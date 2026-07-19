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

export const DECAL_SHAPES = ['arrow'];

const TEX_SIZE = 512;

/** Draw the named shape onto a 2D canvas context sized w×h. */
export function drawDecalShape(ctx, shape, w, h, color = 'white') {
  ctx.clearRect(0, 0, w, h);
  switch (shape) {
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
 * Build a DynamicTexture for the given shape. Caller owns disposal.
 */
export function createDecalTexture(scene, shape, color = 'white', size = TEX_SIZE) {
  const tex = new DynamicTexture(`decalShape_${shape}`, { width: size, height: size }, scene);
  drawDecalShape(tex.getContext(), shape, size, size, color);
  tex.hasAlpha = true;
  tex.update();
  return tex;
}
