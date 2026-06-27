import {
  Mesh, VertexData, StandardMaterial, Color3,
} from "@babylonjs/core";
import { WallSegment } from "./WallSegment.js";
import { expandPolyline } from "../polyline-utils.js";
import { TerrainQuery } from "../managers/TerrainQuery.js";

// Poly walls should sit flush on the sampled surface.
const SKIRT = 2;

// ── Ribbon visual tuning (tweak these by eye) ────────────────────────────────
const SAMPLE_STEP  = 2;    // centerline resample spacing (world units)
const SMOOTH_WINDOW = 18;  // top-edge smoothing window (world units); larger = flatter top
const SKIRT_DEPTH  = 6;    // how far the ribbon base is buried below raw terrain
const STRIPE_LEN   = 4;    // colour stripe length along the wall (world units)

/**
 * PolyWall — a wall that follows a polyline of world-space points.
 *
 * Collision is a chain of per-segment box colliders (terrain-following, built by
 * WallSegment in collisionOnly mode). The VISIBLE wall is a single continuous
 * "ribbon" mesh whose top edge is a smoothed height profile and whose base is
 * buried in the terrain, so the wall reads as an embedded barrier of roughly
 * constant height and has no gaps on thick, sharply-curving corners.
 */
export class PolyWall {
  /**
   * @param {object} feature  - track feature of type "polyWall"
   * @param {Track}  track    - used to sample terrain height at each segment
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(feature, track, scene, shadows) {
    this.segments = [];
    this.ribbon = null;
    this._feature = feature;   // stored so the editor can identify this wall
    this._terrainQuery = new TerrainQuery(scene);
    this._useBridgeSurfaceSampling = this._featureUsesBridgeSurface(feature);
    const visualHeight = Number(feature.height ?? 2);
    const collisionHeight = Number(feature.collisionHeight ?? visualHeight);
    const thickness = Number(feature.thickness ?? 0.5);
    const friction = Number(feature.friction ?? 0.05);
    const closed = feature.closed ?? false;
    const rawPoints = feature.points;
    if (!rawPoints || rawPoints.length < 2) return;

    const points = expandPolyline(rawPoints, closed);
    const numPoints = points.length;
    const edgeCount = closed ? numPoints : numPoints - 1;

    // ── 1) Invisible collider chain (unchanged collision behaviour) ──────────
    for (let i = 0; i < edgeCount; i++) {
      const p0 = points[i];
      const p1 = points[(i + 1) % numPoints];

      const dx     = p1.x - p0.x;
      const dz     = p1.z - p0.z;
      const length = Math.sqrt(dx * dx + dz * dz);
      if (length < 0.01) continue;

      // heading: matches the convention used by StraightWall (cos(h)=dx/len, -sin(h)=dz/len)
      const heading = Math.atan2(-dz, dx);

      // Sub-segment so each piece is ~4 units long (terrain-following)
      const numSegs = Math.max(1, Math.round(length / 4));
      const segLen  = length / numSegs;
      const dirX    = dx / length;
      const dirZ    = dz / length;

      for (let s = 0; s < numSegs; s++) {
        const t       = (s + 0.5) * segLen;
        const px      = p0.x + dirX * t;
        const pz      = p0.z + dirZ * t;

        // Sample terrain at both ends of this segment
        const half = segLen / 2;
        const yA = this._sampleHeight(track, px - dirX * half, pz - dirZ * half);
        const yB = this._sampleHeight(track, px + dirX * half, pz + dirZ * half);

        // Parallelogram: each end matches its local terrain height
        const avgY       = (yA + yB) / 2;
        const visualTotalH = visualHeight + SKIRT;
        const visualCenterY = avgY + (visualHeight - SKIRT) / 2;
        const collisionTotalH = collisionHeight + SKIRT;
        const yShiftA = (yA - yB) / 2;   // vertical offset at −X (start) end
        const yShiftB = (yB - yA) / 2;   // vertical offset at +X (end) end

        // Tiny overlap prevents gaps between segments
        const segW = segLen * 1.02;
        this.segments.push(
          new WallSegment(px, pz, visualCenterY, segW, visualTotalH, thickness,
            heading, friction, this.segments.length, feature.style ?? 'red_white', "wall_poly", scene, shadows,
            yShiftA, yShiftB, true, collisionTotalH, /* collisionOnly */ true)
        );
      }
    }

    // ── 2) Visible ribbon ────────────────────────────────────────────────────
    this.ribbon = this._buildRibbon(points, closed, track, scene, shadows, {
      visualHeight, thickness, style: feature.style ?? 'red_white',
    });
  }

  dispose() {
    for (const seg of this.segments) seg.dispose();
    this.segments = [];
    if (this.ribbon) {
      this.ribbon.material?.dispose();
      this.ribbon.dispose();
      this.ribbon = null;
    }
  }

  _featureUsesBridgeSurface(feature) {
    const points = feature?.points;
    if (!Array.isArray(points) || points.length === 0) return false;
    return points.some(pt => {
      this._terrainQuery.heightAt(pt.x, pt.z);
      return this._terrainQuery.getLastResolvedSurface?.()?.surfaceType === 'bridgeMesh';
    });
  }

  _sampleHeight(track, x, z) {
    if (this._useBridgeSurfaceSampling) {
      return this._terrainQuery.heightAt(x, z);
    }
    return track.getHeightAt(x, z);
  }

  // ─── Ribbon construction ───────────────────────────────────────────────────

  /**
   * Resample the (already corner-rounded) centerline at ~constant arc length and
   * record raw terrain height at each sample. Returns parallel arrays.
   */
  _resampleCenterline(points, closed, track) {
    const loop = closed ? [...points, points[0]] : points;
    // cumulative arc length at each loop vertex
    const arcLen = [0];
    for (let i = 1; i < loop.length; i++) {
      arcLen.push(arcLen[i - 1] + Math.hypot(loop[i].x - loop[i - 1].x, loop[i].z - loop[i - 1].z));
    }
    const total = arcLen[arcLen.length - 1];
    if (total < 1e-6) return null;

    const pointAt = (s) => {
      if (s <= 0) return { x: loop[0].x, z: loop[0].z };
      if (s >= total) { const l = loop[loop.length - 1]; return { x: l.x, z: l.z }; }
      let i = 1;
      while (i < arcLen.length && arcLen[i] < s) i++;
      const t = (s - arcLen[i - 1]) / (arcLen[i] - arcLen[i - 1]);
      return {
        x: loop[i - 1].x + t * (loop[i].x - loop[i - 1].x),
        z: loop[i - 1].z + t * (loop[i].z - loop[i - 1].z),
      };
    };

    const N = Math.max(2, Math.round(total / SAMPLE_STEP));
    // open → include both endpoints (N+1 samples); closed → N samples, wrap.
    const count = closed ? N : N + 1;
    const xs = [], zs = [], raw = [], s = [];
    for (let k = 0; k < count; k++) {
      const arc = (k * total) / N;
      const p = pointAt(arc);
      xs.push(p.x); zs.push(p.z);
      raw.push(this._sampleHeight(track, p.x, p.z));
      s.push(arc);
    }
    return { xs, zs, raw, s, step: total / N, closed };
  }

  /** Moving-average low-pass over the raw height profile. */
  _smoothHeights(raw, step, closed) {
    const n = raw.length;
    const w = Math.max(0, Math.round(SMOOTH_WINDOW / step));
    if (w === 0) return raw.slice();
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0, cnt = 0;
      for (let j = -w; j <= w; j++) {
        let idx = i + j;
        if (closed) {
          idx = ((idx % n) + n) % n;
        } else if (idx < 0 || idx >= n) {
          continue;
        }
        sum += raw[idx]; cnt++;
      }
      out[i] = sum / cnt;
    }
    return out;
  }

  _stripeColors(style) {
    if (style === 'black_yellow') {
      return { a: [0.08, 0.08, 0.08], b: [0.95, 0.80, 0.05] };
    }
    if (style === 'grey') {
      return { a: [0.55, 0.55, 0.55], b: [0.55, 0.55, 0.55] };
    }
    return { a: [0.85, 0.08, 0.08], b: [1.0, 1.0, 1.0] }; // red_white
  }

  _buildRibbon(points, closed, track, scene, shadows, { visualHeight, thickness, style }) {
    const cl = this._resampleCenterline(points, closed, track);
    if (!cl) return null;
    const { xs, zs, raw, s, step } = cl;
    const n = xs.length;
    if (n < 2) return null;

    const smooth = this._smoothHeights(raw, step, closed);
    const halfThick = thickness / 2;

    // Per-sample unit normal (left side) from a central-difference tangent.
    const nx = new Array(n), nz = new Array(n);
    for (let i = 0; i < n; i++) {
      const ip = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
      const iN = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      let tx = xs[iN] - xs[ip], tz = zs[iN] - zs[ip];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      nx[i] = -tz; nz[i] = tx; // rotate tangent +90° in XZ
    }

    // Rails (x/z) and vertical extents.
    const lx = new Array(n), lz = new Array(n), rx = new Array(n), rz = new Array(n);
    const topY = new Array(n), botY = new Array(n);
    for (let i = 0; i < n; i++) {
      lx[i] = xs[i] + nx[i] * halfThick; lz[i] = zs[i] + nz[i] * halfThick;
      rx[i] = xs[i] - nx[i] * halfThick; rz[i] = zs[i] - nz[i] * halfThick;
      topY[i] = smooth[i] + visualHeight; // smoothed, near-constant-height top
      botY[i] = raw[i] - SKIRT_DEPTH;      // buried base → embedded look
    }

    const positions = [], indices = [], normals = [], colors = [];
    const colDef = this._stripeColors(style);
    const pushQuad = (p0, p1, p2, p3, nrm, col) => {
      const base = positions.length / 3;
      positions.push(...p0, ...p1, ...p2, ...p3);
      for (let k = 0; k < 4; k++) {
        normals.push(...nrm);
        colors.push(col[0], col[1], col[2], 1);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    const bandCount = closed ? n : n - 1;
    for (let i = 0; i < bandCount; i++) {
      const j = (i + 1) % n;
      // stripe colour from the band's mid arc-length
      const sMid = closed && i === n - 1 ? s[i] + step * 0.5 : (s[i] + s[j]) / 2;
      const even = Math.floor(sMid / STRIPE_LEN) % 2 === 0;
      const col = even ? colDef.a : colDef.b;

      // averaged outward normal for the side faces of this band
      let anx = nx[i] + nx[j], anz = nz[i] + nz[j];
      const al = Math.hypot(anx, anz) || 1; anx /= al; anz /= al;

      const Li_b = [lx[i], botY[i], lz[i]], Li_t = [lx[i], topY[i], lz[i]];
      const Lj_b = [lx[j], botY[j], lz[j]], Lj_t = [lx[j], topY[j], lz[j]];
      const Ri_b = [rx[i], botY[i], rz[i]], Ri_t = [rx[i], topY[i], rz[i]];
      const Rj_b = [rx[j], botY[j], rz[j]], Rj_t = [rx[j], topY[j], rz[j]];

      // Outer (left) face — faces +n
      pushQuad(Li_b, Li_t, Lj_t, Lj_b, [anx, 0, anz], col);
      // Inner (right) face — faces −n
      pushQuad(Ri_b, Rj_b, Rj_t, Ri_t, [-anx, 0, -anz], col);
      // Top face
      pushQuad(Li_t, Ri_t, Rj_t, Lj_t, [0, 1, 0], col);
    }

    // End caps for an open polyline.
    if (!closed) {
      const capCol = colDef.a;
      // start cap faces −tangent (use sample 0 normal-perp); winding handled by
      // backFaceCulling=false so direction is cosmetic only.
      pushQuad(
        [lx[0], botY[0], lz[0]], [lx[0], topY[0], lz[0]],
        [rx[0], topY[0], rz[0]], [rx[0], botY[0], rz[0]],
        [-nz[0], 0, nx[0]], capCol,
      );
      const e = n - 1;
      pushQuad(
        [lx[e], botY[e], lz[e]], [lx[e], topY[e], lz[e]],
        [rx[e], topY[e], rz[e]], [rx[e], botY[e], rz[e]],
        [nz[e], 0, -nx[e]], capCol,
      );
    }

    const mesh = new Mesh("polyWallRibbon", scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    vd.colors = colors;
    vd.applyToMesh(mesh);

    const mat = new StandardMaterial("polyWallRibbonMat", scene);
    mat.diffuseColor = new Color3(1, 1, 1); // let vertex colours drive the surface
    mat.specularColor = new Color3(0.2, 0.2, 0.2);
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.useVertexColors = true;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    shadows?.addShadowCaster(mesh);

    return mesh;
  }
}
