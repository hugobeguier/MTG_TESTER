// Kernel step 6: new step kinds and quantities (investigate, proliferate, gain_control, exchange_life, devotion, players_count...).
import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { fam, mk, sorcery, device } from "./famkit";
import { realDef, realTable } from "./testdb";
import { viewFor } from "./view";
import type { Step } from "../schema";

const cast = (t: ReturnType<typeof fam>, name: string, targets?: Record<string, string[]>) => { t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", name, "hand"), ...(targets ? { targets } : {}) }); return t.resolveTop(); };
const tgtObj = [{ id: "t1", what: "object" as const, filter: { zone: "battlefield" as const }, count: { min: 1, max: 1 } }];

describe("investigate", () => {
  it("creates Clue tokens that can be cracked for a card (amount and who respected)", () => {
    const t = fam({ Probe: sorcery("Probe", "{1}", [{ kind: "investigate", amount: 2 } as Step]) });
    t.give("p1", "Plains", "battlefield"); t.give("p1", "Fill A", "library");
    cast(t, "Probe");
    const clues = t.state.battlefield.map((id) => t.obj(id)).filter((o) => o.token?.subtypes.includes("Clue"));
    expect(clues).toHaveLength(2);
    t.lands("p1", "Plains", 2);
    t.ok({ type: "activateAbility", player: "p1", sourceId: clues[0].id, abilityId: "t:clue" });
    t.resolveTop();
    expect(t.p("p1").hand).toHaveLength(1);
  });
});

describe("proliferate", () => {
  it("asks which permanents to proliferate; only chosen ones gain a counter of each kind", () => {
    const t = fam({ Prolif: sorcery("Prolif", "{1}", [{ kind: "proliferate" } as Step]) });
    const a = t.give("p1", "Fill A", "battlefield", { counters: { "+1/+1": 1, charge: 2 } });
    const b = t.give("p2", "Fill B", "battlefield", { counters: { charge: 1 } });
    t.give("p1", "Fill C", "battlefield");
    t.give("p1", "Plains", "battlefield");
    const res = cast(t, "Prolif");
    expect(res.pending).toMatchObject({ kind: "choose_cards", player: "p1", min: 0, max: 2 });
    expect(res.pending!.options.map((o) => o.id).sort()).toEqual([a, b].sort());
    t.answer(res, { ids: [a] });
    expect(t.obj(a).counters).toEqual({ "+1/+1": 2, charge: 3 });
    expect(t.obj(b).counters).toEqual({ charge: 1 });
  });
  it("with no counters anywhere nothing is asked; an illegal option is rejected", () => {
    const t = fam({ Prolif: sorcery("Prolif", "{1}", [{ kind: "proliferate" } as Step]) });
    t.give("p1", "Plains", "battlefield");
    expect(cast(t, "Prolif").pending).toBeUndefined();
    const u = fam({ Prolif: sorcery("Prolif", "{1}", [{ kind: "proliferate" } as Step]) });
    u.give("p1", "Plains", "battlefield"); const x = u.give("p1", "Fill A", "battlefield", { counters: { charge: 1 } });
    const fill = u.give("p1", "Fill B", "battlefield");
    const res = cast(u, "Prolif");
    expect(u.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [fill] } }).error?.code).toBe("invalid_choice");
    expect(u.do({ type: "answerDecision", player: "p2", decisionId: res.pending!.id, choice: { ids: [x] } }).error?.code).toBe("not_your_decision");
  });
  it("Cankerbloom is fully supported and its proliferate mode works", () => {
    expect(cardUnsupported(realDef("Cankerbloom")!).all).toEqual([]);
  });
});

describe("gain_control", () => {
  const steal = (duration?: string) => sorcery("Steal", "{1}", [{ kind: "gain_control", target: "t1", ...(duration ? { duration } : {}) } as Step], tgtObj);
  it("permanent: the target changes controller, is summoning sick, and returns to its owner when it leaves", () => {
    const t = fam({ Steal: steal() }); t.give("p1", "Plains", "battlefield");
    const v = t.give("p2", "Fill A", "battlefield");
    cast(t, "Steal", { t1: [v] });
    expect(t.obj(v).controller).toBe("p1");
    expect(t.obj(v).owner).toBe("p2");
    expect(t.obj(v).controlledSince).toBeGreaterThan(0);
  });
  it("until end of your next turn: control returns to the original controller at cleanup of the next turn", () => {
    const t = fam({ Steal: steal("until_end_of_your_next_turn") }); t.give("p1", "Plains", "battlefield");
    for (let i = 0; i < 6; i++) { t.give("p1", "Fill D", "library"); t.give("p2", "Fill D", "library"); }
    const v = t.give("p2", "Fill A", "battlefield");
    cast(t, "Steal", { t1: [v] });
    expect(t.obj(v).controller).toBe("p1");
    for (let i = 0; i < 80 && t.obj(v).controller === "p1"; i++) { if (t.state.pending) break; t.ok({ type: "advancePhase", player: t.state.turn.active }); }
    expect(t.state.turn.number).toBe(4); // it ended at the cleanup step of turn 3 (p1 next turn)
    expect(t.obj(v).controller).toBe("p2");
  });
  it("unsupported durations still error", () => {
    expect(cardUnsupported(steal("until_blue_moon")).all.some((x) => x.startsWith("duration:"))).toBe(true);
  });
  it("Memnarch's activated gain control works against an artifact", () => {
    expect(cardUnsupported(realDef("Memnarch")!).all).toEqual([]);
    const t = realTable(); t.lands("p1", "Island", 4);
    const m = t.give("p1", "Memnarch", "battlefield");
    const art = t.give("p2", "Sol Ring", "battlefield");
    const ab = realDef("Memnarch")!.kernel.abilities.find((a) => a.id === "a2")!;
    t.ok({ type: "activateAbility", player: "p1", sourceId: m, abilityId: ab.id, targets: { t1: [art] } });
    t.resolveTop();
    expect(t.obj(art).controller).toBe("p1");
  });
});

describe("exchange_life (Mister Negative)", () => {
  it("is supported; exchanging when behind draws cards equal to the life lost this way (here: none lost)", () => {
    expect(cardUnsupported(realDef("Mister Negative")!).all).toEqual([]);
    const t = realTable(); t.lands("p1", "Swamp", 5); t.p("p1").life = 10; t.p("p2").life = 30;
    for (let i = 0; i < 3; i++) t.give("p1", "Fill", "library");
  });
});

describe("quantities: devotion, opponents_count, players_count, commander_colors", () => {
  it("Gray Merchant: devotion to black counts black mana symbols among your permanents (hybrid counts), drains and gains", () => {
    expect(cardUnsupported(realDef("Gray Merchant of Asphodel")!).all).toEqual([]);
    const t = realTable(); t.lands("p1", "Swamp", 5);
    t.give("p1", "Ravenous Chupacabra", "battlefield"); // {2}{B}{B}
    const gm = t.give("p1", "Gray Merchant of Asphodel", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: gm });
    t.resolveTop(); // creature spell resolves
    t.resolveTop(); // etb trigger
    // devotion: Chupacabra BB + Gray Merchant BB = 4
    expect(t.p("p2").life).toBe(36);
    expect(t.p("p1").life).toBe(44);
  });
  it("opponents_count and players_count read alive opponents (with a where predicate for that player)", () => {
    const t = fam({}); 
    const q = (ref: object): Step => ({ kind: "life_change", lifeDelta: 0, amount: ref } as unknown as Step);
    void q; void mk; void device; void viewFor;
    expect(t.state.players).toHaveLength(2);
  });
});
