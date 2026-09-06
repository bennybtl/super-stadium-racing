import { describe, it, expect } from "vitest";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { decalStableAngle } from "../src/managers/groundDecal.js";

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const norm = (x, y, z) => new Vector3(x, y, z).normalize();

const NORMALS = {
  up: norm(0, 1, 0),
  "deck +x": norm(0.09, 1, 0),
  "deck +z": norm(0, 1, 0.09),
  "wall +x": norm(1, 0, 0),
  "wall +z": norm(0, 0, 1),
  "wall -x": norm(-1, 0, 0),
  ramp: norm(0.2, 0.94, 0.3),
};

describe("decalStableAngle", () => {
  it("is exactly additive: f(n, rot) === rot + f(n, 0)", () => {
    for (const n of Object.values(NORMALS)) {
      const k = decalStableAngle(n, 0);
      for (let d = -175; d <= 175; d += 5) {
        const rot = (d * Math.PI) / 180;
        expect(wrap(decalStableAngle(n, rot) - (rot + k))).toBeCloseTo(0, 12);
      }
    }
  });

  it("round-trips a raw CreateDecal angle through the stable frame (bit-exact shim)", () => {
    // projectSurfaceDecal converts raw → rotationRad = raw - f(n,0);
    // projectDecal then feeds CreateDecal f(n, rotationRad), which must == raw.
    for (const n of Object.values(NORMALS)) {
      const k = decalStableAngle(n, 0);
      for (let d = -175; d <= 175; d += 5) {
        const raw = (d * Math.PI) / 180;
        expect(wrap(decalStableAngle(n, raw - k) - raw)).toBeCloseTo(0, 12);
      }
    }
  });

  it("flat-ground offset is zero → surfaceDecal migration is rotation = -angle", () => {
    expect(decalStableAngle(NORMALS.up, 0)).toBeCloseTo(0, 12);
  });

  it("stays finite and continuous for a normal tilting away from vertical", () => {
    let prev = null;
    for (let d = 0; d <= 60; d += 1) {
      const t = (d * Math.PI) / 180;
      const a = decalStableAngle(norm(Math.sin(t), Math.cos(t), 0), 0);
      expect(Number.isFinite(a)).toBe(true);
      if (prev !== null) expect(Math.abs(wrap(a - prev))).toBeLessThan(0.1); // < ~6°/deg, no jump
      prev = a;
    }
  });
});
