import { describe, it, expect } from "vitest";
import { Color3 } from "@babylonjs/core";
import { parseColorValue } from "../src/utils/mesh-color.js";

describe("parseColorValue", () => {
  it("passes a Color3 through as a fresh clone", () => {
    const src = new Color3(0.1, 0.2, 0.3);
    const out = parseColorValue(src);
    expect(out).toBeInstanceOf(Color3);
    expect(out).not.toBe(src);
    expect([out.r, out.g, out.b]).toEqual([0.1, 0.2, 0.3]);
  });

  it("reads an [r,g,b] array (0..1)", () => {
    const c = parseColorValue([0.5, 0.25, 0]);
    expect([c.r, c.g, c.b]).toEqual([0.5, 0.25, 0]);
  });

  it("reads a #rrggbb / rrggbb hex string", () => {
    const a = parseColorValue("#ff8000");
    const b = parseColorValue("ff8000");
    expect(a.r).toBeCloseTo(1);
    expect(a.g).toBeCloseTo(0x80 / 255);
    expect(a.b).toBe(0);
    expect([b.r, b.g, b.b]).toEqual([a.r, a.g, a.b]);
  });

  it("reads {r,g,b} and {diffuse:{r,g,b}} objects", () => {
    expect(parseColorValue({ r: 1, g: 0, b: 0 }).r).toBe(1);
    expect(parseColorValue({ diffuse: { r: 0, g: 1, b: 0 } }).g).toBe(1);
  });

  it("returns null for unrecognised input", () => {
    expect(parseColorValue(null)).toBeNull();
    expect(parseColorValue(undefined)).toBeNull();
    expect(parseColorValue("not-a-color")).toBeNull();
    expect(parseColorValue("#fff")).toBeNull(); // 3-digit hex not supported
    expect(parseColorValue([1, 2])).toBeNull();
    expect(parseColorValue(42)).toBeNull();
  });
});
