import { MeshBuilder, DynamicTexture, StandardMaterial, Mesh } from "@babylonjs/core";

// Shared helpers for world-space text billboards — a camera-facing plane whose
// texture is a canvas we draw text onto. Used by both the persistent race
// position badges (RacePositionLabels) and the transient "+$500" pickup popups
// (FloatingTextManager); each owns its own lifecycle/animation, this just builds
// and draws the billboard.

/**
 * Create a camera-facing, unlit, alpha-blended text plane.
 * Pass `size` for a square plane, or `width`/`height` for a rectangle.
 * @returns {{ plane, tex, mat }} caller owns disposal of all three.
 */
export function createBillboardTextPlane(scene, {
  name = 'billboardText',
  size,
  width,
  height,
  texWidth = 256,
  texHeight = 256,
}) {
  const plane = MeshBuilder.CreatePlane(name, size != null ? { size } : { width, height }, scene);
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.isPickable = false;

  const tex = new DynamicTexture(`${name}Tex`, { width: texWidth, height: texHeight }, scene);
  tex.hasAlpha = true;

  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  plane.material = mat;

  return { plane, tex, mat };
}

/**
 * Clear `tex` and draw a single line of centered text, then push the update.
 * `outline` ({ width, color }) draws a stroke behind the fill for legibility;
 * `yNudge` shifts the baseline slightly to visually center a given font.
 */
export function drawCenteredText(tex, text, { color, font, outline = null, yNudge = 0 } = {}) {
  const { width, height } = tex.getSize();
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, width, height);

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = width / 2;
  const cy = height / 2 + yNudge;

  if (outline) {
    ctx.lineWidth = outline.width;
    ctx.strokeStyle = outline.color;
    ctx.strokeText(text, cx, cy);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);

  tex.update();
}
