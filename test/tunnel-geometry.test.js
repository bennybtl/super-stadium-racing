import { describe, it, expect } from "vitest";
import {
  deriveTunnel,
  tunnelProfile,
  archContour,
  stationsBetween,
  TUNNEL_PORTAL_SETBACK,
  rasterizeBores,
  sampleBore,
  tunnelPath,
  cutTunnelHeight,
  tunnelCutReach,
  TUNNEL_LINING_THICKNESS,
  TUNNEL_CUT_CLEARANCE,
  TUNNEL_CUT_SIDE_SLOPE,
} from "../src/world/tunnel-geometry.js";
import { Track } from "../src/world/track.js";

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

  it("finds the exact faces, and sets the lining span back from them", () => {
    const t = deriveTunnel(straight(), heightAt);
    // The ridge passes the 6 m crown at |x| = 30, i.e. 20 m and 80 m along.
    expect(t.faces.in).toBeCloseTo(20, 3);
    expect(t.faces.out).toBeCloseTo(80, 3);
    expect(t.span.start).toBeCloseTo(20 - TUNNEL_PORTAL_SETBACK, 3);
    expect(t.span.end).toBeCloseTo(80 + TUNNEL_PORTAL_SETBACK, 3);
  });

  it("spans the whole centreline without portals", () => {
    const t = deriveTunnel(straight({ height: 14 }), heightAt);
    expect(t.faces).toBeNull();
    expect(t.span).toEqual({ start: 0, end: t.total });
  });

  it("interpolates station frames between two distances", () => {
    const t = deriveTunnel(straight({
      points: [{ x: -50, z: 0 }, { x: 0, z: 0, floorY: -3 }, { x: 50, z: 0 }],
    }), heightAt);
    const f = stationsBetween(t, 10.25, 12.5);
    expect(f[0]).toMatchObject({ s: 10.25 });
    expect(f[0].x).toBeCloseTo(-39.75);
    expect(f[0].floorY).toBeCloseTo(-3 * 10.25 / 50);
    expect(f.map((st) => st.s)).toEqual([10.25, 11, 12, 12.5]);
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

describe("rasterizeBores / sampleBore", () => {
  const tunnel = deriveTunnel(straight(), heightAt); // floor 0, portals at |x| ≈ 29–30
  const raster = rasterizeBores([tunnel]);

  it("is null without tunnels", () => {
    expect(rasterizeBores([])).toBeNull();
    expect(rasterizeBores([null])).toBeNull();
    expect(sampleBore(null, 0, 0)).toBeNull();
  });

  it("covers the bore between the portals, with the arch as its ceiling", () => {
    const mid = sampleBore(raster, 0, 0);
    expect(mid.floorY).toBeCloseTo(0);
    expect(mid.ceilingY).toBeCloseTo(6, 1);
    // Near the wall the ceiling drops toward the springline.
    const wall = sampleBore(raster, 0, 4.9);
    expect(wall.ceilingY).toBeLessThan(4);
    expect(wall.ceilingY).toBeGreaterThan(1.9);
  });

  it("stops at the side walls (plus a little of the lining)", () => {
    expect(sampleBore(raster, 0, 5.1)).not.toBeNull();
    expect(sampleBore(raster, 0, 5.6)).toBeNull();
    expect(sampleBore(raster, 0, -5.6)).toBeNull();
  });

  it("covers the lining's span and leaves the cuttings beyond it alone", () => {
    const xin = -50 + tunnel.span.start, xout = -50 + tunnel.span.end;
    expect(sampleBore(raster, xin + 0.1, 0)).not.toBeNull();
    expect(sampleBore(raster, xin - 0.6, 0)).toBeNull();
    expect(sampleBore(raster, xout - 0.1, 0)).not.toBeNull();
    expect(sampleBore(raster, xout + 0.6, 0)).toBeNull();
    expect(sampleBore(raster, -45, 0)).toBeNull();
  });

  it("has no gaps on the outside of a bend", () => {
    const bent = deriveTunnel(straight({
      points: [{ x: -50, z: 0 }, { x: 0, z: 0, radius: 12 }, { x: 0, z: 50 }],
    }), () => 20);
    const r = rasterizeBores([bent]);
    for (const st of bent.stations) {
      for (const u of [-5, -2.5, 0, 2.5, 5]) {
        expect(sampleBore(r, st.x + st.nx * u, st.z + st.nz * u)).not.toBeNull();
      }
    }
  });

  it("reads empty outside its box", () => {
    expect(sampleBore(raster, 500, 500)).toBeNull();
  });
});

describe("cutTunnelHeight", () => {
  const feature = straight();
  const tp = tunnelPath(feature);
  const cut = (x, z) => cutTunnelHeight(tp, feature, x, z, ridge(x), () => [0, 0]);
  const top = 6 + TUNNEL_CUT_CLEARANCE; // headwall top over a floor at 0

  it("levels ground below the headwall top down to the floor across the bore", () => {
    expect(ridge(-33)).toBeGreaterThan(0);
    expect(ridge(-33)).toBeLessThan(top);
    expect(cut(-33, 0)).toBe(0);
    expect(cut(-33, 4.9)).toBe(0);
  });

  it("slopes the cutting's sides and fades out at its reach", () => {
    // 2 m past the bore wall the cap is 2 × slope above the floor.
    expect(cut(-33, 7)).toBeCloseTo(Math.min(ridge(-33), 2 * TUNNEL_CUT_SIDE_SLOPE));
    expect(cut(-33, 5.5)).toBeCloseTo(0.5 * TUNNEL_CUT_SIDE_SLOPE);
    expect(cut(-33, tunnelCutReach(feature) + 0.1)).toBe(ridge(-33));
  });

  it("leaves the hill above the headwall top alone", () => {
    expect(ridge(0)).toBeGreaterThanOrEqual(top);
    expect(cut(0, 0)).toBe(ridge(0));
    expect(cut(-25, 0)).toBe(ridge(-25));
  });

  it("stops square at the drawn ends and never raises ground", () => {
    const tp2 = tunnelPath(straight({ points: [{ x: -30, z: 0 }, { x: 50, z: 0 }] }));
    const cut2 = (x) => cutTunnelHeight(tp2, feature, x, 0, ridge(x), () => [ridge(-30), 0]);
    expect(cut2(-31)).toBe(ridge(-31));
    expect(cutTunnelHeight(tp, feature, -45, 0, -1, () => [0, 0])).toBe(-1);
  });
});

describe("Track with a tunnel", () => {
  // A 12 m square hill across the tunnel, with steep sides.
  const makeTrack = () => {
    const t = new Track("tunnel test", 160, 160);
    t.features = [
      { type: "squareHill", centerX: 0, centerZ: 0, width: 40, depth: 60, height: 12, angle: 0, blendWidth: 0 },
      { type: "tunnel", points: [{ x: -50, z: 0 }, { x: 50, z: 0 }], width: 10, height: 6, cover: 2 },
    ];
    return t;
  };

  it("cuts the approaches to the floor and keeps the hilltop", () => {
    const t = makeTrack();
    const uncut = (x, z) => t._uncutHeightAt(x, z);
    // Find a point on the hill's flank, part way up but under the headwall top.
    let x = -40;
    while (uncut(x, 0) < 3 && x < 0) x += 0.25;
    expect(uncut(x, 0)).toBeLessThan(6 + TUNNEL_CUT_CLEARANCE);
    expect(t.getHeightAt(x, 0)).toBeCloseTo(0);
    expect(t.getHeightAt(0, 0)).toBeCloseTo(12);
    // Beside the cutting the flank is untouched.
    expect(t.getHeightAt(x, 20)).toBeCloseTo(uncut(x, 20));
  });

  it("puts the portal face where the hill rises past the headwall top", () => {
    const t = makeTrack();
    const tunnel = deriveTunnel(t.features[1], (x, z) => t.getHeightAt(x, z));
    const x = -50 + tunnel.faces.in;
    expect(t._uncutHeightAt(x + 0.01, 0)).toBeGreaterThanOrEqual(6 + TUNNEL_CUT_CLEARANCE);
    expect(t._uncutHeightAt(x - 0.01, 0)).toBeLessThan(6 + TUNNEL_CUT_CLEARANCE);
    // In front of the face, back to the lining's start, the cut is at the floor.
    for (let d = 0.05; d <= TUNNEL_PORTAL_SETBACK + 3; d += 0.5) expect(t.getHeightAt(x - d, 0)).toBeCloseTo(0);
  });

  it("bounds the cut for dirty-region terrain rebuilds", () => {
    const t = makeTrack();
    const b = t.getFeatureHeightBounds(t.features[1]);
    const r = tunnelCutReach(t.features[1]);
    expect(b).toEqual({ minX: -50 - r, maxX: 50 + r, minZ: -r, maxZ: r });
  });
});
