import { describe, it, expect } from "vitest";
import { traceContours, simplifyPolyline } from "../src/world/contours.js";

const grid = (nx, nz, f) => {
  const field = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) field[j * nx + i] = f(i, j);
  return field;
};

// Signed area (shoelace): > 0 for a counter-clockwise loop in (x, z).
const area = (loop) => loop.reduce((a, p, k) => {
  const q = loop[(k + 1) % loop.length];
  return a + p.x * q.z - q.x * p.z;
}, 0) / 2;

describe("traceContours", () => {
  it("traces a circle as one smooth loop, above-level side on the left", () => {
    const field = grid(41, 41, (i, j) => 10 - Math.hypot(i - 20, j - 20)); // > 0 inside radius 10
    const loops = traceContours(field, 41, 41, 0);
    expect(loops).toHaveLength(1);
    for (const p of loops[0]) expect(Math.hypot(p.x - 20, p.z - 20)).toBeCloseTo(10, 1);
    // Inside on the left of travel ⇒ counter-clockwise.
    expect(area(loops[0])).toBeCloseTo(Math.PI * 100, -1);
  });

  it("traces a ring as two loops, each with the ring on its left", () => {
    // Above level between radius 6 and 12.
    const field = grid(41, 41, (i, j) => 3 - Math.abs(Math.hypot(i - 20, j - 20) - 9));
    const loops = traceContours(field, 41, 41, 0).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
    expect(loops).toHaveLength(2);
    expect(area(loops[0])).toBeGreaterThan(0); // outer, counter-clockwise
    expect(area(loops[1])).toBeLessThan(0);    // inner, clockwise
  });

  it("closes contours that run off the grid along its edge", () => {
    const field = grid(10, 10, (i) => i - 4.5); // above level for i ≥ 5
    const loops = traceContours(field, 10, 10, 0);
    expect(loops).toHaveLength(1);
    expect(area(loops[0])).toBeGreaterThan(0);
    const xs = loops[0].map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(4.5);
    expect(Math.max(...xs)).toBeCloseTo(9);
  });

  it("finds nothing in an all-below field", () => {
    expect(traceContours(grid(5, 5, () => -1), 5, 5, 0)).toEqual([]);
  });
});

describe("simplifyPolyline", () => {
  it("drops points within tolerance of the line, keeps corners and ends", () => {
    const pts = [{ x: 0, z: 0 }, { x: 1, z: 0.01 }, { x: 2, z: 0 }, { x: 2, z: 2 }];
    expect(simplifyPolyline(pts, 0.1)).toEqual([pts[0], pts[2], pts[3]]);
  });
});
