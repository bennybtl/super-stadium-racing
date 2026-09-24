import {
  MeshBuilder,
  StandardMaterial,
  SpotLight,
  TransformNode,
  Vector3,
  Color3,
  Texture,
} from "@babylonjs/core";
import concreteUrl from "../assets/textures/concrete_2.texture.png?url";

// Geometry constants (metres). A thin pole carries a horizontal bank of four
// floodlight heads on a backplate. The bank yaws around the pole (rotation) and
// pitches from horizontal to straight-down (tilt). Height / spread / intensity /
// colour are per-feature.
const POLE_DIAM = 0.22;
const HEAD_COUNT = 4;
const HEAD_W = 0.72;      // each head housing, along the bank
const HEAD_H = 0.5;
const HEAD_D = 0.5;
const HEAD_GAP = 0.16;    // gap between heads
const BANK_W = HEAD_COUNT * HEAD_W + (HEAD_COUNT - 1) * HEAD_GAP;
const BACKPLATE_H = 0.26;
const BACKPLATE_D = 0.34;
// Concrete footing the pole stands in: a squat, slightly tapered pier. Sunk
// just below grade so slopes don't show a gap, but only just — caster
// geometry buried deeper throws a phantom shadow through the non-occluding
// terrain (see the bridge/drive-box double-shadow fix).
const BASE_DIAM_BOTTOM = 1.3;
const BASE_DIAM_TOP = 1.05;
const BASE_H = 0.75;      // above grade
const BASE_SINK = 0.15;   // below grade
const CONCRETE_TILE_M = 6; // world metres per texture repeat, as BorderWall
// Trucks collide with the base as a round post: StaticBodyCollisionManager's
// polyline collider on a near-zero-length segment, thickened to the base
// radius (a box collider would catch trucks on invisible square corners).
const BASE_COLLIDER_RADIUS = (BASE_DIAM_BOTTOM + BASE_DIAM_TOP) / 4;
const BASE_COLLIDER_HALF_LEN = 0.001;
// Shadow cone = visible pool (`spread`) × this; see _applyLight.
const SHADOW_POOL_MARGIN = 1.15;

// Each pole is a real SpotLight, one of the `maxSimultaneousLights` slots
// every material evaluates (scene-wide hook in SceneBuilder.buildScene raises
// this above StandardMaterial's default of 4). A night scene already spends
// slots on the ambient fill, the moon, and the vehicle-headlights clustered
// container — so the editor caps track lights per track. Track lights don't
// use clustered lighting themselves (clustered lights can't cast shadows, and
// these need theirs) — revisit if a track needs more than this.
export const MAX_TRACK_LIGHTS = 6;

export const TRACK_LIGHT_DEFAULTS = {
  height: 8,       // pole height (metres)
  spread: 45,      // spotlight cone angle (degrees, full angle)
  intensity: 40,   // spotlight intensity
  color: 'warm',
  tilt: 45,        // aim below horizontal (deg): 0 = level, 90 = straight down
  rotation: 0,     // bank yaw around the pole (degrees)
};

// Named light colours → RGB. Keeps the panel a simple dropdown.
const LIGHT_COLORS = {
  warm:  new Color3(1.0, 0.85, 0.6),
  white: new Color3(1.0, 0.98, 0.95),
  cool:  new Color3(0.7, 0.82, 1.0),
  amber: new Color3(1.0, 0.6, 0.2),
};

export function resolveTrackLightColor(name) {
  return (LIGHT_COLORS[name] ?? LIGHT_COLORS.warm);
}

/**
 * TrackLight — a floodlight pole for night-race tracks. The pole carries a
 * yaw node (rotation) → tilt node (aim) → a backplate with four glowing lens
 * heads. A single SpotLight parented to the tilt node does the illumination for
 * the whole bank, so a pole costs one real light regardless of the head count.
 *
 * The feature object is mutated in place. Adjustable: height, spread, intensity,
 * colour, tilt, rotation.
 *
 * Night is a per-race setting, so the pole only actually illuminates when the
 * scene is in night mode (`scene.metadata.night`). Otherwise the SpotLight is
 * disabled and the lamp blocks render dark — a floodlight that's switched off.
 * `setNight(bool)` flips this live (used by the editor's night-preview toggle).
 */
export class TrackLight {
  /**
   * @param {object}        feature  – { type:'trackLight', x, z, height, spread, intensity, color, tilt, rotation }
   * @param {number}        groundY  – terrain height at (feature.x, feature.z)
   * @param {BABYLON.Scene} scene
   * @param {ShadowGenerator|null} shadows
   */
  constructor(feature, groundY, scene, shadows = null) {
    this.feature = feature;
    this._scene = scene;
    this._shadows = shadows;

    feature.height    = feature.height    ?? TRACK_LIGHT_DEFAULTS.height;
    feature.spread    = feature.spread    ?? TRACK_LIGHT_DEFAULTS.spread;
    feature.intensity = feature.intensity ?? TRACK_LIGHT_DEFAULTS.intensity;
    feature.color     = feature.color     ?? TRACK_LIGHT_DEFAULTS.color;
    feature.tilt      = feature.tilt      ?? TRACK_LIGHT_DEFAULTS.tilt;
    feature.rotation  = feature.rotation  ?? TRACK_LIGHT_DEFAULTS.rotation;

    const { x, z } = feature;
    const tag = `${x}_${z}`;
    this.container = new TransformNode(`trackLight_${tag}`, scene);
    this.container.position = new Vector3(x, groundY, z);

    const tint = resolveTrackLightColor(feature.color);

    // ── Materials ──
    this._poleMat = new StandardMaterial(`trackLightPoleMat_${tag}`, scene);
    this._poleMat.diffuseColor = new Color3(0.12, 0.12, 0.14);
    this._poleMat.specularColor = new Color3(0.2, 0.2, 0.2);

    this._headMat = new StandardMaterial(`trackLightHeadMat_${tag}`, scene);
    this._headMat.diffuseColor = new Color3(0.1, 0.1, 0.12);
    this._headMat.specularColor = new Color3(0.15, 0.15, 0.15);

    // Lenses read as bright white hotspots so the eye can find the source, no
    // matter what colour the beam itself is tinted.
    this._lensMat = new StandardMaterial(`trackLightLensMat_${tag}`, scene);
    this._lensMat.emissiveColor = new Color3(1, 1, 1);
    this._lensMat.diffuseColor = new Color3(1, 1, 1);
    this._lensMat.disableLighting = true;

    this._baseMat = new StandardMaterial(`trackLightBaseMat_${tag}`, scene);
    const concrete = new Texture(concreteUrl, scene);
    concrete.uScale = (Math.PI * BASE_DIAM_BOTTOM) / CONCRETE_TILE_M;
    concrete.vScale = (BASE_H + BASE_SINK) / CONCRETE_TILE_M;
    this._baseMat.diffuseTexture = concrete;
    this._baseMat.specularColor = new Color3(0.05, 0.05, 0.05);

    // ── Concrete base (fixed; doesn't follow height) ──
    this.base = MeshBuilder.CreateCylinder(`trackLightBase_${tag}`, {
      height: BASE_H + BASE_SINK,
      diameterTop: BASE_DIAM_TOP,
      diameterBottom: BASE_DIAM_BOTTOM,
      tessellation: 20,
    }, scene);
    this.base.parent = this.container;
    this.base.position.y = (BASE_H - BASE_SINK) / 2;
    this.base.material = this._baseMat;
    this.base.isPickable = true;
    this._shadows?.addShadowCaster?.(this.base);
    this._baseCollider = { xs: [0, 0], zs: [0, 0], topY: [0, 0], botY: [0, 0], closed: false, halfThick: BASE_COLLIDER_RADIUS, landOnTop: false };
    this.base.metadata = { ...(this.base.metadata ?? {}), polylineCollider: this._baseCollider };
    this._updateBaseCollider();

    // ── Pole (fixed, vertical) ──
    this.pole = MeshBuilder.CreateCylinder(`trackLightPole_${tag}`, {
      height: 1,
      diameter: POLE_DIAM,
      tessellation: 10,
    }, scene);
    this.pole.parent = this.container;
    this.pole.material = this._poleMat;
    this.pole.isPickable = true;
    this._shadows?.addShadowCaster?.(this.pole);

    // ── Yaw node — spins the whole bank around the pole ──
    this.yaw = new TransformNode(`trackLightYaw_${tag}`, scene);
    this.yaw.parent = this.container;

    // ── Tilt node — pitches the bank from level to straight-down ──
    this.tilt = new TransformNode(`trackLightTilt_${tag}`, scene);
    this.tilt.parent = this.yaw;

    // ── Backplate — the bank spine the heads bolt to ──
    this.backplate = MeshBuilder.CreateBox(`trackLightBack_${tag}`, {
      width: BANK_W + 0.2,
      height: BACKPLATE_H,
      depth: BACKPLATE_D,
    }, scene);
    this.backplate.parent = this.tilt;
    this.backplate.material = this._headMat;
    this.backplate.isPickable = true;
    this._shadows?.addShadowCaster?.(this.backplate);

    // ── Four fixtures in a row along local X. Each is a bright emissive lamp
    //    block on a short dark stalk, so it reads as a lit floodlight from any
    //    angle — top-down in the editor or oblique in the race. ──
    this._pickMeshes = [this.base, this.pole, this.backplate];
    this.stalks = [];
    this.lenses = [];
    const x0 = -BANK_W / 2 + HEAD_W / 2;
    const stalkH = 0.16;
    const stalkY = -stalkH / 2 - BACKPLATE_H / 2;
    const lampY = stalkY - stalkH / 2 - HEAD_H / 2;
    for (let i = 0; i < HEAD_COUNT; i++) {
      const hx = x0 + i * (HEAD_W + HEAD_GAP);

      const stalk = MeshBuilder.CreateBox(`trackLightStalk_${tag}_${i}`, {
        width: 0.18, height: stalkH, depth: 0.18,
      }, scene);
      stalk.parent = this.tilt;
      stalk.material = this._headMat;
      stalk.position.set(hx, stalkY, 0);
      stalk.isPickable = true;
      this.stalks.push(stalk);
      this._pickMeshes.push(stalk);

      const lens = MeshBuilder.CreateBox(`trackLightLens_${tag}_${i}`, {
        width: HEAD_W, height: HEAD_H, depth: HEAD_D,
      }, scene);
      lens.parent = this.tilt;
      lens.material = this._lensMat;
      lens.position.set(hx, lampY, 0);
      lens.isPickable = true;
      this._shadows?.addShadowCaster?.(lens);
      this.lenses.push(lens);
      this._pickMeshes.push(lens);
    }

    // ── The illuminating spotlight — one for the whole bank ──
    this.light = new SpotLight(
      `trackLightSpot_${tag}`,
      new Vector3(0, 0, 0),
      new Vector3(0, -1, 0),   // local to the tilt node; aims with the bank
      Math.PI / 4,
      1,                       // gentle axial falloff — see _applyLight for the edge
      scene
    );
    this.light.parent = this.tilt;
    this.light.diffuse = tint.clone();
    this.light.specular = tint.clone();

    this._night = scene?.metadata?.night === true;
    this._applyTransform();
    this._applyLight();
    this._applyNight();
  }

  /** Enable/disable the illumination + lamp glow for night vs day. */
  _applyNight() {
    const lit = this._night;
    this.light.setEnabled(lit);
    // Lamp faces: bright white when lit, dark grey (an off floodlight) otherwise.
    const v = lit ? 1 : 0.05;
    this._lensMat.emissiveColor.copyFromFloats(v, v, v);
    // The spot casts shadows only while lit — a per-light 2D shadow map, added on
    // top of the fixed stadium key set (see ShadowCasterGroup.addLight).
    if (lit) {
      const gen = this._shadows?.addLight?.(this.light, { mapSize: 512, refreshRate: 2 });
      // Leave this light's own fixture out of its own map: the housing sits
      // right at the emitter, so its backplate and lenses threw hard edges and
      // spreading wedges across the whole pool. The fixture still casts under
      // the moon and the other poles.
      for (const m of [this.pole, this.backplate, ...this.lenses]) gen?.removeShadowCaster?.(m);
    } else {
      this._shadows?.removeLight?.(this.light);
    }
  }

  setNight(on) {
    this._night = !!on;
    this._applyNight();
  }

  // ── Transform (height, tilt, rotation) ──────────────────────────────────────

  /** Reposition the pole and re-orient the yaw / tilt nodes. */
  _applyTransform() {
    const h = Math.max(1, this.feature.height ?? TRACK_LIGHT_DEFAULTS.height);
    this.pole.scaling.y = h;
    this.pole.position.y = h / 2;

    // Bank sits at the top of the pole.
    this.yaw.position.y = h;
    this.yaw.rotation.y = (this.feature.rotation ?? 0) * (Math.PI / 180);

    // tilt = degrees below horizontal. A rotation of (90 - tilt)° about X takes
    // the bank's rest aim (straight down) toward the horizon.
    const tiltDeg = Math.max(0, Math.min(90, this.feature.tilt ?? TRACK_LIGHT_DEFAULTS.tilt));
    this.tilt.rotation.x = (90 - tiltDeg) * (Math.PI / 180);
  }

  /** Re-apply cone angle, edge softness, shadow cone, range and intensity. */
  _applyLight() {
    const h = Math.max(1, this.feature.height ?? TRACK_LIGHT_DEFAULTS.height);
    const spreadDeg = Math.max(5, Math.min(120, this.feature.spread ?? TRACK_LIGHT_DEFAULTS.spread));

    // `spread` is the intended visible pool angle. StandardMaterial's spotlight
    // has a hard geometric cutoff at `angle` and only feathers via
    // `pow(cos, exponent)` (its `innerAngle` is a PBR-only feature — inert here),
    // so we push `angle` well past the visible pool and let a fairly high
    // `exponent` do the falloff. Exponent is solved so brightness has dropped to
    // ~12% by the requested half-angle, which lands the fade entirely inside the
    // cone and keeps the hard edge out of sight.
    const halfRad = (spreadDeg * Math.PI) / 180 / 2;
    const gateDeg = Math.min(174, spreadDeg * 1.8);
    this.light.angle = (gateDeg * Math.PI) / 180;
    const cosHalf = Math.max(0.02, Math.cos(halfRad));
    this.light.exponent = Math.max(1.5, Math.min(48, Math.log(0.12) / Math.log(cosHalf)));
    // The shadow map only needs the visible pool, not that padded cone: past
    // `spread` the light is under ~12%. Covering the full cone spread a 512²
    // map so thin that walls (~0.3 thick) dropped out near their base. A
    // little margin keeps the pool's soft edge inside the map.
    this.light.shadowAngleScale = Math.min(1, (spreadDeg * SHADOW_POOL_MARGIN) / gateDeg);

    // Shallow tilts throw the beam much farther across the track, so scale the
    // reach up as the aim drops toward the horizon.
    const tiltDeg = Math.max(0, Math.min(90, this.feature.tilt ?? TRACK_LIGHT_DEFAULTS.tilt));
    const reach = h / Math.max(0.2, Math.sin((tiltDeg * Math.PI) / 180));
    this.light.range = Math.min(h * 8, Math.max(h * 3.5, reach * 2));
    // Shadow depth range = the beam's reach, so the group's world-unit PCF
    // bias maps to a sensible fraction (see ShadowCasterGroup._applyBias).
    this.light.shadowMinZ = 0.5;
    this.light.shadowMaxZ = this.light.range;
    this._shadows?.refreshLight?.(this.light);
    this.light.intensity = Math.max(0, this.feature.intensity ?? TRACK_LIGHT_DEFAULTS.intensity);
  }

  /** World-space Y of the top of the pole — editor parks its handle above. */
  get topY() {
    const h = Math.max(1, this.feature.height ?? TRACK_LIGHT_DEFAULTS.height);
    return this.container.position.y + h + 0.3;
  }

  moveTo(x, z, groundY) {
    this.feature.x = x;
    this.feature.z = z;
    this.container.position.copyFromFloats(x, groundY, z);
    this._updateBaseCollider();
  }

  /** Collider is in world space — keep it on the base when the pole moves. */
  _updateBaseCollider() {
    const { x, y, z } = this.container.position;
    const c = this._baseCollider;
    c.xs[0] = c.xs[1] = x;
    c.zs[0] = z - BASE_COLLIDER_HALF_LEN;
    c.zs[1] = z + BASE_COLLIDER_HALF_LEN;
    c.topY[0] = c.topY[1] = y + BASE_H;
    c.botY[0] = c.botY[1] = y - BASE_SINK;
  }

  setHeight(height) {
    this.feature.height = Math.max(1, height);
    this._applyTransform();
    this._applyLight();
  }

  setSpread(spread) {
    this.feature.spread = spread;
    this._applyLight();
  }

  setIntensity(intensity) {
    this.feature.intensity = Math.max(0, intensity);
    this.light.intensity = this.feature.intensity;
  }

  setTilt(tilt) {
    this.feature.tilt = Math.max(0, Math.min(90, tilt));
    this._applyTransform();
    this._applyLight();
  }

  setRotation(degrees) {
    this.feature.rotation = degrees;
    this._applyTransform();
  }

  setColor(name) {
    this.feature.color = name;
    const tint = resolveTrackLightColor(name);
    // Lenses stay white; only the projected beam takes the tint.
    this.light.diffuse = tint.clone();
    this.light.specular = tint.clone();
  }

  containsMesh(mesh) {
    return this._pickMeshes.includes(mesh);
  }

  dispose() {
    if (this.light) this._shadows?.removeLight?.(this.light);
    this.light?.dispose();
    for (const m of this._pickMeshes ?? []) m?.dispose();
    this.tilt?.dispose();
    this.yaw?.dispose();
    this._poleMat?.dispose();
    this._baseMat?.dispose(false, true);
    this._headMat?.dispose();
    this._lensMat?.dispose();
    this.container?.dispose();
  }
}
