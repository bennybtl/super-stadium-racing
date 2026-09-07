// Shared debounce (ms) for editor-driven geometry rebuilds — terrain grid,
// poly wall/curb/hill meshes, water. Coalesces the rebuild across the
// pointermoves of a drag so it runs a few times a second rather than every
// frame. One value for every polyline/region editor (was 50 / 120 / 300 by
// accident of history).
export const REBUILD_DEBOUNCE_MS = 120;

const rebuild = {
  currentTrack: null,
  currentScene: null,
  terrain: null,
  terrainGrid: null,
  terrainTexture: null,
  normalMap: null,
  water: null,
  polyWall: null,
  polyCurb: null,
  bridgeMesh: null,
  polyHill: null,
  quickTestTrack: null,
  editorScene: null,
};

export function reset() {
  for (const key of Object.keys(rebuild)) rebuild[key] = null;
}

export default rebuild;
