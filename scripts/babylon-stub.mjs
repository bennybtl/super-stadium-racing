// Minimal @babylonjs/core stand-in so Track (via terrain.js) can run in plain
// node for the check scripts. Only what the track/terrain module graph actually
// touches at import time belongs here.
export class Color3 {
  constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b; }
}
