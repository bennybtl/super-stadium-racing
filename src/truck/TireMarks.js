import { Mesh, VertexBuffer, VertexData, StandardMaterial, Color3 } from "@babylonjs/core";

const MARK_WIDTH = 0.66;        // rubber stripe width (m)
const MARK_LIFT = 0.05;         // above the sampled surface (m)
const NODE_SPACING = 0.5;       // minimum travel before a new point is laid (m)
// Marks blend toward the terrain colour under them (see tireMarkColorForTerrain),
// so alpha *is* the blend strength. A full-strength mark pushes the terrain
// 28% of the way toward that colour.
const MAX_ALPHA = 0.28;
const DEFAULT_COLOR = [0, 0, 0]; // fallback: plain darken, if no terrain colour is available
// Same lighten/darken recipe the AI-path wear overlay uses (see ground-shader.js),
// so tire marks read consistently with baked wear instead of always crushing
// toward black. Scaling the terrain's own colour (rather than blending toward a
// fixed black/tan) keeps the mark's hue matched to whatever it's laid on.
const TIRE_MARK_LIGHTEN_LUMINANCE = 0.5;
const TIRE_MARK_WEAR_FACTOR = 0.22;
// Real-time drawing region: each currently-marking truck side gets its own
// reserved, fixed-size slice of the ring (assigned once, kept for the whole
// session) so it can write node-by-node as it moves — exactly like the old
// per-truck ring did — with zero risk of interleaving with another truck's
// slot. ~1km of marks per side before a truck's own slot starts recycling.
const LIVE_SLOT_CAPACITY = 2048;
// Generous headroom over any realistic field size (2 sides per truck).
const MAX_LIVE_SLOTS = 64;
// Bulk-loaded, once, at construction — the previous session's saved streaks
// (see TireMarksStorage / SharedTireMarksManager). Not written to again after
// that, so one shared monotonic cursor is fine here (no live truck is
// concurrently writing into it).
const DEFAULT_HISTORY_CAPACITY = 20000;

/** [r,g,b] (0-1) a tire mark should blend toward, given the terrain colour under it. */
export function tireMarkColorForTerrain(terrainColor) {
  if (!terrainColor) return DEFAULT_COLOR;
  const luminance = 0.299 * terrainColor.r + 0.587 * terrainColor.g + 0.114 * terrainColor.b;
  const factor = luminance > TIRE_MARK_LIGHTEN_LUMINANCE
    ? 1 + TIRE_MARK_WEAR_FACTOR
    : 1 - TIRE_MARK_WEAR_FACTOR;
  return [
    Math.min(1, terrainColor.r * factor),
    Math.min(1, terrainColor.g * factor),
    Math.min(1, terrainColor.b * factor),
  ];
}

/**
 * TireMarks — shared, persistent rubber laid down by every truck's rear
 * wheels, in ONE ring-buffer mesh for the whole track (not one per truck).
 *
 * The mesh is carved into two kinds of region so marks still draw in real
 * time (node by node, as the old per-truck ring did) while staying safe to
 * share across trucks:
 *  - a history region, bulk-written once at construction from last session's
 *    saved streaks (see appendHistory) — nothing live touches it afterward;
 *  - one reserved "live slot" per currently-marking truck side (see
 *    allocateSlot/writeLiveNode), each with its own private write cursor, so
 *    several trucks marking at once write into disjoint index ranges and
 *    never interleave. See TireMarkWriter, which owns exactly when a live
 *    node gets written vs. when a completed streak gets reported for
 *    persistence — those are separate concerns now: rendering is real-time,
 *    persistence just wants the finished shape once a streak ends.
 */
export class TireMarks {
  constructor(scene, { historyCapacity = DEFAULT_HISTORY_CAPACITY, slotCapacity = LIVE_SLOT_CAPACITY, maxSlots = MAX_LIVE_SLOTS } = {}) {
    this._historyCapacity = historyCapacity;
    this._slotCapacity = slotCapacity;
    this._maxSlots = maxSlots;
    this._capacity = historyCapacity + slotCapacity * maxSlots;
    this._positions = new Float32Array(this._capacity * 2 * 3);
    this._colors = new Float32Array(this._capacity * 2 * 4);
    this._historyHead = 0;
    this._slotHeads = new Array(maxSlots).fill(0);
    this._nextSlot = 0;
    this._slotsByOwner = new Map(); // owner (e.g. a TireMarkWriter) -> [leftSlot, rightSlot]
    this.mesh = this._createMesh(scene, this._capacity);
  }

  /**
   * The pair of live slot indices reserved for `owner` (assigned once, on
   * first request, then stable for the rest of the session). `owner` can be
   * anything stable and unique per marking entity — TireMarkWriter passes
   * itself. Slots are reused round-robin if more owners request one than
   * `maxSlots` allows, which would let two trucks share a region on an
   * unrealistically large field — degraded sharing, not a crash.
   */
  allocateSlots(owner) {
    let slots = this._slotsByOwner.get(owner);
    if (!slots) {
      slots = [this._nextSlot % this._maxSlots, (this._nextSlot + 1) % this._maxSlots];
      this._nextSlot += 2;
      this._slotsByOwner.set(owner, slots);
    }
    return slots;
  }

  /**
   * Write one node into `slot`'s own region, in real time — the ring
   * equivalent of the old per-truck ring's per-frame node write. `offsetX/Z`
   * are already scaled to half the mark width, perpendicular to travel.
   */
  writeLiveNode(slot, x, y, z, offsetX, offsetZ, alpha, color) {
    const base = this._historyCapacity + slot * this._slotCapacity;
    const cursor = this._slotHeads[slot];
    const node = base + cursor;
    this._writeNode(node, x, y, z, offsetX, offsetZ, alpha, color);
    this._uploadNode(node);

    const next = (cursor + 1) % this._slotCapacity;
    const nextNode = base + next;
    // Collapse the immediately-following node onto THIS SAME position (alpha
    // 0) — a zero-length quad, so it can never stretch toward whatever that
    // node's position happens to be: stale content from a previous lap
    // around this slot, or — for a node never written before — the
    // position array's zero-initialized default, i.e. the world origin. The
    // node after that only needs its alpha zeroed: once both ends of THAT
    // quad are alpha 0, its position no longer matters either.
    this._writeNode(nextNode, x, y, z, 0, 0, 0, color);
    this._uploadNode(nextNode);
    const after = base + (next + 1) % this._slotCapacity;
    this._setAlpha(after, 0);
    this._uploadNode(after);

    this._slotHeads[slot] = next;
  }

  /**
   * Bulk-load one saved streak into the history region — used only for
   * replaying last session's save at construction. Points: `{ x, z, offsetX,
   * offsetZ, alpha }`. `y` is resolved here via `sampleY` (never stored — see
   * TireMarksStorage), and colour via `colorForPoint(x, z)`, so a replayed
   * streak resolves the exact same terrain-matched colour a live one would.
   */
  appendHistory(points, { sampleY, fromY, colorForPoint }) {
    if (!points || points.length === 0) return;
    const startHead = this._historyHead;
    let lastX = 0, lastY = 0, lastZ = 0, lastColor = DEFAULT_COLOR;
    for (const p of points) {
      const y = sampleY(p.x, p.z, fromY + 1) + MARK_LIFT;
      const color = colorForPoint?.(p.x, p.z) ?? DEFAULT_COLOR;
      this._writeNode(this._historyHead, p.x, y, p.z, p.offsetX, p.offsetZ, p.alpha, color);
      lastX = p.x; lastY = y; lastZ = p.z; lastColor = color;
      this._historyHead = (this._historyHead + 1) % this._historyCapacity;
    }
    // Same collapse-then-zero trick as writeLiveNode, using the streak's own
    // last point as the collapse position — otherwise the node right after a
    // streak (stale from a previous lap around history, or at the position
    // array's zero-initialized default if never written) would connect via a
    // real quad to this streak's real end point.
    this._writeNode(this._historyHead, lastX, lastY, lastZ, 0, 0, 0, lastColor);
    this._historyHead = (this._historyHead + 1) % this._historyCapacity;
    this._setAlpha(this._historyHead, 0);

    this._uploadSpan(startHead, this._historyHead, this._historyCapacity, 0);
  }

  _writeNode(node, x, y, z, offsetX, offsetZ, alpha, color) {
    const p = node * 6;
    this._positions[p]     = x - offsetX;
    this._positions[p + 1] = y;
    this._positions[p + 2] = z - offsetZ;
    this._positions[p + 3] = x + offsetX;
    this._positions[p + 4] = y;
    this._positions[p + 5] = z + offsetZ;
    this._setColor(node, alpha, color);
  }

  _setColor(node, alpha, color) {
    const c = node * 8;
    const [r, g, b] = color;
    this._colors[c]     = r; this._colors[c + 1] = g; this._colors[c + 2] = b; this._colors[c + 3] = alpha;
    this._colors[c + 4] = r; this._colors[c + 5] = g; this._colors[c + 6] = b; this._colors[c + 7] = alpha;
  }

  _setAlpha(node, alpha) {
    const c = node * 8;
    this._colors[c + 3] = alpha;
    this._colors[c + 7] = alpha;
  }

  _uploadNode(node) {
    const posBuf = this.mesh.getVertexBuffer(VertexBuffer.PositionKind);
    const colBuf = this.mesh.getVertexBuffer(VertexBuffer.ColorKind);
    posBuf.updateDirectly(this._positions.subarray(node * 6, node * 6 + 6), node * 6);
    colBuf.updateDirectly(this._colors.subarray(node * 8, node * 8 + 8), node * 8);
  }

  /** Upload [startNode, endNode] (inclusive) within a sub-range [rangeOffset, rangeOffset+rangeCapacity), wrapping at that sub-range's own boundary. */
  _uploadSpan(startNode, endNode, rangeCapacity, rangeOffset) {
    const posBuf = this.mesh.getVertexBuffer(VertexBuffer.PositionKind);
    const colBuf = this.mesh.getVertexBuffer(VertexBuffer.ColorKind);
    const upload = (fromRel, toRelExclusive) => {
      const from = rangeOffset + fromRel;
      const count = toRelExclusive - fromRel;
      posBuf.updateDirectly(this._positions.subarray(from * 6, (from + count) * 6), from * 6);
      colBuf.updateDirectly(this._colors.subarray(from * 8, (from + count) * 8), from * 8);
    };
    const relStart = startNode - rangeOffset, relEnd = endNode - rangeOffset;
    if (relEnd >= relStart) {
      upload(relStart, relEnd + 1);
    } else {
      upload(relStart, rangeCapacity);
      upload(0, relEnd + 1);
    }
  }

  _createMesh(scene, capacity) {
    const mesh = new Mesh("tireMarks", scene);

    // One quad between consecutive ring slots. History and each live slot
    // wrap within their own sub-range (handled by never writing across a
    // sub-range boundary), but the index topology itself just connects n to
    // n+1 for the whole buffer — a stray quad at a sub-range's own seam reads
    // no differently than the erase-ahead trick already guards against.
    const indices = new Uint32Array(capacity * 6);
    let i = 0;
    for (let n = 0; n < capacity; n++) {
      const a = n, b = (n + 1) % capacity;
      indices[i++] = a * 2;
      indices[i++] = a * 2 + 1;
      indices[i++] = b * 2 + 1;
      indices[i++] = a * 2;
      indices[i++] = b * 2 + 1;
      indices[i++] = b * 2;
    }

    const vertexData = new VertexData();
    vertexData.positions = this._positions;
    vertexData.indices = indices;
    vertexData.colors = this._colors;
    vertexData.applyToMesh(mesh, true);

    const material = new StandardMaterial("tireMarksMat", scene);
    // With lighting disabled the diffuse term drops out entirely, so the only
    // colour that reaches the framebuffer is emissiveColor * vertexColor.rgb —
    // same recipe as the ground decals, but white here (not black) so the
    // per-node vertex colour passes through unchanged instead of being crushed
    // to black. That, blended by vertex alpha via the standard alpha-combine
    // (dst*(1-a) + colour*a), is what lets a mark blend toward whatever target
    // colour writeLiveNode/appendHistory's `colorForPoint` supplies.
    material.emissiveColor = Color3.White();
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.backFaceCulling = false;
    // Depth bias instead of a large Y lift, the same recipe the ground decals
    // use; without depth writes the ribbons never sort against each other.
    material.zOffset = -2;
    material.disableDepthWrite = true;
    mesh.material = material;

    mesh.hasVertexAlpha = true;
    mesh.useVertexColors = true;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    // The ribbon spans the whole track and its extents are never refreshed, so
    // skip frustum culling rather than pay to keep a bounding box accurate.
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
  }
}

/**
 * Per-truck accumulator for that truck's two wheel marks (rear left/right).
 * Splits two concerns that used to be one: drawing happens in real time,
 * node by node, straight into this truck's own reserved slots (see
 * TireMarks.writeLiveNode) exactly like the old per-truck ring did — nothing
 * waits for a streak to finish. Separately, the same points are accumulated
 * locally purely so a *completed* streak can be reported once (see
 * recordCompletedStreak) for persistence's sake — that list plays no part in
 * what's currently on screen, which was already drawn as it happened.
 */
export class TireMarkWriter {
  /**
   * @param {{halfTrack: number, rearOffset: number}} dims - this truck's real
   *   rear-wheel placement (from its physics body, not the visual mesh —
   *   deriving spacing from the mesh box left marks too close together and
   *   too far forward).
   */
  constructor({ halfTrack, rearOffset }) {
    this._halfTrack = halfTrack;
    this._rearOffset = rearOffset;
    this._slots = null; // [leftSlot, rightSlot], assigned on first update()
    this._streaks = [
      { active: false, points: [], lastX: 0, lastZ: 0 },
      { active: false, points: [], lastX: 0, lastZ: 0 },
    ];
  }

  /**
   * @param {import("../managers/SharedTireMarksManager.js").SharedTireMarksManager} sharedMarks
   *   the scene's one shared manager, e.g. track._sharedTireMarks
   * @param {object} params
   * @param {{x:number,y:number,z:number}} params.position - truck centre
   * @param {number} params.heading   - truck yaw (rad)
   * @param {number} params.strength  - 0 = no mark, 1 = fully saturated
   * @param {(x:number, z:number, fromY:number) => number} params.sampleY
   *   resolves the drivable surface height, so marks sit on bridge decks too
   * @param {(x:number, z:number) => [number,number,number]} params.colorForPoint
   *   resolves the terrain-matched mark colour at a point (see
   *   tireMarkColorForTerrain), evaluated fresh per node just like the old
   *   per-frame version did.
   */
  update(sharedMarks, { position, heading, strength, sampleY, colorForPoint }) {
    if (!sharedMarks) return;
    if (!this._slots) this._slots = sharedMarks.ring.allocateSlots(this);

    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    // forward = (sin, cos); across = (cos, -sin)
    const rearX = position.x - sin * this._rearOffset;
    const rearZ = position.z - cos * this._rearOffset;
    const halfWidth = MARK_WIDTH / 2;
    const offsetX = cos * halfWidth, offsetZ = -sin * halfWidth;

    for (let side = 0; side < 2; side++) {
      const sideSign = side === 0 ? -1 : 1;
      const x = rearX + cos * this._halfTrack * sideSign;
      const z = rearZ - sin * this._halfTrack * sideSign;
      this._updateSide(sharedMarks, this._slots[side], this._streaks[side], x, z, offsetX, offsetZ, strength, position.y, sampleY, colorForPoint);
    }
  }

  _updateSide(sharedMarks, slot, streak, x, z, offsetX, offsetZ, strength, fromY, sampleY, colorForPoint) {
    const drawNow = (px, pz, alpha) => {
      const y = sampleY(px, pz, fromY + 1) + MARK_LIFT;
      const color = colorForPoint?.(px, pz) ?? DEFAULT_COLOR;
      sharedMarks.ring.writeLiveNode(slot, px, y, pz, offsetX, offsetZ, alpha, color);
    };

    if (strength <= 0) {
      if (!streak.active) return;
      // Streak ended: taper it off so the mark fades rather than cutting hard.
      drawNow(x, z, 0);
      streak.points.push({ x, z, offsetX, offsetZ, alpha: 0 });
      streak.active = false;
      sharedMarks.recordCompletedStreak(streak.points);
      streak.points = [];
      return;
    }

    if (streak.active) {
      const dx = x - streak.lastX, dz = z - streak.lastZ;
      if (dx * dx + dz * dz < NODE_SPACING * NODE_SPACING) return;
      const alpha = strength * MAX_ALPHA;
      drawNow(x, z, alpha);
      streak.points.push({ x, z, offsetX, offsetZ, alpha });
      streak.lastX = x;
      streak.lastZ = z;
      return;
    }

    // Streak start: an alpha-0 node first, so the very first real quad (once
    // the truck has moved NODE_SPACING) fades in rather than popping.
    drawNow(x, z, 0);
    streak.points.push({ x, z, offsetX, offsetZ, alpha: 0 });
    streak.active = true;
    streak.lastX = x;
    streak.lastZ = z;
  }
}
