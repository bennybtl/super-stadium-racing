import { Mesh, VertexData, StandardMaterial, Color3 } from "@babylonjs/core";
import { loadDisplaySettings } from "../settingsStorage.js";

// Arrow geometry (metres), lying flat in the XZ plane and pointing +Z.
const ARROW_LENGTH = 2.2;
const ARROW_WIDTH = 1.6;
// Notch depth of the tail, as a fraction of the length — a plain triangle reads
// as a wedge from the isometric camera; the notch makes the point obvious.
const TAIL_NOTCH = 0.3;

const ORBIT_RADIUS = 4.5;       // distance from the truck centre
const HEIGHT_ABOVE_TRUCK = 1.6; // above the truck origin, clear of the body

const ARROW_COLOR = new Color3(0.3, 1.0, 0.35); // matches the active gate barrels

/**
 * CheckpointArrow — a flat triangular pointer that orbits the player truck and
 * points at the next checkpoint.
 *
 * The target comes from CheckpointManager's active (highlighted) gate, so the
 * arrow follows the same sequence as the green barrels, including alternative
 * gates and reverse races. Hidden when there is no active checkpoint (before
 * the highlight is set, after finishing) or when disabled in display settings.
 */
export class CheckpointArrow {
  constructor(scene, checkpointManager) {
    this.scene = scene;
    this.checkpointManager = checkpointManager;

    this.mesh = this._createMesh(scene);
    this._visible = false;
    this.mesh.setEnabled(false);

    this._enabled = loadDisplaySettings().checkpointArrow !== false;
    this._onDisplaySettingsChanged = (event) => {
      const settings = event?.detail ?? loadDisplaySettings();
      this._enabled = settings?.checkpointArrow !== false;
      if (!this._enabled) this._setVisible(false);
    };
    window.addEventListener('offroad:display-settings-changed', this._onDisplaySettingsChanged);
    scene.onDisposeObservable.add(() => this.dispose());
  }

  /**
   * Place the arrow for this frame.
   * @param {import("@babylonjs/core").AbstractMesh} truckMesh - player truck
   */
  update(truckMesh) {
    if (!this._enabled || !truckMesh) {
      this._setVisible(false);
      return;
    }

    const truckPosition = truckMesh.position;
    const target = this.checkpointManager.getActiveCheckpointPosition(truckPosition);
    if (!target) {
      this._setVisible(false);
      return;
    }

    const dx = target.x - truckPosition.x;
    const dz = target.z - truckPosition.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance < 0.001) {
      this._setVisible(false);
      return;
    }

    const nx = dx / distance;
    const nz = dz / distance;
    this.mesh.position.set(
      truckPosition.x + nx * ORBIT_RADIUS,
      truckPosition.y + HEIGHT_ABOVE_TRUCK,
      truckPosition.z + nz * ORBIT_RADIUS
    );
    this.mesh.rotation.y = Math.atan2(nx, nz);
    this._setVisible(true);
  }

  dispose() {
    window.removeEventListener('offroad:display-settings-changed', this._onDisplaySettingsChanged);
    this.mesh?.material?.dispose();
    this.mesh?.dispose();
    this.mesh = null;
  }

  _setVisible(visible) {
    if (visible === this._visible) return;
    this._visible = visible;
    this.mesh?.setEnabled(visible);
  }

  _createMesh(scene) {
    const mesh = new Mesh("checkpointArrow", scene);
    const halfLength = ARROW_LENGTH / 2;
    const halfWidth = ARROW_WIDTH / 2;

    const vertexData = new VertexData();
    vertexData.positions = [
      0, 0, halfLength,                            // tip
      -halfWidth, 0, -halfLength,                  // back left
      0, 0, -halfLength + ARROW_LENGTH * TAIL_NOTCH, // tail notch
      halfWidth, 0, -halfLength,                   // back right
    ];
    vertexData.indices = [0, 1, 2, 0, 2, 3];
    vertexData.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    vertexData.applyToMesh(mesh);

    const material = new StandardMaterial("checkpointArrowMat", scene);
    material.emissiveColor = ARROW_COLOR;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.alpha = 0.85;
    mesh.material = material;

    mesh.isPickable = false;
    mesh.receiveShadows = false;
    // Draw with the other overlay effects so hills and water never hide the
    // pointer — it is a HUD cue that happens to live in the world.
    mesh.renderingGroupId = 2;
    return mesh;
  }
}
