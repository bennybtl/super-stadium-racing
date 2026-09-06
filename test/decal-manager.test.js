import { describe, it, expect } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { DecalManager } from "../src/managers/DecalManager.js";
import { decalStableAngle } from "../src/managers/groundDecal.js";

const DEG = Math.PI / 180;
const mgr = new DecalManager(null, null, null); // param logic needs no scene

describe("DecalManager.isFlatFeature", () => {
  it("legacy types map by kind", () => {
    expect(mgr.isFlatFeature({ type: "surfaceDecal" })).toBe(true);
    expect(mgr.isFlatFeature({ type: "wallDecal" })).toBe(false);
  });
  it("target-form decals map by normal", () => {
    expect(mgr.isFlatFeature({ type: "decal", normal: [0, 1, 0] })).toBe(true);
    expect(mgr.isFlatFeature({ type: "decal", normal: [0, 0.99, 0.1] })).toBe(true);
    expect(mgr.isFlatFeature({ type: "decal", normal: [0, 0, 1] })).toBe(false);
    expect(mgr.isFlatFeature({ type: "decal", normal: [1, 0, 0] })).toBe(false);
    expect(mgr.isFlatFeature({ type: "decal" })).toBe(true); // missing normal → flat
  });
});

describe("DecalManager._decalParams — legacy → internal", () => {
  it("surfaceDecal: rotationRad reproduces the old CreateDecal angle -(angle·π/180)", () => {
    for (const angle of [0, 37, 90, -45, 180]) {
      const p = mgr._decalParams({ type: "surfaceDecal", centerX: 2, centerZ: 3, angle, depth: 5 });
      // old fed CreateDecal `-(angle·π/180)`; projectDecal feeds decalStableAngle(up, rotationRad)
      expect(decalStableAngle(p.normal, p.rotationRad)).toBeCloseTo(-(angle * DEG), 9);
      expect(p.position.asArray()).toEqual([2, 0, 3]);
      expect(p.normal.asArray()).toEqual([0, 1, 0]);
      expect(p.height).toBe(5); // surface `depth` → internal `height`
    }
  });

  it("wallDecal: rotationRad reproduces the old CreateDecal angle roll·π/180", () => {
    const normal = new Vector3(0, 0, 1).normalize();
    for (const roll of [0, 20, 90, -60]) {
      const p = mgr._decalParams({ type: "wallDecal", position: [1, 4, -2], normal: [0, 0, 1], roll, height: 3 });
      expect(decalStableAngle(p.normal, p.rotationRad)).toBeCloseTo(roll * DEG, 9);
      expect(p.position.asArray()).toEqual([1, 4, -2]);
      expect(p.height).toBe(3);
    }
    expect(normal).toBeDefined();
  });

  it("target-form decal: rotation is taken as-is (stable frame)", () => {
    const p = mgr._decalParams({ type: "decal", position: [0, 0, 0], normal: [0, 1, 0], rotation: 30 });
    expect(p.rotationRad).toBeCloseTo(30 * DEG, 9);
  });

  it("migrated surfaceDecal(angle A) ≡ decal(rotation -A)", () => {
    for (const A of [0, 37, 123, -88]) {
      const legacy = mgr._decalParams({ type: "surfaceDecal", centerX: 0, centerZ: 0, angle: A });
      const migrated = mgr._decalParams({ type: "decal", position: [0, 0, 0], normal: [0, 1, 0], rotation: -A });
      expect(migrated.rotationRad).toBeCloseTo(legacy.rotationRad, 9);
    }
  });

  it("rejects an unknown shape / missing geometry", () => {
    expect(mgr._decalParams({ type: "decal", shape: "bogus", position: [0, 0, 0] })).toBeNull();
    expect(mgr._decalParams({ type: "decal" })).toBeNull(); // no position
    expect(mgr._decalParams({ type: "wallDecal", roll: 0 })).toBeNull(); // no position/normal
    expect(mgr._decalParams({ type: "wallDecal", position: [0, 0, 0], normal: [0, 0, 1], shape: "polyline" })).toBeNull();
  });
});
