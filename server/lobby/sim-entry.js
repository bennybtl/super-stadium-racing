// esbuild entry for the lobby child's simulation bundle (server/build/sim.mjs,
// built by `npm run build:server-sim`). The game's sim code is written for
// Vite — asset imports, import.meta.glob — so Node runs a bundle of it rather
// than the sources.
export { Track } from "../../src/world/track.js";
export { createRace } from "../../src/sim/headless-race.js";
export { setObstacleLoader } from "../../src/objects/Obstacle.js";
export { SIM_DT } from "../../src/modes/fixed-step.js";
export { NullEngine, Scene } from "@babylonjs/core";
