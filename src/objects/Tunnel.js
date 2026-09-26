import { Color3, Mesh, StandardMaterial, VertexData } from "@babylonjs/core";
import {
  deriveTunnel,
  stationsBetween,
  archContour,
  tunnelCutReach,
  TUNNEL_LINING_THICKNESS,
  TUNNEL_FLOOR_DEPTH,
  TUNNEL_FLOOR_LIFT,
  TUNNEL_CUT_CLEARANCE,
  TUNNEL_HEADWALL_EMBED,
} from "../world/tunnel-geometry.js";

const DEFAULT_LINING_COLOR = "#6b6660";
const DEFAULT_FLOOR_COLOR = "#7a6548"; // packed-dirt brown until the floor gets the terrain look


/**
 * Tunnel — the visible parts of a `tunnel` feature (see TUNNELS.md): the lining
 * (walls + arch) and floor slab swept along the centreline over the derived
 * span, and a headwall block at each portal: its face stands
 * TUNNEL_PORTAL_SETBACK out in front of the hill's portal face and it reaches
 * back into the hill, covering the face the cut leaves (and the ground mesh's
 * smear of it). Shape comes from world/tunnel-geometry.js.
 *
 * Not drivable yet (Phase 3).
 *
 * Each part is a closed, outward-wound solid (back faces culled). None of them
 * cast shadows yet: the terrain isn't a shadow occluder, so geometry buried in
 * the hill would throw a phantom shadow on the far hillside (see the bridge
 * double-shadow note). Interior darkness is Phase 4.
 *
 * Feature format:
 *   {
 *     type:        'tunnel',
 *     points:      [{ x, z, radius?, floorY? }, ...],  // open centreline
 *     width:       number,   // inner width (m)
 *     height:      number,   // clearance, floor to crown (m)
 *     cover:       number,   // terrain wanted above the lining (editor warning)
 *     liningColor: string,   // hex, walls + arch + headwalls
 *     floorColor:  string,   // hex
 *   }
 */
export class Tunnel {
  constructor(feature, track, scene) {
    this.feature = feature;
    this._scene = scene;
    this._meshes = [];
    this._materials = [];

    const tunnel = deriveTunnel(feature, (x, z) => track.getHeightAt(x, z));
    /** The derived shape (tunnel-geometry.js), or null for a degenerate feature. */
    this.derived = tunnel;
    if (!tunnel) return;
    const { stations, faces, span, profile } = tunnel;
    const framesBetween = (s0, s1) => stationsBetween(tunnel, s0, s1)
      .map((st) => ({ x: st.x, y: st.floorY, z: st.z, nx: st.nx, nz: st.nz }));

    // The whole centreline when the hill never clears the crown (a visibly
    // wrong placement the editor also flags).
    const frames = framesBetween(span.start, span.end);

    const key = `${stations[0].x.toFixed(1)}_${stations[0].z.toFixed(1)}`;
    const lining = this._material(`tunnelLiningMat_${key}`, feature.liningColor ?? DEFAULT_LINING_COLOR);
    const floor = this._material(`tunnelFloorMat_${key}`, feature.floorColor ?? DEFAULT_FLOOR_COLOR);

    const inner = archContour(profile);
    const outer = archContour(profile, TUNNEL_LINING_THICKNESS);
    this._addMesh(`tunnel_lining_${key}`, sweepSection(frames, inner, outer), lining, scene);

    const w = profile.halfWidth + TUNNEL_LINING_THICKNESS;
    this._addMesh(`tunnel_floor_${key}`, sweepSection(
      frames,
      [{ u: w, v: TUNNEL_FLOOR_LIFT }, { u: -w, v: TUNNEL_FLOOR_LIFT }],
      [{ u: w, v: -TUNNEL_FLOOR_DEPTH }, { u: -w, v: -TUNNEL_FLOOR_DEPTH }],
    ), floor, scene);

    if (faces && faces.out > faces.in) {
      // Wrapped around the lining (its opening is the lining's outer face, so
      // no surface doubles the lining's inside), as wide and tall as the cut.
      const facade = headwallContour(outer, tunnelCutReach(feature), tunnel.height + TUNNEL_CUT_CLEARANCE);
      const blocks = [
        [span.start, Math.min(faces.in + TUNNEL_HEADWALL_EMBED, faces.out)],
        [Math.max(faces.out - TUNNEL_HEADWALL_EMBED, faces.in), span.end],
      ];
      blocks.forEach(([s0, s1], i) => {
        if (s1 - s0 > 0.05) this._addMesh(`tunnel_headwall_${key}_${i}`, sweepSection(framesBetween(s0, s1), outer, facade), lining, scene);
      });
    }
  }

  _material(name, hex) {
    const mat = new StandardMaterial(name, this._scene);
    mat.diffuseColor = Color3.FromHexString(hex);
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    mat.backFaceCulling = true;
    this._materials.push(mat);
    return mat;
  }

  _addMesh(name, vertexData, material, scene) {
    const mesh = new Mesh(name, scene);
    vertexData.applyToMesh(mesh);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    this._meshes.push(mesh);
  }

  dispose() {
    for (const m of this._meshes) m.dispose();
    for (const m of this._materials) m.dispose();
    this._meshes = [];
    this._materials = [];
  }
}

/**
 * A rectangle facade outline (half width `halfW`, from below the floor to
 * `top`) with the same point count as `opening`, each point placed at the same
 * fraction of the way round as its partner, so the two stitch into a face with
 * an arch-shaped hole. Runs left bottom → left top → right top → right bottom,
 * matching archContour's left-to-right order.
 */
function headwallContour(opening, halfW, top) {
  const bottom = -TUNNEL_FLOOR_DEPTH;
  const corners = [{ u: halfW, v: bottom }, { u: halfW, v: top }, { u: -halfW, v: top }, { u: -halfW, v: bottom }];
  const along = (pts) => {
    const d = [0];
    for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i].u - pts[i - 1].u, pts[i].v - pts[i - 1].v));
    return d;
  };
  const dOpen = along(opening), dRect = along(corners);
  const totalOpen = dOpen[dOpen.length - 1], totalRect = dRect[dRect.length - 1];
  return dOpen.map((d) => {
    const s = (d / totalOpen) * totalRect;
    let i = 1;
    while (i < corners.length - 1 && dRect[i] < s) i++;
    const t = (s - dRect[i - 1]) / (dRect[i] - dRect[i - 1]);
    return { u: corners[i - 1].u + t * (corners[i].u - corners[i - 1].u), v: corners[i - 1].v + t * (corners[i].v - corners[i - 1].v) };
  });
}

/**
 * Sweep a cross-section along frames into a closed solid. The section is the
 * band between two outlines `a` and `b` (same point count, (u, v) = across,
 * up): its boundary is `a`, then `b` backwards. Each frame places the section
 * vertically at (x, y, z), with u along its horizontal left normal (nx, nz).
 * Sides join consecutive frames; the band itself caps both ends. Flat-shaded,
 * each face wound to face out of the solid.
 */
export function sweepSection(frames, a, b) {
  const positions = [], indices = [];
  const at = (f, p) => [f.x + f.nx * p.u, f.y + p.v, f.z + f.nz * p.u];

  const quad = (p0, p1, p2, p3, out) => {
    const base = positions.length / 3;
    positions.push(...p0, ...p1, ...p2, ...p3);
    for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) {
      const P = [p0, p1, p2, p3];
      const A = P[i], B = P[j], C = P[k];
      // ComputeNormals' front-face normal is cross(C − A, B − A); flip to match `out`.
      const e1 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const e2 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const flip = g[0] * out[0] + g[1] * out[1] + g[2] * out[2] < 0;
      indices.push(base + i, base + (flip ? k : j), base + (flip ? j : k));
    }
  };

  // Boundary loop and its winding (shoelace), for each edge's outward normal.
  const loop = [...a, ...[...b].reverse()];
  let area2 = 0;
  for (let j = 0; j < loop.length; j++) {
    const p = loop[j], q = loop[(j + 1) % loop.length];
    area2 += p.u * q.v - q.u * p.v;
  }
  const ccw = area2 > 0 ? 1 : -1;

  for (let f = 0; f < frames.length - 1; f++) {
    const f0 = frames[f], f1 = frames[f + 1];
    for (let j = 0; j < loop.length; j++) {
      const p = loop[j], q = loop[(j + 1) % loop.length];
      // Outward in the section plane is the edge rotated −90° for a CCW loop.
      const ou = (q.v - p.v) * ccw, ov = -(q.u - p.u) * ccw;
      const nx = (f0.nx + f1.nx) / 2, nz = (f0.nz + f1.nz) / 2;
      quad(at(f0, p), at(f0, q), at(f1, q), at(f1, p), [nx * ou, ov, nz * ou]);
    }
  }

  const cap = (f, neighbour) => {
    const out = [f.x - neighbour.x, 0, f.z - neighbour.z];
    for (let j = 0; j < a.length - 1; j++) {
      quad(at(f, a[j]), at(f, a[j + 1]), at(f, b[j + 1]), at(f, b[j]), out);
    }
  };
  cap(frames[0], frames[1]);
  cap(frames[frames.length - 1], frames[frames.length - 2]);

  const normals = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  return vd;
}
