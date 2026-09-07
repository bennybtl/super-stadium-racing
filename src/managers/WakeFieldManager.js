import { Constants, RawTexture, Texture } from "@babylonjs/core";
import { groupIntoBodies, isWaterFeature } from "../objects/water-field.js";

/**
 * The wake field: a world-space scalar texture recording how disturbed the water
 * is at each point. Trucks stamp into it while wading, it decays every frame,
 * and WaterSurfacePlugin samples it for both surface slope and foam.
 *
 * Phase 2 of WATER_REACTIVE.md.
 *
 * One field per scene covering the union of the track's water bodies, not one
 * per body: the water material is shared scene-wide (see getWaterMaterial in
 * Water.js) and splitting the field would mean splitting the material too.
 * Sizing to the water rather than to the whole track is what keeps the
 * resolution usable — a track with one small pond gets the full 256² over that
 * pond instead of over 200 units of dry land.
 */

// Field resolution. Square, while the world bounds it covers are not — so world
// distances convert to texels per axis, never with one shared scale. (A round
// splat written with a single radius on non-square bounds comes out an ellipse:
// the same aspect trap that once stretched the terrain bake.)
const WAKE_TEX_SIZE = 256;

// Dead border, in world units, kept outside the water on every side. The
// sampler clamps to edge, so anything beyond the bounds reads whatever sits on
// the border texel — padding guarantees that is always zero, and stamps near a
// shoreline never wrap round to the far side.
const WAKE_PAD = 3;

// Seconds for a disturbance to fall to 1/e. Short enough that a wake reads as
// trailing behind the truck rather than as a permanent scar on the pool.
const WAKE_DECAY_TIME = 0.4;

// Splat geometry. The radius is fixed and the intensity ramps with speed: a fast
// truck churns harder, not wider. One splat per truck rather than one per wheel
// or one per side — a truck is ~2 units across, which at this resolution is
// about four texels, so separate contacts merge into the same blob anyway.
const WAKE_RADIUS = 1.7;
const WAKE_MIN_INTENSITY = 0.35;
const WAKE_SPEED_SCALE = 0.055;

/** Union of every water body's bounds, padded. Null when the track has no water. */
function waterBounds(track) {
  const features = (track?.features ?? []).filter(isWaterFeature);
  if (features.length === 0) return null;

  const bodies = groupIntoBodies(track, features);
  if (bodies.length === 0) return null;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const body of bodies) {
    minX = Math.min(minX, body.bounds.minX);
    maxX = Math.max(maxX, body.bounds.maxX);
    minZ = Math.min(minZ, body.bounds.minZ);
    maxZ = Math.max(maxZ, body.bounds.maxZ);
  }
  if (!Number.isFinite(minX)) return null;

  return {
    minX: minX - WAKE_PAD,
    minZ: minZ - WAKE_PAD,
    sizeX: (maxX - minX) + WAKE_PAD * 2,
    sizeZ: (maxZ - minZ) + WAKE_PAD * 2,
  };
}

export class WakeField {
  constructor(scene, bounds) {
    this.bounds = bounds;
    this._data = new Uint8Array(WAKE_TEX_SIZE * WAKE_TEX_SIZE);
    this._texture = RawTexture.CreateRTexture(
      this._data,
      WAKE_TEX_SIZE,
      WAKE_TEX_SIZE,
      scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
      // Explicit, and not optional: CreateRTexture defaults `type` to
      // TEXTURETYPE_FLOAT (1), not to unsigned byte. Left at the default it
      // reads this Uint8Array as R32F — a quarter of the data it wants — and
      // the field renders as nothing at all.
      Constants.TEXTURETYPE_UNSIGNED_BYTE
    );
    // Clamp, not wrap: a stamp at one shoreline must never bleed out of the
    // opposite edge. The padded border it clamps to is permanently zero.
    this._texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this._texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this._texture.gammaSpace = false;

    // World units per texel, per axis — the bounds are rarely square.
    this._texelX = WAKE_TEX_SIZE / bounds.sizeX;
    this._texelZ = WAKE_TEX_SIZE / bounds.sizeZ;

    // Skip the decay pass and the upload entirely once the field has emptied,
    // which is every frame on a track nobody is driving through water on.
    this._idle = true;
    this._dirty = false;

    // Opt-in diagnostic, off by default: set `window.__wakeDiag = true` in the
    // console to have the field report whether it is being stamped at all and
    // how hot it is getting. Answers "is this the field or the shading?"
    // without a rebuild.
    this._stampCount = 0;
    this._diagTimer = 0;

    this._observer = scene.onBeforeRenderObservable.add(() => {
      this.update(Math.min(0.05, scene.getEngine().getDeltaTime() / 1000));
    });
  }

  get texture() {
    return this._texture;
  }

  /**
   * Disturb the water at a world point. Silently ignores points outside the
   * field, which is most of the track and every truck on dry land.
   *
   * @param {number} x world X
   * @param {number} z world Z
   * @param {number} speed truck speed, in world units per second
   */
  stamp(x, z, speed) {
    const { minX, minZ } = this.bounds;
    const cx = (x - minX) * this._texelX;
    const cz = (z - minZ) * this._texelZ;
    const rx = WAKE_RADIUS * this._texelX;
    const rz = WAKE_RADIUS * this._texelZ;
    if (cx < -rx || cz < -rz || cx > WAKE_TEX_SIZE + rx || cz > WAKE_TEX_SIZE + rz) return;

    const peak = Math.min(1, WAKE_MIN_INTENSITY + Math.max(0, speed) * WAKE_SPEED_SCALE) * 255;
    const i0 = Math.max(0, Math.floor(cx - rx));
    const i1 = Math.min(WAKE_TEX_SIZE - 1, Math.ceil(cx + rx));
    const j0 = Math.max(0, Math.floor(cz - rz));
    const j1 = Math.min(WAKE_TEX_SIZE - 1, Math.ceil(cz + rz));

    for (let j = j0; j <= j1; j++) {
      // Normalised per axis, so the splat is round in world space even when the
      // texels are not square.
      const dz = (j + 0.5 - cz) / rz;
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5 - cx) / rx;
        const d2 = dx * dx + dz * dz;
        if (d2 >= 1) continue;
        // Smooth falloff to zero at the rim, so overlapping stamps along a path
        // blend into a trail instead of reading as a row of discs.
        const v = peak * (1 - d2) * (1 - d2);
        const k = j * WAKE_TEX_SIZE + i;
        // Max, not add: a truck sitting still would otherwise saturate its own
        // footprint to white within a few frames.
        if (v > this._data[k]) this._data[k] = v;
      }
    }
    this._dirty = true;
    this._stampCount++;
  }

  /** Decay the whole field and push it to the GPU. */
  update(dt) {
    if (this._idle && !this._dirty) return;

    const k = Math.exp(-dt / WAKE_DECAY_TIME);
    const data = this._data;
    let max = 0;
    for (let i = 0; i < data.length; i++) {
      // Values under one byte are floored to zero rather than left to converge
      // on it, so the field actually empties and the idle skip can engage.
      const v = data[i] * k;
      const b = v < 1 ? 0 : v;
      data[i] = b;
      if (b > max) max = b;
    }
    this._texture.update(data);
    this._idle = max === 0;
    this._dirty = false;

    if (typeof window !== 'undefined' && window.__wakeDiag === true) {
      this._diagTimer += dt;
      if (this._diagTimer >= 1) {
        console.debug(`[wake-diag] stamps/s ${this._stampCount}, peak ${max}/255, bounds`, this.bounds);
        this._diagTimer = 0;
        this._stampCount = 0;
      }
    }
  }

  dispose() {
    this._observer?.remove();
    this._observer = null;
    this._texture?.dispose();
    this._texture = null;
  }
}

/**
 * Build the scene's wake field and publish it on `scene.metadata.wakeField`,
 * replacing any previous one. Leaves the slot empty on a track with no water,
 * which is what makes every consumer a `?.` away from a no-op.
 *
 * @param {import('../world/track.js').Track} currentTrack
 * @param {BABYLON.Scene} scene
 * @returns {WakeField|null}
 */
export function createWakeField(currentTrack, scene) {
  scene.metadata ??= {};
  scene.metadata.wakeField?.dispose();
  scene.metadata.wakeField = null;

  const bounds = waterBounds(currentTrack);
  if (!bounds) return null;

  const field = new WakeField(scene, bounds);
  scene.metadata.wakeField = field;
  return field;
}
