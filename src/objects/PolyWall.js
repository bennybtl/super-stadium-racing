import {
  PhysicsAggregate,
  PhysicsShapeType,
} from "@babylonjs/core";
import { expandPolyline } from "../utils/polyline-utils.js";
import { clamp01, smoothstep } from "../utils/math-utils.js";
import { resolveStripeColors } from "./stripeColors.js";
import {
  RibbonHeightSampler,
  resampleCenterline,
  centerlineNormals,
  buildStripedRibbon,
  paintWallScuffTexture,
  createBlankWallScuffTexture,
  addWallScuffHits,
  buildChainlinkFence,
} from "./poly-ribbon.js";
import { wallWearKey, loadWallWear, saveWallWear } from "../managers/WallWearStorage.js";

// ── Ribbon visual tuning (tweak these by eye) ────────────────────────────────
const SAMPLE_STEP = 2; // centerline resample spacing (world units)
const SMOOTH_WINDOW = 18; // top-edge smoothing window (world units); larger = flatter top
// How far the ribbon base is sunk below the terrain it meets. Kept small on
// purpose: the terrain is NOT a shadow occluder, so any caster geometry that
// dips below the surface is still lit in the shadow map and throws a phantom
// shadow back toward the key light (a point below the receiver plane projects
// its shadow to the light-facing side). We sink just enough to hide the seam.
const BASE_EMBED = 0.3;
const STRIPE_LEN = 4; // colour stripe length along the wall (world units)
const END_CAP_ANGLE = 60; // open-end rake angle off horizontal (deg); 90 = vertical

// Scuff wear: a deterministic proxy for "trucks rub here". Real driving lines
// run tight to the apex and carry momentum in the PRE-turn direction rather
// than following the path's tighter curve, sliding wide onto the outside wall
// of a corner — hugging the raw AI path itself misses this entirely. So for
// each point along the AI path we look at how sharply it turns and project a
// "slide" segment forward from that point along the incoming (pre-turn)
// tangent — a straight continuation of where the truck was already heading.
// Sharper turns get a longer projection (more likely to carry all the way to
// the outside wall) and a stronger contribution once it gets close.
const AI_PATH_STEP = 2; // resample spacing for curvature sampling (world units)
const DIR_WINDOW_DIST = 10; // world units back/forward used to read local tangent
const SLIDE_FULL_ANGLE = Math.PI / 2; // turn angle (rad) at which slide reach is maxed out
const SLIDE_MAX_DIST = 20; // forward projection length at full sharpness (world units)
const SCUFF_NEAR_DIST = 1.5; // wall-to-slide-segment distance for full darkening
const SCUFF_FAR_DIST = 8; // distance beyond which a slide segment contributes nothing

// Live scuff accumulation: on top of the deterministic bake above, an actual
// truck-vs-wall contact (reported by StaticBodyCollisionManager) nudges the
// hit sample's intensity up in real time, so heavily-used walls keep getting
// more worn over a session instead of staying fixed at the pre-baked look.
const LIVE_SCUFF_GAIN = 1.5; // intensity added per contact-frame, per world-unit of penetration
const LIVE_SCUFF_MIN_DELTA = 0.02; // ignore bumps smaller than this so grazing doesn't spam repaints
const LIVE_SCUFF_FLUSH_MS = 200; // minimum time between texture repaints

/** Closest point + distance from (px,pz) to a segment ab. */
function _closestOnSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 1e-9 ? clamp01(((px - ax) * dx + (pz - az) * dz) / len2) : 0;
  const cx = ax + dx * t, cz = az + dz * t;
  return { dist: Math.hypot(px - cx, pz - cz), cx, cz };
}

/** Resample a closed x/z polyline to (roughly) uniform arc-length spacing. */
function _resampleClosedXZ(points, step) {
  const n = points.length;
  if (n < 2) return [];
  const segLen = new Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    segLen[i] = Math.hypot(b.x - a.x, b.z - a.z);
    total += segLen[i];
  }
  if (total < 1e-6) return [];

  const out = [];
  let segIdx = 0, segStart = 0, segRemain = segLen[0];
  for (let d = 0; d < total; d += step) {
    while (segRemain > 0 && d > segStart + segRemain && segIdx < n - 1) {
      segStart += segRemain;
      segIdx++;
      segRemain = segLen[segIdx];
    }
    const a = points[segIdx], b = points[(segIdx + 1) % n];
    const t = segRemain > 1e-6 ? (d - segStart) / segRemain : 0;
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  return out;
}

/**
 * Every polyWall's centerline (already-authored shape, corners rounded — no
 * need for the ribbon's finer arc-length resampling since these are only used
 * for straight-line occlusion tests). Includes the wall currently being built;
 * that's fine — a slide segment that reaches its own wall unobstructed is
 * exactly the "trucks hit this wall" case we want.
 */
function _gatherWallCenterlines(track) {
  const centerlines = [];
  for (const f of track?.features ?? []) {
    if (f.type !== "polyWall") continue;
    if (!Array.isArray(f.points) || f.points.length < 2) continue;
    const closed = f.closed ?? false;
    centerlines.push({ points: expandPolyline(f.points, closed), closed });
  }
  return centerlines;
}

/** Fraction t along segment ab where it crosses segment cd, or null if it doesn't. */
function _segmentIntersectionT(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az;
  const sx = dx - cx, sz = dz - cz;
  const denom = rx * sz - rz * sx;
  if (Math.abs(denom) < 1e-9) return null; // parallel/collinear
  const t = ((cx - ax) * sz - (cz - az) * sx) / denom;
  const u = ((cx - ax) * rz - (cz - az) * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

/**
 * Shorten a slide segment to stop at the first wall it crosses — otherwise a
 * projection that punches through the near wall it actually hits keeps going
 * and registers false proximity to whatever wall happens to be behind it.
 */
function _truncateAtFirstWall(ax, az, bx, bz, wallCenterlines) {
  let bestT = 1;
  for (const { points, closed } of wallCenterlines) {
    const n = points.length;
    const segCount = closed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      const p1 = points[i], p2 = points[(i + 1) % n];
      const t = _segmentIntersectionT(ax, az, bx, bz, p1.x, p1.z, p2.x, p2.z);
      if (t != null && t < bestT) bestT = t;
    }
  }
  return bestT >= 1 ? { bx, bz } : { bx: ax + (bx - ax) * bestT, bz: az + (bz - az) * bestT };
}

/**
 * Per-point "slide" segments along the AI path: at each resampled path point,
 * measure the turn angle over a `DIR_WINDOW_DIST` window and, if it turns at
 * all, project a segment forward from that point along the incoming tangent
 * — the straight line a sliding truck would carry along instead of following
 * the sharper curve. Length scales with how sharp the turn is. Truncated at
 * the first wall the projection actually crosses.
 */
function _aiPathSlideSegments(aiPathPoints, wallCenterlines) {
  const path = _resampleClosedXZ(aiPathPoints, AI_PATH_STEP);
  const n = path.length;
  if (n < 3) return [];

  const win = Math.max(1, Math.round(DIR_WINDOW_DIST / AI_PATH_STEP));
  const segments = [];
  for (let i = 0; i < n; i++) {
    const a = path[(i - win + n) % n];
    const curr = path[i];
    const b = path[(i + win) % n];
    const inX = curr.x - a.x, inZ = curr.z - a.z;
    const inLen = Math.hypot(inX, inZ);
    const outX = b.x - curr.x, outZ = b.z - curr.z;
    const outLen = Math.hypot(outX, outZ);
    if (inLen < 1e-4 || outLen < 1e-4) continue;

    const dot = (inX * outX + inZ * outZ) / (inLen * outLen);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const sharpness = Math.min(angle / SLIDE_FULL_ANGLE, 1);
    if (sharpness < 0.02) continue;

    const slideLen = sharpness * SLIDE_MAX_DIST;
    const inNX = inX / inLen, inNZ = inZ / inLen;
    const rawBx = curr.x + inNX * slideLen, rawBz = curr.z + inNZ * slideLen;
    const { bx, bz } = _truncateAtFirstWall(curr.x, curr.z, rawBx, rawBz, wallCenterlines);
    segments.push({ ax: curr.x, az: curr.z, bx, bz, sharpness });
  }
  return segments;
}

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
    this.fenceParts = []; // optional chain-link fence above the wall (tubing + mesh)
    this.collider = null; // centerline collider data, also used for AI pathing
    this._physics = null;
    this._scuffTexture = null; // baked scuff-mark texture (see paintWallScuffTexture), if any
    // Live scuff state — populated in _buildRibbon, updated by _onWallContact.
    this._scene = scene;
    this._wallTotal = 0;
    this._wallS = null;
    this._liveLeft = null;
    this._liveRight = null;
    this._paintedLeft = null; // how much of _liveLeft/_liveRight is already drawn — see _onWallContact
    this._paintedRight = null;
    this._pendingScuffHits = [];
    this._lastScuffFlushAt = 0;
    this._liveScuffSeed = 0;
    this._wearDirty = false; // true once a real contact changes wear beyond what's already saved
    this._trackKey = track?.id || null;
    this._wallKey = wallWearKey(feature);
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
      fence: feature.fence ?? false,
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
    if (this._wearDirty && this._trackKey && this._liveLeft && this._liveRight) {
      saveWallWear(this._trackKey, this._wallKey, this._liveLeft, this._liveRight);
      this._wearDirty = false;
    }
    if (this._physics) {
      this._physics.dispose();
      this._physics = null;
    }
    for (const part of this.fenceParts) {
      part.material?.dispose();
      part.dispose();
    }
    this.fenceParts = [];
    if (this._scuffTexture) {
      this._scuffTexture.dispose();
      this._scuffTexture = null;
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

  /**
   * Per-sample scuff intensity (0..1) for each side face, from how close a
   * predicted truck "slide" trajectory (see _aiPathSlideSegments) passes the
   * wall's centerline at that point. Whichever side (left/right of the wall's
   * outward normal) the trajectory is actually on gets the intensity — the far
   * side stays clean. Where several corners' slide segments reach the same
   * stretch of wall, the strongest one wins rather than stacking.
   */
  _computeScuff(xs, zs, nx, nz, track) {
    const n = xs.length;
    const left = new Array(n).fill(0);
    const right = new Array(n).fill(0);
    const aiPath = track?.features?.find((f) => f.type === "aiPath");
    const points = aiPath?.points;
    if (!Array.isArray(points) || points.length < 3) return { left, right };

    const wallCenterlines = _gatherWallCenterlines(track);
    const segments = _aiPathSlideSegments(points, wallCenterlines);
    if (segments.length === 0) return { left, right };

    for (let i = 0; i < n; i++) {
      let best = 0, bestCx = xs[i], bestCz = zs[i];
      for (const seg of segments) {
        const { dist, cx, cz } = _closestOnSegment(xs[i], zs[i], seg.ax, seg.az, seg.bx, seg.bz);
        const proximity = 1 - smoothstep(SCUFF_NEAR_DIST, SCUFF_FAR_DIST, dist);
        if (proximity <= 0) continue;
        const intensity = proximity * seg.sharpness;
        if (intensity > best) {
          best = intensity;
          bestCx = cx;
          bestCz = cz;
        }
      }
      if (best <= 0) continue;
      const side = (bestCx - xs[i]) * nx[i] + (bestCz - zs[i]) * nz[i];
      if (side >= 0) left[i] = best;
      else right[i] = best;
    }
    return { left, right };
  }

  /**
   * Called by StaticBodyCollisionManager every frame a truck is genuinely
   * pressing into this wall's side (not just driving up onto its top) — `i/j/t`
   * locate the contact along the same resampled centerline `_computeScuff`
   * used, so it indexes directly into `_liveLeft`/`_liveRight`. `amount` is the
   * lateral penetration depth that frame; `side` matches the left/right sign
   * convention `_computeScuff` uses.
   *
   * The accumulator (`_liveLeft`/`_liveRight`) always advances, however small
   * the bump — a sustained scrape corrects back out most of its penetration
   * every single frame, so any single frame's gain is typically tiny. What
   * `_paintedLeft`/`_paintedRight` track is how much of that accumulation has
   * actually been drawn; a repaint is only queued once the *undrawn* amount
   * clears LIVE_SCUFF_MIN_DELTA, so many small frames still add up to a visible
   * mark instead of each one being individually discarded as negligible.
   */
  _onWallContact(i, j, t, side, amount) {
    if (!this._liveLeft) return; // ribbon build failed or hasn't finished yet
    const idx = t < 0.5 ? i : j;
    const buf = side >= 0 ? this._liveLeft : this._liveRight;
    const painted = side >= 0 ? this._paintedLeft : this._paintedRight;
    const prev = buf[idx];
    buf[idx] = Math.min(1, buf[idx] + amount * LIVE_SCUFF_GAIN);
    if (buf[idx] > prev) this._wearDirty = true;
    if (buf[idx] - painted[idx] < LIVE_SCUFF_MIN_DELTA) return;
    painted[idx] = buf[idx];
    this._pendingScuffHits.push({ idx, side, intensity: buf[idx] });
    this._maybeFlushLiveScuff();
  }

  /** Paint queued live hits onto the wall's scuff texture, no more often than LIVE_SCUFF_FLUSH_MS. */
  _maybeFlushLiveScuff() {
    if (this._pendingScuffHits.length === 0) return;
    const now = performance.now();
    if (now - this._lastScuffFlushAt < LIVE_SCUFF_FLUSH_MS) return;
    this._lastScuffFlushAt = now;

    if (!this._scuffTexture) {
      this._scuffTexture = createBlankWallScuffTexture(this._scene, "polyWallRibbon", this._wallTotal);
      if (this.ribbon?.material) this.ribbon.material.diffuseTexture = this._scuffTexture;
    }
    const hits = this._pendingScuffHits.map(({ idx, side, intensity }) => ({
      s: this._wallS[idx],
      side,
      intensity,
      seed: idx * 97 + (side >= 0 ? 500 : 0) + this._liveScuffSeed++,
    }));
    this._pendingScuffHits = [];
    addWallScuffHits(this._scuffTexture, { total: this._wallTotal, hits });
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
    { visualHeight, collisionHeight, thickness, friction, fence, stripeColors },
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
    const { left: scuffLeft, right: scuffRight } = this._computeScuff(xs, zs, nx, nz, track);

    // Fold in wear saved from previous sessions (see WallWearStorage) — a
    // straight max against the deterministic baseline, so a wall this track's
    // author reshaped since the save (length mismatch) or one with nothing
    // saved just falls back to the fresh baseline untouched.
    if (this._trackKey) {
      const saved = loadWallWear(this._trackKey, this._wallKey, n);
      if (saved) {
        for (let i = 0; i < n; i++) {
          scuffLeft[i] = Math.max(scuffLeft[i], saved.left[i]);
          scuffRight[i] = Math.max(scuffRight[i], saved.right[i]);
        }
      }
    }

    // Live scuff state (see _onWallContact): starts from the deterministic
    // bake (now folded with any saved wear) so a real hit adds to, rather than
    // overrides, that starting look.
    this._wallTotal = total;
    this._wallS = s;
    this._liveLeft = scuffLeft.slice();
    this._liveRight = scuffRight.slice();
    // What's already drawn (the baseline bake) — see _onWallContact.
    this._paintedLeft = scuffLeft.slice();
    this._paintedRight = scuffRight.slice();

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
      // Follow the terrain at the wall's OWN edges (not just the centerline) so
      // the base tucks a hair under the surface on both sides of a cross-slope
      // instead of needing a deep skirt that would leak a phantom shadow.
      const edgeGround = Math.min(
        raw[i],
        this._sampler.sample(track, lx[i], lz[i]),
        this._sampler.sample(track, rx[i], rz[i]),
      );
      botY[i] = edgeGround - (onBridge[i] ? 0.15 : BASE_EMBED);
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
      xs, s, step, total, closed,
      nx, nz,
      lx, lz, rx, rz,
      lbx, lbz, rbx, rbz,
      topY, botY,
      stripes: stripeColors,
      stripeLen: STRIPE_LEN,
    });

    this._scuffTexture = paintWallScuffTexture(scene, "polyWallRibbon", { total, s, scuffLeft, scuffRight });
    if (this._scuffTexture) mesh.material.diffuseTexture = this._scuffTexture;

    if (fence) {
      this.fenceParts = buildChainlinkFence({
        xs, zs, s, step, total, nx, nz, smooth, closed, scene,
        bottom: visualHeight,
        top: collisionHeight,
      });
    }

    // Truck collision: the same centerline the ribbon was built from, resolved
    // analytically by StaticBodyCollisionManager. Collision top may differ from
    // the visual top (feature.collisionHeight).
    this.collider = {
      xs,
      zs,
      topY: smooth.map((h) => h + collisionHeight),
      // The visual base only tucks ~BASE_EMBED under the surface now; the
      // collision floor stays well below grade so a truck on a downhill slope
      // beside the wall can't drop under the vertical gate and pass through.
      botY: raw.map((h) => h - 2),
      halfThick,
      closed,
      step,
      retain: Math.max(0, Math.min(1, 1 - friction)),
      onContact: (i, j, t, side, amount) => this._onWallContact(i, j, t, side, amount),
    };
    mesh.metadata = { ...(mesh.metadata ?? {}), polylineCollider: this.collider, decalTarget: true };

    return mesh;
  }
}
