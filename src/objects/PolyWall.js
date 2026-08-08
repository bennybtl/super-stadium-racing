import {
  PhysicsAggregate,
  PhysicsShapeType,
  MeshBuilder,
  Mesh,
  VertexData,
  StandardMaterial,
  Texture,
  Color3,
  Vector3,
} from "@babylonjs/core";
import chainlinkTextureUrl from "../assets/textures/chainlink.texture.png?url";
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

// ── Chain-link fence tubing (feature.fence) ──────────────────────────────────
// Post spacing follows the wall's own segments — one per colour stripe through a
// bend, where the fence needs the support and the posts read as the curve, and
// every other stripe down a straight run.
const FENCE_POST_SPACING = STRIPE_LEN;
const FENCE_POST_CORNER_ANGLE = 10; // turn (deg) at a sample that counts as a bend
const FENCE_TUBE_RADIUS = 0.07;  // rail and post radius (world units)
const FENCE_TUBE_SIDES = 6;      // tube tessellation — hexagons read as round here
const FENCE_MIN_HEIGHT = 0.3;    // below this there is nothing worth drawing
const FENCE_POST_EMBED = 0.15;   // how far posts sink into the wall top
const FENCE_COLOR = new Color3(0.60, 0.62, 0.65);
const FENCE_MESH_TILE = 2;       // world units per chain-link texture repeat

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
    if (this._physics) {
      this._physics.dispose();
      this._physics = null;
    }
    for (const part of this.fenceParts) {
      part.material?.dispose();
      part.dispose();
    }
    this.fenceParts = [];
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

    if (fence) {
      this.fenceParts = this._buildFence({
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
      botY,
      halfThick,
      closed,
      step,
      retain: Math.max(0, Math.min(1, 1 - friction)),
    };
    mesh.metadata = { ...(mesh.metadata ?? {}), polylineCollider: this.collider };

    return mesh;
  }

  // ─── Chain-link fence ──────────────────────────────────────────────────────

  /**
   * Metal tubing standing on the wall top: a rail following the wall's smoothed
   * profile, carried by posts at regular intervals. The fence spans the gap the
   * collision height already covers — from the visual top (`bottom`) up to the
   * collision top (`top`) — so what the truck hits and what the player sees line
   * up, and the fence disappears when the two heights match.
   *
   * Purely visual: trucks are stopped by the wall's existing polyline collider,
   * and the ribbon's mesh aggregate keeps handling dynamic bodies.
   *
   * @returns {Mesh[]} the merged tubing and the chain-link mesh (empty when
   *   there is no gap to fill)
   */
  _buildFence({ xs, zs, s, step, total, nx, nz, smooth, closed, scene, bottom, top }) {
    const fenceHeight = top - bottom;
    if (fenceHeight < FENCE_MIN_HEIGHT) return [];

    const n = xs.length;
    const parts = [];

    // Top rail — centred a radius below the collision top so the tube's crown,
    // not its axis, lands on that height.
    const railY = (i) => smooth[i] + top - FENCE_TUBE_RADIUS;
    const path = [];
    for (let i = 0; i < n; i++) path.push(new Vector3(xs[i], railY(i), zs[i]));
    if (closed) path.push(path[0].clone());
    parts.push(MeshBuilder.CreateTube("polyWallFenceRail", {
      path,
      radius: FENCE_TUBE_RADIUS,
      tessellation: FENCE_TUBE_SIDES,
      cap: closed ? Mesh.NO_CAP : Mesh.CAP_ALL,
    }, scene));

    const postAt = (i) => {
      const baseY = smooth[i] + bottom - FENCE_POST_EMBED;
      const height = smooth[i] + top - baseY;
      const post = MeshBuilder.CreateCylinder("polyWallFencePost", {
        height,
        diameter: FENCE_TUBE_RADIUS * 2,
        tessellation: FENCE_TUBE_SIDES,
      }, scene);
      post.position.set(xs[i], baseY + height / 2, zs[i]);
      parts.push(post);
    };

    // Turn between the segments meeting at sample `i`, in radians.
    const turnAt = (i) => {
      const prev = closed ? (i - 1 + n) % n : i - 1;
      const next = closed ? (i + 1) % n : i + 1;
      if (prev < 0 || next >= n) return 0; // open ends have only one segment
      const ax = xs[i] - xs[prev], az = zs[i] - zs[prev];
      const bx = xs[next] - xs[i], bz = zs[next] - zs[i];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < 1e-6 || lb < 1e-6) return 0;
      const cos = (ax * bx + az * bz) / (la * lb);
      return Math.acos(Math.min(1, Math.max(-1, cos)));
    };

    const cornerAngle = (FENCE_POST_CORNER_ANGLE * Math.PI) / 180;
    let lastPost = -1;
    let lastPostS = -Infinity;
    for (let i = 0; i < n; i++) {
      // Straight enough to skip every other stripe; a bend gets one per stripe.
      const spacing = turnAt(i) < cornerAngle
        ? FENCE_POST_SPACING * 2
        : FENCE_POST_SPACING;
      // Samples are quantised to `step`, so allow the nearest one rather than
      // overshooting a whole sample past every target distance.
      if (s[i] - lastPostS < spacing - step * 0.5) continue;
      postAt(i);
      lastPost = i;
      lastPostS = s[i];
    }
    // Open walls always get an end post, so the rail never trails off unsupported.
    if (!closed && lastPost !== n - 1) postAt(n - 1);

    const tubing = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (!tubing) return [];
    tubing.name = "polyWallFenceTubing";

    const mat = new StandardMaterial("polyWallFenceMat", scene);
    mat.diffuseColor = FENCE_COLOR;
    mat.specularColor = new Color3(0.35, 0.35, 0.35);
    mat.specularPower = 48;
    tubing.material = mat;
    tubing.isPickable = false;
    tubing.receiveShadows = true;

    const mesh = this._buildFenceMesh({
      xs, zs, s, total, nx, nz, smooth, closed, scene,
      bottom,
      top: top - FENCE_TUBE_RADIUS, // hangs from the rail's axis
    });

    return mesh ? [tubing, mesh] : [tubing];
  }

  /**
   * The chain-link fabric itself: a quad strip on the wall centerline spanning
   * wall top → top rail, textured with an alpha-cut chain-link tile.
   *
   * Alpha *testing* rather than blending — the mesh is mostly holes, and a
   * cutout keeps it writing depth so overlapping fence runs (and the tubing in
   * front of it) sort correctly without a transparency pass. UVs run off arc
   * length, so the weave keeps a constant world scale around corners and the
   * diamonds stay square whatever the fence height.
   */
  _buildFenceMesh({ xs, zs, s, total, nx, nz, smooth, closed, scene, bottom, top }) {
    const n = xs.length;
    const height = top - bottom;
    if (n < 2 || height <= 0) return null;

    // Closed loops repeat the first sample so the seam band has somewhere to
    // interpolate its U to, rather than wrapping back to zero.
    const count = closed ? n + 1 : n;
    const positions = [], normals = [], uvs = [], indices = [];
    // A closed loop stretches the tile just enough to fit a whole number of
    // repeats around the perimeter, so the weave meets itself at the seam
    // instead of being cut mid-diamond.
    const tile = closed
      ? total / Math.max(1, Math.round(total / FENCE_MESH_TILE))
      : FENCE_MESH_TILE;
    const vTop = height / tile;

    for (let k = 0; k < count; k++) {
      const i = k % n;
      const u = (k < n ? s[i] : total) / tile;
      positions.push(xs[i], smooth[i] + bottom, zs[i]);
      positions.push(xs[i], smooth[i] + top, zs[i]);
      normals.push(nx[i], 0, nz[i], nx[i], 0, nz[i]);
      uvs.push(u, 0, u, vTop);
    }

    for (let k = 0; k < count - 1; k++) {
      const b = k * 2;
      indices.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }

    const mesh = new Mesh("polyWallFenceMesh", scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    vd.uvs = uvs;
    vd.applyToMesh(mesh);

    const texture = new Texture(chainlinkTextureUrl, scene);
    texture.hasAlpha = true;
    texture.anisotropicFilteringLevel = 4;

    const mat = new StandardMaterial("polyWallFenceMeshMat", scene);
    mat.diffuseTexture = texture;
    mat.diffuseColor = FENCE_COLOR;
    mat.specularColor = new Color3(0.25, 0.25, 0.25);
    mat.specularPower = 48;
    mat.backFaceCulling = false;
    mat.twoSidedLighting = true; // the strip is seen from both sides
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    return mesh;
  }
}
