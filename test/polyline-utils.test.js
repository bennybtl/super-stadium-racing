import { describe, it, expect } from "vitest";
import {
  expandPolyline,
  distToPolyline,
  distSqToPolyline,
  isPointInPolygon,
} from "../src/polyline-utils.js";

const square = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
  { x: 0, z: 10 },
];

describe("isPointInPolygon", () => {
  it("detects inside vs outside", () => {
    expect(isPointInPolygon(5, 5, square)).toBe(true);
    expect(isPointInPolygon(15, 5, square)).toBe(false);
    expect(isPointInPolygon(-1, -1, square)).toBe(false);
  });
  it("needs at least 3 points", () => {
    expect(isPointInPolygon(0, 0, [{ x: 0, z: 0 }, { x: 1, z: 1 }])).toBe(false);
  });
});

describe("distToPolyline", () => {
  const line = [{ x: 0, z: 0 }, { x: 10, z: 0 }];

  it("measures perpendicular distance to a segment", () => {
    expect(distToPolyline(5, 3, line)).toBeCloseTo(3);
  });
  it("clamps to the nearest endpoint past the ends", () => {
    expect(distToPolyline(-4, 0, line)).toBeCloseTo(4);
    expect(distToPolyline(13, 4, line)).toBeCloseTo(5);
  });
  it("closed=true also considers the closing segment", () => {
    // point just outside the left edge of the square
    expect(distToPolyline(-2, 5, square, true)).toBeCloseTo(2);
  });
  it("returns Infinity for an empty point list", () => {
    expect(distSqToPolyline(0, 0, [])).toBe(Infinity);
  });
});

describe("expandPolyline", () => {
  it("passes a radius-free polyline through unchanged (plus the start point)", () => {
    const pts = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
    const out = expandPolyline(pts, false);
    expect(out[0]).toEqual({ x: 0, z: 0 });
    expect(out.at(-1)).toEqual({ x: 10, z: 10 });
  });
  it("returns the input untouched for < 2 points", () => {
    const one = [{ x: 1, z: 2 }];
    expect(expandPolyline(one)).toBe(one);
  });
  it("inserts arc points when a corner carries a radius", () => {
    const plain = expandPolyline([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }], false);
    const rounded = expandPolyline(
      [{ x: 0, z: 0 }, { x: 10, z: 0, radius: 3 }, { x: 10, z: 10 }],
      false,
    );
    expect(rounded.length).toBeGreaterThan(plain.length);
  });
});
