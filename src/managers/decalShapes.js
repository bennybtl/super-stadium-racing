import { DynamicTexture } from "@babylonjs/core";
import { basicColors } from "../constants";
import { expandPolyline } from "../polyline-utils.js";
/**
 * decalShapes — programmatically drawn surface-decal textures.
 *
 * Instead of shipping PNG assets, each decal is rendered onto a canvas-backed
 * DynamicTexture (same technique as the checkpoint ground decals). This keeps
 * decals crisp at any scale and makes new markings a matter of adding a draw
 * function rather than an image file.
 *
 * A shape is drawn "pointing up" — toward the top (−Y) of the texture — so the
 * decal's rotation angle maps intuitively to a compass-style heading.
 */

export const DECAL_SHAPES = ['arrow', 'chevron', 'line', 'oval', 'rect', 'triangle', 'text', 'polyline'];

/** Shapes whose look depends on the feature's `count` (repeat) property. */
export const COUNTED_SHAPES = ['chevron'];

/** Shapes that can be drawn solid or as an outline. */
export const OUTLINE_SHAPES = ['oval', 'rect', 'triangle', 'text'];

/** Shapes that take a user-typed `text` string. */
export const TEXT_SHAPES = ['text'];

const DEFAULT_TEXT = 'TEXT';

/** Paint colours available for decals (CSS colours — used directly as fill/stroke). */
export const DECAL_COLORS = ['white', 'yellow', 'red', 'blue', 'black', 'gray'];

export const MIN_COUNT = 1;
export const MAX_COUNT = 10;

const TEX_SIZE = 512;

// Outline stroke width as a fraction of texture width.
const STROKE_RATIO = 0.09;

const clampCount = (n) => Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(n ?? MIN_COUNT)));

/** Draw the named shape onto a 2D canvas context sized w×h. */
export function drawDecalShape(ctx, shape, w, h, { color = 'white', count = 1, outline = false, text = '', localPoints = null, thickness = 1, worldWidth = 4, worldDepth = 4 } = {}) {
  const hexColor = basicColors[color]?.diffuse.toHexString() || '#FFFFFF';

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = hexColor;
  ctx.strokeStyle = hexColor;
  ctx.lineWidth = w * STROKE_RATIO;

  switch (shape) {
    case 'chevron':
      drawChevrons(ctx, w, h, hexColor, clampCount(count));
      break;
    case 'line':
      drawLine(ctx, w, h, hexColor);
      break;
    case 'oval':
      drawOval(ctx, w, h, outline);
      break;
    case 'rect':
      drawRect(ctx, w, h, outline);
      break;
    case 'triangle':
      drawTriangle(ctx, w, h, outline);
      break;
    case 'text':
      drawText(ctx, w, h, text, outline);
      break;
    case 'polyline': {
      // A single canvas stroke can't vary width per path direction, so pick
      // one px-per-world-unit scale for the whole path. The box's narrower
      // dimension is the one squeezed down toward the stroke's own thickness
      // padding, so its scale is the finer of the two — using it is exact for
      // an axis-aligned line (the common case: a straight or gently-curved
      // line down the track) and errs toward "too thick" rather than "too
      // thin" as the path tilts off-axis, same spirit as the minor stretch
      // the single-segment `line` shape already accepts when width ≠ depth.
      const pxPerUnit = Math.max(w / worldWidth, h / worldDepth);
      drawPolyline(ctx, w, h, localPoints, thickness * pxPerUnit);
      break;
    }
    case 'arrow':
    default:
      drawArrow(ctx, w, h, hexColor);
      break;
  }
}

/** Solid arrow pointing toward the top of the texture. */
function drawArrow(ctx, w, h, color) {
  ctx.fillStyle = color;
  const cx = w / 2;
  const top        = h * 0.08;
  const headH      = h * 0.42;
  const headBottom = top + headH;
  const bottom     = h * 0.92;
  const headHalfW  = w * 0.30;
  const shaftHalfW = w * 0.14;

  // Arrowhead triangle
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx - headHalfW, headBottom);
  ctx.lineTo(cx + headHalfW, headBottom);
  ctx.closePath();
  ctx.fill();

  // Shaft
  ctx.fillRect(cx - shaftHalfW, headBottom, shaftHalfW * 2, bottom - headBottom);
}

/**
 * `count` chevrons pointing toward the top of the texture, stacked evenly down
 * it. Each gets an equal band so the run always fills the decal regardless of
 * how many are drawn.
 */
function drawChevrons(ctx, w, h, color, count) {
  ctx.fillStyle = color;
  const cx = w / 2;
  const halfW = w * 0.34;
  const bandH = h / count;
  const thickness = bandH * 0.32;
  const legDrop = bandH * 0.5;

  for (let i = 0; i < count; i++) {
    const apexY = i * bandH + bandH * 0.12;
    const legY  = apexY + legDrop;
    ctx.beginPath();
    ctx.moveTo(cx, apexY);
    ctx.lineTo(cx + halfW, legY);
    ctx.lineTo(cx + halfW, legY + thickness);
    ctx.lineTo(cx, apexY + thickness);
    ctx.lineTo(cx - halfW, legY + thickness);
    ctx.lineTo(cx - halfW, legY);
    ctx.closePath();
    ctx.fill();
  }
}

/** Straight bar running the length of the texture (rotate the decal to aim it). */
function drawLine(ctx, w, h, color) {
  ctx.fillStyle = color;
  const thickness = w * 0.16;
  ctx.fillRect((w - thickness) / 2, h * 0.04, thickness, h * 0.92);
}

// ── Basic shapes (solid or outline) ─────────────────────────────────────────
// Outlined variants inset by half the stroke width so the stroke stays inside
// the texture instead of being clipped at the edges.

function drawOval(ctx, w, h, outline) {
  const inset = outline ? ctx.lineWidth / 2 : 0;
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2 - w * 0.05 - inset, h / 2 - h * 0.05 - inset, 0, 0, Math.PI * 2);
  outline ? ctx.stroke() : ctx.fill();
}

function drawRect(ctx, w, h, outline) {
  const inset = outline ? ctx.lineWidth / 2 : 0;
  const x = w * 0.06 + inset;
  const y = h * 0.06 + inset;
  const rw = w - 2 * x;
  const rh = h - 2 * y;
  outline ? ctx.strokeRect(x, y, rw, rh) : ctx.fillRect(x, y, rw, rh);
}

/**
 * A single line of user text, scaled to fill the texture width. The caller sets
 * fillStyle/strokeStyle/lineWidth; here we just size the font and paint. The
 * user sets the decal's width/depth to control the final on-ground proportions.
 */
function drawText(ctx, w, h, text, outline) {
  const str = (text ?? '').trim() || DEFAULT_TEXT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxW = w * 0.88;   // horizontal padding
  const maxH = h * 0.7;    // cap height so short strings aren't full-bleed
  let font = maxH;
  ctx.font = `bold ${font}px Arial`;
  const measured = ctx.measureText(str).width;
  if (measured > maxW) {
    font *= maxW / measured;
    ctx.font = `bold ${font}px Arial`;
  }
  ctx.lineWidth = Math.max(1, font * 0.06);
  outline ? ctx.strokeText(str, w / 2, h / 2) : ctx.fillText(str, w / 2, h / 2);
}

/** Triangle pointing toward the top of the texture. */
function drawTriangle(ctx, w, h, outline) {
  const inset = outline ? ctx.lineWidth : 0;
  const top    = h * 0.06 + inset;
  const bottom = h * 0.94 - inset * 0.5;
  const halfW  = w * 0.44 - inset;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(w / 2, top);
  ctx.lineTo(w / 2 + halfW, bottom);
  ctx.lineTo(w / 2 - halfW, bottom);
  ctx.closePath();
  outline ? ctx.stroke() : ctx.fill();
}

/**
 * A user-drawn line traced through `localPoints` — an already-rounded, OPEN
 * polyline in the feature's own local unit frame (see `decalPolylineLocalOutline`
 * below), where ±1 is exactly the projector box edge (unlike `rect`/`oval`'s
 * stylistic 6% margin: the box itself is derived from these same points, so
 * drawing full-bleed keeps the painted marking lined up with where the user
 * actually dragged each control point). `linePx` is the pre-computed stroke
 * width in texture pixels.
 *
 * The V axis (localPoints' `.z`) is flipped going into canvas rows: confirmed
 * by raycasting a live decal mesh and sampling its actual UV — a DynamicTexture
 * uploads its 2D canvas (row 0 = top) so that UV.y = 0 lands at the texture's
 * BOTTOM, independent of the `useOpenGLOrientationForUV` flag CreateDecal's own
 * UV formula uses. Every other shape here draws a fixed, self-contained image
 * ("pointing up") so this flip is invisible in them — GHOST_ROTATION_OFFSET_DEG
 * already calibrates around it — but a polyline maps specific world points
 * through, so getting the row direction right actually matters.
 */
function drawPolyline(ctx, w, h, localPoints, linePx) {
  if (!localPoints || localPoints.length < 2) return;
  ctx.lineWidth = Math.max(1, linePx);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  localPoints.forEach((p, i) => {
    const px = w / 2 + p.x * (w / 2);
    const pz = h / 2 - p.z * (h / 2);
    if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
  });
  ctx.stroke();
}

/**
 * Derive a polyline decal's ground footprint + local draw path from its raw
 * world-space control points (each an optional `{x, z, radius}`, same corner-
 * rounding convention as polyWall/polyCurb/polyHill) and its stroke `thickness`.
 *
 * Corner rounding is expanded in world space (so `radius` clamps against real
 * segment lengths, same as every other polyline feature; unlike those, this
 * polyline is always open — a wall/curb-style `closed` toggle doesn't apply to
 * a decal line).
 *
 * CreateDecal's own decal-local frame (normal = +Y, `angle` = θ passed to it in
 * radians) maps a world offset (wx, wz) to local (u, v) via — reverse-engineered
 * from `@babylonjs/core`'s decalBuilder.js and confirmed numerically against it:
 *   localX = −sin(θ)·wx + cos(θ)·wz     (→ U, divided by size.x)
 *   localY = −cos(θ)·wx − sin(θ)·wz     (→ V, divided by size.y)
 * This is NOT the same as rotating (wx, wz) by θ in the ordinary sense (an
 * earlier version of this function assumed it was, and was consequently
 * correct only at θ = 0/180° and increasingly wrong approaching 90°/270°).
 * Picking θ so the line's own direction (first control point → last) lands
 * purely along local Y packs a tight box (thin U, long V); its exact inverse
 * then recovers the box's world-space center.
 */
export function decalPolylineLocalOutline(points, thickness = 1) {
  const expanded = expandPolyline(points, false);

  const first = points[0];
  const last = points[points.length - 1];
  const ddx = last.x - first.x;
  const ddz = last.z - first.z;
  // Zeroes localX for direction (ddx, ddz): solving −sinθ·ddx + cosθ·ddz = 0.
  const theta = (ddx === 0 && ddz === 0) ? 0 : Math.atan2(ddz, ddx);
  const s = Math.sin(theta), c = Math.cos(theta);

  const local = expanded.map(p => ({
    x: -s * p.x + c * p.z, // localX / U
    z: -c * p.x - s * p.z, // localY / V
  }));

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of local) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const pad = Math.max(0, thickness) / 2;
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
  const localCenterX = (minX + maxX) / 2;
  const localCenterZ = (minZ + maxZ) / 2;
  const width = Math.max(0.1, maxX - minX);
  const depth = Math.max(0.1, maxZ - minZ);
  const halfW = width / 2;
  const halfD = depth / 2;

  // Exact inverse of the localX/localY formulas above (their matrix is
  // orthogonal — det 1 — so the inverse is its transpose).
  const centerX = -s * localCenterX - c * localCenterZ;
  const centerZ = c * localCenterX - s * localCenterZ;

  return {
    centerX, centerZ, width, depth,
    angleRad: theta, // radians — CreateDecal's own `angle`, pass through unchanged (no sign flip)
    localPoints: local.map(p => ({ x: (p.x - localCenterX) / halfW, z: (p.z - localCenterZ) / halfD })),
  };
}

/**
 * Simple seeded PRNG (mulberry32) — returns a function yielding [0, 1) floats,
 * so a given seed always produces the same wear pattern.
 */
function seededRng(seed) {
  let s = seed * 2654435761 >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

// Wear is defined in WORLD units, not texture pixels. The texture is stretched
// over the decal's footprint, so pixel-sized noise would grow with the decal;
// sizing it in metres keeps the same grain on a 2m arrow and a 20m one.
// Values below reproduce the original look on a 4×4 decal.
const SPECKLES_PER_SQ_UNIT = 156;    // ≈2500 over 4×4
const SCRATCHES_PER_SQ_UNIT = 3.75;  // ≈60 over 4×4
const SPECKLE_R_MIN = 0.004, SPECKLE_R_RANGE = 0.035;
const SCRATCH_W_MIN = 0.0625, SCRATCH_W_RANGE = 0.3125;
const SCRATCH_H_MIN = 0.0156, SCRATCH_H_RANGE = 0.0625;
// Ceilings so a very large decal can't cost a pathological number of draws.
const MAX_SPECKLES = 12000, MAX_SCRATCHES = 400;

/**
 * Punch seeded holes through whatever has been drawn, for a worn-stencil look.
 * Shared by every ground decal (checkpoint gates and surface markings alike).
 *
 * `worldWidth`/`worldDepth` are the decal's footprint in world units; speckle
 * size and count are derived from them so wear density is scale-independent.
 * When the two differ, speckles are drawn as ellipses in texture space so they
 * still land as circles on the ground.
 *
 * Erases via destination-out, which uses only the alpha of fillStyle — so the
 * fill is forced opaque here; inheriting a caller's transparent fill would
 * silently erase nothing.
 */
export function applyDecalWear(ctx, texW, texH, { seed = 0, worldWidth = 4, worldDepth = 4 } = {}) {
  const rng = seededRng(seed);
  const pxX = texW / worldWidth;   // texture pixels per world unit
  const pxY = texH / worldDepth;
  const area = worldWidth * worldDepth;

  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';

  // Fine speckle dropout
  const speckles = Math.min(MAX_SPECKLES, Math.round(SPECKLES_PER_SQ_UNIT * area));
  for (let i = 0; i < speckles; i++) {
    const r = rng() * SPECKLE_R_RANGE + SPECKLE_R_MIN;
    ctx.beginPath();
    ctx.ellipse(rng() * texW, rng() * texH, r * pxX, r * pxY, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Larger worn scratches / patches
  const scratches = Math.min(MAX_SCRATCHES, Math.round(SCRATCHES_PER_SQ_UNIT * area));
  for (let i = 0; i < scratches; i++) {
    ctx.save();
    ctx.translate(rng() * texW, rng() * texH);
    ctx.scale(pxX, pxY);   // draw in world units from here
    ctx.rotate(rng() * Math.PI);
    ctx.fillRect(0, 0,
      rng() * SCRATCH_W_RANGE + SCRATCH_W_MIN,
      rng() * SCRATCH_H_RANGE + SCRATCH_H_MIN);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Build a DynamicTexture for the given shape, with wear applied. Caller owns
 * disposal. `seed` selects the wear pattern — vary it to avoid identical
 * neighbours (it is part of the manager's material cache key).
 */
export function createDecalTexture(scene, shape, {
  color = 'white', seed = 0, count = 1, outline = false, text = '',
  worldWidth = 4, worldDepth = 4, size = TEX_SIZE, localPoints = null, thickness = 1,
} = {}) {
  const tex = new DynamicTexture(`decalShape_${shape}`, { width: size, height: size }, scene);
  const ctx = tex.getContext();
  drawDecalShape(ctx, shape, size, size, { color, count, outline, text, localPoints, thickness, worldWidth, worldDepth });
  applyDecalWear(ctx, size, size, { seed, worldWidth, worldDepth });
  tex.hasAlpha = true;
  tex.update();
  return tex;
}
