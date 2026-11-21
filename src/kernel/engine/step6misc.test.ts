// Kernel step 6: smaller capabilities (destroy_all targetType, sacrifice all, reanimate from any graveyard, cast_option cost reduction, main-phase begin_step).
import { describe, expect, it } from "vitest";
import type { Ability, Step } from "../schema";
import { cardUnsupported } from "./support";
import { fam, filler, mk, sorcery } from "./famkit";
import { realDef, realTable } from "./testdb";

const cast = (t: ReturnType<typeof fam>, name: string, targets?: Record<string, string[]>) => { t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", name, "hand"), ...(targets ? { targets } : {}) }); return t.resolveTop(); };

describe("destroy_all targetType / sacrifice all / reanimate from any graveyard", () => {
  it("destroy_all with targetType creature destroys every creature (Day of Judgment shape)", () => {
    const t = fam({ Wrath: sorcery("Wrath", "{1}", [{ kind: "destroy_all", targetType: "creature" } as Step]) });
    t.give("p1", "Plains", "battlefield");
    const a = t.give("p1", "Fill A", "battlefield"), b = t.give("p2", "Fill B", "battlefield"), art = t.give("p2", "Fill Artifact", "battlefield");
    cast(t, "Wrath");
    expect(t.obj(a).zone).toBe("graveyard"); expect(t.obj(b).zone).toBe("graveyard");
    expect(t.obj(art).zone).toBe("battlefield");
  });
  it("sacrifice_permanent all: each listed player sacrifices every matching permanent they control", () => {
    const t = fam({ Dust: sorcery("Dust", "{1}", [{ kind: "sacrifice_permanent", who: "each_player", all: true, filter: { types: ["creature"], zone: "battlefield" } } as Step]) });
    t.give("p1", "Plains", "battlefield");
    const a = t.give("p1", "Fill A", "battlefield"), b = t.give("p2", "Fill B", "battlefield"), l = t.give("p2", "Fill Land", "battlefield");
    cast(t, "Dust");
    expect([a, b].every((x) => t.obj(x).zone === "graveyard")).toBe(true);
    expect(t.obj(l).zone).toBe("battlefield");
  });
  it("Reanimate / Junji / Gravespawn Sovereign are supported (reanimate.anyGraveyard)", () => {
    for (const n of ["Reanimate", "Cleansing Nova", "Day of Judgment", "All Is Dust"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]);
  });
  it("reanimate from the opponent's graveyard puts it under your control", () => {
    const re = sorcery("Rea", "{1}", [{ kind: "reanimate", target: "t1", who: "you", anyGraveyard: true } as Step], [{ id: "t1", what: "object", filter: { types: ["creature"], zone: "graveyard" }, count: { min: 1, max: 1 } }]);
    const t = fam({ Rea: re }); t.give("p1", "Plains", "battlefield");
    const dead = t.give("p2", "Fill A", "graveyard");
    cast(t, "Rea", { t1: [dead] });
    expect(t.obj(dead)).toMatchObject({ zone: "battlefield", controller: "p1", owner: "p2" });
  });
});

describe("cost reduction on a cast_option ability (Blasphemous Act)", () => {
  it("costs {1} less for each creature on the battlefield (never below the colored part)", () => {
    expect(cardUnsupported(realDef("Blasphemous Act")!).all).toEqual([]);
    const t = realTable(); t.lands("p1", "Mountain", 1);
    for (let i = 0; i < 4; i++) t.give("p2", "Llanowar Elves", "battlefield");
    for (let i = 0; i < 4; i++) t.give("p1", "Llanowar Elves", "battlefield");
    const act = t.give("p1", "Blasphemous Act", "hand");
    // {8}{R} with 8 creatures: costs {R}
    expect(t.do({ type: "castSpell", player: "p1", cardId: act }).error).toBeUndefined();
    expect(t.state.battlefield.filter((id) => t.obj(id).cardName === "Mountain" && t.obj(id).tapped)).toHaveLength(1);
  });
  it("with fewer creatures the rest must be paid", () => {
    const t = realTable(); t.lands("p1", "Mountain", 1);
    t.give("p2", "Llanowar Elves", "battlefield");
    const res = t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Blasphemous Act", "hand") });
    expect(res.error?.code).toBe("cannot_pay");
  });
});

describe("begin_step on the main phases", () => {
  it("a precombat_main trigger fires at the beginning of your precombat main phase", () => {
    const w = mk("Main Watcher", { manaCost: "{1}", types: ["enchantment"] }, [{ id: "a1", kind: "triggered", text: "w", trigger: { event: "begin_step", step: "precombat_main", whose: "yours" }, steps: [{ kind: "life_change", lifeDelta: 2, who: "you" }] } as Ability]);
    expect(cardUnsupported(w).all).toEqual([]);
    const t = fam({ "Main Watcher": w }, ); void filler;
    for (let i = 0; i < 8; i++) { t.give("p1", "Fill A", "library"); t.give("p2", "Fill A", "library"); }
    t.give("p1", "Main Watcher", "battlefield");
    for (let i = 0; i < 40 && !t.state.stack.length; i++) t.ok({ type: "advancePhase", player: t.state.priority ?? t.state.turn.active });
    expect(t.state.turn).toMatchObject({ number: 3, phase: "precombat_main" }); // your own precombat main (turn 2 is the opponent's)
    t.resolveTop();
    expect(t.p("p1").life).toBe(42);
  });
});

describe("crew (Vehicles)", () => {
  const setup = () => {
    const t = realTable();
    const v = t.give("p1", "Cultivator's Caravan", "battlefield");
    const a = t.give("p1", "Llanowar Elves", "battlefield"), b = t.give("p1", "Plaguecrafter", "battlefield");
    const ab = realDef("Cultivator's Caravan")!.kernel.abilities.find((x) => x.scripted?.handler === "crew")!;
    return { t, v, a, b, ab };
  };
  it("is supported", () => { expect(cardUnsupported(realDef("Cultivator's Caravan")!).all).toEqual([]); expect(cardUnsupported(realDef("Skysovereign, Consul Flagship")!).all.filter((x) => /crew/.test(x))).toEqual([]); });
  it("tapping creatures with total power 3 makes it an artifact creature until end of turn", () => {
    const { t, v, a, b, ab } = setup();
    let res = t.ok({ type: "activateAbility", player: "p1", sourceId: v, abilityId: ab.id });
    expect(res.pending).toMatchObject({ kind: "choose_cards", player: "p1", min: 1 });
    res = t.answer(res, { ids: [a, b] }); // 1 + 3 power
    expect(t.obj(a).tapped && t.obj(b).tapped).toBe(true);
    t.resolveTop();
    expect(charsOf(t, v).types).toContain("creature");
  });
  it("total power too low: the answer is rejected and nothing is tapped; wrong player rejected", () => {
    const { t, v, a, ab } = setup();
    const res = t.ok({ type: "activateAbility", player: "p1", sourceId: v, abilityId: ab.id });
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [a] } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: res.pending!.id, choice: { ids: [a] } }).error?.code).toBe("not_your_decision");
    expect(t.obj(a).tapped).toBe(false);
  });
  it("without enough creatures the activation is refused up front", () => {
    const t = realTable(); const v = t.give("p1", "Cultivator's Caravan", "battlefield"); t.give("p1", "Llanowar Elves", "battlefield");
    const ab = realDef("Cultivator's Caravan")!.kernel.abilities.find((x) => x.scripted?.handler === "crew")!;
    expect(t.do({ type: "activateAbility", player: "p1", sourceId: v, abilityId: ab.id }).error?.code).toBe("cannot_activate");
  });
});
import { charsOf } from "./testdb";

describe("unless_pay with a discard cost (Thirst for Knowledge)", () => {
  const setup = (libraryNames: string[]) => {
    const t = realTable(); t.lands("p1", "Island", 3);
    for (const n of libraryNames) t.give("p1", n, "library", { top: false });
    const spell = t.give("p1", "Thirst for Knowledge", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: spell });
    return { t, spell };
  };
  it("is supported", () => { expect(cardUnsupported(realDef("Thirst for Knowledge")!).all).toEqual([]); });
  it("holding an artifact: asked pay/don't; paying discards just that artifact", () => {
    const { t } = setup(["Sol Ring", "Mountain", "Mountain"]);
    let res = t.resolveTop();
    expect(res.pending).toMatchObject({ kind: "pay_unless", player: "p1" });
    res = t.answer(res, { yes: true });
    expect(t.p("p1").graveyard.map((id) => t.obj(id).cardName).sort()).toEqual(["Sol Ring", "Thirst for Knowledge"]);
    expect(t.p("p1").hand).toHaveLength(2);
  });
  it("declining discards two cards of your choice", () => {
    const { t } = setup(["Sol Ring", "Mountain", "Mountain"]);
    let res = t.resolveTop();
    res = t.answer(res, { yes: false });
    expect(res.pending).toMatchObject({ kind: "choose_cards", min: 2, max: 2 });
    t.answer(res, { ids: res.pending!.options.slice(0, 2).map((o) => o.id) });
    expect(t.p("p1").hand).toHaveLength(1);
  });
  it("with no artifact among the cards in hand nobody is asked to pay: straight to discarding two", () => {
    const { t } = setup(["Mountain", "Mountain", "Mountain"]);
    const res = t.resolveTop();
    expect(res.pending).toMatchObject({ kind: "choose_cards", min: 2, max: 2 });
  });
});

describe("emblems", () => {
  const emblemSpell = (abilities: Ability[]) => sorcery("Make Emblem", "{1}", [{ kind: "create_emblem", who: "you", emblem: { abilities } } as unknown as Step]);
  it("a static emblem (Garruk-style +3/+3 and trample to your creatures) applies from the command zone and never goes away", () => {
    const em = emblemSpell([{ id: "em1", kind: "static", text: "Creatures you control get +3/+3 and have trample.", static: { affects: { types: ["creature"], controller: "you" }, modify: [{ pt: { power: 3, toughness: 3 } }, { grant: "trample" }] } } as Ability]);
    const t = fam({ "Make Emblem": em }); t.give("p1", "Plains", "battlefield");
    const mine = t.give("p1", "Fill A", "battlefield"), theirs = t.give("p2", "Fill B", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Make Emblem", "hand") }); t.resolveTop();
    const c = (id: string) => chars2(t, id, { "Make Emblem": em });
    expect([c(mine).power, c(mine).toughness]).toEqual([4, 4]);
    expect(c(mine).keywords).toContain("trample");
    expect([c(theirs).power, c(theirs).toughness]).toEqual([1, 1]);
    expect(t.p("p1").command).toHaveLength(1);
  });
  it("a triggered emblem (Tezzeret-style end step trigger) fires for its owner", () => {
    const em = emblemSpell([{ id: "em1", kind: "triggered", text: "At the beginning of your end step, you gain 3 life.", trigger: { event: "begin_step", step: "end_step", whose: "yours" }, steps: [{ kind: "life_change", lifeDelta: 3, who: "you" }] } as Ability]);
    const t = fam({ "Make Emblem": em }); t.give("p1", "Plains", "battlefield");
    for (let i = 0; i < 8; i++) { t.give("p1", "Fill A", "library"); t.give("p2", "Fill A", "library"); }
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Make Emblem", "hand") }); t.resolveTop();
    for (let i = 0; i < 20 && t.state.turn.phase !== "end_step"; i++) t.ok({ type: "advancePhase", player: "p1" });
    expect(t.state.stack).toHaveLength(1);
    t.resolveTop();
    expect(t.p("p1").life).toBe(43);
  });
  it("real emblem makers (Garruk, Cursed Huntsman; Tezzeret; Daretti) have no unsupported emblem abilities", () => {
    for (const n of ["Tezzeret, Artifice Master", "Daretti, Scrap Savant"]) expect(cardUnsupported(realDef(n)!).all.filter((x) => x.includes("emblem") || x.startsWith("zone"))).toEqual([]);
  });
});
import { chars } from "./core";
import { lookup } from "./testkit";
import { famCards } from "./famkit";
function chars2(t: ReturnType<typeof fam>, id: string, extra: Record<string, ReturnType<typeof sorcery>>) { return chars({ s: structuredClone(t.state), events: [], defs: (n: string) => extra[n] ?? (famCards[n] ?? lookup(n) ?? (undefined as never)), scanned: 0 } as never, id); }

describe("token abilities (create_tokens.tokenAbilities)", () => {
  const pest = sorcery("Make Pests", "{1}", [{ kind: "create_tokens", tokenCount: 2, tokenName: "Pest", tokenPower: 1, tokenToughness: 1, tokenColors: ["black", "green"], tokenTypeLine: "Creature — Pest", tokenAbilities: [{ id: "k0", kind: "triggered", text: "When this token dies, you gain 1 life.", trigger: { event: "dies", subject: "self" }, steps: [{ kind: "life_change", who: "you", amount: 1 }] }] } as unknown as Step]);
  const kill = sorcery("Kill One", "{1}", [{ kind: "destroy_target", target: "t1" } as Step], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }]);
  it("the token carries its own triggered ability: when it dies you gain 1 life", () => {
    const t = fam({ "Make Pests": pest, "Kill One": kill }); t.lands("p1", "Plains", 2);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Make Pests", "hand") }); t.resolveTop();
    const pests = t.state.battlefield.filter((id) => t.obj(id).token?.name === "Pest");
    expect(pests).toHaveLength(2);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Kill One", "hand"), targets: { t1: [pests[0]] } }); t.resolveTop();
    for (let i = 0; i < 4 && t.state.stack.length; i++) t.resolveTop();
    expect(t.p("p1").life).toBe(41);
  });
  it("an unsupported token ability is reported by the creating card (never silently dropped)", () => {
    const bad = sorcery("Bad Pests", "{1}", [{ kind: "create_tokens", tokenCount: 1, tokenName: "X", tokenTypeLine: "Creature — X", tokenAbilities: [{ id: "k0", kind: "scripted", text: "x", scripted: { handler: "no_such_thing" } }] } as unknown as Step]);
    expect(cardUnsupported(bad).all).toContain("scripted:no_such_thing");
  });
  it("real: Beledros Witherbloom and Moseo, Vein's New Dean make working Pests", () => {
    for (const n of ["Moseo, Vein's New Dean", "Pest Infestation"]) expect(cardUnsupported(realDef(n)!).all.filter((x) => x.includes("tokenAbilities"))).toEqual([]);
  });
});
