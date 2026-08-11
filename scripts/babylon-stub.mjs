// Minimal @babylonjs/core stand-in so Track (via terrain.js) can run in plain
// node for the check scripts. Only what the track/terrain module graph actually
// touches at import time belongs here.
export class Color3 {
  constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b; }
}

// Nothing here is called by the pure-geometry code the checks exercise — these
// exist so the module graph links when a file imports Babylon for code paths the
// checks never run (BorderWall's mesh/physics builders, for instance).
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
}
export const MeshBuilder = {};
export class StandardMaterial {}
export class Texture {}
export class PhysicsAggregate {}
export const PhysicsShapeType = {};
