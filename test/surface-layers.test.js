import { describe, it, expect } from "vitest";
import {
  SurfaceLayers,
  createGroundLayer,
  createTriangleLayer,
} from "../src/world/surface-layers.js";

// Position + normal buffers laid out the way Babylon's CreateGround lays them
// out: row 0 is the +Z edge, columns run along +X.
function groundBuffers({ width, depth, subdivisions }, heightAt) {
  const positions = [];
  const normals = [];
  for (let row = 0; row <= subdivisions; row++) {
    for (let col = 0; col <= subdivisions; col++) {
      const x = (col * width) / subdivisions - width / 2;
      const z = ((subdivisions - row) * depth) / subdivisions - depth / 2;
      positions.push(x, heightAt(x, z), z);
      normals.push(0, 1, 0);
    }
  }
  return { positions, normals };
}

// A flat square at height y, as two triangles.
function flatSquare(cx, cz, half, y) {
  const positions = [
    cx - half, y, cz - half,
    cx + half, y, cz - half,
    cx + half, y, cz + half,
    cx - half, y, cz + half,
  ];
  const normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  return createTriangleLayer(positions, [0, 1, 2, 0, 2, 3], normals);
}

const heights = (layer, x, z) => {
  const out = [];
  layer.heightsAt(x, z, out);
  return out;
};

describe("createGroundLayer", () => {
  it("reproduces a plane exactly and reaches nothing outside the lattice", () => {
    const lattice = { width: 10, depth: 6, subdivisions: 4 };
    const plane = (x, z) => 2 * x + 3 * z + 1;
    const { positions, normals } = groundBuffers(lattice, plane);
    const layer = createGroundLayer(lattice, positions, normals);
    for (const [x, z] of [[0, 0], [1.3, -2.2], [-4.9, 2.9], [5, 3]]) {
      expect(heights(layer, x, z)[0]).toBeCloseTo(plane(x, z), 10);
    }
    expect(heights(layer, 5.01, 0)).toEqual([]);
    expect(heights(layer, 0, -3.01)).toEqual([]);
  });

  it("splits each cell along CreateGround's (i, j+1)–(i+1, j) diagonal", () => {
    // One cell with only the +X+Z corner raised. Bilinear would give 0.5625 at
    // (0.75, 0.75); the upper-right triangle gives 0.5, the lower-left 0.
    const lattice = { width: 1, depth: 1, subdivisions: 1 };
    const { positions, normals } = groundBuffers(lattice, (x, z) => (x > 0 && z > 0 ? 1 : 0));
    const layer = createGroundLayer(lattice, positions, normals);
    expect(heights(layer, -0.25, -0.25)[0]).toBeCloseTo(0, 10);
    expect(heights(layer, 0.25, 0.25)[0]).toBeCloseTo(0.5, 10);
  });

  it("interpolates the vertex normals", () => {
    const lattice = { width: 2, depth: 2, subdivisions: 1 };
    const { positions, normals } = groundBuffers(lattice, () => 0);
    const layer = createGroundLayer(lattice, positions, normals);
    const n = layer.normalAt(0.2, 0.3, 0, {});
    expect([n.x, n.y, n.z]).toEqual([0, 1, 0]);
  });
});

describe("createTriangleLayer", () => {
  it("returns every triangle over the point and nothing off the mesh", () => {
    const low = flatSquare(0, 0, 2, 1);
    expect(heights(low, 0.5, -1.5)).toEqual([1]);
    expect(heights(low, 2.5, 0)).toEqual([]);

    // Two stacked quads in one mesh: both heights come back.
    const positions = [-1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 3, -1, 1, 3, -1, 1, 3, 1];
    const stacked = createTriangleLayer(positions, [0, 1, 2, 3, 4, 5]);
    expect(heights(stacked, 0.5, -0.5).sort()).toEqual([1, 3]);
  });

  it("skips vertical triangles", () => {
    const wall = createTriangleLayer([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
    expect(heights(wall, 0.2, 0)).toEqual([]);
  });

  it("gives the normal of the triangle at the requested height", () => {
    const positions = [0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5, 0, 2, 5, 0, 0, 5, 2];
    const normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0];
    const layer = createTriangleLayer(positions, [0, 1, 2, 3, 4, 5], normals);
    expect(layer.normalAt(0.5, 0.5, 0, {})).toEqual({ x: 0, y: 1, z: 0 });
    expect(layer.normalAt(0.5, 0.5, 5, {})).toEqual({ x: 1, y: 0, z: 0 });
    expect(layer.normalAt(0.5, 0.5, 2, {})).toBeNull();
  });
});

describe("SurfaceLayers.sample", () => {
  const ground = { surfaceId: 1, kind: "ground", level: 0 };
  const deck = { surfaceId: 2, kind: "deck", level: 1 };
  const stack = () => {
    const layers = new SurfaceLayers();
    layers.add(flatSquare(0, 0, 50, 0), ground);
    layers.add(flatSquare(0, 0, 5, 5), deck);
    return layers;
  };

  it("takes the highest surface at or below fromY", () => {
    const layers = stack();
    expect(layers.sample(0, 0, 10).surface).toBe(deck);
    expect(layers.sample(0, 0, 1).surface).toBe(ground);
    expect(layers.sample(20, 0, 10).surface).toBe(ground);
    expect(layers.sample(80, 0, 10)).toBeNull();
  });

  it("recovers a surface the point has sunk into, but never snaps up onto a deck overhead", () => {
    const layers = stack();
    // 1 below the deck, 4 above the ground: sunk in, the deck is within reach.
    expect(layers.sample(0, 0, 4).surface).toBe(deck);
    // 2 below the deck: too far to rise, stays on the ground below.
    expect(layers.sample(0, 0, 3).surface).toBe(ground);
    // Nothing below at all: a surface up to 1 above is still found.
    expect(layers.sample(0, 0, -0.5).y).toBe(0);
    expect(layers.sample(0, 0, -2)).toBeNull();
  });

  it("prefers the continuity surface only when it's nearly tied", () => {
    const layers = new SurfaceLayers();
    layers.add(flatSquare(0, 0, 5, 5), deck);
    const lower = { surfaceId: 3, kind: "deck", level: 1 };
    layers.add(flatSquare(0, 0, 5, 4.95), lower);
    expect(layers.sample(0, 0, 10).surface).toBe(deck);
    expect(layers.sample(0, 0, 10, { surfaceId: 3, maxDistanceDelta: 0.08 }).surface).toBe(lower);
    expect(layers.sample(0, 0, 10, { surfaceId: 3, maxDistanceDelta: 0.01 }).surface).toBe(deck);
  });

  it("gives exact ties to the first-added surface", () => {
    const layers = new SurfaceLayers();
    layers.add(flatSquare(0, 0, 50, 0), ground);
    layers.add(flatSquare(0, 0, 5, 0), { surfaceId: 4, kind: "seam", level: 0 });
    expect(layers.sample(0, 0, 10).surface).toBe(ground);
  });

  it("drops ground inside a ground void, but no other surface", () => {
    // A tunnel: the hill (ground at 12) over a floor (tunnel at 0.1), and the
    // mesh's smear of a portal face (ground at 3) inside the bore.
    const tunnelFloor = { surfaceId: 5, kind: "tunnel", level: -1 };
    const layers = new SurfaceLayers();
    layers.add(flatSquare(0, 0, 50, 12), ground);
    layers.add(flatSquare(0, 0, 50, 3), ground);
    layers.add(flatSquare(0, 0, 5, 0.1), tunnelFloor);
    expect(layers.sample(0, 0, 1.5).y).toBe(0.1);
    expect(layers.sample(0, 0, 4).y).toBe(3); // no void yet: the smear is there
    layers.groundVoidAt = (x) => (Math.abs(x) < 5 ? { min: 0.05, max: 6 } : null);
    expect(layers.sample(0, 0, 4).surface).toBe(tunnelFloor);
    expect(layers.sample(0, 0, 20).y).toBe(12); // the hilltop, above the roof
    expect(layers.sample(10, 0, 4).y).toBe(3);  // outside the bore
  });

  it("downOnLevel only sees its level; remove drops a layer", () => {
    const layers = new SurfaceLayers();
    layers.add(flatSquare(0, 0, 50, 0), ground);
    const entry = layers.add(flatSquare(0, 0, 5, 5), deck);
    expect(layers.downOnLevel(0, 0, 10, 0, 50)).toBe(0);
    expect(layers.downOnLevel(0, 0, 10, 1, 50)).toBe(5);
    expect(layers.downOnLevel(0, 0, 10, 1, 2)).toBeNull();
    layers.remove(entry);
    expect(layers.sample(0, 0, 10).surface).toBe(ground);
  });
});
