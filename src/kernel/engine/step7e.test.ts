// Kernel step 7, batch E: "also who" steps, mass effects scoped to a player's permanents, new object filters.
import { describe, expect, it } from "vitest";
import type { Step } from "../schema";
import { cardUnsupported } from "./support";
import { fam, famCards, filler, mk, sorcery } from "./famkit";
import { realDef, realTable } from "./testdb";
import type { Table } from "./testkit";

const pass = (t: Table) => { for (let i = 0; i < 20 && t.state.stack.length && !t.state.pending; i++) t.ok({ type: "passPriority", player: t.state.priority! }); };
const cast = (t: Table, name: string, extra: Record<string, unknown> = {}) => { t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", name, "hand"), ...extra }); pass(t); };

describe("alsoWho (you and target opponent each ...)", () => {
  it("Secret Rendezvous / Master of Ceremonies are supported", () => { for (const n of ["Secret Rendezvous", "Master of Ceremonies"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); });
  it("draw: both players draw", () => {
    const t = realTable(["p1", "p2"], famCards); t.lands("p1", "Plains", 5);
    for (const p of ["p1", "p2"]) for (let i = 0; i < 5; i++) t.give(p, "Fill A", "library");
    cast(t, "Secret Rendezvous", { targets: { t1: ["p2"] } });
    expect(t.p("p1").hand).toHaveLength(3); expect(t.p("p2").hand).toHaveLength(3);
  });
  it("create tokens for both players", () => {
    const s = sorcery("Treasure For Two", "{1}", [{ kind: "create_tokens", who: "you", alsoWho: "target_player", tokenCount: 1, tokenName: "Treasure", tokenColors: ["colorless"], tokenTypeLine: "Artifact — Treasure" } as Step], [{ id: "t1", what: "player", count: { min: 1, max: 1 } }]);
    const t = fam({ "Treasure For Two": s }); t.lands("p1", "Plains", 1);
    cast(t, "Treasure For Two", { targets: { t1: ["p2"] } });
    expect(t.state.battlefield.filter((i) => t.obj(i).token && t.obj(i).controller === "p1")).toHaveLength(1);
    expect(t.state.battlefield.filter((i) => t.obj(i).token && t.obj(i).controller === "p2")).toHaveLength(1);
  });
  it("damage to creatures and also to each opponent", () => {
    const s = sorcery("Ping All", "{1}", [{ kind: "damage_target", all: true, filter: { types: ["creature"] }, alsoWho: "each_opponent", amount: 2 } as Step]);
    const t = fam({ "Ping All": s }); t.lands("p1", "Plains", 1);
    const c = t.give("p2", "Big Elf", "battlefield");
    cast(t, "Ping All");
    expect(t.obj(c).damage).toBe(2); expect(t.p("p2").life).toBe(38); expect(t.p("p1").life).toBe(40);
  });
});

describe("mass_pump scoped to a player's permanents", () => {
  const s = sorcery("Shrink Theirs", "{1}", [{ kind: "mass_pump", who: "each_opponent", filter: { types: ["creature"] }, power: -1, toughness: -1, duration: "until_end_of_turn" } as Step]);
  it("only creatures that player controls are affected", () => {
    const t = fam({ "Shrink Theirs": s }); t.lands("p1", "Plains", 1);
    const mine = t.give("p1", "Big Elf", "battlefield"), theirs = t.give("p2", "Big Elf", "battlefield");
    cast(t, "Shrink Theirs");
    expect(t.state.effects.filter((e) => e.objectId === theirs)).toHaveLength(1);
    expect(t.state.effects.filter((e) => e.objectId === mine)).toHaveLength(0);
  });
  it("Silumgar is supported", () => { expect(cardUnsupported(realDef("Silumgar, the Drifting Death")!).all).toEqual([]); });
});

describe("object filters", () => {
  const count = (name: string, f: object) => mk(name, { manaCost: "{1}", types: ["artifact"] }, [{ id: "a1", kind: "activated", text: "t", costs: [{ mana: "{0}" }], timing: { only: [{ check: "controls", filter: f, count: { op: ">=", value: 2 } } as never] }, steps: [{ kind: "life_change", who: "you", lifeDelta: 1 } as Step] }]);
  const gated = (f: object) => { const t = fam({ Gate: count("Gate", f) }); const g = t.give("p1", "Gate", "battlefield"); return { t, g, act: () => t.do({ type: "activateAbility", player: "p1", sourceId: g, abilityId: "a1" }) }; };
  it("hasBasicLandType: a basic land type counts, a nonbasic land without one does not", () => {
    const { t, act } = gated({ types: ["land"], controller: "you", hasBasicLandType: true });
    t.give("p1", "Plains", "battlefield"); t.give("p1", "Fill Land", "battlefield");
    expect(act().error).toBeDefined();
    t.give("p1", "Island", "battlefield");
    expect(act().error).toBeUndefined();
  });
  it("hasBasicLandType false: nonbasic-typed lands", () => {
    const { t, act } = gated({ types: ["land"], controller: "you", hasBasicLandType: false });
    t.give("p1", "Plains", "battlefield"); t.give("p1", "Plains", "battlefield");
    expect(act().error).toBeDefined();
    t.give("p1", "Fill Land", "battlefield"); t.give("p1", "Fill Land", "battlefield");
    expect(act().error).toBeUndefined();
  });
  it("enteredThisTurn follows the turn log", () => {
    const { t, g, act } = gated({ types: ["creature"], controller: "you", enteredThisTurn: true });
    void g;
    const a = t.give("p1", "Fill A", "battlefield"), b = t.give("p1", "Fill B", "battlefield");
    expect(act().error).toBeDefined();
    t.state.turnLog.push({ type: "etb", id: a, ts: 1 }, { type: "etb", id: b, ts: 2 });
    expect(act().error).toBeUndefined();
  });
  it("sameName: three lands with the same name (Endless Atlas)", () => {
    const { t, act } = gated({ types: ["land"], controller: "you", sameName: true });
    t.give("p1", "Plains", "battlefield"); t.give("p1", "Island", "battlefield");
    expect(act().error).toBeDefined();
    t.give("p1", "Plains", "battlefield");
    expect(act().error).toBeUndefined();
  });
  it("sameNameAs: Maelstrom Pulse destroys every permanent with the target's name", () => {
    expect(cardUnsupported(realDef("Maelstrom Pulse")!).all).toEqual([]);
    const t = realTable(["p1", "p2"], famCards); t.lands("p1", "Swamp", 2); t.lands("p1", "Forest", 2);
    const a = t.give("p2", "Fill A", "battlefield"), a2 = t.give("p1", "Fill A", "battlefield"), b = t.give("p2", "Fill B", "battlefield");
    cast(t, "Maelstrom Pulse", { targets: { t1: [a] } });
    expect([t.obj(a).zone, t.obj(a2).zone, t.obj(b).zone]).toEqual(["graveyard", "graveyard", "battlefield"]);
  });
  it("sharesCreatureTypeWith: only creatures sharing a type with the target are destroyed", () => {
    const f = (name: string, sub: string[]) => filler(name, ["creature"], 1, 1, sub);
    const cull = sorcery("Tribal Cull", "{1}", [{ kind: "destroy_all", filter: { types: ["creature"], sharesCreatureTypeWith: "t1" } } as Step], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }]);
    const t = fam({ Elf1: f("Elf1", ["Elf"]), Elf2: f("Elf2", ["Elf", "Druid"]), Goblin: f("Goblin", ["Goblin"]), "Tribal Cull": cull }); t.lands("p1", "Plains", 1);
    const e1 = t.give("p2", "Elf1", "battlefield"), e2 = t.give("p2", "Elf2", "battlefield"), g = t.give("p2", "Goblin", "battlefield");
    cast(t, "Tribal Cull", { targets: { t1: [e1] } });
    expect([t.obj(e1).zone, t.obj(e2).zone, t.obj(g).zone]).toEqual(["graveyard", "graveyard", "battlefield"]);
  });
  it("Boseiju / Endless Atlas / Oran-Rief / Heraldic Banner are supported", () => { for (const n of ["Boseiju, Who Endures", "Endless Atlas", "Oran-Rief, the Vastwood", "Heraldic Banner"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); });
});

describe("determinism (same seed, same answers, same state)", () => {
  it("two identical games with a hideaway-style shuffle end in the same JSON", () => {
    const run = () => {
      const t = realTable(["p1", "p2"], famCards); t.lands("p1", "Forest", 2); t.lands("p1", "Island", 3);
      for (let i = 0; i < 8; i++) t.give("p1", i % 2 ? "Fill A" : "Fill B", "library");
      t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Clifftop Lookout", "hand") }); pass(t);
      return JSON.stringify(t.state);
    };
    expect(run()).toBe(run());
  });
});
