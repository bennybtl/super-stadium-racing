const rebuild = {
  currentTrack: null,
  currentScene: null,
  terrain: null,
  terrainGrid: null,
  terrainTexture: null,
  normalMap: null,
  hillWater: null,
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
