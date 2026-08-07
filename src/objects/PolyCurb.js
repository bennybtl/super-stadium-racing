import { PhysicsAggregate, PhysicsShapeType } from "@babylonjs/core";
import { expandPolyline } from "../polyline-utils.js";
import { resolveStripeColors } from "./stripeColors.js";
import {
  RibbonHeightSampler,
  resampleCenterline,
  centerlineNormals,
  buildStripedRibbon,
} from "./poly-ribbon.js";

const SAMPLE_STEP = 0.5;
const STRIPE_LEN = 2;

/**
 * PolyCurb — builds terrain-following curb segments along a polyline.
 *
 * The visible curb is a single continuous ribbon mesh with vertex-colour
 * stripes matching the kerb strips seen at the edge of real race tracks.
 * Trucks drive over curbs freely (no truck collider); the ribbon carries a
 * static Havok MESH aggregate so dynamic obstacles still collide with it.
 * `this.collider` exposes the centerline so AI pathing treats curbs as
 * track limits.
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
    this.ribbon = null;
    this.collider = null; // centerline data for AI pathing (no truck collision)
    this._physics = null;
    this._feature = feature;
    this._sampler = new RibbonHeightSampler(scene, feature);

    const { height = 0.22, width = 0.9, closed = false } = feature;
    const rawPoints = feature.points;
    if (!rawPoints || rawPoints.length < 2) return;

    const points = expandPolyline(rawPoints, closed);

    this.ribbon = this._buildRibbon(points, closed, track, scene, shadows, {
      height,
      width,
      stripeColors: resolveStripeColors(feature),
    });

    if (this.ribbon) {
      // Static collision for dynamic Havok bodies (obstacles). Trucks ignore
      // statics (ANIMATED body) so they still drive over curbs freely.
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

  // ─── Ribbon construction ────────────────────────────────────────────────

  _buildRibbon(
    points,
    closed,
    track,
    scene,
    shadows,
    { height, width, stripeColors },
  ) {
    const cl = resampleCenterline(points, closed, this._sampler, track, SAMPLE_STEP);
    if (!cl) return null;
    const { xs, zs, raw, s, step } = cl;
    const n = xs.length;
    if (n < 2) return null;

    const halfWidth = width / 2;
    const { nx, nz } = centerlineNormals(xs, zs, closed);

    // Rails and vertical extents. A curb sits flat on the ground, so its base
    // rails are directly below the top ones (no splay) and its base is the raw
    // terrain height rather than a buried skirt.
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

    const mesh = buildStripedRibbon({
      name: "polyCurbRibbon",
      scene,
      shadows,
      xs, s, step, closed,
      nx, nz,
      lx, lz, rx, rz,
      lbx: lx, lbz: lz, rbx: rx, rbz: rz,
      topY, botY,
      stripes: stripeColors,
      stripeLen: STRIPE_LEN,
    });

    // Centerline descriptor source for AI pathing (curbs mark track limits
    // even though trucks can physically drive over them).
    this.collider = { xs, zs, halfThick: halfWidth, closed, step };

    return mesh;
  }
}
