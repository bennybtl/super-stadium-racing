import { PhysicsAggregate, PhysicsShapeType } from "@babylonjs/core";
import { expandPolyline } from "../polyline-utils.js";
import { clamp01 } from "../math-utils.js";
import { resolveStripeColors } from "./stripeColors.js";
import {
  RibbonHeightSampler,
  resampleCenterline,
  centerlineNormals,
  buildStripedRibbon,
} from "./poly-ribbon.js";

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
    this._sampler = new RibbonHeightSampler(scene, feature);
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

  // ─── Ribbon construction ───────────────────────────────────────────────────

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
    const cl = resampleCenterline(points, closed, this._sampler, track, SAMPLE_STEP);
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

    const { nx, nz } = centerlineNormals(xs, zs, closed);

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

    const mesh = buildStripedRibbon({
      name: "polyWallRibbon",
      scene,
      shadows,
      xs, s, step, closed,
      nx, nz,
      lx, lz, rx, rz,
      lbx, lbz, rbx, rbz,
      topY, botY,
      stripes: stripeColors,
      stripeLen: STRIPE_LEN,
    });

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
