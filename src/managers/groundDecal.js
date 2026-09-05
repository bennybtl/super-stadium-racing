import { MeshBuilder, StandardMaterial, Vector3, Engine } from "@babylonjs/core";

/**
 * groundDecal — shared helpers for projecting a canvas/DynamicTexture onto a
 * mesh as a flat marking. Used by the checkpoint gate decals (Checkpoint.js),
 * the programmatic ground decals (SurfaceDecalManager.js) and the wall decals
 * (WallDecalManager.js).
 *
 * These features differ in what they draw and how they cache, but they share
 * the same projection call and the same "self-lit decal" material recipe —
 * centralised here so the tricky material flags can't drift between them.
 */

const PROJECTION_DEPTH = 10; // how far the decal box projects along the normal

/**
 * Project a decal quad onto `target` at a world position, oriented by a surface
 * `normal`, and rotated `angle` (radians) about that normal. `projectionDepth`
 * is how far the projector box extends along the normal — keep it below the
 * target's thickness so the decal doesn't punch through to the far face.
 */
export function projectSurfaceDecal(target, name, { position, normal, width, height, angle, projectionDepth = PROJECTION_DEPTH }) {
  return MeshBuilder.CreateDecal(name, target, {
    position,
    normal,
    size: new Vector3(width, height, projectionDepth),
    angle,
  });
}

/** Project a decal flat onto `ground` at a world position, rotated `angle` (radians) about +Y. */
export function projectGroundDecal(ground, name, { position, width, depth, angle }) {
  return projectSurfaceDecal(ground, name, {
    position,
    normal: Vector3.Up(),
    width,
    height: depth,
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
