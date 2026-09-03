import { describe, it, expect } from "vitest";
import {
  awardRace,
  createChampionship,
  isChampionshipComplete,
  applyRaceResult,
  standings,
} from "../src/managers/ChampionshipStorage.js";

const roster = [
  { id: "player", name: "Player", isPlayer: true, vehicleKey: "baja", colorKey: "red" },
  { id: "ai1", name: "A", vehicleKey: "gila", colorKey: "blue" },
  { id: "ai2", name: "B", vehicleKey: "gila", colorKey: "green" },
];

describe("awardRace", () => {
  it("pays the fixed table for the top 4", () => {
    expect(awardRace(1)).toEqual({ points: 10, purse: 2000 });
    expect(awardRace(4)).toEqual({ points: 2, purse: 250 });
  });
  it("gives every lower finish the consolation tier", () => {
    expect(awardRace(5)).toEqual({ points: 1, purse: 150 });
    expect(awardRace(9)).toEqual({ points: 1, purse: 150 });
  });
});

describe("createChampionship", () => {
  it("seeds every driver to stock and uppercases/clips initials", () => {
    const cup = createChampionship({
      initials: "abcdef",
      calendar: ["t1", "t2"],
      drivers: roster,
    });
    expect(cup.initials).toBe("ABCDE");
    expect(cup.currentRaceIndex).toBe(0);
    expect(cup.drivers).toHaveLength(3);
    for (const d of cup.drivers) {
      expect(d).toMatchObject({ points: 0, money: 0, winnings: 0, upgrades: { nitroCount: 5 } });
    }
    expect(cup.drivers[0]).toMatchObject({ vehicleKey: "baja", colorKey: "red", isPlayer: true });
  });

  it("copies calendar and settings (no aliasing)", () => {
    const calendar = ["t1"];
    const cup = createChampionship({ initials: "AA", calendar, drivers: roster });
    calendar.push("t2");
    expect(cup.calendar).toEqual(["t1"]);
  });
});

describe("applyRaceResult", () => {
  const cup = createChampionship({ initials: "AA", calendar: ["t1", "t2"], drivers: roster });

  it("awards by finishing position and advances the race index", () => {
    const next = applyRaceResult(cup, ["ai1", "player", "ai2"]);
    expect(next.currentRaceIndex).toBe(1);
    const byId = Object.fromEntries(next.drivers.map((d) => [d.id, d]));
    expect(byId.ai1).toMatchObject({ points: 10, money: 2000, winnings: 2000 });
    expect(byId.player).toMatchObject({ points: 7, money: 1000, winnings: 1000 });
    expect(byId.ai2).toMatchObject({ points: 4, money: 500, winnings: 500 });
  });

  it("does not mutate the input state", () => {
    const before = JSON.stringify(cup);
    applyRaceResult(cup, ["player", "ai1", "ai2"]);
    expect(JSON.stringify(cup)).toBe(before);
  });

  it("accumulates across races", () => {
    let s = applyRaceResult(cup, ["player", "ai1", "ai2"]); // player +10/+2000
    s = applyRaceResult(s, ["ai1", "player", "ai2"]); // player +7/+1000
    const player = s.drivers.find((d) => d.id === "player");
    expect(player).toMatchObject({ points: 17, winnings: 3000 });
    expect(s.currentRaceIndex).toBe(2);
  });
});

describe("isChampionshipComplete", () => {
  it("is true once currentRaceIndex reaches calendar length", () => {
    expect(isChampionshipComplete({ currentRaceIndex: 1, calendar: ["a", "b"] })).toBe(false);
    expect(isChampionshipComplete({ currentRaceIndex: 2, calendar: ["a", "b"] })).toBe(true);
  });
});

describe("standings", () => {
  it("sorts by points desc, then winnings desc, without mutating", () => {
    const drivers = [
      { id: "a", points: 10, winnings: 500 },
      { id: "b", points: 17, winnings: 100 },
      { id: "c", points: 10, winnings: 900 },
    ];
    const ranked = standings(drivers).map((d) => d.id);
    expect(ranked).toEqual(["b", "c", "a"]);
    expect(drivers[0].id).toBe("a"); // original order intact
  });
});
