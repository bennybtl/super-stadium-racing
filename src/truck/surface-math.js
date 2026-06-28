import { Vector3 } from "@babylonjs/core";

// Small shared vector helpers for projecting motion onto the terrain tangent
// plane. These replace the component-wise project/normalize blocks that were
// hand-inlined in DriftPhysics and Controls. All operate in place on a caller-
// owned Vector3 so the hot path stays allocation-free.

const EPS_SQ = 1e-6;

/**
 * Normalize `v` in place. If it is (near-)zero length, set it to the fallback
 * (fx, fy, fz) instead. Returns `v`.
 */
export function normalizeOr(v, fx, fy, fz) {
  const lenSq = v.x * v.x + v.y * v.y + v.z * v.z;
  if (lenSq > EPS_SQ) {
    v.scaleInPlace(1 / Math.sqrt(lenSq));
  } else {
    v.set(fx, fy, fz);
  }
  return v;
}

/**
 * Project `v` onto the plane defined by unit-ish `normal`, writing the normalized
 * result into `out`. If the projection collapses (v parallel to normal), `out` is
 * set from `fallback`. Returns `out`.
 */
export function projectOnPlane(out, v, normal, fallback) {
  const d = v.x * normal.x + v.y * normal.y + v.z * normal.z;
  out.set(v.x - normal.x * d, v.y - normal.y * d, v.z - normal.z * d);
  const lenSq = out.x * out.x + out.y * out.y + out.z * out.z;
  if (lenSq > EPS_SQ) {
    out.scaleInPlace(1 / Math.sqrt(lenSq));
  } else {
    out.copyFrom(fallback);
  }
  return out;
}

/**
 * Build an orthonormal basis on the terrain tangent plane from a surface `normal`
 * and a `forward` heading. Writes normalized vectors into `outForward` (forward
 * projected onto the plane) and `outRight` (normal × forward). `outNormal` is
 * normalized in place. All three are caller-owned Vector3s.
 */
export function tangentBasis(normal, forward, outNormal, outForward, outRight) {
  normalizeOr(outNormal, 0, 1, 0);
  projectOnPlane(outForward, forward, outNormal, forward);
  Vector3.CrossToRef(outNormal, outForward, outRight);
  normalizeOr(outRight, outForward.z, 0, -outForward.x);
}
