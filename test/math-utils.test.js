import { describe, it, expect } from "vitest";
import { clamp, clamp01, lerp, smoothstep } from "../src/utils/math-utils.js";

describe("clamp", () => {
  it("bounds to [min, max]", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("clamp01", () => {
  it("bounds to [0, 1]", () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });
  it("reads non-finite input as 0", () => {
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
    expect(clamp01("nope")).toBe(0);
  });
});

describe("lerp", () => {
  it("interpolates, unclamped", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 2)).toBe(20);
    expect(lerp(10, 0, 0.25)).toBe(7.5);
  });
});

describe("smoothstep", () => {
  it("clamps to the edges and eases between", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
  });
  it("does not divide by zero when edges coincide", () => {
    expect(Number.isFinite(smoothstep(5, 5, 5))).toBe(true);
  });
});
