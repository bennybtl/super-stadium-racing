import { MeshBuilder, StandardMaterial, Matrix, Vector3, Engine, Ray } from "@babylonjs/core";

/**
 * groundDecal — shared helpers for projecting a canvas/DynamicTexture onto a
 * mesh as a flat marking. Used by the checkpoint gate decals (Checkpoint.js) and
 * the programmatic decals (DecalManager.js).
 *
 * Those differ in what they draw and how they cache, but share the same
 * projection call, the same "self-lit decal" material recipe, and the same
 * "which mesh do I project onto" raycast — centralised here so the tricky flags
 * can't drift between them.
 */

const PROJECTION_DEPTH = 10; // how far the decal box projects along the normal

// ── Stable rotation frame ────────────────────────────────────────────────────
//
// `MeshBuilder.CreateDecal` derives its own in-plane basis from the surface
// normal via `RotationYawPitchRoll(yaw, pitch, angle)`, where `yaw`/`pitch` come
// from the normal. That basis swings ~90° for a barely-tilted surface (yaw jumps
// as `atan2(n.z, n.x)` crosses a quadrant) and is undefined at the poles — so
// the same stored `angle` looks different on a north- vs east-tilted deck, and a
// decal dragged across surfaces appears to spin on its own.
//
// `decalStableAngle` fixes that: it takes a `rotationRad` measured in an
// EXPLICIT tangent frame (a fixed world axis projected onto the surface) and
// returns the `angle` to hand CreateDecal so its basis lands where we want. The
// relation is exactly additive — `decalStableAngle(n, rot) === rot + K(n)` — so
// callers that still think in CreateDecal's raw angle convert with `rot = raw -
// decalStableAngle(n, 0)` and round-trip bit-for-bit (see projectSurfaceDecal).
const DECAL_REF_AXIS = new Vector3(0, 0, 1);      // world +Z = "rotation 0" direction
const DECAL_REF_FALLBACK = new Vector3(1, 0, 0);  // used when the normal is near ±Z
const DECAL_REF_POLE = 0.9;

/**
 * Signed angle (radians) from CreateDecal's own U axis at `angle = 0` to our
 * stable reference U (`DECAL_REF_AXIS` projected onto the surface), measured
 * about CreateDecal's roll axis (which is -n). This is `decalStableAngle(n, 0)`
 * — the whole normal-dependent part — pulled out so `decalStableAngle` is one
 * exact float add (see there).
 */
function _decalFrameOffset(n) {
  const yaw = -Math.atan2(n.z, n.x) - Math.PI / 2;
  const pitch = Math.atan2(n.y, Math.hypot(n.x, n.z));
  const u0 = Vector3.TransformNormal(Vector3.Right(), Matrix.RotationYawPitchRoll(yaw, pitch, 0));
  const rollAxis = n.scale(-1);

  let ref = DECAL_REF_AXIS;
  if (Math.abs(Vector3.Dot(n, ref)) > DECAL_REF_POLE) ref = DECAL_REF_FALLBACK;
  const refU = ref.subtract(n.scale(Vector3.Dot(n, ref)));
  refU.normalize();

  const cos = Vector3.Dot(u0, refU);
  const sin = Vector3.Dot(Vector3.Cross(u0, refU), rollAxis);
  return Math.atan2(sin, cos);
}

/**
 * The `angle` (radians) to pass `CreateDecal` so the decal's U axis aligns with
 * an explicit tangent frame — `DECAL_REF_AXIS` projected onto the surface —
 * rotated by `rotationRad` about the surface normal. Consistent across every
 * surface orientation, unlike CreateDecal's built-in basis.
 *
 * Exactly additive: `decalStableAngle(n, rot) === rot + decalStableAngle(n, 0)`,
 * so `projectSurfaceDecal`'s raw-angle round-trip is bit-exact.
 *
 * Near-degenerate only where the surface normal is within ~26° of ±Z (a
 * near-north/south-facing wall): the reference axis switches to
 * `DECAL_REF_FALLBACK`, a discontinuity if a decal is dragged straight through
 * that pose. Acceptable for flat + axis-aligned walls; revisit if free-surface
 * dragging needs it.
 */
export function decalStableAngle(normal, rotationRad = 0) {
  return rotationRad + _decalFrameOffset(normal.normalizeToNew());
}

/**
 * The world-space U axis (texture "right") a decal projected by `projectDecal`
 * with this `normal` / `rotationRad` ends up with — i.e. `DECAL_REF_AXIS`
 * projected onto the surface, rotated by `rotationRad` about the normal. The
 * editor's ghost preview aligns to this so it matches the baked decal.
 */
export function decalStableU(normal, rotationRad = 0) {
  const n = normal.normalizeToNew();
  let ref = DECAL_REF_AXIS;
  if (Math.abs(Vector3.Dot(n, ref)) > DECAL_REF_POLE) ref = DECAL_REF_FALLBACK;
  const refU = ref.subtract(n.scale(Vector3.Dot(n, ref)));
  refU.normalize();
  const refV = Vector3.Cross(refU, n);
  return refU.scale(Math.cos(rotationRad)).add(refV.scale(Math.sin(rotationRad)));
}

/**
 * Project a decal onto `target` at a world position, oriented by the surface
 * `normal` and rotated `rotationRad` about it in the stable tangent frame (see
 * decalStableAngle). This is the primitive; `projectSurfaceDecal` /
 * `projectGroundDecal` are back-compatible wrappers.
 */
export function projectDecal(target, name, { position, normal, rotationRad = 0, width, height, projectionDepth = PROJECTION_DEPTH }) {
  const n = normal ? normal.normalizeToNew() : Vector3.Up();
  return MeshBuilder.CreateDecal(name, target, {
    position,
    normal: n,
    size: new Vector3(width, height, projectionDepth),
    angle: decalStableAngle(n, rotationRad),
  });
}

/**
 * Resolve the mesh a decal should project onto: the first `metadata[tag]` mesh a
 * ray hits. Re-resolved at build time so a decal follows its surface through a
 * rebuild — DecalManager casts straight down (`surfaceDecalTarget`, long reach)
 * for a flat decal, else back along `-normal` (`decalTarget`, short reach).
 *
 * The predicate matches on the metadata tag alone — target meshes are commonly
 * `isPickable = false`, and passing a predicate to pickWithRay bypasses that
 * check.
 *
 * @returns {{ mesh: import("@babylonjs/core").AbstractMesh, point: Vector3 } | null}
 */
export function resolveDecalTarget(scene, { origin, direction, reach, tag }) {
  const hit = scene?.pickWithRay(
    new Ray(origin, direction, reach),
    (m) => m?.isEnabled?.() && m.metadata?.[tag] === true,
  );
  if (!hit?.hit || !hit.pickedMesh || !hit.pickedPoint) return null;
  return { mesh: hit.pickedMesh, point: hit.pickedPoint };
}

/**
 * Back-compatible wrapper: `angle` is CreateDecal's raw angle (radians about the
 * normal, in CreateDecal's own basis). Converts to the stable frame so the
 * output is bit-identical to a direct CreateDecal call — new code should use
 * `projectDecal` with `rotationRad` instead.
 */
export function projectSurfaceDecal(target, name, { position, normal, width, height, angle = 0, projectionDepth = PROJECTION_DEPTH }) {
  const n = normal ? normal.normalizeToNew() : Vector3.Up();
  return projectDecal(target, name, {
    position,
    normal: n,
    width,
    height,
    projectionDepth,
    rotationRad: angle - decalStableAngle(n, 0), // reproduce the raw CreateDecal angle
  });
}

/**
 * Project a decal flat onto `ground` at a world position, rotated `angle`
 * (radians) about +Y. `projectionDepth` overrides how far the projector box
 * extends vertically — pass a small value for a thin slab (a bridge deck) so the
 * decal doesn't also print on the underside.
 */
export function projectGroundDecal(ground, name, { position, width, depth, angle, projectionDepth }) {
  return projectSurfaceDecal(ground, name, {
    position,
    normal: Vector3.Up(),
    width,
    height: depth,
    angle,
    projectionDepth,
  });
}

/**
 * Self-lit decal material: the texture supplies both colour (emissive) and
 * alpha, lighting is disabled so the marking reads the same under any scene
 * light, and a negative zOffset keeps it from z-fighting the ground beneath it.
 */
export function makeDecalMaterial(scene, name, texture, opacity = 1) {
  texture.hasAlpha = true;
  const mat = new StandardMaterial(name, scene);
  mat.diffuseTexture = texture;
  mat.emissiveTexture = texture;
  mat.useAlphaFromDiffuseTexture = true;
  mat.disableLighting = true;
  mat.alphaMode = Engine.ALPHA_COMBINE;
  mat.alpha = opacity;
  mat.backFaceCulling = false;
  mat.zOffset = -2;
  return mat;
}
