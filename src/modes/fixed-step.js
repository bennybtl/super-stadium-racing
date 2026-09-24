/**
 * Fixed-timestep simulation with render interpolation.
 *
 * Truck/AI/collision/lap logic always advances in SIM_DT steps, so handling,
 * lap times and ghosts are identical at 60/120/144 Hz. The render frame then
 * shows each truck mesh blended between its last two step poses, so motion
 * stays smooth when the display rate isn't a multiple of the step rate.
 *
 * The sim owns `mesh.position` / `mesh.rotation` (it integrates them), so the
 * blend is written onto the mesh after stepping and taken back off before the
 * next frame's steps. Anything that moves a mesh *between* frames (a respawn
 * from a key handler, the visibility handler) is detected because the mesh is
 * no longer where we put it — that pose is adopted as the new sim pose.
 * "Where we put it" is tolerance-based: the truck mesh is also its Havok
 * body's transformNode, and Havok syncs the body back onto it after every
 * physics step (float32-rounded position, Euler rebuilt from a quaternion).
 * A single-step jump longer than TELEPORT_DIST (respawn inside a step) snaps
 * instead of sweeping the truck across the map for a frame.
 */

export const SIM_DT = 1 / 60;
// Frame time beyond this is dropped: below ~12 fps the game slows down
// rather than spending ever more steps catching up (spiral of death).
const MAX_STEPS = 5;
const TELEPORT_DIST = 5; // m in one step — ~10x top speed
// Float slack so frame times that sum to exact multiples of SIM_DT (e.g. two
// half steps) aren't lost to rounding and deferred to the next frame.
const EPS = 1e-9;
// A mesh further than this from the pose we presented was moved on purpose.
// Well above Havok's float32 write-back error, far below any teleport.
const MOVED_DIST = 1e-3;

const readPose = (mesh, out) => {
  out.px = mesh.position.x; out.py = mesh.position.y; out.pz = mesh.position.z;
  out.rx = mesh.rotation.x; out.ry = mesh.rotation.y; out.rz = mesh.rotation.z;
  return out;
};

const writePose = (mesh, p) => {
  mesh.position.x = p.px; mesh.position.y = p.py; mesh.position.z = p.pz;
  mesh.rotation.x = p.rx; mesh.rotation.y = p.ry; mesh.rotation.z = p.rz;
};

const movedFrom = (mesh, p) =>
  Math.abs(mesh.position.x - p.px) > MOVED_DIST ||
  Math.abs(mesh.position.y - p.py) > MOVED_DIST ||
  Math.abs(mesh.position.z - p.pz) > MOVED_DIST;

const lerp = (a, b, t) => a + (b - a) * t;
// Shortest-arc angle blend, so a heading wrapping past ±π doesn't spin.
const lerpAngle = (a, b, t) => {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
};

export class FixedStepLoop {
  /** @param {() => Iterable<{position, rotation}>} getMeshes  meshes to interpolate */
  constructor(getMeshes) {
    this._getMeshes = getMeshes;
    this._acc = 0;
    this._poses = new Map(); // mesh -> { prev, sim, shown }
  }

  /**
   * Advance the sim by `frameDt` seconds of real time: runs `step(SIM_DT)`
   * zero or more times, then leaves each mesh on its interpolated render pose.
   * Returns the number of steps run.
   */
  run(frameDt, step) {
    const meshes = [...this._getMeshes()];
    for (const mesh of meshes) this._restore(mesh);

    this._acc += frameDt;
    let steps = 0;
    while (this._acc >= SIM_DT - EPS && steps < MAX_STEPS) {
      for (const mesh of meshes) readPose(mesh, this._entry(mesh).prev);
      step(SIM_DT);
      this._acc -= SIM_DT;
      steps++;
    }
    if (this._acc >= SIM_DT) this._acc = 0;
    if (this._acc < 0) this._acc = 0;

    const alpha = this._acc / SIM_DT;
    for (const mesh of meshes) this._present(mesh, alpha);
    return steps;
  }

  /** How far the rendered poses trail the sim, in seconds (for ghost playback). */
  get renderLag() {
    return SIM_DT - this._acc;
  }

  _entry(mesh) {
    let e = this._poses.get(mesh);
    if (!e) {
      e = { prev: readPose(mesh, {}), sim: readPose(mesh, {}), shown: readPose(mesh, {}) };
      this._poses.set(mesh, e);
    }
    return e;
  }

  // Put the sim pose back on the mesh — unless something moved the mesh since
  // we presented it, in which case that move is the new truth.
  _restore(mesh) {
    const e = this._poses.get(mesh);
    if (!e) return;
    if (!movedFrom(mesh, e.shown)) {
      writePose(mesh, e.sim);
    } else {
      readPose(mesh, e.sim);
      readPose(mesh, e.prev);
    }
  }

  _present(mesh, alpha) {
    const e = this._entry(mesh);
    const { prev, sim, shown } = e;
    readPose(mesh, sim);
    if (Math.hypot(sim.px - prev.px, sim.py - prev.py, sim.pz - prev.pz) > TELEPORT_DIST) {
      Object.assign(prev, sim);
    }
    shown.px = lerp(prev.px, sim.px, alpha);
    shown.py = lerp(prev.py, sim.py, alpha);
    shown.pz = lerp(prev.pz, sim.pz, alpha);
    shown.rx = lerpAngle(prev.rx, sim.rx, alpha);
    shown.ry = lerpAngle(prev.ry, sim.ry, alpha);
    shown.rz = lerpAngle(prev.rz, sim.rz, alpha);
    writePose(mesh, shown);
  }
}
