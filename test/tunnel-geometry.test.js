import { describe, it, expect } from "vitest";
import {
  deriveTunnel,
  tunnelProfile,
  archContour,
  TUNNEL_LINING_THICKNESS,
} from "../src/world/tunnel-geometry.js";

// A ridge along Z: 12 m tall across |x| < 20, sloping to 0 by |x| = 40.
const ridge = (x) => {
  const d = Math.abs(x);
  if (d < 20) return 12;
  if (d > 40) return 0;
  return 12 * (40 - d) / 20;
};
const heightAt = (x) => ridge(x);

const straight = (extra = {}) => ({
  type: "tunnel",
  points: [{ x: -50, z: 0 }, { x: 50, z: 0 }],
  width: 10, height: 6, cover: 2,
  ...extra,
});

describe("tunnelProfile / archContour", () => {
  it("is a semicircle over walls when tall enough, flatter otherwise", () => {
    expect(tunnelProfile(10, 8)).toEqual({ halfWidth: 5, springY: 3, archRise: 5 });
    const flat = tunnelProfile(10, 4);
    expect(flat.springY).toBeCloseTo(1.4);
    expect(flat.springY + flat.archRise).toBeCloseTo(4);
  });

  it("runs left foot → crown → right foot, same count when grown", () => {
    const p = tunnelProfile(10, 6);
    const inner = archContour(p);
    const outer = archContour(p, 0.6);
    expect(inner).toHaveLength(outer.length);
    expect(inner[0]).toEqual({ u: 5, v: 0 });
    expect(inner[inner.length - 1]).toEqual({ u: -5, v: 0 });
    const crown = inner[Math.floor(inner.length / 2)];
    expect(crown.u).toBeCloseTo(0);
    expect(crown.v).toBeCloseTo(6);
    expect(Math.max(...outer.map((q) => q.v))).toBeCloseTo(6.6);
  });
});

describe("deriveTunnel", () => {
  it("returns null without two points", () => {
    expect(deriveTunnel({ points: [{ x: 0, z: 0 }] }, heightAt)).toBeNull();
    expect(deriveTunnel({ points: [{ x: 0, z: 0 }, { x: 0, z: 0 }] }, heightAt)).toBeNull();
  });

  it("stations every ~1 m with left-pointing normals", () => {
    const t = deriveTunnel(straight(), heightAt);
    expect(t.total).toBeCloseTo(100);
    expect(t.stations).toHaveLength(101);
    expect(t.stations[0]).toMatchObject({ x: -50, z: 0, s: 0 });
    // The tangent rotated +90° in XZ, (−tz, tx): (0, 1) travelling +X.
    expect(t.stations[10].nx).toBeCloseTo(0);
    expect(t.stations[10].nz).toBeCloseTo(1);
  });

  it("ramps the floor between the terrain at the ends", () => {
    const t = deriveTunnel(straight(), (x) => (x < 0 ? 0 : 2));
    expect(t.stations[0].floorY).toBe(0);
    expect(t.stations[t.stations.length - 1].floorY).toBe(2);
  });

  it("finds the portals where the terrain first rises over the crown", () => {
    const t = deriveTunnel(straight(), heightAt);
    // Crown 6 m over a floor at 0: the ridge passes 6 m at |x| = 30.
    const xin = t.stations[t.portals.in].x;
    const xout = t.stations[t.portals.out].x;
    expect(xin).toBeGreaterThan(-30);
    expect(xin).toBeLessThanOrEqual(-29);
    expect(xout).toBeGreaterThanOrEqual(29);
    expect(xout).toBeLessThan(30);
  });

  it("has no portals when the hill never clears the crown", () => {
    const t = deriveTunnel(straight({ height: 14 }), heightAt);
    expect(t.portals).toBeNull();
    expect(t.lowCover.every((f) => !f)).toBe(true);
  });

  it("doesn't flag the ramps up from the portals", () => {
    const t = deriveTunnel(straight(), heightAt);
    expect(t.lowCover.some(Boolean)).toBe(false);
  });

  it("flags a dip in the hill between the portals", () => {
    // A 6 m-wide notch in the ridge top, down to 7 m: above the crown (6) but
    // under the 6 + lining + 2 of cover wanted.
    const notched = (x) => (Math.abs(x) < 3 ? 7 : ridge(x));
    const t = deriveTunnel(straight(), notched);
    const need = 6 + TUNNEL_LINING_THICKNESS + 2;
    t.stations.forEach((st, k) => {
      expect(t.lowCover[k]).toBe(Math.abs(st.x) < 3 && st.groundY < need);
    });
    expect(t.lowCover.some(Boolean)).toBe(true);
  });

  it("flags portal to portal when the hill never reaches full cover", () => {
    const t = deriveTunnel(straight(), (x) => ridge(x) * 0.6); // tops out at 7.2
    const flagged = t.lowCover.map((f, k) => (f ? k : -1)).filter((k) => k >= 0);
    expect(flagged[0]).toBe(t.portals.in);
    expect(flagged[flagged.length - 1]).toBe(t.portals.out);
  });

  it("lets a control point pin the floor", () => {
    const t = deriveTunnel(straight({
      points: [{ x: -50, z: 0 }, { x: 0, z: 0, floorY: -3 }, { x: 50, z: 0 }],
    }), heightAt);
    const at = (x) => t.stations.find((st) => Math.abs(st.x - x) < 0.51).floorY;
    expect(at(0)).toBeCloseTo(-3);
    expect(at(-25)).toBeCloseTo(-1.5);
    expect(at(50)).toBeCloseTo(0);
  });
});
