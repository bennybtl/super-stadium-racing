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
// Ring slots zeroed (alpha only, not position) right after each appended
// streak, so the quad bridging into whatever the ring holds next — possibly a
// much older, still-visible mark landed there on a previous lap around the
// buffer — never becomes visible until real content overwrites it.
const ERASE_AHEAD = 2;

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
 * Trucks never touch this directly while marking — see TireMarkWriter, which
 * accumulates one truck's in-progress streak locally and only hands off a
 * *completed* streak (appendStreak) once it ends. That means several trucks
 * marking at the same time never interfere with each other, and a completed
 * streak is also the natural unit for persistence: TireMarksStorage saves a
 * bounded list of the most recent completed streaks, and loading replays them
 * through this same appendStreak to reconstruct the ring's visible content
 * exactly.
 *
 * A streak's first and last point are written at alpha 0 (see TireMarkWriter)
 * so it fades in and tapers out rather than popping, and the quad bridging
 * two unrelated streaks that happen to land adjacent in ring order is
 * invisible at both ends.
 */
export class TireMarks {
  constructor(scene, { capacity = 20000 } = {}) {
    this._capacity = capacity;
    this._positions = new Float32Array(capacity * 2 * 3);
    this._colors = new Float32Array(capacity * 2 * 4);
    this._head = 0;
    this.mesh = this._createMesh(scene, capacity);
  }

  /**
   * Append one completed streak (points in travel order): each
   * `{ x, z, offsetX, offsetZ, alpha }` — offsetX/Z already scaled to half the
   * mark width, perpendicular to travel. `y` is resolved here via `sampleY`
   * (never stored — see TireMarksStorage), and colour is resolved here too via
   * `colorForPoint(x, z)`, so a replayed streak recomputes the exact same
   * terrain-matched colour a live one would.
   */
  appendStreak(points, { sampleY, fromY, colorForPoint }) {
    if (!points || points.length === 0) return;
    const startHead = this._head;
    for (const p of points) {
      const y = sampleY(p.x, p.z, fromY + 1) + MARK_LIFT;
      const color = colorForPoint?.(p.x, p.z) ?? DEFAULT_COLOR;
      this._writeNode(this._head, p.x, y, p.z, p.offsetX, p.offsetZ, p.alpha, color);
      this._head = (this._head + 1) % this._capacity;
    }
    for (let k = 0; k < ERASE_AHEAD; k++) {
      this._setAlpha((this._head + k) % this._capacity, 0);
    }
    const lastTouched = (this._head + ERASE_AHEAD - 1) % this._capacity;
    this._uploadRange(startHead, lastTouched);
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

  /** Upload [startNode, endNode] (inclusive), wrapping around the ring in at most two calls. */
  _uploadRange(startNode, endNode) {
    const posBuf = this.mesh.getVertexBuffer(VertexBuffer.PositionKind);
    const colBuf = this.mesh.getVertexBuffer(VertexBuffer.ColorKind);
    const upload = (from, toExclusive) => {
      posBuf.updateDirectly(this._positions.subarray(from * 6, toExclusive * 6), from * 6);
      colBuf.updateDirectly(this._colors.subarray(from * 8, toExclusive * 8), from * 8);
    };
    if (endNode >= startNode) {
      upload(startNode, endNode + 1);
    } else {
      // The streak (plus erase-ahead) wrapped past the end of the ring.
      upload(startNode, this._capacity);
      upload(0, endNode + 1);
    }
  }

  _createMesh(scene, capacity) {
    const mesh = new Mesh("tireMarks", scene);

    // One quad between consecutive ring slots, wrapping at the end.
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
    // colour appendStreak's `colorForPoint` supplies.
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
 * Per-truck, local accumulator for that truck's two in-progress streaks (rear
 * left/right wheel). Nothing shared is touched while a streak is being laid
 * down — only once one ends does it get handed to the shared TireMarks ring
 * (see appendStreak). Lets several trucks mark at once without needing to
 * coordinate any shared write-cursor state.
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
    this._streaks = [
      { active: false, points: [], lastX: 0, lastZ: 0 },
      { active: false, points: [], lastX: 0, lastZ: 0 },
    ];
  }

  /**
   * @param {TireMarks} sharedMarks - the scene's one shared ring, e.g. track._sharedTireMarks
   * @param {object} params
   * @param {{x:number,y:number,z:number}} params.position - truck centre
   * @param {number} params.heading   - truck yaw (rad)
   * @param {number} params.strength  - 0 = no mark, 1 = fully saturated
   * @param {(x:number, z:number, fromY:number) => number} params.sampleY
   *   resolves the drivable surface height, so marks sit on bridge decks too
   * @param {(x:number, z:number) => [number,number,number]} params.colorForPoint
   *   resolves the terrain-matched mark colour at a point (see
   *   tireMarkColorForTerrain) — deferred to append time since terrain colour
   *   doesn't change mid-race, and this also lets a replayed streak resolve
   *   colour identically to a live one, with no need to persist it.
   */
  update(sharedMarks, { position, heading, strength, sampleY, colorForPoint }) {
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
      const finished = this._updateStreak(this._streaks[side], x, z, offsetX, offsetZ, strength);
      if (finished) sharedMarks?.appendStreak(finished, { sampleY, fromY: position.y, colorForPoint });
    }
  }

  /** Returns the finished streak's points if this call just closed one out, else null. */
  _updateStreak(streak, x, z, offsetX, offsetZ, strength) {
    if (strength <= 0) {
      if (!streak.active) return null;
      // Streak ended: taper it off so the append's own boundary fades rather
      // than cutting hard.
      streak.points.push({ x, z, offsetX, offsetZ, alpha: 0 });
      streak.active = false;
      const finished = streak.points;
      streak.points = [];
      return finished;
    }

    if (streak.active) {
      const dx = x - streak.lastX, dz = z - streak.lastZ;
      if (dx * dx + dz * dz < NODE_SPACING * NODE_SPACING) return null;
      streak.points.push({ x, z, offsetX, offsetZ, alpha: strength * MAX_ALPHA });
      streak.lastX = x;
      streak.lastZ = z;
      return null;
    }

    // Streak start: an alpha-0 point first, so the very first real quad
    // (once the truck has moved NODE_SPACING) fades in rather than popping.
    streak.points.push({ x, z, offsetX, offsetZ, alpha: 0 });
    streak.active = true;
    streak.lastX = x;
    streak.lastZ = z;
    return null;
  }
}
