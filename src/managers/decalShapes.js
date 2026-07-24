import { DynamicTexture } from "@babylonjs/core";

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

export const DECAL_SHAPES = ['arrow', 'chevron', 'line', 'oval', 'rect', 'triangle'];

/** Shapes whose look depends on the feature's `count` (repeat) property. */
export const COUNTED_SHAPES = ['chevron'];

/** Shapes that can be drawn solid or as an outline. */
export const OUTLINE_SHAPES = ['oval', 'rect', 'triangle'];

/** Paint colours available for decals (CSS colours — used directly as fill/stroke). */
export const DECAL_COLORS = ['white', 'yellow', 'red', 'blue', 'black', 'gray'];

export const MIN_COUNT = 1;
export const MAX_COUNT = 10;

const TEX_SIZE = 512;

// Outline stroke width as a fraction of texture width.
const STROKE_RATIO = 0.09;

const clampCount = (n) => Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(n ?? MIN_COUNT)));

/** Draw the named shape onto a 2D canvas context sized w×h. */
export function drawDecalShape(ctx, shape, w, h, { color = 'white', count = 1, outline = false } = {}) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = w * STROKE_RATIO;

  switch (shape) {
    case 'chevron':
      drawChevrons(ctx, w, h, color, clampCount(count));
      break;
    case 'line':
      drawLine(ctx, w, h, color);
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
    case 'arrow':
    default:
      drawArrow(ctx, w, h, color);
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
  color = 'white', seed = 0, count = 1, outline = false,
  worldWidth = 4, worldDepth = 4, size = TEX_SIZE,
} = {}) {
  const tex = new DynamicTexture(`decalShape_${shape}`, { width: size, height: size }, scene);
  const ctx = tex.getContext();
  drawDecalShape(ctx, shape, size, size, { color, count, outline });
  applyDecalWear(ctx, size, size, { seed, worldWidth, worldDepth });
  tex.hasAlpha = true;
  tex.update();
  return tex;
}
