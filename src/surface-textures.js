/**
 * Tiled textures selectable for drivable-mesh surfaces (driveBox, bridgeMesh),
 * alongside the flat colors in the same dropdown. The key is what gets stored on
 * the feature's `color` / `sideColor`; the `tex:` prefix keeps it distinguishable
 * from a hex color and from the literal 'terrain'.
 *
 * Like a flat color, a texture opts the surface out of the terrain-blend look:
 * plain diffuse + this texture, no blend plugin, no normal map.
 */
export const SURFACE_TEXTURES = {
  'tex:concrete': {
    label: 'Concrete',
    diffuseTexture: 'textures/concrete.texture.png',
    worldUnitsPerTile: 10,
    specular: 0.10,
  },
  'tex:plywood': {
    label: 'Plywood',
    diffuseTexture: 'textures/plywood.texture.png',
    worldUnitsPerTile: 6,
    specular: 0.14,
  },
};

const _textureModules = import.meta.glob('./assets/textures/*', { eager: true, query: '?url', import: 'default' });

const _textureUrls = {};
for (const [path, url] of Object.entries(_textureModules)) {
  _textureUrls[path.replace('./assets/', '')] = url;
  _textureUrls[path.split('/').at(-1)] = url;
}

/** The texture definition for a stored surface value, or null if it isn't one. */
export function resolveSurfaceTexture(value) {
  if (typeof value !== 'string') return null;
  return SURFACE_TEXTURES[value] ?? null;
}

/** Bundled URL for a stored surface value's texture, or null. */
export function surfaceTextureUrl(value) {
  const texture = resolveSurfaceTexture(value);
  if (!texture) return null;
  return _textureUrls[texture.diffuseTexture] ?? null;
}
