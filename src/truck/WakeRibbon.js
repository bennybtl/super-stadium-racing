import { Mesh, VertexBuffer, VertexData, StandardMaterial, Color3 } from "@babylonjs/core";
import { getSharedFoamTexture } from "../objects/Water.js";

/**
 * WakeRibbon — the V-shaped foam trail a truck drags through water.
 *
 * Phase 4 of WATER_REACTIVE.md, and the counterpart to the wake field: the
 * field (WakeFieldManager.js) is a decaying scalar that reads as a trough the
 * truck pressed into the surface, which is correct but is not a wake. The V is
 * geometry, because a V is a shape, not a diffuse quantity.
 *
 * Built like TireMarks.js — a trail of nodes laid as the truck moves, two
 * triangles bridging each consecutive pair — with one structural difference:
 * a tire mark is written once and never touched again, while every node here
 * *widens and fades as it ages*. That is what makes the V: a node is narrow when
 * laid at the truck and wider by the time it is metres behind, so the ribbon
 * opens out behind the truck rather than tracking its width. It also means the
 * whole buffer is rewritten every update, which is why the node count is small
 * and the nodes are a plain deque rather than TireMarks' ring — there is no
 * benefit to a ring when nothing is preserved across frames anyway.
 */

const NODE_SPACING = 0.5;      // metres of travel between nodes
// Deque limit. A node lives NODE_LIFE seconds, so the wake is speed × NODE_LIFE
// long — 100 m at full pelt, or 200 nodes. Sized past that so the trail is cut
// short by fading, never by running out of slots.
const CAPACITY = 240;
const NODE_LIFE = 3.0;         // seconds before a node has faded out entirely

// The V. Half-width starts near the truck's own width and opens at SPREAD_RATE
// as the node ages — so the opening angle of the V is set by SPREAD_RATE
// relative to the truck's speed, exactly as a real wake's is.
const HALF_WIDTH_START = 0.8;
const SPREAD_RATE = 2.5;       // metres of half-width per second of age
// A backstop, not a shape. Every node that reaches it stops widening, so once
// a stretch of trail is all past it that stretch is a constant-width slab with
// blunt ends instead of a V — which is exactly what it looked like at 8.0 m
// against a 4 s life. Keep this above HALF_WIDTH_START + SPREAD_RATE ×
// NODE_LIFE so it never binds during a node's life.
const HALF_WIDTH_MAX = 10.0;

// Alpha across the ribbon: the two edges are the wake lines and carry most of
// it, the centre is the churn between them and thins out faster, so an old
// stretch of wake reads as two diverging lines rather than a solid wedge.
const EDGE_ALPHA = 1.0;
const CENTRE_ALPHA = 0.70;
const CENTRE_FADE_POWER = 1.4; // centre fades this much faster than the edges

// Fraction of a node's life spent at full strength before it starts fading.
// A plain (1 - age) curve starts dimming immediately, which is what made the
// wake read as faint everywhere; holding first means the trail is solid for
// most of its length and only softens at the far end.
const FADE_HOLD = 0.55;

// Nodes within this many of the end of a streak ramp their alpha to zero, so a
// trail begins and ends by fading in over ~5 m rather than on a straight full
// strength edge. Applies at both ends of every streak, and at the truck end only
// once the truck has left the water — while it is still laying trail, the wake
// should stay attached to the truck.
const TAPER_NODES = 10;

// A single frame's movement larger than this is a respawn, not driving. Without
// the check the trail would bridge the two positions and stripe the map.
const TELEPORT_DIST = 12;

const Y_LIFT = 0.06;           // above the water surface, same idea as FOAM_Y_BIAS
const UV_SCALE = 0.12;         // texture repeats per metre along the ribbon

const VERTS_PER_NODE = 3;      // left edge, centre, right edge

// Every truck's ribbon wants the identical material, and a race can field eight
// of them. One per scene, built on first use — the same reasoning as the water
// and foam materials in Water.js.
const _ribbonMaterials = new WeakMap();

function getRibbonMaterial(scene) {
  const cached = _ribbonMaterials.get(scene);
  if (cached) return cached;

  const material = new StandardMaterial("wakeRibbonMat", scene);
  material.disableLighting = true;          // flat stylised foam, like the shoreline bands
  material.emissiveColor = new Color3(0.92, 0.96, 1.0);
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  // The same swirl mask the shoreline foam uses, so the two read as one
  // material. Its alpha carries the froth; the vertex alpha carries the V.
  const foam = getSharedFoamTexture(scene);
  if (foam) material.opacityTexture = foam;
  // The ribbon crosses itself wherever the truck turns, and every quad sits at
  // the same height, so depth writes would make those overlaps fight.
  material.disableDepthWrite = true;

  _ribbonMaterials.set(scene, material);
  return material;
}

export class WakeRibbon {
  /**
   * @param {import("@babylonjs/core").Scene} scene
   * @param {{ rearOffset: number }} options
   *   rearOffset - distance behind the truck centre to lay the trail from (m)
   */
  constructor(scene, { rearOffset = 0 } = {}) {
    this._rearOffset = rearOffset;
    this._nodes = [];          // oldest first, newest last
    this._active = false;
    // A truck spends almost all of its time out of the water, so an empty
    // ribbon writes and uploads its buffers once and then costs nothing at all.
    this._blank = false;
    // Ageing moves every vertex and fades every colour, but UVs only shift when
    // the node list itself changes, so they ride a separate flag.
    this._uvDirty = true;
    this._lastX = 0;
    this._lastZ = 0;

    this._positions = new Float32Array(CAPACITY * VERTS_PER_NODE * 3);
    this._colors = new Float32Array(CAPACITY * VERTS_PER_NODE * 4);
    this._uvs = new Float32Array(CAPACITY * VERTS_PER_NODE * 2);
    // Scratch for the end taper, reused rather than allocated per frame.
    this._taper = new Float32Array(CAPACITY);
    this.mesh = this._createMesh(scene);
  }

  /**
   * @param {object} params
   * @param {{x:number,y:number,z:number}} params.position truck centre
   * @param {number} params.heading  truck yaw (rad)
   * @param {number} params.speed    horizontal speed (m/s)
   * @param {number} params.dt       seconds since the last call
   * @param {boolean} params.wading  is the truck actually churning through water
   * @param {number} params.waterDepth depth under the truck (m)
   * @param {(x:number, z:number, fromY:number) => number} params.sampleY
   *   drivable-surface height — under water that is the bed, so bed + depth is
   *   the water surface. Avoids a second water-level query for a value both
   *   sides already have between them.
   */
  update({ position, heading, speed, dt, wading, waterDepth, sampleY }) {
    this._ageNodes(dt);

    if (wading) {
      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      // forward = (sin, cos); right = (cos, -sin) — same convention as TireMarks
      const x = position.x - sin * this._rearOffset;
      const z = position.z - cos * this._rearOffset;
      const dx = x - this._lastX;
      const dz = z - this._lastZ;
      const moved2 = dx * dx + dz * dz;
      const y = sampleY(x, z, position.y + 1) + waterDepth;

      if (!this._active || moved2 > TELEPORT_DIST * TELEPORT_DIST) {
        // Starting a new stretch — entering water, or arriving somewhere else
        // entirely after a respawn. Two alpha-zero nodes, one where the trail
        // left off and one here, make the quads bridging old to new transparent
        // at both ends however far apart they are. Same trick as TireMarks'
        // streak caps, and what stops a re-entry drawing a stripe across the map.
        const last = this._nodes[this._nodes.length - 1];
        if (last) this._push(last.x, last.z, last.y, last.rx, last.rz, 0);
        this._push(x, z, y, cos, -sin, 0);
        this._active = true;
        this._lastX = x;
        this._lastZ = z;
      } else if (moved2 >= NODE_SPACING * NODE_SPACING) {
        // Strength ramps with speed: idling in the shallows should not draw the
        // same wake as crossing at pace.
        this._push(x, z, y, cos, -sin, Math.min(1, speed / 8));
        this._lastX = x;
        this._lastZ = z;
      }
    } else if (this._active) {
      // Leaving the water: cap the trail with an alpha-zero node where it ended,
      // so it tapers out instead of stopping on a full-strength straight edge —
      // and so the taper pass below treats this as a streak boundary. Same trick
      // TireMarks uses to end a streak.
      const last = this._nodes[this._nodes.length - 1];
      if (last) this._push(last.x, last.z, last.y, last.rx, last.rz, 0);
      this._active = false;
    }

    this._writeGeometry();
  }

  _ageNodes(dt) {
    for (const node of this._nodes) node.age += dt;
    // Oldest first, so expiry is a prefix — no filter, no reallocation.
    let expired = 0;
    while (expired < this._nodes.length && this._nodes[expired].age >= NODE_LIFE) expired++;
    if (expired > 0) {
      this._nodes.splice(0, expired);
      this._uvDirty = true; // every node moved slot
    }
  }

  _push(x, z, y, rx, rz, strength) {
    const prev = this._nodes[this._nodes.length - 1];
    const dist = prev ? prev.dist + Math.hypot(x - prev.x, z - prev.z) : 0;
    this._nodes.push({ x, y, z, rx, rz, strength, age: 0, dist });
    if (this._nodes.length > CAPACITY) this._nodes.shift();
    this._uvDirty = true;
  }

  /**
   * Rewrite the whole vertex buffer from the live nodes. Slots past the end are
   * collapsed onto the newest node at alpha zero, so the static index buffer
   * always has something degenerate and invisible to point at.
   */
  _writeGeometry() {
    const nodes = this._nodes;
    const count = nodes.length;

    if (count === 0) {
      if (this._blank) return; // already cleared, and nothing can change it but a node
      this._positions.fill(0);
      this._colors.fill(0);
      this.mesh.getVertexBuffer(VertexBuffer.PositionKind).updateDirectly(this._positions, 0);
      this.mesh.getVertexBuffer(VertexBuffer.ColorKind).updateDirectly(this._colors, 0);
      this._blank = true;
      return;
    }
    this._blank = false;
    this._computeTaper(count);

    for (let i = 0; i < CAPACITY; i++) {
      const node = i < count ? nodes[i] : nodes[count - 1];
      const p = i * VERTS_PER_NODE * 3;
      const c = i * VERTS_PER_NODE * 4;
      const t = i * VERTS_PER_NODE * 2;

      const live = i < count;
      const ageT = Math.min(1, node.age / NODE_LIFE);
      const endFade = live ? Math.min(1, this._taper[i] / TAPER_NODES) : 0;
      const fade = live
        ? Math.min(1, (1 - ageT) / (1 - FADE_HOLD)) * node.strength * endFade
        : 0;
      const halfWidth = Math.min(HALF_WIDTH_MAX, HALF_WIDTH_START + SPREAD_RATE * node.age);
      const ox = node.rx * halfWidth;
      const oz = node.rz * halfWidth;
      const y = node.y + Y_LIFT;

      this._positions[p]     = node.x - ox;
      this._positions[p + 1] = y;
      this._positions[p + 2] = node.z - oz;
      this._positions[p + 3] = node.x;
      this._positions[p + 4] = y;
      this._positions[p + 5] = node.z;
      this._positions[p + 6] = node.x + ox;
      this._positions[p + 7] = y;
      this._positions[p + 8] = node.z + oz;

      const edge = fade * EDGE_ALPHA;
      const centre = fade * CENTRE_ALPHA * Math.pow(1 - ageT, CENTRE_FADE_POWER);
      for (let v = 0; v < VERTS_PER_NODE; v++) {
        const k = c + v * 4;
        this._colors[k] = 1;
        this._colors[k + 1] = 1;
        this._colors[k + 2] = 1;
        this._colors[k + 3] = v === 1 ? centre : edge;
      }

      // u runs along the trail by distance travelled, so the froth stays put on
      // the water instead of stretching when the truck speeds up.
      const u = node.dist * UV_SCALE;
      this._uvs[t] = u;     this._uvs[t + 1] = 0;
      this._uvs[t + 2] = u; this._uvs[t + 3] = 0.5;
      this._uvs[t + 4] = u; this._uvs[t + 5] = 1;
    }

    this.mesh.getVertexBuffer(VertexBuffer.PositionKind).updateDirectly(this._positions, 0);
    this.mesh.getVertexBuffer(VertexBuffer.ColorKind).updateDirectly(this._colors, 0);
    if (this._uvDirty) {
      this.mesh.getVertexBuffer(VertexBuffer.UVKind).updateDirectly(this._uvs, 0);
      this._uvDirty = false;
    }
  }

  /**
   * Distance, in nodes, from each live node to the nearest end of its streak.
   * A streak ends at the oldest node, at the newest *if the truck has stopped
   * laying*, and at every alpha-zero cap node in between — which is what makes
   * a trail left behind in one pool taper off independently of the one being
   * laid in the next.
   */
  _computeTaper(count) {
    const nodes = this._nodes;
    const taper = this._taper;

    let d = CAPACITY;
    for (let i = 0; i < count; i++) {
      d = (i === 0 || nodes[i].strength === 0) ? 0 : d + 1;
      taper[i] = d;
    }

    d = CAPACITY;
    for (let i = count - 1; i >= 0; i--) {
      const isEnd = (i === count - 1 && !this._active) || nodes[i].strength === 0;
      d = isEnd ? 0 : d + 1;
      if (d < taper[i]) taper[i] = d;
    }
  }

  _createMesh(scene) {
    const mesh = new Mesh("wakeRibbon", scene);

    // Two quads between consecutive nodes — left-to-centre and centre-to-right —
    // so the centre vertex can carry its own alpha and the wake reads as two
    // lines with churn between them rather than one flat wedge.
    const indices = new Uint32Array((CAPACITY - 1) * 12);
    let i = 0;
    for (let n = 0; n < CAPACITY - 1; n++) {
      const a = n * VERTS_PER_NODE;
      const b = (n + 1) * VERTS_PER_NODE;
      for (let half = 0; half < 2; half++) {
        const a0 = a + half, a1 = a + half + 1;
        const b0 = b + half, b1 = b + half + 1;
        indices[i++] = a0; indices[i++] = b0; indices[i++] = b1;
        indices[i++] = a0; indices[i++] = b1; indices[i++] = a1;
      }
    }

    const vertexData = new VertexData();
    vertexData.positions = this._positions;
    vertexData.indices = indices;
    vertexData.colors = this._colors;
    vertexData.uvs = this._uvs;
    vertexData.applyToMesh(mesh, true);

    mesh.material = getRibbonMaterial(scene);

    mesh.hasVertexAlpha = true;
    mesh.useVertexColors = true;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    // Rewritten every frame, so a maintained bounding box would be pure cost.
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
  }
}
