import { Color3, Constants, Mesh, MeshBuilder, StandardMaterial, Vector3, VertexData } from "@babylonjs/core";
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
  tunnelShadeAt,
} from "../world/tunnel-geometry.js";

const DEFAULT_LINING_COLOR = "#6b6660";
const DEFAULT_FLOOR_COLOR = "#7a6548"; // packed-dirt brown until the floor gets the terrain look

// Wall hint (setHintStrength): the foot of each wall drawn through the hill
// while the player is inside, at this colour and full-strength opacity.
const HINT_COLOR = new Color3(0.85, 0.9, 1);
const HINT_ALPHA = 0.5;
const HINT_LIFT = 0.15; // above the floor line, clear of the slab top


/**
 * Tunnel — the visible parts of a `tunnel` feature (see TUNNELS.md): the lining
 * (walls + arch) and floor slab swept along the centreline over the derived
 * span, and a headwall block at each portal: its face stands
 * TUNNEL_PORTAL_SETBACK out in front of the hill's portal face and it reaches
 * back into the hill, covering the face the cut leaves (and the ground mesh's
 * smear of it). Shape comes from world/tunnel-geometry.js.
 *
 * Driving: the floor's top is registered as a 'tunnel' drive surface (level
 * −1) so TerrainQuery puts a truck on it inside the hill; box colliders
 * (StaticBodyCollisionManager) line both walls and the headwall faces beside
 * each mouth; TerrainPhysics.clampToTunnelRoof keeps a truck under the roof.
 *
 * Each part is a closed, outward-wound solid (back faces culled). None of them
 * cast shadows: the terrain isn't a shadow occluder, so geometry buried in the
 * hill would throw a phantom shadow on the far hillside (see the bridge
 * double-shadow note). Instead the lining and floor darken by vertex colour
 * with depth into the tunnel (tunnelShadeAt); the headwalls, outside, don't.
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
  constructor(feature, track, scene, driveSurfaceManager = null) {
    this.feature = feature;
    this._scene = scene;
    this._meshes = [];
    this._materials = [];
    this._colliders = [];

    const tunnel = deriveTunnel(feature, (x, z) => track.getHeightAt(x, z));
    /** The derived shape (tunnel-geometry.js), or null for a degenerate feature. */
    this.derived = tunnel;
    if (!tunnel) return;
    const { stations, faces, span, profile } = tunnel;
    const framesBetween = (s0, s1) => stationsBetween(tunnel, s0, s1)
      .map((st) => ({
        x: st.x, y: st.floorY, z: st.z, nx: st.nx, nz: st.nz,
        shade: tunnelShadeAt(Math.min(st.s - span.start, span.end - st.s)),
      }));

    // The whole centreline when the hill never clears the crown (a visibly
    // wrong placement the editor also flags).
    const frames = framesBetween(span.start, span.end);

    const key = `${stations[0].x.toFixed(1)}_${stations[0].z.toFixed(1)}`;
    const liningColor = feature.liningColor ?? DEFAULT_LINING_COLOR;
    const lining = this._material(`tunnelLiningMat_${key}`, liningColor);
    const headwall = this._material(`tunnelHeadwallMat_${key}`, liningColor);
    const floor = this._material(`tunnelFloorMat_${key}`, feature.floorColor ?? DEFAULT_FLOOR_COLOR);

    const inner = archContour(profile);
    const outer = archContour(profile, TUNNEL_LINING_THICKNESS);
    this._addMesh(`tunnel_lining_${key}`, sweepSection(frames, inner, outer, { shaded: true }), lining, scene);

    const w = profile.halfWidth + TUNNEL_LINING_THICKNESS;
    this._addMesh(`tunnel_floor_${key}`, sweepSection(
      frames,
      [{ u: w, v: TUNNEL_FLOOR_LIFT }, { u: -w, v: TUNNEL_FLOOR_LIFT }],
      [{ u: w, v: -TUNNEL_FLOOR_DEPTH }, { u: -w, v: -TUNNEL_FLOOR_DEPTH }],
      { shaded: true },
    ), floor, scene);

    if (faces && faces.out > faces.in) {
      // Wrapped around the lining (its opening is the lining's outer face, so
      // no surface doubles the lining's inside), as wide and tall as the cut.
      const facade = headwallContour(outer, tunnelCutReach(feature), tunnel.height + TUNNEL_CUT_CLEARANCE);
      const blocks = [
        [span.start, Math.min(faces.in + TUNNEL_HEADWALL_EMBED, faces.out)],
        [Math.max(faces.out - TUNNEL_HEADWALL_EMBED, faces.in), span.end],
      ];
      const top = tunnel.height + TUNNEL_CUT_CLEARANCE;
      const reach = tunnelCutReach(feature);
      blocks.forEach(([s0, s1], i) => {
        if (s1 - s0 <= 0.05) return;
        const blockFrames = framesBetween(s0, s1);
        this._addMesh(`tunnel_headwall_${key}_${i}`, sweepSection(blockFrames, outer, facade), headwall, scene);
        // The faces beside the mouth, as far out as the headwall reaches.
        for (const side of [1, -1]) {
          this._addCollider(`tunnel_headwall_collider_${key}_${i}_${side}`, blockFrames[0], blockFrames[blockFrames.length - 1],
            side * (w + reach) / 2, reach - w, -TUNNEL_FLOOR_DEPTH, top, scene);
        }
      });
    }

    // Walls: one box per ~2 m along each side, from below the floor to the
    // crown, just behind the inner face.
    for (let k = 2; k < frames.length + 1; k += 2) {
      const a = frames[k - 2], b = frames[Math.min(k, frames.length - 1)];
      for (const side of [1, -1]) {
        this._addCollider(`tunnel_wall_collider_${key}_${k}_${side}`, a, b,
          side * (profile.halfWidth + TUNNEL_LINING_THICKNESS / 2), TUNNEL_LINING_THICKNESS, -1, tunnel.height, scene);
      }
    }

    // Wall hint: a line along the foot of each wall, drawn only where something
    // is in front of it (depth test GREATER, no depth write) — i.e. through the
    // hill. Vertex alpha puts it in the transparent pass, after the opaque
    // scene has filled the depth buffer; its colour/alpha come from uniforms.
    const wallFoot = (side) => frames.map((f) => new Vector3(
      f.x + f.nx * side * profile.halfWidth, f.y + HINT_LIFT, f.z + f.nz * side * profile.halfWidth));
    this._hint = MeshBuilder.CreateLineSystem(`tunnel_hint_${key}`, { lines: [wallFoot(1), wallFoot(-1)], useVertexAlpha: true }, scene);
    this._hint.color = HINT_COLOR;
    this._hint.alpha = 0;
    this._hint.isPickable = false;
    this._hint.material.depthFunction = Constants.GREATER;
    this._hint.material.disableDepthWrite = true;
    this._hint.setEnabled(false);
    this._meshes.push(this._hint);

    // The drivable floor: the slab's top across the bore.
    this._driveMesh = new Mesh(`tunnel_drive_${key}`, scene);
    floorTopVertexData(frames, profile.halfWidth, TUNNEL_FLOOR_LIFT).applyToMesh(this._driveMesh);
    this._driveMesh.isVisible = false;
    this._driveMesh.isPickable = false;
    this._meshes.push(this._driveMesh);
    driveSurfaceManager?.register(this._driveMesh, { kind: "tunnel", level: -1 });
  }

  /** Show the wall hint at `strength` (0 hides it, 1 is full opacity). */
  setHintStrength(strength) {
    if (!this._hint) return;
    this._hint.setEnabled(strength > 0.001);
    this._hint.alpha = HINT_ALPHA * strength;
  }

  /**
   * An invisible box collider for trucks between frames `a` and `b`: centred
   * `u` across (left +), `width` wide, from `v0` to `v1` over the floor (the
   * lower floor of the two ends to the higher), with a little overlap along
   * its length so consecutive boxes leave no seam.
   */
  _addCollider(name, a, b, u, width, v0, v1, scene) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.05 || width <= 0) return;
    const nx = (a.nx + b.nx) / 2, nz = (a.nz + b.nz) / 2;
    const bottom = Math.min(a.y, b.y) + v0, topY = Math.max(a.y, b.y) + v1;
    const box = MeshBuilder.CreateBox(name, { width: length + 0.2, height: topY - bottom, depth: width }, scene);
    // Babylon's rotation.y turns local +X to (cos θ, −sin θ) in XZ.
    box.rotation.y = Math.atan2(-dz, dx);
    box.position.set((a.x + b.x) / 2 + nx * u, (bottom + topY) / 2, (a.z + b.z) / 2 + nz * u);
    box.isVisible = false;
    box.isPickable = false;
    box.metadata = { truckCollider: true };
    this._colliders.push(box);
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
    for (const c of this._colliders) c.dispose();
    this._meshes = [];
    this._materials = [];
    this._colliders = [];
  }
}

/**
 * The floor's top surface along `frames`: a strip ±`halfWidth` across, `lift`
 * above each frame's floor, facing up.
 */
function floorTopVertexData(frames, halfWidth, lift) {
  const positions = [], indices = [], normals = [];
  frames.forEach((f, i) => {
    positions.push(f.x + f.nx * halfWidth, f.y + lift, f.z + f.nz * halfWidth);
    positions.push(f.x - f.nx * halfWidth, f.y + lift, f.z - f.nz * halfWidth);
    if (i > 0) {
      const l0 = (i - 1) * 2, r0 = l0 + 1, l1 = i * 2, r1 = l1 + 1;
      indices.push(l0, r0, r1, l0, r1, l1);
    }
  });
  VertexData.ComputeNormals(positions, indices, normals);
  // Wound either way depending on travel direction: make sure it faces up.
  if (normals[1] < 0) {
    for (let t = 0; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
    for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  return vd;
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
 * each face wound to face out of the solid. With `shaded`, each frame's
 * `shade` (0–1) becomes a grey vertex colour, blended along the sides.
 */
export function sweepSection(frames, a, b, { shaded = false } = {}) {
  const positions = [], indices = [], colors = [];
  const at = (f, p) => [f.x + f.nx * p.u, f.y + p.v, f.z + f.nz * p.u];

  // `shades`: one per corner, from the frames each corner lies on.
  const quad = (p0, p1, p2, p3, out, shades) => {
    const base = positions.length / 3;
    positions.push(...p0, ...p1, ...p2, ...p3);
    if (shaded) for (const g of shades) colors.push(g, g, g, 1);
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
      quad(at(f0, p), at(f0, q), at(f1, q), at(f1, p), [nx * ou, ov, nz * ou], [f0.shade, f0.shade, f1.shade, f1.shade]);
    }
  }

  const cap = (f, neighbour) => {
    const out = [f.x - neighbour.x, 0, f.z - neighbour.z];
    for (let j = 0; j < a.length - 1; j++) {
      quad(at(f, a[j]), at(f, a[j + 1]), at(f, b[j + 1]), at(f, b[j]), out, [f.shade, f.shade, f.shade, f.shade]);
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
  if (shaded) vd.colors = colors;
  return vd;
}
