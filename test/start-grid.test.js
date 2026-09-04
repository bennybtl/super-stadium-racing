import { describe, it, expect } from "vitest";
import {
  gridSlotXZ,
  resolvePoleIndex,
  layoutIndexFor,
  raceIndexFor,
  startGridLayoutSlot,
  startGridSlot,
  MAX_GRID_SLOTS,
} from "../src/utils/start-grid.js";

describe("layoutIndexFor / raceIndexFor", () => {
  it("are inverses for every slot at a few pole positions", () => {
    for (const pole of [0, 1, 3, 9]) {
      for (let layout = 0; layout < MAX_GRID_SLOTS; layout++) {
        expect(layoutIndexFor(raceIndexFor(layout, pole), pole)).toBe(layout);
      }
    }
  });

  it("pole (race index 0) maps to the pole layout slot", () => {
    expect(layoutIndexFor(0, 4)).toBe(4);
    expect(raceIndexFor(4, 4)).toBe(0);
  });

  it("with pole 0, layout and race index coincide", () => {
    for (let i = 0; i < MAX_GRID_SLOTS; i++) {
      expect(layoutIndexFor(i, 0)).toBe(i);
      expect(raceIndexFor(i, 0)).toBe(i);
    }
  });
});

describe("resolvePoleIndex", () => {
  it("clamps a stored poleIndex into range", () => {
    expect(resolvePoleIndex({ poleIndex: -5 })).toBe(0);
    expect(resolvePoleIndex({ poleIndex: 999 })).toBe(MAX_GRID_SLOTS - 1);
    expect(resolvePoleIndex({ poleIndex: 3 })).toBe(3);
  });
  it("defaults a missing poleIndex to 0", () => {
    expect(resolvePoleIndex({})).toBe(0);
    expect(resolvePoleIndex(null)).toBe(0);
  });
});

describe("gridSlotXZ", () => {
  const anchor = { x: 0, z: 0, heading: 0, columns: 2, colSpacing: 4, rowSpacing: 7 };

  it("front row straddles the anchor line", () => {
    const a = gridSlotXZ(0, anchor);
    const b = gridSlotXZ(1, anchor);
    expect(a.x).toBeCloseTo(-2);
    expect(b.x).toBeCloseTo(2);
    expect(a.z).toBeCloseTo(0);
    expect(b.z).toBeCloseTo(0);
  });

  it("later rows sit behind the anchor (−z at heading 0)", () => {
    expect(gridSlotXZ(2, anchor).z).toBeCloseTo(-7);
    expect(gridSlotXZ(4, anchor).z).toBeCloseTo(-14);
  });

  it("respects heading rotation", () => {
    // single column so there's no lateral offset to reason about
    const line = { x: 0, z: 0, heading: Math.PI / 2, columns: 1, rowSpacing: 7 };
    expect(gridSlotXZ(0, line).x).toBeCloseTo(0);
    expect(gridSlotXZ(0, line).z).toBeCloseTo(0);
    // heading +90°: the row that was behind (−z) is now at −x
    const back = gridSlotXZ(1, line);
    expect(back.x).toBeCloseTo(-7);
    expect(back.z).toBeCloseTo(0);
  });
});

describe("startGridLayoutSlot", () => {
  it("uses a hand-placed position in custom mode", () => {
    const feature = { mode: "custom", positions: [{ x: 12, z: 34, heading: 1 }] };
    expect(startGridLayoutSlot(feature, 0)).toEqual({ x: 12, z: 34, heading: 1 });
  });

  it("falls back to the grid formula when a custom slot is missing", () => {
    const feature = { mode: "custom", positions: [], x: 0, z: 0, heading: 0, columns: 2 };
    const slot = startGridLayoutSlot(feature, 1);
    expect(Number.isFinite(slot.x)).toBe(true);
    expect(Number.isFinite(slot.z)).toBe(true);
  });
});

describe("startGridSlot", () => {
  it("routes race index 0 to the configured pole slot", () => {
    const feature = { x: 0, z: 0, heading: 0, columns: 2, colSpacing: 4, poleIndex: 1 };
    expect(startGridSlot(feature, 0)).toEqual(startGridLayoutSlot(feature, 1));
  });
});
