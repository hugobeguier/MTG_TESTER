// Observer round 1: mana payments the kernel used to refuse (cannot_pay) although the legacy engine paid them legally.
//   - "{1}, {T}: Add {U}{R}" sources (Signets) are used by the automatic payment, their {1} paid out of the other sources' mana
//   - "add {B} for each Swamp you control" (Cabal Coffers style) is read when the ability is used
//   - Mycosynth Lattice: any mana pays a colored symbol (for every player)
//   - Forsaken Monument: tapping a permanent for {C} adds one more {C}
//   - an object filter with colors: ["colorless"] matches colorless objects
import { describe, expect, it } from "vitest";
import type { Ability } from "../schema";
import { chars } from "./core";
import type { Run } from "./core";
import type { CardDef } from "./types";
import { defs } from "./testcards";
import { cardUnsupported } from "./support";
import { fam, famCards, mk } from "./famkit";
import type { Table } from "./testkit";

const rock = (name: string, produces: string, costs: Ability["costs"] = [{ tap: "self" }], types = ["artifact"]) =>
  mk(name, { manaCost: "{2}", types }, [{ id: "a1", kind: "mana", text: `Add ${produces}`, costs, mana: { produces: [{ colors: produces }] } } as Ability]);
const spell = (name: string, cost: string) => mk(name, { manaCost: cost, types: ["sorcery"] }, [{ id: "a1", kind: "spell_effect", text: name, steps: [] }]);
const lattice = mk("Test Lattice", { manaCost: "{4}", types: ["artifact"] }, [{ id: "a1", kind: "static", text: "Players may spend mana as though it were mana of any color.", static: { affects: "each_player", modify: [{ grant: "spend mana as though it were mana of any color" }] } } as Ability]);
const monument = mk("Test Monument", { manaCost: "{4}", types: ["artifact"] }, [
  { id: "a1", kind: "triggered", text: "Whenever you tap a permanent for {C}, add an additional {C}.", trigger: { event: "tap", subject: { types: ["permanent"], controller: "you" } }, scripted: { handler: "tapped_for_colorless_mana" }, steps: [{ kind: "add_mana", produces: [{ colors: "{C}" }] }] } as Ability,
  { id: "a2", kind: "static", text: "Colorless creatures you control get +2/+2.", static: { affects: { types: ["creature"], colors: ["colorless"], controller: "you" }, modify: [{ pt: { power: 2, toughness: 2 } }] } } as Ability
]);
const cards = {
  "Test Signet": rock("Test Signet", "{U}{R}", [{ mana: "{1}" }, { tap: "self" }]),
  "Test Rock": rock("Test Rock", "{C}{C}"),
  "Test Coffers": mk("Test Coffers", { types: ["land"] }, [{ id: "a1", kind: "mana", text: "{2}, {T}: Add {B} for each Swamp you control.", costs: [{ mana: "{2}" }, { tap: "self" }], mana: { produces: [{ perCount: { subtypes: ["Swamp"], controller: "you" }, color: "{B}" }] } } as Ability]),
  "Test Lattice": lattice, "Test Monument": monument,
  "Blue Red Three": spell("Blue Red Three", "{2}{U}{R}"), "Double Blue": spell("Double Blue", "{U}{U}"), "Three": spell("Three", "{3}"), "Four": spell("Four", "{4}"), "Pay B": spell("Pay B", "{B}{B}{B}{B}{B}{B}"),
  "Real Red": mk("Real Red", { manaCost: "{R}", types: ["creature"], power: 2, toughness: 2 }, []),
  "Colorless Bear": mk("Colorless Bear", { types: ["creature"], power: 2, toughness: 2 }, [])
};
const cast = (t: Table, name: string, extra: object = {}) => t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", name, "hand"), ...extra });

describe("automatic payment with paid mana sources", () => {
  it("a Signet turns the mana of the other sources into {U}{R} (net gain): 3 lands + Signet pay {2}{U}{R}", () => {
    const t = fam(cards);
    t.give("p1", "Island", "battlefield"); t.give("p1", "Mountain", "battlefield"); t.give("p1", "Plains", "battlefield"); const sig = t.give("p1", "Test Signet", "battlefield");
    const res = cast(t, "Blue Red Three");
    expect(res.error).toBeUndefined();
    expect(t.state.objects[sig].tapped).toBe(true);
    expect(t.state.battlefield.filter((id) => t.state.objects[id].tapped)).toHaveLength(4);
  });
  it("a Signet alone (nothing to pay its {1}) pays nothing", () => {
    const t = fam(cards);
    t.give("p1", "Test Signet", "battlefield");
    expect(cast(t, "Double Blue").error?.code).toBe("cannot_pay");
  });
  it("a paid source is only used when it is a net gain", () => {
    const t = fam(cards);
    t.give("p1", "Island", "battlefield"); t.give("p1", "Plains", "battlefield"); t.give("p1", "Test Signet", "battlefield");
    expect(cast(t, "Four").error?.code).toBe("cannot_pay"); // Island + Plains + Signet make at most 3 mana (net +1), {4} is out of reach
  });
});

describe("per-count mana", () => {
  it("{2}, {T}: Add {B} for each Swamp you control pays six black with four Swamps and two other lands", () => {
    const t = fam(cards);
    for (let i = 0; i < 4; i++) t.give("p1", "Swamp", "battlefield");
    t.give("p1", "Test Coffers", "battlefield"); t.give("p1", "Plains", "battlefield"); t.give("p1", "Plains", "battlefield");
    // Swamps B,B,B,B + (2 Plains pay the Coffers {2}) => Coffers adds BBBB (four Swamps) : plenty for BBBBBB? 4 + 4 = 8 black, 6 needed
    expect(cast(t, "Pay B").error).toBeUndefined();
  });
});

describe("Mycosynth Lattice (any mana pays colored symbols)", () => {
  it("two Mountains pay {U}{U} while a Lattice is in play, for either player", () => {
    const t = fam(cards);
    t.lands("p1", "Mountain", 2); t.give("p2", "Test Lattice", "battlefield");
    expect(cast(t, "Double Blue").error).toBeUndefined();
  });
  it("without it the same payment is refused", () => {
    const t = fam(cards);
    t.lands("p1", "Mountain", 2);
    expect(cast(t, "Double Blue").error?.code).toBe("cannot_pay");
  });
});

describe("Forsaken Monument", () => {
  it("tapping a permanent for {C} adds one more {C}: a {C}{C} rock pays {3}", () => {
    const t = fam(cards);
    t.give("p1", "Test Rock", "battlefield"); t.give("p1", "Test Monument", "battlefield");
    expect(cast(t, "Three").error).toBeUndefined();
  });
  it("without a Monument the rock only pays two", () => {
    const t = fam(cards);
    t.give("p1", "Test Rock", "battlefield");
    expect(cast(t, "Three").error?.code).toBe("cannot_pay");
  });
  it("colors: [\"colorless\"] matches a colorless creature and not a red one (+2/+2)", () => {
    const t = fam(cards);
    const a = t.give("p1", "Colorless Bear", "battlefield");
    t.give("p1", "Test Monument", "battlefield");
    const run = { s: structuredClone(t.state), events: [], defs: (n: string) => (cards as Record<string, CardDef>)[n] ?? famCards[n] ?? defs(n), scanned: 0 } as unknown as Run;
    expect(chars(run, a)).toMatchObject({ power: 4, toughness: 4 });
  });
  it("a creature with a color is not colorless", () => {
    const t = fam(cards);
    const id = t.give("p1", "Real Red", "battlefield"); t.give("p1", "Test Monument", "battlefield");
    const run = { s: structuredClone(t.state), events: [], defs: (n: string) => (cards as Record<string, CardDef>)[n] ?? famCards[n] ?? defs(n), scanned: 0 } as unknown as Run;
    expect(chars(run, id).colors).toEqual(["R"]);
    expect(chars(run, id)).toMatchObject({ power: 2, toughness: 2 });
  });
});

describe("improvise pays for X too (CR 702.126a)", () => {
  const xImp = mk("X Improviser", { manaCost: "{X}{R}", types: ["sorcery"] }, [
    { id: "k", kind: "keyword", text: "Improvise", keyword: { name: "improvise" }, scripted: { handler: "improvise" } } as Ability,
    { id: "a1", kind: "spell_effect", text: "gain life", steps: [{ kind: "life_change", who: "you", lifeDelta: 1 }] } as Ability
  ]);
  it("two artifacts and a Mountain pay {X}{R} with X=2", () => {
    const t = fam({ ...cards, "X Improviser": xImp });
    t.give("p1", "Mountain", "battlefield");
    const arts = [t.give("p1", "Fill Artifact", "battlefield"), t.give("p1", "Fill Artifact", "battlefield")];
    const res = t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "X Improviser", "hand"), x: 2, improvise: arts });
    expect(res.error).toBeUndefined();
    expect(arts.every((a) => t.state.objects[a].tapped)).toBe(true);
  });
  it("one artifact is not enough for X=2", () => {
    const t = fam({ ...cards, "X Improviser": xImp });
    t.give("p1", "Mountain", "battlefield");
    const res = t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "X Improviser", "hand"), x: 2, improvise: [t.give("p1", "Fill Artifact", "battlefield")] });
    expect(res.error?.code).toBe("cannot_pay");
  });
});

describe("experience counters on a player", () => {
  const gain = mk("Gain Experience", { manaCost: "{1}", types: ["sorcery"] }, [{ id: "a1", kind: "spell_effect", text: "You get two experience counters.", steps: [{ kind: "add_counters", on: "you", counterKind: "experience", amount: 2 }] } as Ability]);
  const lifeByExperience = mk("Experience Life", { manaCost: "{1}", types: ["sorcery"] }, [{ id: "a1", kind: "spell_effect", text: "Double your experience counters.", steps: [{ kind: "add_counters", on: "you", counterKind: "experience", amount: { ref: "counters", kind: "experience", on: "you" } }] } as Ability]);
  it("add_counters on you puts counters on the player, and the quantity reads them", () => {
    const t = fam({ "Gain Experience": gain, "Experience Life": lifeByExperience });
    t.lands("p1", "Island", 3);
    expect(cardUnsupported(gain).all).toEqual([]);
    expect(cast(t, "Gain Experience").error).toBeUndefined(); t.resolveTop();
    expect(t.p("p1").counters).toEqual({ experience: 2 });
    expect(cast(t, "Experience Life").error).toBeUndefined(); t.resolveTop();
    expect(t.p("p1").counters).toEqual({ experience: 4 }); // the quantity read the 2 counters on the player
  });
});

describe("cast triggers without a subject (\"whose\")", () => {
  const watcher = (whose: string) => mk("Cast Watcher", { manaCost: "{2}", types: ["enchantment"] }, [{ id: "a1", kind: "triggered", text: "Whenever you cast your first spell each turn, you gain 1 life.", trigger: { event: "cast", whose, nth: { n: 1, per: "turn" } }, steps: [{ kind: "life_change", who: "you", lifeDelta: 1 }] } as Ability]);
  const settle = (t: Table) => { for (let i = 0; i < 6 && t.state.stack.length; i++) t.resolveTop(); };
  it("whose: yours fires for the first spell of the turn only", () => {
    const t = fam({ ...cards, "Cast Watcher": watcher("yours") });
    t.give("p1", "Cast Watcher", "battlefield"); t.lands("p1", "Island", 8);
    const life = t.p("p1").life;
    expect(cast(t, "Three").error).toBeUndefined(); settle(t);
    expect(t.p("p1").life).toBe(life + 1);
    expect(cast(t, "Three").error).toBeUndefined(); settle(t);
    expect(t.p("p1").life).toBe(life + 1);
  });
  it("whose: opponents does not fire for my own spell", () => {
    const t = fam({ ...cards, "Cast Watcher": watcher("opponents") });
    t.give("p1", "Cast Watcher", "battlefield"); t.lands("p1", "Island", 3);
    const life = t.p("p1").life;
    expect(cast(t, "Three").error).toBeUndefined(); settle(t);
    expect(t.p("p1").life).toBe(life);
  });
});
