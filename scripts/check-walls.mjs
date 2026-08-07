// Poly-wall collider regression checks: `npm run check:walls`
//
// Poly walls collide as an analytic centerline ribbon (mesh.metadata.
// polylineCollider, resolved by StaticBodyCollisionManager) rather than as a
// chain of box segments. That rework exists to kill a specific class of bug —
// phantom hits from collider faces that don't exist in the real shape — so the
// cases pinned here are the ones that were actually broken:
//
//   1. sliding    — driving alongside a curved wall must not scrub forward speed
//                   beyond the wall's own friction. The box chain used to eject
//                   the truck at segment seams, reading as a hard stop.
//   2. head-on    — a real face impact must still bounce and lock controls.
//   3. tunneling  — a truck crossing the wall body in one frame is pushed back.
//   4. height     — a truck above the wall top passes over it untouched.
//   5. open ends  — driving around a wall's tip must NOT collide. The tunneling
//                   guard measures "which side" against the last segment's
//                   extended line, so rounding the tip flips it; the guard only
//                   applies to interior closest-points.
//
// Pure geometry + velocity math — no scene, no physics engine.
// Exits non-zero on any failure.

import { Vector3 } from '@babylonjs/core';
import { StaticBodyCollisionManager } from '../src/managers/StaticBodyCollisionManager.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` ${detail}` : ''}`);
};

const RETAIN = 0.95; // per-60fps-frame along-wall speed retention
const WALL_TOP = 2, WALL_BOT = -2;

/**
 * Build a manager holding one polyline wall. The mesh AABB is modelled on the
 * real ribbon's bounding box — which matters: the broadphase gates on it, so a
 * test point outside the box never reaches the resolver and would pass for the
 * wrong reason.
 */
function makeWall(xs, zs) {
  const collider = {
    xs, zs,
    topY: xs.map(() => WALL_TOP),
    botY: xs.map(() => WALL_BOT),
    halfThick: 0.25, closed: false, retain: RETAIN,
  };
  const mesh = {
    metadata: { polylineCollider: collider },
    isDisposed: () => false,
    isEnabled: () => true,
    getBoundingInfo: () => ({ boundingBox: {
      minimumWorld: new Vector3(Math.min(...xs) - 1, WALL_BOT, Math.min(...zs) - 1),
      maximumWorld: new Vector3(Math.max(...xs) + 1, WALL_TOP, Math.max(...zs) + 1),
    } }),
  };
  return new StaticBodyCollisionManager({ meshes: [mesh] });
}

/** Walk a corner list at ~2u spacing, the way PolyWall resamples a centerline. */
function resample(corners, step = 2) {
  const xs = [corners[0].x], zs = [corners[0].z];
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1], b = corners[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 1; k <= n; k++) {
      xs.push(a.x + (b.x - a.x) * (k / n));
      zs.push(a.z + (b.z - a.z) * (k / n));
    }
  }
  return { xs, zs };
}

// Quarter arc, radius 30 — the curved case, for sliding/impact/tunneling.
const arcXs = [], arcZs = [];
for (let a = 0; a <= Math.PI / 2 + 1e-9; a += 2 / 30) {
  arcXs.push(Math.cos(a) * 30);
  arcZs.push(Math.sin(a) * 30);
}
const xs = arcXs, zs = arcZs;
const mgr = makeWall(arcXs, arcZs);

function makeTruck(x, z, heading, vx, vz) {
  return {
    mesh: { position: new Vector3(x, 0.75, z), uniqueId: 1 },
    state: { velocity: new Vector3(vx, 0, vz), heading },
    width: 1.5, depth: 3.0, halfHeight: 0.75, radius: 1.7,
  };
}
const setPrev = (x, y, z) => mgr._prevPositions.set(1, new Vector3(x, y, z));

// ── 1. Sliding alongside the wall, sampled all along the arc ────────────────
// The truck hugs the face and drifts very slightly into it each frame. Forward
// speed must survive everywhere — no seam may stop it.
{
  let minRatio = 1;
  let worstAngle = 0;
  for (let a = 0.1; a < Math.PI / 2 - 0.1; a += 0.017) {
    const r = 30.9; // inside the Minkowski reach, so it resolves every frame
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const tx = -Math.sin(a), tz = Math.cos(a); // tangent
    const speed = 20;
    const truck = makeTruck(x, z, Math.atan2(tx, tz), tx * speed, tz * speed);
    setPrev(x - tx * 0.33 + 0.02 * Math.cos(a), 0.75, z - tz * 0.33 + 0.02 * Math.sin(a));
    mgr.update([truck], 1 / 60);
    const v = truck.state.velocity;
    const ratio = (v.x * tx + v.z * tz) / speed;
    if (ratio < minRatio) { minRatio = ratio; worstAngle = a; }
  }
  // One frame of wall friction is the floor; anything less is a phantom hit.
  check('slide: forward speed survives every seam', minRatio > RETAIN - 0.01,
    `(min ratio ${minRatio.toFixed(3)} at ${worstAngle.toFixed(2)} rad, friction floor ${RETAIN})`);
}

// ── 2. Head-on impact still bounces and locks controls ──────────────────────
{
  const a = Math.PI / 4;
  const x = Math.cos(a) * 32, z = Math.sin(a) * 32;
  const inX = -Math.cos(a), inZ = -Math.sin(a);
  const truck = makeTruck(x + inX * 1.6, z + inZ * 1.6, Math.atan2(inX, inZ), inX * 20, inZ * 20);
  setPrev(x, 0.75, z);
  mgr.update([truck], 1 / 60);
  const v = truck.state.velocity;
  const outward = v.x * -inX + v.z * -inZ;
  check('head-on: rebounds off the face', outward > 0, `(outward ${outward.toFixed(2)})`);
  check('head-on: suppresses drive + steer', !!truck.state.noDriveUntil && !!truck.state.noSteerUntil);
}

// ── 3. Tunneling through the wall body is caught ────────────────────────────
{
  const a = Math.PI / 4;
  const nX = Math.cos(a), nZ = Math.sin(a);
  const truck = makeTruck(nX * 28.5, nZ * 28.5, Math.atan2(-nX, -nZ), -nX * 60, -nZ * 60);
  setPrev(nX * 31.5, 0.75, nZ * 31.5);
  mgr.update([truck], 1 / 60);
  const r = Math.hypot(truck.mesh.position.x, truck.mesh.position.z);
  check('tunneling: 60u/s crossing is pushed back out', r > 30.25, `(radius ${r.toFixed(2)})`);
}

// ── 4. Above the wall top → no contact ──────────────────────────────────────
{
  const a = Math.PI / 4;
  const truck = makeTruck(Math.cos(a) * 30, Math.sin(a) * 30, 0, 5, 0);
  truck.mesh.position.y = 3.5; // underside 2.75, wall top 2
  const before = truck.mesh.position.clone();
  setPrev(before.x, before.y, before.z);
  mgr.update([truck], 1 / 60);
  check('height: clears the top untouched', truck.mesh.position.equals(before));
}

// ── 5. Rounding an open end must not collide ────────────────────────────────
// Needs a HOOKED wall, not the arc: past a lone wall's tip you immediately leave
// its bounding box and the broadphase rejects you, so the guard is never
// reached. A hook curls back, so the region beyond its free end sits well inside
// the box — which is exactly the real-world shape where this bit.
//
// Wall: (0,0) → (40,0) → (40,40) → (0,40) → (0,15), free end pointing −Z.
// The truck crosses that end's extended line 5u past the tip. The tunneling
// guard measures "which side" against that extended line, so without the
// open-end exemption it reads as a wall crossing and ejects the truck — the wall
// behaves as if it ran on forever.
{
  const { xs: hx, zs: hz } = resample([
    { x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 40 }, { x: 0, z: 40 }, { x: 0, z: 15 },
  ]);
  const hook = makeWall(hx, hz);

  const truck = makeTruck(-1.5, 10, 0, 0, 0); // 5u past the tip at (0,15)
  const before = truck.mesh.position.clone();
  hook._prevPositions.set(1, new Vector3(1.5, 0.75, 10)); // came from the other side
  hook.update([truck], 1 / 60);
  check('open end: driving around the tip is free', truck.mesh.position.equals(before),
    `(moved to ${truck.mesh.position.x.toFixed(2)}, ${truck.mesh.position.z.toFixed(2)})`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall wall checks pass');
process.exit(failures ? 1 : 0);
