import {
  Mesh,
  VertexData,
  StandardMaterial,
  Color3,
  PhysicsAggregate,
  PhysicsShapeType,
} from "@babylonjs/core";
import { expandPolyline } from "../polyline-utils.js";
import { TerrainQuery } from "../managers/TerrainQuery.js";
import { resolveStripeColors } from "./stripeColors.js";

// ── Ribbon visual tuning (tweak these by eye) ────────────────────────────────
const SAMPLE_STEP = 2; // centerline resample spacing (world units)
const SMOOTH_WINDOW = 18; // top-edge smoothing window (world units); larger = flatter top
const SKIRT_DEPTH = 2; // how far the ribbon base is buried below raw terrain
const STRIPE_LEN = 4; // colour stripe length along the wall (world units)
const END_CAP_ANGLE = 60; // open-end rake angle off horizontal (deg); 90 = vertical

/**
 * PolyWall — a wall that follows a polyline of world-space points.
 *
 * The wall is a single continuous "ribbon" mesh whose top edge is a smoothed
 * height profile and whose base is buried in the terrain, so the wall reads as
 * an embedded barrier of roughly constant height and has no gaps on thick,
 * sharply-curving corners.
 *
 * Collision uses the same resampled centerline as the ribbon:
 *  - trucks: analytic polyline collider (mesh.metadata.polylineCollider,
 *    resolved by StaticBodyCollisionManager) — no box-segment seams to hit
 *    while sliding along the wall.
 *  - dynamic Havok bodies (obstacles): a static MESH aggregate on the ribbon.
 */
export class PolyWall {
  /**
   * @param {object} feature  - track feature of type "polyWall"
   * @param {Track}  track    - used to sample terrain height at each segment
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(feature, track, scene, shadows) {
    this.ribbon = null;
    this.collider = null; // centerline collider data, also used for AI pathing
    this._physics = null;
    this._feature = feature; // stored so the editor can identify this wall
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

    this.ribbon = this._buildRibbon(points, closed, track, scene, shadows, {
      visualHeight,
      collisionHeight,
      thickness,
      friction,
      stripeColors: resolveStripeColors(feature),
    });

    if (this.ribbon) {
      // Static collision for dynamic Havok bodies (obstacles). The truck's
      // ANIMATED body ignores statics, so trucks only see the polyline collider.
      this._physics = new PhysicsAggregate(this.ribbon, PhysicsShapeType.MESH, {
        mass: 0,
        restitution: 0.2,
        friction: 0.8,
      }, scene);
    }
  }

  dispose() {
    if (this._physics) {
      this._physics.dispose();
      this._physics = null;
    }
    if (this.ribbon) {
      this.ribbon.material?.dispose();
      this.ribbon.dispose();
      this.ribbon = null;
    }
    this.collider = null;
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
    // open → include both endpoints (N+1 samples); closed → N samples, wrap.
    const count = closed ? N : N + 1;
    const xs = [],
      zs = [],
      raw = [],
      s = [],
      onBridge = [];
    for (let k = 0; k < count; k++) {
      const arc = (k * total) / N;
      const p = pointAt(arc);
      xs.push(p.x);
      zs.push(p.z);
      raw.push(this._sampleHeight(track, p.x, p.z));
      onBridge.push(
        this._useBridgeSurfaceSampling &&
          this._terrainQuery.getLastResolvedSurface?.()?.surfaceType ===
            "bridgeMesh",
      );
      s.push(arc);
    }
    return { xs, zs, raw, s, onBridge, step: total / N, total, closed };
  }

  /**
   * Per-centerline-sample smoothing blend (0..1), interpolated from the original
   * nodes' `smoothing` values along arc-length fraction. 1 = fully smoothed (the
   * flat-topped default); 0 = follow raw terrain exactly. Nodes without a value
   * default to 1 so existing walls are unchanged.
   */
  _perSampleSmoothing(s, total, closed) {
    const nodes = this._feature.points ?? [];
    const n = s.length;
    if (nodes.length < 2 || total < 1e-6) return new Array(n).fill(1);

    // Original-node smoothing values and their cumulative arc-length fractions.
    const loop = closed ? [...nodes, nodes[0]] : nodes;
    const cum = [0];
    for (let i = 1; i < loop.length; i++) {
      cum.push(
        cum[i - 1] +
          Math.hypot(loop[i].x - loop[i - 1].x, loop[i].z - loop[i - 1].z),
      );
    }
    const tot = cum[cum.length - 1] || 1;
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const sm = loop.map((p) => clamp01(p.smoothing ?? 1));

    return s.map((arc) => {
      const target = (arc / total) * tot; // same fraction along the original polyline
      let i = 1;
      while (i < cum.length && cum[i] < target) i++;
      if (i >= cum.length) return sm[sm.length - 1];
      const seg = cum[i] - cum[i - 1];
      const t = seg > 1e-6 ? (target - cum[i - 1]) / seg : 0;
      return sm[i - 1] + (sm[i] - sm[i - 1]) * t;
    });
  }

  /** Moving-average low-pass over the raw height profile. */
  _smoothHeights(raw, step, closed) {
    const n = raw.length;
    const w = Math.max(0, Math.round(SMOOTH_WINDOW / step));
    if (w === 0) return raw.slice();
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0,
        cnt = 0;
      for (let j = -w; j <= w; j++) {
        let idx = i + j;
        if (closed) {
          idx = ((idx % n) + n) % n;
        } else if (idx < 0 || idx >= n) {
          continue;
        }
        sum += raw[idx];
        cnt++;
      }
      out[i] = sum / cnt;
    }
    return out;
  }

  _buildRibbon(
    points,
    closed,
    track,
    scene,
    shadows,
    { visualHeight, collisionHeight, thickness, friction, stripeColors },
  ) {
    const cl = this._resampleCenterline(points, closed, track);
    if (!cl) return null;
    const { xs, zs, raw, s, onBridge, step, total } = cl;
    const n = xs.length;
    if (n < 2) return null;

    // Fully-smoothed profile, then blend each sample back toward raw terrain by
    // its per-node smoothing (1 = flat top as before, 0 = follow terrain exactly).
    const smoothFull = this._smoothHeights(raw, step, closed);
    const blend = this._perSampleSmoothing(s, total, closed);
    const smooth = smoothFull.map((h, i) => raw[i] + (h - raw[i]) * blend[i]);
    const halfThick = thickness / 2;

    // Per-sample unit normal (left side) from a central-difference tangent.
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
      nz[i] = tx; // rotate tangent +90° in XZ
    }

    // Rails (x/z) and vertical extents. Bottom rail carries its own x/z so the
    // open ends can splay their base outward (see below); interior samples keep
    // the base directly below the top.
    const lx = new Array(n),
      lz = new Array(n),
      rx = new Array(n),
      rz = new Array(n);
    const lbx = new Array(n),
      lbz = new Array(n),
      rbx = new Array(n),
      rbz = new Array(n);
    const topY = new Array(n),
      botY = new Array(n);
    for (let i = 0; i < n; i++) {
      lx[i] = xs[i] + nx[i] * halfThick;
      lz[i] = zs[i] + nz[i] * halfThick;
      rx[i] = xs[i] - nx[i] * halfThick;
      rz[i] = zs[i] - nz[i] * halfThick;
      lbx[i] = lx[i];
      lbz[i] = lz[i];
      rbx[i] = rx[i];
      rbz[i] = rz[i];
      topY[i] = smooth[i] + visualHeight;
      botY[i] = raw[i] - (onBridge[i] ? 0.15 : SKIRT_DEPTH);
    }

    // Splay the open-polyline end caps: push the base outward along the wall so
    // the end face leans out to ~END_CAP_ANGLE from horizontal instead of a sheer
    // vertical (90°) face. Closed loops have no ends and are left untouched.
    if (!closed && n >= 2) {
      const splayEnd = (i, iInward) => {
        // outward tangent = away from the wall body
        let tx = xs[i] - xs[iInward],
          tz = zs[i] - zs[iInward];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        // Splay so the VISIBLE face (ground→top) sits at END_CAP_ANGLE off
        // horizontal. The base is buried, so scale by the full top→bottom height
        // (not just the visible part) to land the right angle where it shows.
        const run = (topY[i] - botY[i]) / Math.tan((END_CAP_ANGLE * Math.PI) / 180);
        lbx[i] = lx[i] + tx * run;
        lbz[i] = lz[i] + tz * run;
        rbx[i] = rx[i] + tx * run;
        rbz[i] = rz[i] + tz * run;
      };
      splayEnd(0, 1);
      splayEnd(n - 1, n - 2);
    }

    const positions = [],
      indices = [],
      normals = [],
      colors = [];
    const pushQuad = (p0, p1, p2, p3, nrm, col) => {
      const base = positions.length / 3;
      positions.push(...p0, ...p1, ...p2, ...p3);
      for (let k = 0; k < 4; k++) {
        normals.push(...nrm);
        colors.push(col[0], col[1], col[2], 1);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    // 1–3 stripe colours, cycled along the ribbon (one colour = solid).
    const stripes = stripeColors;
    const bandCount = closed ? n : n - 1;
    for (let i = 0; i < bandCount; i++) {
      const j = (i + 1) % n;
      // stripe colour from the band's mid arc-length
      const sMid =
        closed && i === n - 1 ? s[i] + step * 0.5 : (s[i] + s[j]) / 2;
      const col = stripes[Math.floor(sMid / STRIPE_LEN) % stripes.length];

      // averaged outward normal for the side faces of this band
      let anx = nx[i] + nx[j],
        anz = nz[i] + nz[j];
      const al = Math.hypot(anx, anz) || 1;
      anx /= al;
      anz /= al;

      const Li_b = [lbx[i], botY[i], lbz[i]],
        Li_t = [lx[i], topY[i], lz[i]];
      const Lj_b = [lbx[j], botY[j], lbz[j]],
        Lj_t = [lx[j], topY[j], lz[j]];
      const Ri_b = [rbx[i], botY[i], rbz[i]],
        Ri_t = [rx[i], topY[i], rz[i]];
      const Rj_b = [rbx[j], botY[j], rbz[j]],
        Rj_t = [rx[j], topY[j], rz[j]];

      // Outer (left) face — faces +n
      pushQuad(Li_b, Li_t, Lj_t, Lj_b, [anx, 0, anz], col);
      // Inner (right) face — faces −n
      pushQuad(Ri_b, Rj_b, Rj_t, Ri_t, [-anx, 0, -anz], col);
      // Top face
      pushQuad(Li_t, Ri_t, Rj_t, Lj_t, [0, 1, 0], col);
    }

    // End caps for an open polyline.
    if (!closed) {
      const capCol = stripes[0];
      // start cap faces −tangent (use sample 0 normal-perp); winding handled by
      // backFaceCulling=false so direction is cosmetic only.
      pushQuad(
        [lbx[0], botY[0], lbz[0]],
        [lx[0], topY[0], lz[0]],
        [rx[0], topY[0], rz[0]],
        [rbx[0], botY[0], rbz[0]],
        [-nz[0], 0, nx[0]],
        capCol,
      );
      const e = n - 1;
      pushQuad(
        [lbx[e], botY[e], lbz[e]],
        [lx[e], topY[e], lz[e]],
        [rx[e], topY[e], rz[e]],
        [rbx[e], botY[e], rbz[e]],
        [nz[e], 0, -nx[e]],
        capCol,
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

    // Truck collision: the same centerline the ribbon was built from, resolved
    // analytically by StaticBodyCollisionManager. Collision top may differ from
    // the visual top (feature.collisionHeight).
    this.collider = {
      xs,
      zs,
      topY: smooth.map((h) => h + collisionHeight),
      botY,
      halfThick,
      closed,
      step,
      retain: Math.max(0, Math.min(1, 1 - friction)),
    };
    mesh.metadata = { ...(mesh.metadata ?? {}), polylineCollider: this.collider };

    return mesh;
  }
}
