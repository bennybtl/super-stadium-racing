import { describe, it, expect } from "vitest";
import { Track } from "../src/world/track.js";
import { TERRAIN_TYPES } from "../src/world/terrain.js";

// A straight terrainPath down the Z axis, 16 wide, centred on x=0.
function makeTrack(extra = {}) {
  const t = new Track("rough test", 160, 160);
  t.features = [
    {
      type: "terrainPath",
      points: [{ x: 0, z: -40 }, { x: 0, z: 40 }],
      width: 16,
      blendWidth: 4,
      cornerRadius: 0,
      closed: false,
      terrainType: TERRAIN_TYPES.MUD,
      ...extra,
    },
  ];
  return t;
}

describe("terrainPath roughness", () => {
  it("adds no height when roughness is unset", () => {
    const t = makeTrack();
    for (const x of [0, 3, -5, 7]) expect(t.getHeightAt(x, 0)).toBeCloseTo(0, 6);
  });

  it("perturbs the ground inside the corridor when roughness is set", () => {
    const t = makeTrack({ roughness: 1 });
    let maxAbs = 0;
    for (let x = -6; x <= 6; x += 0.5) maxAbs = Math.max(maxAbs, Math.abs(t.getHeightAt(x, 0)));
    expect(maxAbs).toBeGreaterThan(0.05);
  });

  it("leaves the ground flat well outside the corridor", () => {
    const t = makeTrack({ roughness: 1 });
    for (const x of [20, -25, 40]) expect(t.getHeightAt(x, 0)).toBeCloseTo(0, 6);
  });

  it("reports a finite height-contribution AABB only when rough", () => {
    expect(makeTrack().getFeatureHeightBounds(makeTrack().features[0]))
      .toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
    const rough = makeTrack({ roughness: 0.5 });
    const b = rough.getFeatureHeightBounds(rough.features[0]);
    // Straight centreline at x=0 from z=-40..40, padded by halfWidth (8) on
    // every side — matching the getHeightAt early-out.
    expect(b.minX).toBeCloseTo(-8, 6);
    expect(b.maxX).toBeCloseTo(8, 6);
    expect(b.minZ).toBeCloseTo(-48, 6);
    expect(b.maxZ).toBeCloseTo(48, 6);
  });
});
