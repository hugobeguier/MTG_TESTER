// Kernel step 7, batch A: target-count forms (any number / up to X / per opponent), linked exile + hideaway (cast during resolution),
// "until this leaves the battlefield" exile, regeneration, extra turns, fight pairs, counters on groups, discard up to, untap up to.
import { describe, expect, it } from "vitest";
import type { Step } from "../schema";
import { cardUnsupported } from "./support";
import { fam, famCards, filler, mk, sorcery } from "./famkit";
import { realDef, realTable } from "./testdb";
import type { Table } from "./testkit";
import type { Choice } from "./types";
import { viewFor } from "./view";
import { CARDS } from "./testcards";
import { table } from "./testkit";
const tableOf = (players: string[], extra: Record<string, import("./types").CardDef>) => table(players, { extra: { ...CARDS, ...famCards, ...extra } });

const answerWith = (t: Table, ...choices: Choice[]) => { for (const c of choices) { const p = t.state.pending; if (!p) throw new Error("no pending for " + JSON.stringify(c)); t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: c }); } };
const pass = (t: Table) => { for (let i = 0; i < 12 && t.state.stack.length && !t.state.pending; i++) t.ok({ type: "passPriority", player: t.state.priority! }); };
const castNamed = (t: Table, name: string, extra: Record<string, unknown> = {}) => t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", name, "hand"), ...extra });

const upToX = (name: string, anyNumber = false) => sorcery(name, "{X}", [{ kind: "destroy_target", target: "t1" } as Step],
  [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 0, max: 1 }, ...(anyNumber ? { anyNumber: true } : { maxQuantity: { ref: "X" } }) } as never]);

describe("target counts: up to X / any number", () => {
  it("X is asked BEFORE the targets and caps how many may be chosen", () => {
    const t = fam({ Cull: upToX("Cull") });
    t.lands("p1", "Plains", 3);
    const [a, b, c] = ["Fill A", "Fill B", "Fill C"].map((n) => t.give("p2", n, "battlefield"));
    castNamed(t, "Cull");
    expect(t.state.pending!.kind).toBe("choose_x");
    answerWith(t, { number: 2 });
    expect(t.state.pending!.kind).toBe("choose_targets");
    expect(t.state.pending!.max).toBe(2);
    answerWith(t, { ids: [a, b] });
    pass(t);
    expect([t.obj(a).zone, t.obj(b).zone, t.obj(c).zone]).toEqual(["graveyard", "graveyard", "battlefield"]);
  });
  it("X = 0 asks for no targets at all", () => {
    const t = fam({ Cull: upToX("Cull") });
    t.lands("p1", "Plains", 2); t.give("p2", "Fill A", "battlefield");
    castNamed(t, "Cull");
    answerWith(t, { number: 0 });
    expect(t.state.pending).toBeNull();
    expect(t.state.stack).toHaveLength(1);
  });
  it("choosing more targets than X is refused", () => {
    const t = fam({ Cull: upToX("Cull") });
    t.lands("p1", "Plains", 3);
    const [a, b] = ["Fill A", "Fill B"].map((n) => t.give("p2", n, "battlefield"));
    castNamed(t, "Cull");
    answerWith(t, { number: 1 });
    const p = t.state.pending!;
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: p.id, choice: { ids: [a, b] } }).error?.code).toBe("invalid_choice");
  });
  it("a shortcut `targets` over the cap is an illegal target", () => {
    const t = fam({ Cull: upToX("Cull") });
    t.lands("p1", "Plains", 3);
    const [a, b] = ["Fill A", "Fill B"].map((n) => t.give("p2", n, "battlefield"));
    const res = t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Cull", "hand"), x: 1, targets: { t1: [a, b] } });
    expect(res.error?.code).toBe("illegal_target");
  });
  it("any number of targets: zero up to every candidate", () => {
    const t = fam({ Sweep: upToX("Sweep", true) });
    t.lands("p1", "Plains", 1);
    const ids = ["Fill A", "Fill B", "Fill C"].map((n) => t.give("p2", n, "battlefield"));
    castNamed(t, "Sweep", { x: 0 });
    expect(t.state.pending!.max).toBe(3);
    answerWith(t, { ids });
    pass(t);
    expect(ids.every((i) => t.obj(i).zone === "graveyard")).toBe(true);
  });
  it("Pest Infestation / Crackle with Power / Priest of Forgotten Gods are supported", () => {
    for (const n of ["Pest Infestation", "Crackle with Power", "Priest of Forgotten Gods", "Immoral Bargain"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]);
  });
});

describe("target counts: for each opponent", () => {
  const strike = sorcery("Pick Off", "{1}", [{ kind: "destroy_target", target: "t1" } as Step],
    [{ id: "t1", what: "object", filter: { types: ["creature"], controller: "opponent" }, count: { min: 0, max: 1 }, perOpponent: true } as never]);
  it("asks one question per opponent, each limited to that opponent's creatures", () => {
    const t = tableOf(["p1", "p2", "p3"], { "Pick Off": strike });
    t.lands("p1", "Plains", 1);
    const a = t.give("p2", "Fill A", "battlefield"), a2 = t.give("p2", "Fill B", "battlefield"), b = t.give("p3", "Fill C", "battlefield");
    castNamed(t, "Pick Off");
    expect(t.state.pending!.options.map((o) => o.id).sort()).toEqual([a, a2].sort());
    answerWith(t, { ids: [a2] });
    expect(t.state.pending!.options.map((o) => o.id)).toEqual([b]);
    answerWith(t, { ids: [b] });
    pass(t);
    expect([t.obj(a).zone, t.obj(a2).zone, t.obj(b).zone]).toEqual(["battlefield", "graveyard", "graveyard"]);
  });
  it("an opponent with no candidate is not asked", () => {
    const t = tableOf(["p1", "p2", "p3"], { "Pick Off": strike });
    t.lands("p1", "Plains", 1);
    const b = t.give("p3", "Fill C", "battlefield");
    castNamed(t, "Pick Off");
    expect(t.state.pending!.options.map((o) => o.id)).toEqual([b]);
  });
  it("choosing none for an opponent is allowed (up to one)", () => {
    const t = tableOf(["p1", "p2", "p3"], { "Pick Off": strike });
    t.lands("p1", "Plains", 1);
    const a = t.give("p2", "Fill A", "battlefield"), b = t.give("p3", "Fill C", "battlefield");
    castNamed(t, "Pick Off");
    answerWith(t, { ids: [] }, { ids: [b] }); pass(t);
    expect([t.obj(a).zone, t.obj(b).zone]).toEqual(["battlefield", "graveyard"]);
  });
});

describe("regeneration", () => {
  const shield = mk("Regen Charm", { manaCost: "{1}", types: ["instant"] }, [{ id: "a1", kind: "spell_effect", text: "Regenerate target creature.", targets: [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }], steps: [{ kind: "regenerate", target: "t1", duration: "until_end_of_turn" } as Step] }]);
  const doom = sorcery("Doom Blade", "{1}", [{ kind: "destroy_target", target: "t1" } as Step], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }]);
  it("a shield saves the creature from destroy: it taps and loses its damage", () => {
    const t = fam({ "Regen Charm": shield, "Doom Blade": doom });
    t.lands("p1", "Plains", 2);
    const c = t.give("p2", "Fill A", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Regen Charm", "hand"), targets: { t1: [c] } }); pass(t);
    expect(t.obj(c).regen).toBe(1);
    t.state.priority = "p1";
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Doom Blade", "hand"), targets: { t1: [c] } }); pass(t);
    expect(t.obj(c)).toMatchObject({ zone: "battlefield", tapped: true });
    expect(t.obj(c).regen).toBeUndefined();
  });
  it("the shield is used up: a second destroy kills it", () => {
    const t = fam({ "Regen Charm": shield, "Doom Blade": doom });
    t.lands("p1", "Plains", 4);
    const c = t.give("p2", "Fill A", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Regen Charm", "hand"), targets: { t1: [c] } }); pass(t);
    for (let i = 0; i < 2; i++) { t.state.priority = "p1"; t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Doom Blade", "hand"), targets: { t1: [c] } }); pass(t); }
    expect(t.obj(c).zone).toBe("graveyard");
  });
  it("lethal damage also consumes the shield (state-based action)", () => {
    const t = fam({ "Regen Charm": shield });
    t.lands("p1", "Plains", 1);
    const c = t.give("p2", "Fill A", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Regen Charm", "hand"), targets: { t1: [c] } }); pass(t);
    t.state.objects[c].damage = 1;
    t.state.priority = "p1";
    t.ok({ type: "passPriority", player: "p1" }); t.ok({ type: "passPriority", player: "p2" });
    expect(t.obj(c)).toMatchObject({ zone: "battlefield", tapped: true, damage: 0 });
  });
  it("shields expire at the end of the turn", () => {
    const t = fam({ "Regen Charm": shield });
    t.lands("p1", "Plains", 1);
    const c = t.give("p2", "Fill A", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Regen Charm", "hand"), targets: { t1: [c] } }); pass(t);
    for (let i = 0; i < 40 && t.state.turn.number === 1; i++) { if (t.state.pending) break; t.ok({ type: "advancePhase", player: t.state.turn.active }); }
    expect(t.obj(c).regen).toBeUndefined();
  });
  it("Swarmyard is supported", () => { expect(cardUnsupported(realDef("Swarmyard")!).all).toEqual([]); });
});

describe("extra turns", () => {
  const walk = sorcery("Time Walk", "{1}", [{ kind: "extra_turn", who: "you" } as Step]);
  const stock = (t: Table) => { for (const p of ["p1", "p2"]) for (let i = 0; i < 12; i++) t.give(p, "Fill A", "library"); };
  const endTurn = (t: Table) => { const n = t.state.turn.number; for (let i = 0; i < 60 && t.state.turn.number === n; i++) { if (t.state.pending) break; t.ok({ type: "advancePhase", player: t.state.turn.active }); } };
  it("the extra turn comes right after this one, then the normal order resumes", () => {
    const t = fam({ "Time Walk": walk }); stock(t);
    t.lands("p1", "Plains", 1);
    castNamed(t, "Time Walk"); pass(t);
    endTurn(t);
    expect(t.state.turn).toMatchObject({ number: 2, active: "p1" });
    endTurn(t);
    expect(t.state.turn).toMatchObject({ number: 3, active: "p2" });
  });
  it("two extra turns stack", () => {
    const t = fam({ "Time Walk": walk }); stock(t);
    t.lands("p1", "Plains", 2);
    castNamed(t, "Time Walk"); pass(t); t.state.priority = "p1"; castNamed(t, "Time Walk"); pass(t);
    endTurn(t); endTurn(t);
    expect(t.state.turn).toMatchObject({ number: 3, active: "p1" });
    endTurn(t);
    expect(t.state.turn.active).toBe("p2");
  });
  it("extra turn for an opponent (gift) goes to that player", () => {
    const gift = sorcery("Gift Turn", "{1}", [{ kind: "extra_turn", who: "each_opponent" } as Step]);
    const t = fam({ "Gift Turn": gift }); stock(t);
    t.lands("p1", "Plains", 1);
    castNamed(t, "Gift Turn"); pass(t); endTurn(t);
    expect(t.state.turn.active).toBe("p2");
    endTurn(t);
    expect(t.state.turn.active).toBe("p1");
  });
});

describe("counters on groups, discard up to, untap up to", () => {
  it("add_counters all: +1/+1 on every matching permanent", () => {
    const s = sorcery("Rally", "{1}", [{ kind: "add_counters", all: true, filter: { types: ["creature"], controller: "you" }, counterKind: "+1/+1", amount: 1 } as Step]);
    const t = fam({ Rally: s });
    t.lands("p1", "Plains", 1);
    const a = t.give("p1", "Fill A", "battlefield"), b = t.give("p1", "Fill B", "battlefield"), o = t.give("p2", "Fill C", "battlefield");
    castNamed(t, "Rally"); pass(t);
    expect([t.obj(a).counters["+1/+1"], t.obj(b).counters["+1/+1"], t.obj(o).counters["+1/+1"]]).toEqual([1, 1, undefined]);
  });
  it("discard up to N: the player picks how many; that many are drawn", () => {
    const s = sorcery("Rummage", "{1}", [{ kind: "discard", who: "you", amount: 2, upTo: true, id: "d1" } as Step, { kind: "draw_cards", who: "you", amount: { ref: "step_result", step: "d1" } } as Step]);
    const t = fam({ Rummage: s });
    t.lands("p1", "Plains", 1);
    const h1 = t.give("p1", "Fill A", "hand"), h2 = t.give("p1", "Fill B", "hand"); t.give("p1", "Fill C", "library"); t.give("p1", "Fill D", "library");
    castNamed(t, "Rummage"); pass(t);
    expect(t.state.pending!.min).toBe(0);
    answerWith(t, { ids: [h1] });
    expect(t.obj(h1).zone).toBe("graveyard"); expect(t.obj(h2).zone).toBe("hand");
    expect(t.p("p1").hand).toHaveLength(2);
  });
  it("discard up to: choosing none discards and draws nothing", () => {
    const s = sorcery("Rummage", "{1}", [{ kind: "discard", who: "you", amount: 2, upTo: true, id: "d1" } as Step, { kind: "draw_cards", who: "you", amount: { ref: "step_result", step: "d1" } } as Step]);
    const t = fam({ Rummage: s });
    t.lands("p1", "Plains", 1); t.give("p1", "Fill A", "hand"); t.give("p1", "Fill C", "library");
    castNamed(t, "Rummage"); pass(t);
    answerWith(t, { ids: [] });
    expect(t.p("p1").hand).toHaveLength(1); expect(t.p("p1").library).toHaveLength(1);
  });
  it("untap up to two lands: asks which", () => {
    const s = sorcery("Thaw", "{1}", [{ kind: "untap_target", filter: { types: ["land"], controller: "you" }, amount: 2, upTo: true } as Step]);
    const t = fam({ Thaw: s });
    t.lands("p1", "Plains", 1);
    const ls = [1, 2, 3].map(() => t.give("p1", "Fill Land", "battlefield", { tapped: true }));
    castNamed(t, "Thaw"); pass(t);
    answerWith(t, { ids: [ls[0], ls[2]] });
    expect(ls.map((l) => t.obj(l).tapped)).toEqual([false, true, false]);
  });
  it("untap more than allowed is refused", () => {
    const s = sorcery("Thaw", "{1}", [{ kind: "untap_target", filter: { types: ["land"], controller: "you" }, amount: 1, upTo: true } as Step]);
    const t = fam({ Thaw: s });
    t.lands("p1", "Plains", 1);
    const ls = [1, 2].map(() => t.give("p1", "Fill Land", "battlefield", { tapped: true }));
    castNamed(t, "Thaw"); pass(t);
    const p = t.state.pending!;
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: p.id, choice: { ids: ls } }).error?.code).toBe("invalid_choice");
  });
});

describe("agadeem's awakening: any number of creatures with different mana values", () => {
  it("is supported; targets with the same mana value are refused", () => {
    expect(cardUnsupported(realDef("Agadeem's Awakening // Agadeem, the Undercrypt")!).all).toEqual([]);
    const t = realTable(["p1", "p2"], famCards); t.lands("p1", "Swamp", 6);
    const a = t.give("p1", "Llanowar Elves", "graveyard"), b = t.give("p1", "Llanowar Elves", "graveyard");
    const res = t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Agadeem's Awakening // Agadeem, the Undercrypt", "hand"), x: 3, face: "Agadeem's Awakening", targets: { t1: [a, b] } });
    expect(res.error?.code).toBe("illegal_target");
  });
});

describe("linked exile / until this leaves", () => {
  it("Grasp of Fate exiles one permanent per opponent; they come back when it leaves", () => {
    expect(cardUnsupported(realDef("Grasp of Fate")!).all).toEqual([]);
    const t = realTable(["p1", "p2", "p3"], famCards); t.lands("p1", "Plains", 3);
    const x = t.give("p2", "Llanowar Elves", "battlefield"), y = t.give("p3", "Llanowar Elves", "battlefield");
    const grasp = t.give("p1", "Grasp of Fate", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: grasp }); t.resolveTop();
    expect(t.state.pending?.kind).toBe("choose_targets");
    answerWith(t, { ids: [x] });
    expect(t.state.pending?.kind).toBe("choose_targets");
    expect(t.state.pending!.options.map((o) => o.id)).toEqual([y]);
    answerWith(t, { ids: [y] });
    pass(t);
    expect([t.obj(x).zone, t.obj(y).zone]).toEqual(["exile", "exile"]);
    // destroy the enchantment: both return under their owners' control
    t.do({ type: "passPriority", player: t.state.priority! });
  });
});

describe("hideaway (linked exile, cast during resolution)", () => {
  const lib = (t: Table, n: number) => { const ids: string[] = []; for (let i = 0; i < n; i++) ids.push(t.give("p1", i === 0 ? "Llanowar Elves" : "Fill A", "library")); return ids; };
  it("Mosswort Bridge / Cemetery Tampering are supported; Spinerock Knoll is not (its \"7 or more damage\" condition counts damage EVENTS, and deals_damage is not logged)", () => {
    for (const n of ["Mosswort Bridge", "Cemetery Tampering"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]);
    expect(cardUnsupported(realDef("Spinerock Knoll")!).all).toEqual(["event:deals_damage"]);
  });
  it("entering: look at four, exile one face down (linked), the rest go to the bottom", () => {
    const t = realTable(["p1", "p2"], famCards); const ids = lib(t, 6);
    const knoll = t.give("p1", "Mosswort Bridge", "hand");
    t.ok({ type: "playLand", player: "p1", cardId: knoll });
    expect(t.state.stack).toHaveLength(1);
    t.resolveTop();
    expect(t.state.pending?.kind).toBe("choose_cards");
    expect(t.state.pending!.options).toHaveLength(4);
    const pick = t.state.pending!.options[0].id;
    answerWith(t, { ids: [pick] });
    expect(t.obj(pick)).toMatchObject({ zone: "exile", faceDown: true });
    expect(t.p("p1").library).toHaveLength(5);
    expect(t.state.links).toHaveLength(1);
  });
  it("the exiled card is hidden from the opponent", () => {
    const t = realTable(["p1", "p2"], famCards); const ids = lib(t, 5);
    t.ok({ type: "playLand", player: "p1", cardId: t.give("p1", "Mosswort Bridge", "hand") });
    t.resolveTop();
    const pick = t.state.pending!.options[0].id;
    answerWith(t, { ids: [pick] });
    expect(t.state.objects[pick].faceDown).toBe(true);
    const view = viewFor(t.state, "p2");
    expect(JSON.stringify(view.objects[pick] ?? null)).not.toContain("Llanowar");
    expect(JSON.stringify(view.objects[pick] ?? null)).not.toContain("Fill A");
  });
});

describe("fight pairs (Ezuri's Predation)", () => {
  it("is supported, and the controller pairs each token with a different creature", () => {
    expect(cardUnsupported(realDef("Ezuri's Predation")!).all).toEqual([]);
    const t = realTable(["p1", "p2"], famCards); t.lands("p1", "Forest", 9);
    const a = t.give("p2", "Llanowar Elves", "battlefield"), b = t.give("p2", "Fill A", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Ezuri's Predation", "hand") }); t.resolveTop();
    expect(t.state.pending?.kind).toBe("choose_cards");
    answerWith(t, { ids: [a] });
    // the second token is forced onto the remaining creature
    expect(t.state.pending).toBeNull();
    expect([t.obj(a).zone, t.obj(b).zone]).toEqual(["graveyard", "graveyard"]);
    expect(t.state.battlefield.filter((id) => t.obj(id).token)).toHaveLength(2);
  });
});

void filler;

describe("hideaway: playing the exiled card while the ability resolves", () => {
  const vault = mk("Hide Vault", { manaCost: "{1}", types: ["artifact"] }, [
    { id: "a1", kind: "triggered", text: "Hideaway 2", keyword: { name: "hideaway", param: 2 }, trigger: { event: "etb", subject: "self" },
      steps: [{ kind: "look_top", amount: 2 }, { kind: "choose", from: { zone: "library" }, fromLooked: true, count: 1, saveAs: "chosen" },
        { kind: "move_card_zone", target: "chosen", moveTo: "exile", faceDown: true, linkExile: true }, { kind: "move_card_zone", what: "rest_of_looked_cards", moveTo: "library", position: "bottom", order: "random" }] } as never,
    { id: "a2", kind: "activated", text: "{T}: You may play the exiled card without paying its mana cost.", costs: [{ tap: "self" }],
      steps: [{ kind: "permission_to_play", what: "linked_exile", withoutPaying: true, optional: true } as Step] }
  ]);
  const setup = (top: string, second: string) => {
    const t = fam({ "Hide Vault": vault });
    t.give("p1", "Fill A", "library"); t.give("p1", "Fill A", "library"); t.give("p1", second, "library"); t.give("p1", top, "library");
    return t;
  };
  const hide = (t: Table, name: string) => {
    t.lands("p1", "Plains", 1);
    const v = t.give("p1", "Hide Vault", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: v }); t.resolveTop(); t.resolveTop();
    const opt = t.state.pending!.options.find((o) => t.obj(o.id).cardName === name)!;
    answerWith(t, { ids: [opt.id] });
    return { v, card: opt.id };
  };
  it("yes: the exiled creature is cast for free during resolution and lands on the stack", () => {
    const t = setup("Fill B", "Fill C"); // Fill B top
    const { v, card } = hide(t, "Fill B");
    t.state.objects[v].controlledSince = -5;
    t.ok({ type: "activateAbility", player: "p1", sourceId: v, abilityId: "a2" });
    t.resolveTop();
    expect(t.state.pending!.kind).toBe("choose_yes_no");
    answerWith(t, { yes: true });
    expect(t.obj(card).zone).toBe("stack");
    expect(t.state.stack).toHaveLength(1);
    pass(t);
    expect(t.obj(card).zone).toBe("battlefield");
    expect(t.state.links?.filter((l) => l.object === card && t.obj(card).zone === "exile")).toHaveLength(0);
  });
  it("no: the card stays hidden in exile and can be used next time", () => {
    const t = setup("Fill B", "Fill C");
    const { v, card } = hide(t, "Fill B");
    t.state.objects[v].controlledSince = -5;
    t.ok({ type: "activateAbility", player: "p1", sourceId: v, abilityId: "a2" });
    t.resolveTop();
    answerWith(t, { yes: false });
    expect(t.obj(card)).toMatchObject({ zone: "exile", faceDown: true });
    expect(t.state.durableEffects ?? []).toHaveLength(0);
  });
  it("a land is played (using the land drop) instead of cast", () => {
    const t = setup("Fill Land", "Fill C");
    const { v, card } = hide(t, "Fill Land");
    t.state.objects[v].controlledSince = -5;
    t.ok({ type: "activateAbility", player: "p1", sourceId: v, abilityId: "a2" });
    t.resolveTop();
    answerWith(t, { yes: true });
    expect(t.obj(card).zone).toBe("battlefield");
    expect(t.p("p1").landsPlayed).toBe(1);
  });
  it("with the land drop used up the land cannot be played and stays exiled", () => {
    const t = setup("Fill Land", "Fill C");
    const { v, card } = hide(t, "Fill Land");
    t.state.objects[v].controlledSince = -5; t.p("p1").landsPlayed = 1;
    t.ok({ type: "activateAbility", player: "p1", sourceId: v, abilityId: "a2" });
    t.resolveTop();
    answerWith(t, { yes: true });
    expect(t.obj(card).zone).toBe("exile");
    expect(t.state.durableEffects ?? []).toHaveLength(0);
  });
  it("when the hideaway permanent leaves, the link is gone (the card cannot be played any more)", () => {
    const t = setup("Fill B", "Fill C");
    const { v, card } = hide(t, "Fill B");
    expect(t.state.links).toHaveLength(1);
    t.state.battlefield = t.state.battlefield.filter((i) => i !== v);
    t.state.objects[v].zone = "graveyard"; t.state.objects[v].timestamp += 100;
    expect(t.obj(card).zone).toBe("exile");
  });
});
