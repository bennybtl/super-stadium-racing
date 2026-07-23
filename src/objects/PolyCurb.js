import { Mesh, VertexData, StandardMaterial, Color3 } from "@babylonjs/core";
import { expandPolyline } from "../polyline-utils.js";
import { WallSegment } from "./WallSegment.js";
import { TerrainQuery } from "../managers/TerrainQuery.js";
import { resolveStripeColors } from "./stripeColors.js";

const SAMPLE_STEP = 0.5;
const STRIPE_LEN = 2;

/**
 * PolyCurb — builds terrain-following curb segments along a polyline.
 *
 * Collision is a chain of per-segment box colliders (WallSegment in
 * collisionOnly mode). The visible curb is a single continuous ribbon mesh
 * with vertex-colour stripes matching the kerb strips seen at the edge of
 * real race tracks. Segments are deliberately excluded from WallManager so
 * trucks can drive over curbs without being blocked.
 *
 * Feature shape:
 * {
 *   type:   'polyCurb',
 *   points: [{ x, z, radius? }, …],
 *   height: 0.22,
 *   width:  0.9,
 *   closed: false,
 * }
 */
export class PolyCurb {
  constructor(feature, track, scene, shadows) {
    this.segments = [];
    this.ribbon = null;
    this._feature = feature;
    this._terrainQuery = new TerrainQuery(scene);
    this._useBridgeSurfaceSampling = this._featureUsesBridgeSurface(feature);

    const { height = 0.22, width = 0.9, closed = false } = feature;
    const rawPoints = feature.points;
    if (!rawPoints || rawPoints.length < 2) return;

    const points = expandPolyline(rawPoints, closed);
    const numPoints = points.length;
    const edgeCount = closed ? numPoints : numPoints - 1;

    // ── 1) Invisible collider chain ─────────────────────────────────────────
    for (let i = 0; i < edgeCount; i++) {
      const p0 = points[i];
      const p1 = points[(i + 1) % numPoints];

      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const length = Math.sqrt(dx * dx + dz * dz);
      if (length < 0.01) continue;

      const heading = Math.atan2(-dz, dx);
      const numSegs = Math.max(1, Math.round(length / 2));
      const segLen = length / numSegs;
      const dirX = dx / length;
      const dirZ = dz / length;

      for (let s = 0; s < numSegs; s++) {
        const t = (s + 0.5) * segLen;
        const px = p0.x + dirX * t;
        const pz = p0.z + dirZ * t;

        const half = segLen / 2;
        const yA = this._sampleHeight(
          track,
          px - dirX * half,
          pz - dirZ * half,
        );
        const yB = this._sampleHeight(
          track,
          px + dirX * half,
          pz + dirZ * half,
        );

        const avgY = (yA + yB) / 2;
        const centerY = avgY + height / 2;
        const yShiftA = (yA - yB) / 2;
        const yShiftB = (yB - yA) / 2;
        const segW = segLen * 1.02;

        this.segments.push(
          new WallSegment(
            px,
            pz,
            centerY,
            segW,
            height,
            width,
            heading,
            0,
            this.segments.length,
            null, // `style` — unused by WallSegment (collider is invisible)
            "curb_poly",
            scene,
            shadows,
            yShiftA,
            yShiftB,
            false,
          ),
        );
      }
    }

    // ── 2) Visible ribbon ───────────────────────────────────────────────────
    this.ribbon = this._buildRibbon(points, closed, track, scene, shadows, {
      height,
      width,
      stripeColors: resolveStripeColors(feature),
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
    return points.some((pt) => {
      this._terrainQuery.heightAt(pt.x, pt.z);
      return (
        this._terrainQuery.getLastResolvedSurface?.()?.surfaceType ===
        "bridgeMesh"
      );
    });
  }

  _sampleHeight(track, x, z) {
    if (this._useBridgeSurfaceSampling) {
      return this._terrainQuery.heightAt(x, z);
    }
    return track.getHeightAt(x, z);
  }

  // ─── Ribbon construction ────────────────────────────────────────────────

  _resampleCenterline(points, closed, track) {
    const loop = closed ? [...points, points[0]] : points;
    const arcLen = [0];
    for (let i = 1; i < loop.length; i++) {
      arcLen.push(
        arcLen[i - 1] +
          Math.hypot(loop[i].x - loop[i - 1].x, loop[i].z - loop[i - 1].z),
      );
    }
    const total = arcLen[arcLen.length - 1];
    if (total < 1e-6) return null;

    const pointAt = (s) => {
      if (s <= 0) return { x: loop[0].x, z: loop[0].z };
      if (s >= total) {
        const l = loop[loop.length - 1];
        return { x: l.x, z: l.z };
      }
      let i = 1;
      while (i < arcLen.length && arcLen[i] < s) i++;
      const t = (s - arcLen[i - 1]) / (arcLen[i] - arcLen[i - 1]);
      return {
        x: loop[i - 1].x + t * (loop[i].x - loop[i - 1].x),
        z: loop[i - 1].z + t * (loop[i].z - loop[i - 1].z),
      };
    };

    const N = Math.max(2, Math.round(total / SAMPLE_STEP));
    const count = closed ? N : N + 1;
    const xs = [],
      zs = [],
      raw = [],
      s = [];
    for (let k = 0; k < count; k++) {
      const arc = (k * total) / N;
      const p = pointAt(arc);
      xs.push(p.x);
      zs.push(p.z);
      raw.push(this._sampleHeight(track, p.x, p.z));
      s.push(arc);
    }
    return { xs, zs, raw, s, step: total / N, total };
  }

  _buildRibbon(
    points,
    closed,
    track,
    scene,
    shadows,
    { height, width, stripeColors },
  ) {
    const cl = this._resampleCenterline(points, closed, track);
    if (!cl) return null;
    const { xs, zs, raw, s, step, total } = cl;
    const n = xs.length;
    if (n < 2) return null;

    const halfWidth = width / 2;

    // Per-sample unit normal (left side) from central-difference tangent.
    const nx = new Array(n),
      nz = new Array(n);
    for (let i = 0; i < n; i++) {
      const ip = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
      const iN = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      let tx = xs[iN] - xs[ip],
        tz = zs[iN] - zs[ip];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      nx[i] = -tz;
      nz[i] = tx;
    }

    // Rails (x/z) and vertical extents.
    const lx = new Array(n),
      lz = new Array(n),
      rx = new Array(n),
      rz = new Array(n);
    const topY = new Array(n),
      botY = new Array(n);
    for (let i = 0; i < n; i++) {
      lx[i] = xs[i] + nx[i] * halfWidth;
      lz[i] = zs[i] + nz[i] * halfWidth;
      rx[i] = xs[i] - nx[i] * halfWidth;
      rz[i] = zs[i] - nz[i] * halfWidth;
      topY[i] = raw[i] + height;
      botY[i] = raw[i];
    }

    const positions = [],
      indices = [],
      normals = [],
      colors = [];
    // 1–3 stripe colours, cycled along the ribbon (one colour = solid).
    const stripes = stripeColors;
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
      const sMid =
        closed && i === n - 1 ? s[i] + step * 0.5 : (s[i] + s[j]) / 2;
      const col = stripes[Math.floor(sMid / STRIPE_LEN) % stripes.length];

      let anx = nx[i] + nx[j],
        anz = nz[i] + nz[j];
      const al = Math.hypot(anx, anz) || 1;
      anx /= al;
      anz /= al;

      const Li_b = [lx[i], botY[i], lz[i]],
        Li_t = [lx[i], topY[i], lz[i]];
      const Lj_b = [lx[j], botY[j], lz[j]],
        Lj_t = [lx[j], topY[j], lz[j]];
      const Ri_b = [rx[i], botY[i], rz[i]],
        Ri_t = [rx[i], topY[i], rz[i]];
      const Rj_b = [rx[j], botY[j], rz[j]],
        Rj_t = [rx[j], topY[j], rz[j]];

      // Outer (left) face
      pushQuad(Li_b, Li_t, Lj_t, Lj_b, [anx, 0, anz], col);
      // Inner (right) face
      pushQuad(Ri_b, Rj_b, Rj_t, Ri_t, [-anx, 0, -anz], col);
      // Top face
      pushQuad(Li_t, Ri_t, Rj_t, Lj_t, [0, 1, 0], col);
    }

    // End caps for open polylines
    if (!closed) {
      const capCol = stripes[0];
      pushQuad(
        [lx[0], botY[0], lz[0]],
        [lx[0], topY[0], lz[0]],
        [rx[0], topY[0], rz[0]],
        [rx[0], botY[0], rz[0]],
        [-nz[0], 0, nx[0]],
        capCol,
      );
      const e = n - 1;
      pushQuad(
        [lx[e], botY[e], lz[e]],
        [lx[e], topY[e], lz[e]],
        [rx[e], topY[e], rz[e]],
        [rx[e], botY[e], rz[e]],
        [nz[e], 0, -nx[e]],
        capCol,
      );
    }

    const mesh = new Mesh("polyCurbRibbon", scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    vd.colors = colors;
    vd.applyToMesh(mesh);

    const mat = new StandardMaterial("polyCurbRibbonMat", scene);
    mat.diffuseColor = new Color3(1, 1, 1);
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
