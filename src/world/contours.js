// Marching squares: the outlines where a scalar field on a grid crosses a
// level, as joined-up polylines. Babylon-free.

// Per case (bit 0 = corner (i,j), 1 = (i+1,j), 2 = (i+1,j+1), 3 = (i,j+1)
// above the level), the pairs of cell edges each segment joins. Edges:
// 0 bottom (j), 1 right (i+1), 2 top (j+1), 3 left (i). Saddles (5, 10) are
// resolved per cell from the centre value, below.
const SEGMENTS = [
  [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], null, [[0, 2]], [[3, 2]],
  [[2, 3]], [[0, 2]], null, [[1, 2]], [[1, 3]], [[0, 1]], [[3, 0]], [],
];
// The two ways to cut a saddle: joined through the centre when the centre is
// above the level for case 5 (below for 10), cutting off the other corners.
const SADDLE_CUTS = [[[0, 1], [2, 3]], [[3, 0], [1, 2]]];

// Each pair directed so the above-level side is on its left. Worked out once on
// a synthetic cell (corners ±1, crossings at edge midpoints), where it can't be
// ambiguous; data with values exactly at the level would make a per-cell
// geometric test degenerate (a crossing on a corner).
const ORIENTED = SEGMENTS.map((pairs, c) => {
  const v = [0, 1, 2, 3].map((k) => (c >> k) & 1 ? 1 : -1);
  const orient = (list) => list.map(([ea, eb]) => {
    const { a } = _orient(0, 0, v, 0, _crossing(0, 0, ea, v, 0), _crossing(0, 0, eb, v, 0));
    return a.key === _crossing(0, 0, ea, v, 0).key ? [ea, eb] : [eb, ea];
  });
  return pairs ? orient(pairs) : SADDLE_CUTS.map(orient);
});

/**
 * Contours of `field` at `level`, with the above-level side on the left of
 * travel (left of direction (dx, dz) being (−dz, dx)). The field is sampled at
 * the `nx` × `nz` grid nodes, row-major (`field[j * nx + i]`); everything
 * outside the grid counts as below the level, so every contour is a closed
 * loop.
 *
 * @returns {{ x: number, z: number }[][]} loops in grid units (node (i, j) is
 *   at (i, j)); the first point is not repeated at the end.
 */
export function traceContours(field, nx, nz, level) {
  // Pad with a below-level border so every contour closes inside the grid.
  const px = nx + 2, pz = nz + 2;
  const at = (i, j) => (i < 1 || j < 1 || i > nx || j > nz ? -Infinity : field[(j - 1) * nx + (i - 1)]);

  const segs = [];
  for (let j = 0; j < pz - 1; j++) {
    for (let i = 0; i < px - 1; i++) {
      const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      const c = (v[0] > level ? 1 : 0) | (v[1] > level ? 2 : 0) | (v[2] > level ? 4 : 0) | (v[3] > level ? 8 : 0);
      let pairs = ORIENTED[c];
      if (!SEGMENTS[c]) {
        const centreAbove = (v[0] + v[1] + v[2] + v[3]) / 4 > level;
        pairs = pairs[(c === 5) === centreAbove ? 0 : 1];
      }
      for (const [ea, eb] of pairs) segs.push({ a: _crossing(i, j, ea, v, level), b: _crossing(i, j, eb, v, level) });
    }
  }

  // Join segments end to start (crossings are keyed by the grid edge they lie on).
  const byStart = new Map();
  for (const s of segs) byStart.set(s.a.key, s);
  const loops = [];
  for (const first of segs) {
    if (first.used) continue;
    const loop = [];
    for (let s = first; s && !s.used; s = byStart.get(s.b.key)) {
      s.used = true;
      loop.push({ x: s.a.x - 1, z: s.a.z - 1 });
    }
    if (loop.length >= 2) loops.push(loop);
  }
  return loops;
}

/** Where the level crosses edge `e` of cell (i, j), keyed by that grid edge. */
function _crossing(i, j, e, v, level) {
  const [c0, c1] = [[0, 1], [1, 2], [3, 2], [0, 3]][e];
  const t0 = v[c0], t1 = v[c1];
  // -Infinity (padding) against a finite value: the crossing sits at the
  // finite node, i.e. the outline follows the grid's edge.
  let t = t0 === -Infinity ? 1 : t1 === -Infinity ? 0 : (level - t0) / (t1 - t0);
  t = Math.min(1, Math.max(0, t));
  const corner = (k) => [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]][k];
  const [x0, z0] = corner(c0), [x1, z1] = corner(c1);
  const key = e === 0 ? `h${i},${j}` : e === 2 ? `h${i},${j + 1}` : e === 1 ? `v${i + 1},${j}` : `v${i},${j}`;
  return { x: x0 + t * (x1 - x0), z: z0 + t * (z1 - z0), key };
}

/**
 * Segment a → b, reversed if needed so the above-level side is on its left,
 * judged from the cell corner nearest its midpoint (a cut-off corner, or one of
 * a straight cut's pair). Only used to build ORIENTED.
 */
function _orient(i, j, v, level, a, b) {
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
  let k = 0, best = Infinity;
  corners.forEach(([x, z], n) => {
    const d = (x - mx) ** 2 + (z - mz) ** 2;
    if (d < best) { best = d; k = n; }
  });
  const [cx, cz] = corners[k];
  const cross = (b.x - a.x) * (cz - a.z) - (b.z - a.z) * (cx - a.x); // > 0: corner on the left
  const above = v[k] > level;
  return above === cross > 0 ? { a, b } : { a: b, b: a };
}

/** Douglas–Peucker simplification of an open polyline (endpoints kept). */
export function simplifyPolyline(pts, tolerance) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const ax = pts[s].x, az = pts[s].z;
    const dx = pts[e].x - ax, dz = pts[e].z - az;
    const len2 = dx * dx + dz * dz;
    let worst = -1, worstD = tolerance * tolerance;
    for (let k = s + 1; k < e; k++) {
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((pts[k].x - ax) * dx + (pts[k].z - az) * dz) / len2)) : 0;
      const d2 = (ax + t * dx - pts[k].x) ** 2 + (az + t * dz - pts[k].z) ** 2;
      if (d2 > worstD) { worstD = d2; worst = k; }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([s, worst], [worst, e]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}
