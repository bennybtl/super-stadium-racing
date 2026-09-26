import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  encodeTireMarkStreaks,
  decodeTireMarkStreaks,
  loadTireMarkStreaks,
  saveTireMarkStreaks,
  deleteTireMarkStreaks,
} from "../src/managers/TireMarksStorage.js";

// IndexedDB stand-in: CacheStore's API over one in-memory map.
const cache = new Map();
vi.mock("../src/managers/CacheStore.js", () => ({
  TIRE_MARKS_STORE: "tireMarks",
  cacheGet: async (store, key) => cache.get(`${store}/${key}`),
  cachePut: async (store, key, value) => { cache.set(`${store}/${key}`, value); },
  cacheDelete: async (store, key) => { cache.delete(`${store}/${key}`); },
}));

const HALF = 0.18;

// A streak shaped like the game writes them: 0.5 m steps, a turning heading,
// offsets = halfWidth × (cos, −sin) of the heading, alpha fading in and out.
function makeStreak(x, z, heading, turn, n) {
  const points = [];
  for (let i = 0; i < n; i++) {
    heading += turn;
    x += Math.sin(heading) * 0.5;
    z += Math.cos(heading) * 0.5;
    points.push({
      x, z,
      offsetX: Math.cos(heading) * HALF,
      offsetZ: -Math.sin(heading) * HALF,
      alpha: i === 0 || i === n - 1 ? 0 : 0.75,
    });
  }
  return { points };
}

function expectClose(actual, expected) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((s, si) => {
    expect(actual[si].points).toHaveLength(s.points.length);
    s.points.forEach((p, pi) => {
      const q = actual[si].points[pi];
      expect(Math.abs(q.x - p.x)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(q.z - p.z)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(q.offsetX - p.offsetX)).toBeLessThanOrEqual(0.002);
      expect(Math.abs(q.offsetZ - p.offsetZ)).toBeLessThanOrEqual(0.002);
      expect(Math.abs(q.alpha - p.alpha)).toBeLessThanOrEqual(0.005);
    });
  });
}

describe("tire-mark encoding", () => {
  it("round-trips within 1 cm / 2 mm / 1%", () => {
    const streaks = [makeStreak(-70.3, 55.1, 0.4, 0.05, 40), makeStreak(12, -80, -2, -0.08, 12)];
    expectClose(decodeTireMarkStreaks(encodeTireMarkStreaks(streaks)), streaks);
  });

  it("survives the heading wrapping past ±π", () => {
    // Starts just under +π and keeps turning, so atan2 flips to −π mid-streak.
    const streaks = [makeStreak(0, 0, Math.PI - 0.3, 0.1, 30)];
    expectClose(decodeTireMarkStreaks(encodeTireMarkStreaks(streaks)), streaks);
  });

  it("handles no streaks and empty streaks", () => {
    expect(decodeTireMarkStreaks(encodeTireMarkStreaks([]))).toEqual([]);
    expect(decodeTireMarkStreaks(encodeTireMarkStreaks([{ points: [] }]))).toEqual([{ points: [] }]);
  });

  it("is about 10× smaller than the schema-1 JSON", () => {
    const round = (v) => Math.round(v * 1000) / 1000;
    const streaks = Array.from({ length: 100 }, (_, i) => makeStreak(i, -i, i * 0.3, 0.04, 40));
    const v1 = JSON.stringify({
      version: 1,
      streaks: streaks.map((s) => ({ points: s.points.map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, round(v)]))) })),
    });
    const v2 = encodeTireMarkStreaks(streaks);
    expect(v2.length * 8).toBeLessThan(v1.length);
  });

  it("throws on truncated data", () => {
    const data = encodeTireMarkStreaks([makeStreak(0, 0, 0, 0.1, 20)]);
    expect(() => decodeTireMarkStreaks(data.slice(0, 12))).toThrow();
  });
});

describe("tire-mark storage", () => {
  beforeEach(() => cache.clear());

  it("saves and loads a track", async () => {
    const streaks = [makeStreak(5, 5, 1, 0.02, 20), makeStreak(-3, 9, 2, -0.05, 8)];
    await saveTireMarkStreaks("oval", streaks);
    expect(cache.get("tireMarks/oval").bytes).toBeInstanceOf(Uint8Array);
    expectClose(await loadTireMarkStreaks("oval"), streaks);
  });

  it("snapshots the streaks when saving", async () => {
    const streaks = [makeStreak(0, 0, 0, 0.02, 10)];
    const saving = saveTireMarkStreaks("oval", streaks);
    streaks.push(makeStreak(9, 9, 1, 0.02, 10));
    await saving;
    expect(await loadTireMarkStreaks("oval")).toHaveLength(1);
  });

  it("resolves [] for missing, unknown-schema or corrupt saves, and after delete", async () => {
    expect(await loadTireMarkStreaks("none")).toEqual([]);
    cache.set("tireMarks/old", { version: 1, streaks: [] });
    expect(await loadTireMarkStreaks("old")).toEqual([]);
    cache.set("tireMarks/bad", { version: 2, bytes: Uint8Array.from([5, 0xff]) });
    expect(await loadTireMarkStreaks("bad")).toEqual([]);
    await saveTireMarkStreaks("oval", [makeStreak(0, 0, 0, 0.02, 10)]);
    await deleteTireMarkStreaks("oval");
    expect(await loadTireMarkStreaks("oval")).toEqual([]);
  });
});
