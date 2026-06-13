# Ground Shader Notes

This file documents how the terrain ground shader works and how BridgeMesh now uses the same shader path.

## Purpose

The ground material uses a Babylon StandardMaterial plus TerrainBlendPlugin.
The plugin overrides per-pixel diffuse and specular behavior while keeping StandardMaterial lighting, shadows, and bump mapping.

## Core Inputs

TerrainBlendPlugin consumes these textures and constants:

- terrainId texture: per-cell terrain type index
- terrainProperty texture: per-terrain RGBA where RGB is base color and A is specular intensity
- water overlay texture: world-space tint and alpha for water depth look
- wear overlay texture: world-space lighten and darken masks
- diffuse overlay texture: world-space terrain diffuse details
- terrainTypeCount
- terrainCellCount
- terrainWorldHalfWidth
- terrainWorldHalfDepth

## Fragment Flow

For each pixel:

1. Convert world position to terrain UV.
2. Sample a 3x3 gaussian neighborhood of terrain cells to blend terrain properties smoothly.
3. Combine terrain color with water overlay.
4. Apply wear lighten and darken modulation.
5. Mix in smoothed diffuse overlay detail.
6. Drive specular from terrain blend alpha (terrain property A plus slight wear influence).

## Forced Terrain Type Mode

TerrainBlendPlugin supports an optional forced terrain type index.
When set, the shader skips neighbor terrain-id blending and uses one terrain type for that mesh.

Use case: bridge decks should look like selected bridge material type while still receiving the same water/wear/diffuse overlay logic as terrain.

## BridgeMesh Integration

Bridge meshes receive terrain shader config from SceneBuilder through BridgeMeshManager:

- pluginClass
- resolveTerrainTypeIndex helper
- all terrain textures used by ground
- terrain dimensions and counts

Bridge material behavior:

- If WebGL2 and terrain blend resources exist: apply TerrainBlendPlugin with forced terrain type index.
- Otherwise: use the legacy bridge diffuse texture fallback path.

## Why This Approach

- Visual consistency: bridges and terrain share one shading model.
- Feature parity: overlays and specular behavior are aligned.
- Safe fallback: non-WebGL2 or missing resources still render via old bridge material path.

## Known Constraints

- Overlay maps are world-space projected, so bridge visuals reflect the world location under the bridge.
- Forced terrain type controls base terrain color and specular source, but overlays still apply from world-space textures.

## Extension Ideas

- Add per-bridge option to disable overlays.
- Add per-bridge option to use true underlying terrain-id blending instead of forced terrain type.
- Add per-bridge material tuning (specular multiplier, overlay influence multiplier).
