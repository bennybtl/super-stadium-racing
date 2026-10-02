import {
  DynamicTexture,
  Mesh,
  StandardMaterial,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import { basicColors } from "../../constants.js";
import { loadBrandImage } from "../../utils/brand-images.js";

/** Rungs across the sail. Most are spent on the curved top, which is the only
 *  part whose width changes quickly. */
const N_RUNG = 22;

/** Fabric starts this fraction up the pole — bare pole shows below it. */
const T0 = 0.08;

/** The angled hem: width ramps 0 → full over this much of the pole. */
const HEM = 0.12;

/** Max sail width as a fraction of pole length. */
export const WIDTH_RATIO = 0.17;

/** Where the pole's built-in forward curve begins (fraction of its length). */
export const TIP_CURVE_START = 0.76;

/**
 * Strength of the tip curve. Not a reach multiplier: the centreline walk is
 * arc-length preserving, so sideways travel falls off as the slope grows and
 * the tip lands well short of the naive figure. Solved numerically so the tip
 * arrives at 1.02x the trailing edge (72 degrees from vertical) and the fabric
 * closes to a point right at the pole's end.
 */
export const TIP_CURVE_OUT = 2.13;

/** Texture is two half-width columns: left = front art, right = the same art
 *  mirrored, so the logo reads the right way round from either side. */
const TEX_W = 512;
const TEX_H = 1024;

/**
 * Rung positions as a fraction of pole length, clustered toward the tip where
 * the pole's curve takes the fabric width from full to nothing.
 */
const RUNG_T = Array.from({ length: N_RUNG + 1 }, (_, j) => {
  const u = 1 - (1 - j / N_RUNG) ** 1.8;
  return T0 + u * (1 - T0);
});

/**
 * Slope (d·offset/dy) of the pole's built-in forward curve at height fraction
 * `t`. Dimensionless — the offset and the height both scale with pole length,
 * so this shape holds at any height.
 *
 * The Flag adds this to the modal bending slope when it walks the centreline,
 * so the feather pole arcs over the way a real fibreglass one does and the
 * physics bend rides on top of it.
 */
export function poleCurveSlope(t) {
  if (t <= TIP_CURVE_START) return 0;
  const a = (t - TIP_CURVE_START) / (1 - TIP_CURVE_START);
  return (2 * TIP_CURVE_OUT * WIDTH_RATIO * a) / (1 - TIP_CURVE_START);
}

/**
 * FeatherSail — the tall vertical banner option for the flag decoration.
 *
 * Shape: a vertical rectangle, cut off at an angle along the bottom hem and
 * closed at the top by the pole's own forward curve. So the fabric is the
 * region between the (curved) pole and a straight vertical trailing edge, and
 * its width at any height is simply `maxWidth − poleOffset`, ramped in over the
 * hem. That falls out of the pole shape rather than being a sculpted profile.
 *
 * The rest shape is precomputed once per pole length. Each frame the rungs are
 * re-seated on the live (physics-bent) centreline, with the rung direction
 * rotated by however much the beam has bent at that height — so at rest the
 * outline is exact, and under a hit the fabric rotates with the pole.
 *
 * Front and back faces are separate vertices sharing one texture: the front set
 * maps into the left half, the back set into the mirrored right half.
 */
export class FeatherSail {
  constructor(name, scene, color, logo, poleLen) {
    this.scene     = scene;
    this._color    = color;
    this._logo     = logo || "";
    this._disposed = false;
    this._logoImg  = null;
    this._len      = 0;

    const rows   = N_RUNG + 1;
    this._nFront = rows * 2;            // leading + trailing per rung
    this._positions = new Float32Array(this._nFront * 2 * 3);
    this._normals   = new Float32Array(this._nFront * 2 * 3);
    this._width     = new Float64Array(rows);
    this._restAngle = new Float64Array(rows);
    this._restV     = new Float64Array(rows);

    this._buildRest(poleLen);

    // ── Indices: front set, then the back set with reversed winding ──
    const indices = [];
    for (let i = 0; i < N_RUNG; i++) {
      const l0 = i * 2, t0 = l0 + 1, l1 = l0 + 2, t1 = l0 + 3;
      indices.push(l0, t0, t1, l0, t1, l1);
    }
    const off = this._nFront;
    for (let i = 0; i < N_RUNG; i++) {
      const l0 = off + i * 2, t0 = l0 + 1, l1 = l0 + 2, t1 = l0 + 3;
      indices.push(l0, t1, t0, l0, l1, t1);
    }
    this._indices = indices;

    // Rest pose, so ComputeNormals can tell us which set actually faces +Z.
    this._writePositions(null, poleLen);
    VertexData.ComputeNormals(this._positions, indices, this._normals);

    // ── UVs ───────────────────────────────────────────────────────────
    // The texture is a rectangle and the outline crops it, so the logo stays
    // undistorted. `v` tracks real height up the fabric, so the texture isn't
    // squashed where the pole curves over. Whichever vertex set ComputeNormals
    // put on the +Z side gets the un-mirrored left half.
    const frontIsPlusZ = this._normals[2] >= 0;
    const maxW = poleLen * WIDTH_RATIO;
    const uvs = new Float32Array(this._nFront * 2 * 2);
    for (let pass = 0; pass < 2; pass++) {
      const mirrored = pass === 0 ? !frontIsPlusZ : frontIsPlusZ;
      const base = pass * this._nFront;
      for (let i = 0; i <= N_RUNG; i++) {
        const v = this._restV[i];
        const w = (this._width[i] / maxW) * 0.5;  // half the texture = one face
        const k = (base + i * 2) * 2;
        if (mirrored) {
          uvs[k]     = 1;      uvs[k + 1] = v;
          uvs[k + 2] = 1 - w;  uvs[k + 3] = v;
        } else {
          uvs[k]     = 0;      uvs[k + 1] = v;
          uvs[k + 2] = w;      uvs[k + 3] = v;
        }
      }
    }

    this.mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this._positions;
    vd.indices   = indices;
    vd.normals   = this._normals;
    vd.uvs       = uvs;
    vd.applyToMesh(this.mesh, true); // updatable
    this.mesh.isPickable = true;

    this._tex = new DynamicTexture(`${name}Tex`, { width: TEX_W, height: TEX_H }, scene);
    const mat = new StandardMaterial(`${name}Mat`, scene);
    mat.diffuseTexture  = this._tex;
    mat.specularColor   = basicColors.black.emissive;
    // The mesh carries its own back faces, so each set must be culled when it
    // faces away — otherwise the two coplanar sets fight and the unlit one wins.
    mat.backFaceCulling = true;
    this.mesh.material = mat;

    this._paint();
    if (this._logo) this._loadLogo();
  }

  // ─── Rest shape ─────────────────────────────────────────────────────────

  /**
   * Walk the pole's rest (unbent) centreline finely, and record for each rung
   * the fabric width, the rest beam angle and the texture's v coordinate.
   */
  _buildRest(L) {
    if (L === this._len) return;
    this._len = L;

    const STEPS = 240;
    const ds = L / STEPS;
    const maxW = L * WIDTH_RATIO;

    // Arc-length walk of the pre-curve: how far the pole has moved sideways by
    // each point along its length.
    const xs = new Float64Array(STEPS + 1);
    let x = 0;
    for (let k = 0; k < STEPS; k++) {
      const sx = poleCurveSlope((k + 0.5) / STEPS);
      x += (sx * ds) / Math.hypot(sx, 1);
      xs[k + 1] = x;
    }

    for (let i = 0; i <= N_RUNG; i++) {
      const t  = RUNG_T[i];
      const f  = Math.min(STEPS - 1e-6, t * STEPS);
      const k  = Math.min(STEPS - 1, Math.floor(f));
      const px = xs[k] + (xs[k + 1] - xs[k]) * (f - k);

      // Width is whatever is left between the pole and the vertical trailing
      // edge, ramped in over the hem. Floored just above zero so the closing
      // rungs stay non-degenerate for ComputeNormals.
      const hem = (maxW * (t - T0)) / HEM;
      this._width[i]     = Math.max(1e-4, Math.min(hem, maxW - px));
      this._restAngle[i] = Math.atan(poleCurveSlope(t));
      // The fabric is sewn along the pole's sleeve, so the print runs with arc
      // length, not vertical height — otherwise it squashes where it curves.
      this._restV[i]     = (t - T0) / (1 - T0);
    }
  }

  // ─── Geometry ───────────────────────────────────────────────────────────

  /**
   * Rebuild the sail from the pole centreline. `path` is the Flag's local-space
   * path (N+1 evenly spaced points); pass null for the rest pose.
   */
  update(path, poleLen) {
    this._buildRest(poleLen);
    this._writePositions(path, poleLen);
    VertexData.ComputeNormals(this._positions, this._indices, this._normals);
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this._positions);
    this.mesh.updateVerticesData(VertexBuffer.NormalKind, this._normals);
  }

  _writePositions(path, poleLen) {
    const segs = path ? path.length - 1 : 1;
    const p = this._positions;

    for (let i = 0; i <= N_RUNG; i++) {
      const t = RUNG_T[i];

      // Sample the live centreline and its local tangent at arc fraction t.
      let cx, cy, cz, tx, ty;
      if (path) {
        const f  = Math.min(segs - 1e-6, t * segs);
        const s  = Math.min(segs - 1, Math.floor(f));
        const fr = f - s;
        const a = path[s], b = path[s + 1];
        cx = a.x + (b.x - a.x) * fr;
        cy = a.y + (b.y - a.y) * fr;
        cz = a.z + (b.z - a.z) * fr;
        tx = b.x - a.x; ty = b.y - a.y;
      } else {
        // Rest pose: walk is implicit in the precomputed tables.
        const ang = this._restAngle[i];
        cx = 0; cy = t * poleLen; cz = 0;
        tx = Math.sin(ang); ty = Math.cos(ang);
      }

      // How far the beam has bent here beyond its rest curve. The rung starts
      // horizontal and rotates with the beam, so the rest outline is exact.
      const beta = Math.atan2(tx, ty) - this._restAngle[i];
      const dx = Math.cos(beta), dy = -Math.sin(beta);

      const w = this._width[i];
      const k = i * 6;
      p[k]     = cx;          p[k + 1] = cy;          p[k + 2] = cz;
      p[k + 3] = cx + dx * w; p[k + 4] = cy + dy * w; p[k + 5] = cz;
    }

    // Back faces share the front's positions exactly.
    p.copyWithin(this._nFront * 3, 0, this._nFront * 3);
  }

  // ─── Texture ────────────────────────────────────────────────────────────

  setColor(color) {
    this._color = color;
    this._paint();
  }

  setLogo(logo) {
    this._logo = logo || "";
    this._logoImg = null;
    if (this._logo) this._loadLogo();
    else this._paint();
  }

  _loadLogo() {
    const want = this._logo;
    loadBrandImage(want).then((img) => {
      if (this._disposed || this._logo !== want) return;
      this._logoImg = img;
      this._paint();
    });
  }

  /** Fill the colour, draw the logo into the left half, mirror it into the right. */
  _paint() {
    const ctx  = this._tex.getContext();
    const half = TEX_W / 2;
    const c = basicColors[this._color]?.diffuse ?? basicColors.white.diffuse;

    // The texture is sampled as sRGB, so write the gamma-space value: a raw
    // linear hex here comes back about half as bright as the pennant's
    // diffuseColor for the same basicColors entry.
    ctx.fillStyle = c.toGammaSpace().toHexString();
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    const img = this._logoImg;
    if (img?.width) {
      // Canvas y=0 is the top of the sail. Centre the logo on the rectangular
      // body, rotated to read bottom-to-top. The back half is the same draw
      // reflected about the midline, so it reads correctly from behind.
      const s = Math.min((TEX_H * 0.55) / img.width, (half * 0.8) / img.height);
      for (const mirror of [false, true]) {
        ctx.save();
        if (mirror) {
          ctx.translate(TEX_W, 0);
          ctx.scale(-1, 1);
        }
        ctx.translate(half * 0.5, TEX_H * 0.45);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2,
                      img.width * s, img.height * s);
        ctx.restore();
      }
    }

    this._tex.update();
  }

  dispose() {
    this._disposed = true;
    this.mesh.material?.dispose();
    this._tex?.dispose();
    this.mesh.dispose();
  }
}
