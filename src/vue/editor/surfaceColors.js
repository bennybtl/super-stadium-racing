import { SURFACE_TEXTURES, surfaceTextureUrl } from '../../surface-textures.js';

/**
 * Palette for drivable-mesh surface colors (driveBox, bridgeMesh).
 *
 * 'terrain' is the default: no color on the feature, so the surface keeps the
 * terrain-blended material. A 'tex:*' value picks a tiled texture (see
 * surface-textures.js). Any other value is a hex passed straight to the material
 * as a flat diffuse color.
 */
export const SURFACE_COLOR_OPTIONS = [
  { value: 'terrain', label: 'Terrain' },
  { value: '#9aa0a8', label: 'Grey' },
  { value: '#4a4f55', label: 'Dark Grey' },
  { value: '#e8e8e8', label: 'White' },
  { value: '#1a1a1a', label: 'Black' },
  { value: '#b3342e', label: 'Red' },
  { value: '#2e5cb3', label: 'Blue' },
  { value: '#e0b32e', label: 'Yellow' },
  { value: '#3f7a3a', label: 'Green' },
  { value: '#6e4f2f', label: 'Brown' },
  ...Object.entries(SURFACE_TEXTURES).map(([value, texture]) => ({ value, label: texture.label })),
];

/**
 * CSS background for the panel swatch: the tile itself for a texture, the color
 * for a hex, nothing for terrain (which has no single color to show).
 */
export function surfaceSwatch(value) {
  const textureUrl = surfaceTextureUrl(value);
  if (textureUrl) return `url(${textureUrl}) center/cover`;
  return value === 'terrain' ? 'transparent' : value;
}
