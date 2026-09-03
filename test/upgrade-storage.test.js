import { describe, it, expect } from "vitest";
import { applyPurchase, getUpgradeCatalog } from "../src/managers/UpgradeStorage.js";

const stock = { nitroCount: 5 };

describe("applyPurchase", () => {
  it("buys a stat upgrade, deducts its cost, bumps its level", () => {
    const res = applyPurchase(stock, 1000, "topSpeed");
    expect(res.ok).toBe(true);
    expect(res.money).toBe(0);
    expect(res.upgrades.topSpeed).toBe(1);
  });

  it("rejects when short on money, leaving state untouched", () => {
    const res = applyPurchase(stock, 999, "topSpeed");
    expect(res).toMatchObject({ ok: false, reason: "Not enough money", money: 999 });
    expect(res.upgrades.topSpeed).toBeUndefined();
  });

  it("rejects an unknown upgrade id", () => {
    expect(applyPurchase(stock, 9999, "wings").ok).toBe(false);
  });

  it("caps a stat upgrade at maxLevel (6)", () => {
    const maxed = applyPurchase({ ...stock, tires: 6 }, 100000, "tires");
    expect(maxed).toMatchObject({ ok: false, reason: "Already maxed" });
  });

  it("treats nitro as a consumable count with a 99 ceiling", () => {
    const res = applyPurchase({ nitroCount: 5 }, 100, "nitro");
    expect(res.ok).toBe(true);
    expect(res.upgrades.nitroCount).toBe(6);
    expect(applyPurchase({ nitroCount: 99 }, 100, "nitro").ok).toBe(false);
  });

  it("does not mutate the passed-in upgrade object", () => {
    const input = { nitroCount: 5, topSpeed: 1 };
    const snap = JSON.stringify(input);
    applyPurchase(input, 5000, "topSpeed");
    expect(JSON.stringify(input)).toBe(snap);
  });
});

describe("getUpgradeCatalog", () => {
  it("marks affordability against an explicit balance + upgrade state", () => {
    const catalog = getUpgradeCatalog({ balance: 600, upgrades: { nitroCount: 5, tires: 2 } });
    const byId = Object.fromEntries(catalog.map((u) => [u.id, u]));
    expect(byId.tires).toMatchObject({ level: 2, affordable: true });   // cost 500
    expect(byId.topSpeed).toMatchObject({ level: 0, affordable: false }); // cost 1000
  });

  it("ignoreBalance makes everything not-yet-maxed affordable", () => {
    const catalog = getUpgradeCatalog({ ignoreBalance: true, upgrades: { nitroCount: 99, suspension: 6 } });
    const byId = Object.fromEntries(catalog.map((u) => [u.id, u]));
    expect(byId.topSpeed.affordable).toBe(true);
    expect(byId.nitro.affordable).toBe(false);      // at the 99 ceiling
    expect(byId.suspension.affordable).toBe(false); // at maxLevel
  });
});
