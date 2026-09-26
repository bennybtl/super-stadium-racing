import { Mesh, VertexData } from "@babylonjs/core";
import { traceContours, simplifyPolyline } from "../world/contours.js";

const DEFAULTS = {
  enabled: true,
  // Grid spacing (m) the slope is sampled on.
  sampleStep: 1,
  maxSlopeDeg: 60,
  // The wall's vertical extent around the ground at its foot.
  wallAbove: 4,
  wallBelow: 1,
};

// Half the wall's thickness (m).
const WALL_HALF_THICK = 0.15;
// Contours are simplified to within this (m) before becoming walls.
const SIMPLIFY_TOLERANCE = 0.2;
// Walls are split into pieces of at most this many points, so each one's
// bounding box (the collision broadphase) stays tight around it.
const MAX_WALL_POINTS = 24;
// A contour point is a rim (top edge, no wall) when the ground just outside the
// steep area is this much higher than just inside it.
const RIM_PROBE = 1.5;
const RIM_RISE = 0.3;
// A point only gets a wall where the ground rises at least this much within
// FACE_PROBE of it going into the steep area: a short steep lip is something a
// truck drives over, not a cliff.
const MIN_FACE_RISE = 1;
const FACE_PROBE = 4;

/**
 * Invisible one-way walls along the foot of every slope steeper than
 * `maxSlopeDeg`, so trucks can't drive up cliffs (TerrainPhysics alone would
 * let them climb anything).
 *
 * The slope is sampled on a grid, the outlines of the steep areas traced
 * (marching squares, world/contours.js) into smooth polylines, and each
 * outline's stretches that aren't a rim become `polylineCollider` walls
 * (StaticBodyCollisionManager): from `wallBelow` under the ground there to
 * `wallAbove` over it. They block only from outside the steep area, so a truck
 * driving off the top of a cliff falls past them. Rims (the top edge of a
 * steep face, where the ground outside is higher) get no wall, nor do steep
 * lips less than MIN_FACE_RISE tall.
 *
 * (Replaced merged axis-aligned boxes on a 3 m grid, whose corners stuck out
 * over flat ground beside diagonal faces and snagged passing trucks.)
 *
 * Stretches whose wall would reach into a tunnel bore (`scene.metadata.
 * tunnelBore`, published by TunnelManager — build tunnels first) are left out,
 * or the steep hill face around a portal would wall off the mouth.
 */
export class SteepSlopeColliderManager {
  constructor(scene, track, options = {}) {
    this.scene = scene;
    this.track = track;
    this.options = { ...DEFAULTS, ...options };
    this._meshes = [];
  }

  dispose() {
    for (const mesh of this._meshes) mesh.dispose();
    this._meshes = [];
  }

  rebuild() {
    this.dispose();
    if (!this.options.enabled || !this.track) return;
    for (const wall of this.traceWalls()) this._createWall(wall);
  }

  /**
   * The walls as `{ points: [{ x, z, y, low }] }` (y = ground at the point, low
   * = the lower of that and the ground just outside, which the wall's bottom
   * hangs from), steep side on the left of travel. Separate from rebuild so
   * it can be inspected.
   */
  traceWalls() {
    const track = this.track;
    const step = Math.max(0.25, this.options.sampleStep);
    const width = track.width ?? 160;
    const depth = track.depth ?? 160;
    const nx = Math.floor(width / step) + 1;
    const nz = Math.floor(depth / step) + 1;
    const originX = -((nx - 1) * step) / 2;
    const originZ = -((nz - 1) * step) / 2;

    const heights = new Float64Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) heights[j * nx + i] = track.getHeightAt(originX + i * step, originZ + j * step);
    }
    // Slope (degrees) at each node from central differences (one-sided at the edges).
    const slope = new Float64Array(nx * nz);
    const h = (i, j) => heights[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const dx = (h(i + 1, j) - h(i - 1, j)) / (((i < nx - 1) + (i > 0)) * step || 1);
        const dz = (h(i, j + 1) - h(i, j - 1)) / (((j < nz - 1) + (j > 0)) * step || 1);
        slope[j * nx + i] = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
      }
    }

    const bore = this.scene?.metadata?.tunnelBore ?? null;
    const { wallBelow } = this.options;
    const walls = [];
    for (const loop of traceContours(slope, nx, nz, this.options.maxSlopeDeg)) {
      const pts = loop.map((p) => {
        const x = originX + p.x * step, z = originZ + p.z * step;
        return { x, z, y: track.getHeightAt(x, z) };
      });
      // Which points get a wall: not a rim, and not reaching into a tunnel.
      const n = pts.length;
      const walled = pts.map((p, k) => {
        const a = pts[(k - 1 + n) % n], b = pts[(k + 1) % n];
        const tx = b.x - a.x, tz = b.z - a.z;
        const len = Math.hypot(tx, tz) || 1;
        // Right of travel = outside the steep area.
        const rx = tz / len, rz = -tx / len;
        const outside = track.getHeightAt(p.x + rx * RIM_PROBE, p.z + rz * RIM_PROBE);
        const inside = track.getHeightAt(p.x - rx * RIM_PROBE, p.z - rz * RIM_PROBE);
        if (outside - inside > RIM_RISE) return false;
        p.low = Math.min(p.y, outside);
        let top = -Infinity;
        for (let d = 0.5; d <= FACE_PROBE; d += 0.5) top = Math.max(top, track.getHeightAt(p.x - rx * d, p.z - rz * d));
        if (top - p.low < MIN_FACE_RISE) return false;
        const b0 = bore?.sample(p.x, p.z);
        return !(b0 && p.low - wallBelow < b0.ceilingY);
      });
      for (const run of _runs(pts, walled)) {
        const simple = simplifyPolyline(run, SIMPLIFY_TOLERANCE);
        for (let s = 0; s < simple.length - 1; s += MAX_WALL_POINTS - 1) {
          walls.push({ points: simple.slice(s, s + MAX_WALL_POINTS) });
        }
      }
    }
    return walls;
  }

  _createWall({ points }) {
    const { wallAbove, wallBelow } = this.options;
    const collider = {
      xs: points.map((p) => p.x),
      zs: points.map((p) => p.z),
      topY: points.map((p) => p.y + wallAbove),
      botY: points.map((p) => p.low - wallBelow),
      halfThick: WALL_HALF_THICK,
      closed: false,
      blockFrom: -1, // outside the steep area: the right of travel
      landOnTop: false,
      retain: null,
    };
    // An invisible vertical ribbon, only for the broadphase's bounding box
    // (and the debug overlay).
    const positions = [];
    const indices = [];
    points.forEach((p, k) => {
      positions.push(p.x, p.low - wallBelow, p.z, p.x, p.y + wallAbove, p.z);
      if (k > 0) indices.push(2 * k - 2, 2 * k - 1, 2 * k + 1, 2 * k - 2, 2 * k + 1, 2 * k);
    });
    const mesh = new Mesh(`steepSlopeWall_${this._meshes.length}`, this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.applyToMesh(mesh);
    mesh.isVisible = false;
    mesh.isPickable = false;
    mesh.metadata = { polylineCollider: collider, internalSteepSlopeCollider: true };
    this._meshes.push(mesh);
  }
}

/**
 * The maximal runs of consecutive `keep`ed points around a closed loop, as open
 * polylines (a loop kept all the way round comes back as one run that ends
 * where it started).
 */
function _runs(pts, keep) {
  const n = pts.length;
  if (keep.every(Boolean)) return [[...pts, pts[0]]];
  const start = keep.findIndex((k) => !k); // begin just after a gap
  const runs = [];
  let run = [];
  for (let s = 1; s <= n; s++) {
    const k = (start + s) % n;
    if (keep[k]) run.push(pts[k]);
    else {
      if (run.length >= 2) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}
