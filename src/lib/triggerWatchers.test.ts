import { describe, expect, it } from "vitest";
import { matchWatcherSubject } from "./triggerWatchers";

const zombie = { id: "z", typeLine: "Creature — Zombie", colors: ["B"] };
const zombieToken = { id: "zt", typeLine: "Token Creature — Zombie", token: true, colors: ["B"] };
const humanWhite = { id: "h", typeLine: "Creature — Human", colors: ["W"] };
const blackHuman = { id: "bh", typeLine: "Creature — Human", colors: ["B"] };

type Subject = { id: string; typeLine: string; token?: boolean; colors?: string[] };

function check(text: string, event: "enters" | "dies", subject: Subject, opts: { source?: string; mine?: boolean; name?: string } = {}) {
  return matchWatcherSubject(text, event, {
    sourceId: opts.source ?? "source",
    sourceName: opts.name ?? "Test Card",
    subject,
    subjectIsControlledBySourceController: opts.mine ?? true
  });
}

describe("matchWatcherSubject — enters", () => {
  it("Champion of the Perished: another Zombie you control (tokens too), not itself, not an opponent's", () => {
    const text = "Whenever another Zombie you control enters, put a +1/+1 counter on this creature.";
    expect(check(text, "enters", zombie)).toBe(true);
    expect(check(text, "enters", zombieToken)).toBe(true);
    expect(check(text, "enters", humanWhite)).toBe(false);
    expect(check(text, "enters", zombie, { mine: false })).toBe(false);
    expect(check(text, "enters", { ...zombie, id: "source" })).toBe(false);
  });

  it("Ayara: herself by short name OR another black creature you control", () => {
    const text = "Whenever Ayara or another black creature you control enters, each opponent loses 1 life and you gain 1 life.";
    const ayara = { id: "ayara", typeLine: "Legendary Creature — Elf Noble", colors: ["B"] };
    const opts = { source: "ayara", name: "Ayara, First of Locthwain" };
    expect(check(text, "enters", ayara, opts)).toBe(true);
    expect(check(text, "enters", blackHuman, opts)).toBe(true);
    expect(check(text, "enters", humanWhite, opts)).toBe(false);
    expect(check(text, "enters", blackHuman, { ...opts, mine: false })).toBe(false);
  });

  it("Noxious Ghoul: this creature or another Zombie (any controller)", () => {
    const text = "Whenever this creature or another Zombie enters, all non-Zombie creatures get -1/-1 until end of turn.";
    expect(check(text, "enters", zombie, { mine: false })).toBe(true);
    expect(check(text, "enters", { ...zombie, id: "source" })).toBe(true);
    expect(check(text, "enters", humanWhite)).toBe(false);
  });

  it("a plain 'a land enters under your control' landfall", () => {
    const text = "Landfall — Whenever a land enters under your control, you gain 1 life.";
    const land = { id: "l", typeLine: "Basic Land — Forest" };
    expect(check(text, "enters", land)).toBe(true);
    expect(check(text, "enters", land, { mine: false })).toBe(false);
  });

  it("returns undefined for a clause it doesn't fully understand (caller falls back)", () => {
    expect(check("Whenever a nonland permanent enters, draw a card.", "enters", zombie)).toBeUndefined();
    expect(check("Flying, vigilance", "enters", zombie)).toBeUndefined();
  });
});

describe("matchWatcherSubject — dies", () => {
  it("Headless Rider: this creature or another NONTOKEN Zombie you control", () => {
    const text = "Whenever Headless Rider or another nontoken Zombie you control dies, create a 2/2 black Zombie creature token.";
    const opts = { source: "rider", name: "Headless Rider" };
    expect(check(text, "dies", zombie, opts)).toBe(true);
    expect(check(text, "dies", zombieToken, opts)).toBe(false);
    expect(check(text, "dies", { id: "rider", typeLine: "Creature — Zombie", token: false, colors: ["B"] }, opts)).toBe(true);
    expect(check(text, "dies", humanWhite, opts)).toBe(false);
  });

  it("Open the Graves / Midnight Reaper: a nontoken creature you control", () => {
    const text = "Whenever a nontoken creature you control dies, create an X/X black Zombie creature token.";
    expect(check(text, "dies", zombie)).toBe(true);
    expect(check(text, "dies", zombieToken)).toBe(false);
    expect(check(text, "dies", zombie, { mine: false })).toBe(false);
  });

  it("Undead Augur: this creature or another Zombie you control", () => {
    const text = "Whenever this creature or another Zombie you control dies, you draw a card and you lose 1 life.";
    expect(check(text, "dies", humanWhite)).toBe(false);
    expect(check(text, "dies", zombie)).toBe(true);
  });

  it("Vengeful Dead: any controller's Zombie", () => {
    const text = "Whenever this creature or another Zombie dies, each opponent loses 1 life.";
    expect(check(text, "dies", zombie, { mine: false })).toBe(true);
  });

  it("Grim Haruspex: another nontoken creature you control", () => {
    const text = "Whenever another nontoken creature you control dies, draw a card.";
    expect(check(text, "dies", zombie)).toBe(true);
    expect(check(text, "dies", { ...zombie, id: "source" })).toBe(false);
    expect(check(text, "dies", zombieToken)).toBe(false);
  });
});

describe("matchWatcherSubject — power and keyword conditions", () => {
  const big = { id: "big", typeLine: "Creature — Dinosaur", power: "6", colors: ["G"], oracleText: "Trample" };
  const small = { id: "small", typeLine: "Creature — Elf", power: "1", colors: ["G"], oracleText: "" };
  const flier = { id: "fl", typeLine: "Creature — Dragon", power: "4", colors: ["R"], oracleText: "Flying" };
  it("Garruk's Packleader: a creature with power 3 or greater entering under your control", () => {
    const text = "Whenever another creature you control with power 3 or greater enters, you may draw a card.";
    expect(check(text, "enters", big)).toBe(true);
    expect(check(text, "enters", small)).toBe(false);
    expect(check(text, "enters", big, { mine: false })).toBe(false);
  });
  it("Dragon Tempest: a creature with flying", () => {
    const text = "Whenever a creature you control with flying enters, it gains haste until end of turn.";
    expect(check(text, "enters", flier)).toBe(true);
    expect(check(text, "enters", big)).toBe(false);
  });
});
