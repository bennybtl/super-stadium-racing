import { describe, it, expect } from "vitest";
import { DecalManager } from "../src/managers/DecalManager.js";

const DEG = Math.PI / 180;
const mgr = new DecalManager(null, null, null); // param logic needs no scene

describe("DecalManager.isFlatFeature", () => {
  it("maps by normal", () => {
    expect(mgr.isFlatFeature({ normal: [0, 1, 0] })).toBe(true);
    expect(mgr.isFlatFeature({ normal: [0, 0.99, 0.1] })).toBe(true);
    expect(mgr.isFlatFeature({ normal: [0, 0, 1] })).toBe(false);
    expect(mgr.isFlatFeature({ normal: [1, 0, 0] })).toBe(false);
    expect(mgr.isFlatFeature({})).toBe(true); // missing normal → flat
  });
});

describe("DecalManager._decalParams", () => {
  it("normalises a decal feature to the build form", () => {
    const p = mgr._decalParams({
      type: "decal", position: [2, 5, -3], normal: [0, 0, 2], rotation: 30,
      shape: "arrow", width: 6, height: 4, opacity: 0.5, count: 2,
    });
    expect(p.position.asArray()).toEqual([2, 5, -3]);
    expect(p.normal.asArray()).toEqual([0, 0, 1]); // normalised
    expect(p.rotationRad).toBeCloseTo(30 * DEG, 9);
    expect(p.width).toBe(6);
    expect(p.height).toBe(4);
    expect(p.opacity).toBe(0.5);
    expect(p.count).toBe(2);
  });

  it("defaults a missing normal to up", () => {
    const p = mgr._decalParams({ type: "decal", position: [0, 0, 0], rotation: 0 });
    expect(p.normal.asArray()).toEqual([0, 1, 0]);
  });

  it("rejects bad input", () => {
    expect(mgr._decalParams({ type: "decal", shape: "bogus", position: [0, 0, 0] })).toBeNull();
    expect(mgr._decalParams({ type: "decal" })).toBeNull(); // no position
    expect(mgr._decalParams({ type: "decal", position: [0, 0, 0], normal: [0, 0, 0] })).toBeNull(); // degenerate normal
  });
});
