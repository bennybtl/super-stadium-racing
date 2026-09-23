/**
 * Port of the ez-tree generator (https://github.com/dgreenheck/ez-tree,
 * MIT © 2024 Daniel Greenheck — see ./LICENSE), vendored at dcf309b.
 *
 * Only the engine-agnostic core is kept: skeleton growth (all RNG) and
 * meshing (no RNG) into plain {verts, normals, uvs, indices} arrays. Three's
 * materials / wind shader / LOD / trellis are dropped — the Babylon side lives
 * in ../../tree.js.
 *
 * The orientation math deliberately does NOT use Babylon's Quaternion/Vector3:
 * ez-tree stores section orientations as XYZ Euler angles, perturbs them in
 * Euler space and round-trips them through quaternions, so the exact Three
 * decomposition (Euler.setFromRotationMatrix 'XYZ') is part of the tree's
 * shape. The helpers below are verbatim ports of the Three r186 formulas, so
 * a seed yields the same tree as the original (verified by
 * scripts/check-eztree.mjs against a golden captured from the Three version).
 *
 * Output is in Three's right-handed space (y up); the Babylon mesh builder
 * mirrors z.
 */
import RNG from "./rng.js";

// ── Three-compatible math on plain {x,y,z} / {x,y,z,w} ──────────────────────

const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const clone3 = (v) => ({ x: v.x, y: v.y, z: v.z });
const lerp3 = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const len3 = (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

function normalize3(v) {
  const s = 1 / (len3(v) || 1);
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function quatFromEuler(e) { // order 'XYZ'
  const c1 = Math.cos(e.x / 2), c2 = Math.cos(e.y / 2), c3 = Math.cos(e.z / 2);
  const s1 = Math.sin(e.x / 2), s2 = Math.sin(e.y / 2), s3 = Math.sin(e.z / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

function quatAxisAngle(axis, angle) {
  const s = Math.sin(angle / 2);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) };
}

function quatMul(a, b) { // a * b
  return {
    x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
    y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
    z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function quatSlerp(a, b, t) { // Three's a.slerp(b, t)
  let { x, y, z, w } = b;
  let dot = a.x * x + a.y * y + a.z * z + a.w * w;
  if (dot < 0) { x = -x; y = -y; z = -z; w = -w; dot = -dot; }
  let s = 1 - t;
  if (dot < 0.9995) {
    const theta = Math.acos(dot);
    const sin = Math.sin(theta);
    s = Math.sin(s * theta) / sin;
    t = Math.sin(t * theta) / sin;
    return { x: a.x * s + x * t, y: a.y * s + y * t, z: a.z * s + z * t, w: a.w * s + w * t };
  }
  const q = { x: a.x * s + x * t, y: a.y * s + y * t, z: a.z * s + z * t, w: a.w * s + w * t };
  let l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (l === 0) return { x: 0, y: 0, z: 0, w: 1 };
  l = 1 / l;
  return { x: q.x * l, y: q.y * l, z: q.z * l, w: q.w * l };
}

function eulerFromQuat(q) { // order 'XYZ', via Three's rotation-matrix path
  const x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
  const xx = q.x * x2, xy = q.x * y2, xz = q.x * z2;
  const yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
  const wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
  const m11 = 1 - (yy + zz), m12 = xy - wz, m13 = xz + wy;
  const m22 = 1 - (xx + zz), m23 = yz - wx;
  const m32 = yz + wx, m33 = 1 - (xx + yy);
  const y = Math.asin(Math.min(1, Math.max(-1, m13)));
  return Math.abs(m13) < 0.9999999
    ? { x: Math.atan2(-m23, m33), y, z: Math.atan2(-m12, m11) }
    : { x: Math.atan2(m32, m22), y, z: 0 };
}

function rotateByQuat(v, q) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

const rotateByEuler = (v, e) => rotateByQuat(v, quatFromEuler(e));

const X_AXIS = v3(1, 0, 0);
const Y_AXIS = v3(0, 1, 0);

// ── Options ─────────────────────────────────────────────────────────────────

/** ez-tree's TreeOptions defaults, minus textures + trellis. */
export function defaultTreeOptions() {
  return {
    seed: 0,
    type: "deciduous",
    bark: { type: "Bark001", tint: 0xffffff, flatShading: false, textured: true, textureScale: { x: 1, y: 1 } },
    branch: {
      levels: 3,
      angle: { 1: 70, 2: 60, 3: 60 },
      children: { 0: 7, 1: 7, 2: 5 },
      force: { direction: { x: 0, y: 1, z: 0 }, strength: 0.01 },
      gnarliness: { 0: 0.15, 1: 0.2, 2: 0.3, 3: 0.02 },
      length: { 0: 20, 1: 20, 2: 10, 3: 1 },
      radius: { 0: 1.5, 1: 0.7, 2: 0.7, 3: 0.7 },
      sections: { 0: 12, 1: 10, 2: 8, 3: 6 },
      segments: { 0: 8, 1: 6, 2: 4, 3: 3 },
      start: { 1: 0.4, 2: 0.3, 3: 0.3 },
      taper: { 0: 0.7, 1: 0.7, 2: 0.7, 3: 0.7 },
      twist: { 0: 0, 1: 0, 2: 0, 3: 0 },
    },
    leaves: {
      type: "oak", billboard: "double", angle: 10, count: 1, start: 0,
      size: 2.5, sizeVariance: 0.7, tint: 0xffffff, alphaTest: 0.5, roundedNormals: true,
    },
  };
}

/**
 * Defaults overlaid with `source` (a preset JSON). Like TreeOptions.copy, keys
 * missing from the defaults are ignored (e.g. a preset's `trellis`).
 */
export function treeOptions(source = {}) {
  const copy = (src, dst) => {
    for (const k in src) {
      if (!Object.hasOwn(src, k) || !Object.hasOwn(dst, k)) continue;
      const v = src[k];
      if (v !== null && typeof v === "object" && v.constructor === Object) copy(v, dst[k]);
      else dst[k] = v;
    }
    return dst;
  };
  return copy(source, defaultTreeOptions());
}

// ── Skeleton (all RNG) ──────────────────────────────────────────────────────

/**
 * Grows the tree skeleton: section frames of every branch plus every leaf
 * placement. RNG is consumed in exactly the original order.
 * @returns {{ branches: {sections, segmentCount, baseRadius}[], leaves: {origin, orientation, size}[] }}
 */
export function growSkeleton(options) {
  const o = options;
  const rng = new RNG(o.seed);
  const skeleton = { branches: [], leaves: [] };
  const queue = [{
    origin: v3(), orientation: v3(), length: o.branch.length[0], radius: o.branch.radius[0],
    level: 0, sectionCount: o.branch.sections[0], segmentCount: o.branch.segments[0],
  }];

  const shuffledIndices = (count) => {
    const arr = Array.from({ length: count }, (_, k) => k);
    for (let k = count - 1; k > 0; k--) {
      const r = Math.floor(rng.random() * (k + 1));
      [arr[k], arr[r]] = [arr[r], arr[k]];
    }
    return arr;
  };

  const recordLeaf = (origin, orientation) => {
    const size = o.leaves.size * (1 + rng.random(o.leaves.sizeVariance, -o.leaves.sizeVariance));
    skeleton.leaves.push({ origin: clone3(origin), orientation: clone3(orientation), size });
  };

  // Shared by child branches and leaves: sample a point `t` (0..1) along the
  // parent's sections and derive its origin, radius and the rotated orientation.
  const sampleAlong = (sections, t, angleDeg, radialAngle) => {
    const sectionIndex = Math.floor(t * (sections.length - 1));
    const a = sections[sectionIndex];
    const b = sectionIndex === sections.length - 1 ? a : sections[sectionIndex + 1];
    const alpha = (t - sectionIndex / (sections.length - 1)) / (1 / (sections.length - 1));
    // Upstream quirk kept for fidelity: slerps from B toward A by alpha.
    const parent = eulerFromQuat(quatSlerp(quatFromEuler(b.orientation), quatFromEuler(a.orientation), alpha));
    const q1 = quatAxisAngle(X_AXIS, angleDeg / (180 / Math.PI));
    const q2 = quatAxisAngle(Y_AXIS, radialAngle);
    return {
      origin: lerp3(a.origin, b.origin, alpha),
      radius: (1 - alpha) * a.radius + alpha * b.radius,
      orientation: eulerFromQuat(quatMul(quatFromEuler(parent), quatMul(q2, q1))),
    };
  };

  const generateChildBranches = (count, level, sections) => {
    const radialOffset = rng.random();
    const startMin = o.branch.start[level];
    const heightStep = (1.0 - startMin) / count;
    const angleSlots = shuffledIndices(count);
    for (let i = 0; i < count; i++) {
      const start = startMin + (i + rng.random()) * heightStep;
      const radialJitter = rng.random(0.5, -0.5);
      const radialAngle = 2.0 * Math.PI * (radialOffset + (angleSlots[i] + radialJitter) / count);
      const s = sampleAlong(sections, start, o.branch.angle[level], radialAngle);
      queue.push({
        origin: s.origin,
        orientation: s.orientation,
        length: o.branch.length[level] * (o.type === "evergreen" ? 1.0 - start : 1.0),
        radius: o.branch.radius[level] * s.radius,
        level,
        sectionCount: o.branch.sections[level],
        segmentCount: o.branch.segments[level],
      });
    }
  };

  const generateLeaves = (sections) => {
    const radialOffset = rng.random();
    const count = o.leaves.count;
    const startMin = o.leaves.start;
    const heightStep = (1.0 - startMin) / count;
    const angleSlots = shuffledIndices(count);
    for (let i = 0; i < count; i++) {
      const start = startMin + (i + rng.random()) * heightStep;
      const radialJitter = rng.random(0.5, -0.5);
      const radialAngle = 2.0 * Math.PI * (radialOffset + (angleSlots[i] + radialJitter) / count);
      const s = sampleAlong(sections, start, o.leaves.angle, radialAngle);
      recordLeaf(s.origin, s.orientation);
    }
  };

  const growBranch = (branch) => {
    let orientation = clone3(branch.orientation);
    let origin = clone3(branch.origin);
    // Upstream compares type against 'Deciduous' (never matches), so the
    // divisor is always 1 — kept for fidelity.
    const sectionLength = branch.length / branch.sectionCount;
    const sections = [];

    for (let i = 0; i <= branch.sectionCount; i++) {
      let radius = branch.radius;
      if (i === branch.sectionCount && branch.level === o.branch.levels) {
        radius = 0.001;
      } else if (o.type === "deciduous") {
        radius *= 1 - o.branch.taper[branch.level] * (i / branch.sectionCount);
      } else if (o.type === "evergreen") {
        radius *= 1 - (i / branch.sectionCount); // no terminal branch → full taper
      }

      sections.push({ origin: clone3(origin), orientation: clone3(orientation), radius });

      const step = rotateByEuler(v3(0, sectionLength, 0), orientation);
      origin = { x: origin.x + step.x, y: origin.y + step.y, z: origin.z + step.z };

      // Random perturbation — larger for thinner sections.
      const gnarliness = Math.max(1, 1 / Math.sqrt(radius)) * o.branch.gnarliness[branch.level];
      orientation.x += rng.random(gnarliness, -gnarliness);
      orientation.z += rng.random(gnarliness, -gnarliness);

      let q = quatMul(quatFromEuler(orientation), quatAxisAngle(Y_AXIS, o.branch.twist[branch.level]));

      // Growth force: rotate the section's up toward (or away from) force.direction.
      const up = rotateByQuat(Y_AXIS, q);
      const target = normalize3(o.branch.force.direction);
      let axis = {
        x: up.y * target.z - up.z * target.y,
        y: up.z * target.x - up.x * target.z,
        z: up.x * target.y - up.y * target.x,
      };
      const sinFull = len3(axis);
      if (sinFull > 1e-6) {
        const inv = 1 / sinFull;
        axis = { x: axis.x * inv, y: axis.y * inv, z: axis.z * inv };
        const fullAngle = Math.atan2(sinFull, up.x * target.x + up.y * target.y + up.z * target.z);
        const stepAngle = o.branch.force.strength / radius;
        const clamped = Math.max(-fullAngle, Math.min(fullAngle, stepAngle));
        q = quatMul(quatAxisAngle(axis, clamped), q);
      }

      orientation = eulerFromQuat(q);
    }

    skeleton.branches.push({ sections, segmentCount: branch.segmentCount, baseRadius: branch.radius });

    // Deciduous trees continue with a terminal branch out of the tip.
    if (o.type === "deciduous") {
      const last = sections[sections.length - 1];
      if (branch.level < o.branch.levels) {
        queue.push({
          origin: last.origin, orientation: last.orientation,
          length: o.branch.length[branch.level + 1], radius: last.radius,
          level: branch.level + 1,
          sectionCount: branch.sectionCount, segmentCount: branch.segmentCount,
        });
      } else {
        recordLeaf(last.origin, last.orientation);
      }
    }

    if (branch.level === o.branch.levels) {
      generateLeaves(sections);
    } else if (branch.level < o.branch.levels) {
      generateChildBranches(o.branch.children[branch.level], branch.level + 1, sections);
    }
  };

  while (queue.length > 0) growBranch(queue.shift());
  return skeleton;
}

// ── Meshing (no RNG) ────────────────────────────────────────────────────────

function meshBranch(buf, { sections, segmentCount, baseRadius }, options, sectionStride, segmentFactor) {
  const segments = Math.max(3, Math.round(segmentCount * segmentFactor));
  const wrapsX = Math.max(1, Math.round(baseRadius * options.bark.textureScale.x));

  // Every Nth ring, always keeping first + last so junctions stay sealed.
  const sampled = [];
  for (let i = 0; i < sections.length; i += sectionStride) sampled.push(sections[i]);
  if ((sections.length - 1) % sectionStride !== 0) sampled.push(sections[sections.length - 1]);

  const indexOffset = buf.verts.length / 3;

  for (let k = 0; k < sampled.length; k++) {
    const section = sampled[k];
    const q = quatFromEuler(section.orientation);
    const uvY = k % 2 === 0 ? 0 : 1;
    let first;
    for (let j = 0; j < segments; j++) {
      const angle = (2.0 * Math.PI * j) / segments;
      const c = Math.cos(angle), s = Math.sin(angle);
      const p = rotateByQuat(v3(c * section.radius, 0, s * section.radius), q);
      const vertex = { x: p.x + section.origin.x, y: p.y + section.origin.y, z: p.z + section.origin.z };
      const normal = normalize3(rotateByQuat(v3(c, 0, s), q));
      buf.verts.push(vertex.x, vertex.y, vertex.z);
      buf.normals.push(normal.x, normal.y, normal.z);
      buf.uvs.push((j / segments) * wrapsX, uvY);
      if (j === 0) first = { vertex, normal };
    }
    // Seam duplicate so u runs 0..wrapsX without wrapping back.
    buf.verts.push(first.vertex.x, first.vertex.y, first.vertex.z);
    buf.normals.push(first.normal.x, first.normal.y, first.normal.z);
    buf.uvs.push(wrapsX, uvY);
  }

  const N = segments + 1;
  for (let i = 0; i < sampled.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const v1 = indexOffset + i * N + j;
      const v2 = indexOffset + i * N + (j + 1);
      const v3i = v1 + N;
      const v4 = v2 + N;
      buf.indices.push(v1, v3i, v2, v2, v3i, v4);
    }
  }
}

function meshLeaf(buf, leaf, options, scale, billboard) {
  const { origin, orientation } = leaf;
  const W = leaf.size * scale;
  const L = W;
  const qLeaf = quatFromEuler(orientation);
  const n = rotateByQuat(v3(0, 0, 1), qLeaf);
  const rounded = options.leaves.roundedNormals;

  const quad = (rotation) => {
    const i = buf.verts.length / 3;
    const qRot = quatFromEuler(v3(0, rotation, 0));
    const v = [v3(-W / 2, L, 0), v3(-W / 2, 0, 0), v3(W / 2, 0, 0), v3(W / 2, L, 0)].map((c) => {
      const p = rotateByQuat(rotateByQuat(c, qRot), qLeaf);
      return { x: p.x + origin.x, y: p.y + origin.y, z: p.z + origin.z };
    });
    for (const p of v) buf.verts.push(p.x, p.y, p.z);
    // Rounded normals: leaf facing + direction to the corner → a domed canopy.
    for (const p of v) {
      const nn = rounded
        ? normalize3({ x: n.x + p.x - origin.x, y: n.y + p.y - origin.y, z: n.z + p.z - origin.z })
        : n;
      buf.normals.push(nn.x, nn.y, nn.z);
    }
    buf.uvs.push(0, 1, 0, 0, 1, 0, 1, 1);
    buf.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };

  quad(0);
  if (billboard === "double") quad(Math.PI / 2);
}

/**
 * Meshes a skeleton at the given detail (ez-tree's LODDetail: sectionStride,
 * segmentFactor, leafStride, leafScale, billboard).
 * @returns {{ branches: {verts, normals, uvs, indices}, leaves: {verts, normals, uvs, indices} }}
 */
export function meshSkeleton(skeleton, options, detail = {}) {
  const sectionStride = Math.max(1, Math.floor(detail.sectionStride ?? 1));
  const segmentFactor = detail.segmentFactor ?? 1;
  const leafStride = Math.max(1, Math.floor(detail.leafStride ?? 1));
  const leafScale = detail.leafScale ?? 1;
  const billboard = detail.billboard ?? options.leaves.billboard;

  const branches = { verts: [], normals: [], uvs: [], indices: [] };
  const leaves = { verts: [], normals: [], uvs: [], indices: [] };
  for (const b of skeleton.branches) meshBranch(branches, b, options, sectionStride, segmentFactor);
  for (let i = 0; i < skeleton.leaves.length; i += leafStride) {
    meshLeaf(leaves, skeleton.leaves[i], options, leafScale, billboard);
  }
  return { branches, leaves };
}
