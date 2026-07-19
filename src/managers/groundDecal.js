import { MeshBuilder, StandardMaterial, Vector3, Engine } from "@babylonjs/core";

/**
 * groundDecal — shared helpers for projecting a canvas/DynamicTexture onto the
 * ground as a flat marking. Used by both the checkpoint gate decals
 * (Checkpoint.js) and the programmatic surface decals (SurfaceDecalManager.js).
 *
 * These two features differ in what they draw and how they cache, but they
 * share the same projection call and the same "self-lit decal" material recipe
 * — centralised here so the tricky material flags can't drift between them.
 */

const PROJECTION_DEPTH = 10; // how far the decal box projects along the normal

/** Project a decal quad onto `ground` at a world position, rotated `angle` (radians) about +Y. */
export function projectGroundDecal(ground, name, { position, width, depth, angle }) {
  return MeshBuilder.CreateDecal(name, ground, {
    position,
    normal: Vector3.Up(),
    size: new Vector3(width, depth, PROJECTION_DEPTH),
    angle,
  });
}

/**
 * Self-lit decal material: the texture supplies both colour (emissive) and
 * alpha, lighting is disabled so the marking reads the same under any scene
 * light, and a negative zOffset keeps it from z-fighting the ground beneath it.
 */
export function makeDecalMaterial(scene, name, texture, opacity = 1) {
  texture.hasAlpha = true;
  const mat = new StandardMaterial(name, scene);
  mat.diffuseTexture = texture;
  mat.emissiveTexture = texture;
  mat.useAlphaFromDiffuseTexture = true;
  mat.disableLighting = true;
  mat.alphaMode = Engine.ALPHA_COMBINE;
  mat.alpha = opacity;
  mat.backFaceCulling = false;
  mat.zOffset = -2;
  return mat;
}
