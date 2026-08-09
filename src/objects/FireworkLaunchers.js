import { MeshBuilder, StandardMaterial, Color3, Vector3, TransformNode } from "@babylonjs/core";
import { basicColors } from "../constants";

/** Mortar can dimensions in world units. */
const CAN_HEIGHT = 1.3;
const CAN_DIAMETER_BOTTOM = 0.62;
const CAN_DIAMETER_TOP = 0.8;
const RIM_HEIGHT = 0.14;
const RIM_DIAMETER = 0.95;

const BODY_COLOR = new Color3(0.14, 0.13, 0.17);
/** In-race rim: a plain gunmetal band, so a can reads as a prop on the track. */
const RIM_COLOR = new Color3(0.32, 0.32, 0.36);
const RIM_EMISSIVE = Color3.Black();
/** Editor rim: the zone's own gizmo hue, matching its cylinder and handles. */
const EDITOR_RIM_COLOR = basicColors.purple.diffuse;
const EDITOR_RIM_EMISSIVE = basicColors.purple.emissive;

/**
 * FireworkLaunchers — the pair of mortar cans a firework action zone fires from.
 *
 * Two cans sit on opposite sides of the zone, at ±radius along the local X axis
 * of a container rotated to `feature.heading` — the same arrangement as a
 * checkpoint's barrels, so the zone can be spun to line the cans up with the
 * direction of travel. Each can is dropped onto the terrain under it, so a pair
 * straddling a slope still sits on the ground.
 *
 * Used by both FireworksManager (in game) and ActionZoneEditor (as the gizmo),
 * so the cans stand exactly where the race will fire from. The only difference
 * is the rim: the editor glows it in the zone's gizmo hue, the race leaves it a
 * plain metal band so nothing on the track looks like an editor overlay.
 */
export class FireworkLaunchers {
  /**
   * @param {object} feature  track feature of type "actionZone", zoneType "fireworks"
   * @param {Track} track     used to sample terrain height
   * @param {import('@babylonjs/core').Scene} scene
   * @param {{ editorTint?: boolean }} [options]  editor gizmos tint the rim
   */
  constructor(feature, track, scene, options = {}) {
    this.feature = feature;
    this._track = track;
    this._scene = scene;

    this.container = new TransformNode('fireworkLaunchers', scene);

    this._bodyMat = new StandardMaterial('fwCanBody', scene);
    this._bodyMat.diffuseColor = BODY_COLOR.clone();
    this._bodyMat.specularColor = new Color3(0.15, 0.15, 0.18);

    const tinted = options.editorTint === true;
    this._rimMat = new StandardMaterial('fwCanRim', scene);
    this._rimMat.diffuseColor = (tinted ? EDITOR_RIM_COLOR : RIM_COLOR).clone();
    this._rimMat.emissiveColor = (tinted ? EDITOR_RIM_EMISSIVE : RIM_EMISSIVE).clone();
    this._rimMat.specularColor = new Color3(0.2, 0.2, 0.2);

    this.cans = [this._createCan('fwCanA', 1), this._createCan('fwCanB', -1)];
    this.refresh();
  }

  /**
   * World-space muzzle positions, one per can — where shells leave the tube.
   * @returns {Vector3[]}
   */
  get launchPoints() {
    return this.cans.map(can => {
      const p = can.root.getAbsolutePosition();
      return new Vector3(p.x, p.y + CAN_HEIGHT, p.z);
    });
  }

  /**
   * Re-seat both cans for the feature's current centre, radius and heading.
   * Call after any edit that moves or turns the zone.
   */
  refresh() {
    const f = this.feature;
    const cx = f.x ?? 0;
    const cz = f.z ?? 0;
    const heading = f.heading ?? 0;
    const offset = Math.max(2, f.radius ?? 15);
    const centerY = this._track.getHeightAt(cx, cz);

    this.container.position.set(cx, centerY, cz);
    this.container.rotation.y = heading;

    // Local +X maps to world (cos, 0, −sin) under a Y rotation, so each can's
    // own terrain height has to be sampled at its rotated world position.
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    for (const can of this.cans) {
      const localX = can.side * offset;
      const worldX = cx + localX * cos;
      const worldZ = cz - localX * sin;
      can.root.position.set(localX, this._track.getHeightAt(worldX, worldZ) - centerY, 0);
    }

    // Force the world matrices now so launchPoints is correct even when a volley
    // fires in the same frame the zone was built or moved.
    this.container.computeWorldMatrix(true);
    for (const can of this.cans) can.root.computeWorldMatrix(true);
  }

  dispose() {
    for (const can of this.cans) can.root.dispose(false, false);
    this.cans = [];
    this._bodyMat?.dispose();
    this._rimMat?.dispose();
    this.container?.dispose();
  }

  _createCan(name, side) {
    const root = new TransformNode(name, this._scene);
    root.parent = this.container;

    const body = MeshBuilder.CreateCylinder(`${name}Body`, {
      height: CAN_HEIGHT,
      diameterTop: CAN_DIAMETER_TOP,
      diameterBottom: CAN_DIAMETER_BOTTOM,
      tessellation: 14,
    }, this._scene);
    body.position.y = CAN_HEIGHT / 2;
    body.material = this._bodyMat;
    body.isPickable = false;
    body.parent = root;

    const rim = MeshBuilder.CreateCylinder(`${name}Rim`, {
      height: RIM_HEIGHT,
      diameter: RIM_DIAMETER,
      tessellation: 14,
    }, this._scene);
    rim.position.y = CAN_HEIGHT - RIM_HEIGHT / 2;
    rim.material = this._rimMat;
    rim.isPickable = false;
    rim.parent = root;

    return { root, body, rim, side };
  }
}
