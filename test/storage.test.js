import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setItemEvictingCosmetics } from "../src/utils/storage.js";

// Minimal localStorage with a character quota, throwing the browser's
// QuotaExceededError when a write wouldn't fit.
function fakeStorage(quota) {
  const data = new Map();
  const used = () => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const store = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => {
      const next = used() - (data.has(k) ? k.length + data.get(k).length : 0) + k.length + v.length;
      if (next > quota) {
        const e = new Error("quota");
        e.name = "QuotaExceededError";
        throw e;
      }
      data.set(k, String(v));
    },
  };
  // Object.keys(localStorage) lists the stored keys, as in a browser.
  return new Proxy(store, {
    ownKeys: () => [...data.keys()],
    getOwnPropertyDescriptor: (_, k) => (data.has(k) ? { enumerable: true, configurable: true } : undefined),
  });
}

describe("setItemEvictingCosmetics", () => {
  let saved;
  beforeEach(() => { saved = globalThis.localStorage; });
  afterEach(() => { globalThis.localStorage = saved; });

  it("writes normally when there's room", () => {
    globalThis.localStorage = fakeStorage(1000);
    setItemEvictingCosmetics("player_upgrades", "{}");
    expect(localStorage.getItem("player_upgrades")).toBe("{}");
  });

  it("clears tire marks to make room, keeping everything else", () => {
    globalThis.localStorage = fakeStorage(200);
    localStorage.setItem("tireMarks_a", "x".repeat(80));
    localStorage.setItem("tireMarks_b", "x".repeat(80));
    localStorage.setItem("hotlap_laps_a", "keep");
    setItemEvictingCosmetics("player_upgrades", "x".repeat(60));
    expect(localStorage.getItem("player_upgrades")).toHaveLength(60);
    expect(localStorage.getItem("tireMarks_a")).toBeNull();
    expect(localStorage.getItem("hotlap_laps_a")).toBe("keep");
  });

  it("only clears wall wear when tire marks weren't enough", () => {
    globalThis.localStorage = fakeStorage(200);
    localStorage.setItem("tireMarks_a", "x".repeat(40));
    localStorage.setItem("wallWear_a", "x".repeat(100));
    setItemEvictingCosmetics("k", "x".repeat(100));
    expect(localStorage.getItem("wallWear_a")).toBeNull();

    globalThis.localStorage = fakeStorage(200);
    localStorage.setItem("tireMarks_a", "x".repeat(100));
    localStorage.setItem("wallWear_a", "x".repeat(40));
    setItemEvictingCosmetics("k", "x".repeat(100));
    expect(localStorage.getItem("wallWear_a")).toHaveLength(40);
  });

  it("still throws when clearing cosmetics can't make room", () => {
    globalThis.localStorage = fakeStorage(100);
    localStorage.setItem("track_mine", "x".repeat(80));
    expect(() => setItemEvictingCosmetics("k", "x".repeat(50))).toThrow("quota");
    expect(localStorage.getItem("track_mine")).toHaveLength(80);
  });
});
