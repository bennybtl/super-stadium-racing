import { Mesh, VertexBuffer, VertexData, StandardMaterial, Color3 } from "@babylonjs/core";

const MARK_WIDTH = 0.66;        // rubber stripe width (m)
const MARK_LIFT = 0.05;         // above the sampled surface (m)
const NODE_SPACING = 0.5;       // minimum travel before a new node is laid (m)
// Marks blend toward the caller-supplied target colour (see update()'s
// `color` param), so alpha *is* the blend strength. A full-strength mark
// pushes the terrain 18% of the way toward that colour.
const MAX_ALPHA = 0.28;
const DEFAULT_COLOR = [0, 0, 0]; // fallback: plain darken, if the caller has no terrain sample

/**
 * TireMarks — rubber laid down behind a truck's rear wheels.
 *
 * One mesh per truck holds two independent ribbons (left and right wheel), each
 * a fixed ring of nodes. A node is two vertices straddling the wheel line;
 * consecutive nodes are joined into a quad. Marks are never cleared or faded out
 * — they last until the scene is torn down at the end of the race. The ring is
 * sized so a race ends first; if one ever wraps, the newest marks overwrite the
 * oldest rather than the buffer growing.
 *
 * Everything is done with per-vertex alpha rather than index juggling:
 *   • a streak's first and last node are written at alpha 0, so it fades in and
 *     tapers out, and the quad bridging two separate streaks is transparent at
 *     both ends — invisible, however far apart they are;
 *   • writing a node also erases the two nodes ahead of the head (the next one
 *     collapsed onto the head, the one after zeroed in place), so the quads that
 *     would otherwise stretch from the newest mark to the oldest never show.
 */
export class TireMarks {
  /**
   * @param {import("@babylonjs/core").Scene} scene
   * @param {{ capacity?: number, halfTrack: number, rearOffset: number }} options
   *   capacity   - nodes per ribbon (each is ~NODE_SPACING of mark)
   *   halfTrack  - lateral wheel offset from the truck centre (m)
   *   rearOffset - distance behind the truck centre for the rear axle (m)
   */
  constructor(scene, { capacity = 384, halfTrack, rearOffset }) {
    this._capacity = capacity;
    this._halfTrack = halfTrack;
    this._rearOffset = rearOffset;

    const nodeCount = capacity * 2; // two ribbons in one buffer
    this._positions = new Float32Array(nodeCount * 2 * 3);
    this._colors = new Float32Array(nodeCount * 2 * 4);
    // RGB defaults to black (darken); alpha 0 keeps every node invisible until written.

    // Per-ribbon ring state: write head, and whether a streak is in progress.
    this._heads = [0, capacity];
    this._active = [false, false];
    this._lastX = [0, 0];
    this._lastZ = [0, 0];
    // Node range touched since the last upload, tracked per ribbon — one range
    // across both would span the gap between them and re-upload half the buffer.
    // Only these slices go to the GPU, so laying a node costs the same whether
    // the ring holds 100 m of marks or two kilometres of them.
    this._dirtyMin = [Infinity, Infinity];
    this._dirtyMax = [-1, -1];

    this.mesh = this._createMesh(scene, nodeCount);
  }

  /**
   * @param {object} params
   * @param {{x:number,y:number,z:number}} params.position - truck centre
   * @param {number} params.heading                        - truck yaw (rad)
   * @param {number} params.strength                       - 0 = no mark, 1 = fully saturated
   * @param {[number,number,number]} [params.color]         - RGB (0-1) the mark blends
   *   toward. Callers derive this from the terrain under the truck (e.g. its own colour
   *   scaled darker/lighter, matching the AI-path wear overlay's ±22% multiply) so marks
   *   read as worn terrain rather than a fixed paint colour. Defaults to plain black.
   * @param {(x:number, z:number, fromY:number) => number} params.sampleY
   *   resolves the drivable surface height, so marks sit on bridge decks too
   */
  update({ position, heading, strength, color = DEFAULT_COLOR, sampleY }) {
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    // forward = (sin, cos); right = (cos, -sin)
    const rearX = position.x - sin * this._rearOffset;
    const rearZ = position.z - cos * this._rearOffset;

    for (let side = 0; side < 2; side++) {
      const sideSign = side === 0 ? -1 : 1;
      const x = rearX + cos * this._halfTrack * sideSign;
      const z = rearZ - sin * this._halfTrack * sideSign;
      this._updateRibbon(side, x, z, cos, -sin, strength, color, position.y, sampleY);
    }

    for (let side = 0; side < 2; side++) {
      if (this._dirtyMax[side] < 0) continue;
      const first = this._dirtyMin[side];
      const end = this._dirtyMax[side] + 1;
      this.mesh.getVertexBuffer(VertexBuffer.PositionKind).updateDirectly(
        this._positions.subarray(first * 6, end * 6), first * 6
      );
      this.mesh.getVertexBuffer(VertexBuffer.ColorKind).updateDirectly(
        this._colors.subarray(first * 8, end * 8), first * 8
      );
      this._dirtyMin[side] = Infinity;
      this._dirtyMax[side] = -1;
    }
  }

  _updateRibbon(side, x, z, acrossX, acrossZ, strength, color, fromY, sampleY) {
    if (strength <= 0) {
      // Streak ended: taper it off so the bridge to the next streak is
      // transparent at both ends.
      if (this._active[side]) {
        this._layNode(side, x, z, acrossX, acrossZ, 0, color, fromY, sampleY);
        this._active[side] = false;
      }
      return;
    }

    if (this._active[side]) {
      const dx = x - this._lastX[side];
      const dz = z - this._lastZ[side];
      if (dx * dx + dz * dz < NODE_SPACING * NODE_SPACING) return;
      this._layNode(side, x, z, acrossX, acrossZ, strength * MAX_ALPHA, color, fromY, sampleY);
      return;
    }

    // Streak start: an alpha-0 node first, so it fades in rather than beginning
    // with a hard edge, and the bridging quad from the previous streak stays
    // invisible.
    this._layNode(side, x, z, acrossX, acrossZ, 0, color, fromY, sampleY);
    this._layNode(side, x, z, acrossX, acrossZ, strength * MAX_ALPHA, color, fromY, sampleY);
    this._active[side] = true;
  }

  _layNode(side, x, z, acrossX, acrossZ, alpha, color, fromY, sampleY) {
    const base = side * this._capacity;
    const head = this._heads[side];
    const y = sampleY(x, z, fromY + 1) + MARK_LIFT;
    const halfWidth = MARK_WIDTH / 2;

    this._writeNode(head, x, y, z, acrossX * halfWidth, acrossZ * halfWidth, alpha, color);

    // Erase ahead of the head: collapse the next node onto this one and zero
    // the one after, so no quad spans from the newest mark to the oldest.
    const next = base + ((head - base + 1) % this._capacity);
    const after = base + ((head - base + 2) % this._capacity);
    this._writeNode(next, x, y, z, acrossX * halfWidth, acrossZ * halfWidth, 0, color);
    this._setNodeColor(after, 0, color);

    this._heads[side] = next;
    this._lastX[side] = x;
    this._lastZ[side] = z;
  }

  _writeNode(node, x, y, z, offsetX, offsetZ, alpha, color) {
    const p = node * 6;
    this._positions[p]     = x - offsetX;
    this._positions[p + 1] = y;
    this._positions[p + 2] = z - offsetZ;
    this._positions[p + 3] = x + offsetX;
    this._positions[p + 4] = y;
    this._positions[p + 5] = z + offsetZ;
    this._setNodeColor(node, alpha, color);
  }

  // RGB carries the target colour this node blends toward; alpha carries the
  // strength. See the material's emissiveColor comment in _createMesh for how
  // that multiply reaches the framebuffer.
  _setNodeColor(node, alpha, color) {
    const c = node * 8;
    const [r, g, b] = color;
    this._colors[c]     = r;
    this._colors[c + 1] = g;
    this._colors[c + 2] = b;
    this._colors[c + 3] = alpha;
    this._colors[c + 4] = r;
    this._colors[c + 5] = g;
    this._colors[c + 6] = b;
    this._colors[c + 7] = alpha;
    const side = node < this._capacity ? 0 : 1;
    if (node < this._dirtyMin[side]) this._dirtyMin[side] = node;
    if (node > this._dirtyMax[side]) this._dirtyMax[side] = node;
  }

  _createMesh(scene, nodeCount) {
    const mesh = new Mesh("tireMarks", scene);

    // One quad between consecutive nodes, wrapping within each ribbon's range.
    const indices = new Uint32Array(nodeCount * 6);
    let i = 0;
    for (let side = 0; side < 2; side++) {
      const base = side * this._capacity;
      for (let n = 0; n < this._capacity; n++) {
        const a = base + n;
        const b = base + ((n + 1) % this._capacity);
        indices[i++] = a * 2;
        indices[i++] = a * 2 + 1;
        indices[i++] = b * 2 + 1;
        indices[i++] = a * 2;
        indices[i++] = b * 2 + 1;
        indices[i++] = b * 2;
      }
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
    // per-node vertex colour (see _setNodeColor) passes through unchanged
    // instead of being crushed to black. That, blended by vertex alpha via
    // the standard alpha-combine (dst*(1-a) + colour*a), is what lets a mark
    // blend toward whatever target colour update()'s `color` param supplies.
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
