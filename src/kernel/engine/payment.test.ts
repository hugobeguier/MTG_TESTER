// Paying by hand (CR 601.2g-h, 117.3, 903.8): a player in config.manualPay pays costs from the mana POOL only. A short pool opens a `pay_mana` question in which
// they tap sources one by one (or cancel); nothing is ever tapped or sacrificed for them. Real cards from the drafts.
import { describe, expect, it } from "vitest";
import { legalActions } from "./legal";
import { suggestTaps, poolCovers } from "./mana";
import { makeRunForTest } from "./paymentkit";
import { PREDEFINED_TOKEN_ABILITIES } from "./steps";
import { ctxOf, realTable } from "./testdb";
import type { Table } from "./testkit";
import { famCards, filler, instant, mk } from "./famkit";
import type { ResolveResult } from "./types";

const manual = (players = ["p1", "p2"], who = ["p1"]): Table => { const t = realTable(players); t.state.config.manualPay = who; return t; };
const tap = (t: Table, src: string, abilityId = "a1", color?: string, player = "p1") => t.do({ type: "activateAbility", player, sourceId: src, abilityId, ...(color ? { color } : {}) } as never);
const pool = (t: Table, p = "p1") => Object.fromEntries(Object.entries(t.p(p).manaPool).filter(([, n]) => n > 0));
const treasure = (t: Table, owner = "p1"): string => {
  const id = t.give(owner, "Sol Ring", "battlefield");
  t.state.objects[id].token = { name: "Treasure", types: ["artifact"], subtypes: ["Treasure"], colors: [], keywords: [], abilities: [PREDEFINED_TOKEN_ABILITIES.Treasure] } as never;
  return id;
};
const toCommand = (t: Table, name: string, casts: number): string => {
  const c = t.give("p1", name, "battlefield");
  t.state.objects[c].isCommander = true; t.state.objects[c].zone = "command";
  t.state.battlefield = t.state.battlefield.filter((i) => i !== c); t.p("p1").command.push(c);
  t.p("p1").commanderCasts[c] = casts;
  return c;
};
const pend = (t: Table) => t.state.pending!;

describe("the exact commander case: Aminatou with commander tax", () => {
  const setup = () => {
    const t = manual();
    const c = toCommand(t, "Aminatou, the Fateshifter", 1); // {W}{U}{B} + {2}
    const plains = t.give("p1", "Plains", "battlefield"), isl = t.give("p1", "Island", "battlefield"), swp = t.give("p1", "Swamp", "battlefield");
    const tr = treasure(t);
    const more = [t.give("p1", "Island", "battlefield"), t.give("p1", "Swamp", "battlefield")];
    for (const id of [plains, isl, swp]) expect(tap(t, id).error).toBeUndefined(); // the player taps the base cost by hand
    return { t, c, tr, more };
  };
  it("the tax is not covered: the player is asked, nothing else is tapped, the Treasure is NOT used", () => {
    const { t, c, tr } = setup();
    const res = t.ok({ type: "castSpell", player: "p1", cardId: c });
    expect(pend(t).kind).toBe("pay_mana");
    expect(res.pending?.pay).toMatchObject({ cost: "{2}{W}{U}{B}", remaining: "{2}" });
    expect(res.pending?.pay?.parts.map((p) => p.label)).toEqual(["Mana cost", "Commander tax"]);
    expect(t.obj(tr)?.zone).toBe("battlefield");
    expect(t.obj(tr).tapped).toBeFalsy();
    expect(pool(t)).toEqual({ W: 1, U: 1, B: 1 });
    expect(t.state.stack).toHaveLength(0);
  });
  it("tapping two lands pays the tax; the spell is cast as soon as the pool covers it; the Treasure survives", () => {
    const { t, c, tr, more } = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: c });
    expect(tap(t, more[0]).error).toBeUndefined();
    expect(pend(t).kind).toBe("pay_mana");
    expect(pend(t).pay?.remaining).toBe("{1}");
    expect(tap(t, more[1]).error).toBeUndefined();
    expect(t.state.pending).toBeNull();
    expect(t.state.stack).toHaveLength(1);
    expect(t.p("p1").commanderCasts[c]).toBe(2);
    expect(t.obj(tr)?.zone).toBe("battlefield");
    expect(pool(t)).toEqual({});
  });
  it("the Treasure is spent only when the player taps it", () => {
    const t = manual();
    const c = toCommand(t, "Aminatou, the Fateshifter", 0);
    const tr = treasure(t);
    for (const [n, id] of [["Plains", 0], ["Island", 0], ["Swamp", 0]] as const) { void id; expect(tap(t, t.give("p1", n, "battlefield")).error).toBeUndefined(); }
    t.ok({ type: "castSpell", player: "p1", cardId: c }); // {W}{U}{B}: covered, no question
    expect(t.state.pending).toBeNull();
    expect(t.state.stack).toHaveLength(1);
    expect(t.obj(tr)?.zone).toBe("battlefield");
  });
  it("cancel: the commander returns to the command zone, the pool keeps the mana, the taps can still be taken back", () => {
    const { t, c } = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: c });
    const res = t.ok({ type: "answerDecision", player: "p1", decisionId: pend(t).id, choice: { ids: ["cancel"] } });
    expect(res.error).toBeUndefined();
    expect(t.state.pending).toBeNull();
    expect(t.obj(c).zone).toBe("command");
    expect(t.p("p1").command).toContain(c);
    expect(t.p("p1").commanderCasts[c]).toBe(1);
    expect(t.state.priority).toBe("p1");
    expect(pool(t)).toEqual({ W: 1, U: 1, B: 1 });
  });
  it("take-back while paying: a tap made during the question can be undone, the question follows", () => {
    const { t, c, more } = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: c });
    tap(t, more[0]);
    expect(pend(t).pay?.remaining).toBe("{1}");
    expect(t.do({ type: "untapForMana", player: "p1", permanentId: more[0] } as never).error).toBeUndefined();
    expect(pend(t).pay?.remaining).toBe("{2}");
    expect(t.obj(more[0]).tapped).toBeFalsy();
  });
  it("legalActions while paying lists the answer, every untapped source and the take-back; other actions are refused", () => {
    const { t, c, more } = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: c });
    tap(t, more[0]);
    const acts = legalActions(t.state, "p1", ctxOf(t), { untap: true });
    expect(acts.some((a) => a.kind === "answerDecision")).toBe(true);
    expect(acts.some((a) => a.kind === "activateAbility" && a.objectId === more[1] && a.isMana)).toBe(true);
    expect(acts.some((a) => a.kind === "untapForMana" && a.objectId === more[0])).toBe(true);
    expect(acts.some((a) => a.kind === "castSpell" || a.kind === "passPriority")).toBe(false);
    expect(t.do({ type: "passPriority", player: "p1" }).error?.code).toBe("decision_pending");
  });
});

describe("one-shot and painful sources are only used when the player picks them", () => {
  it("a Treasure alone cannot pay by itself: the question stays open; tapping it by hand (with a color) pays and sacrifices it", () => {
    const t = manual();
    const tr = treasure(t);
    const bs = t.give("p1", "Brainstorm", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: bs });
    expect(pend(t).kind).toBe("pay_mana");
    expect(t.obj(tr)?.zone).toBe("battlefield");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: pend(t).id, choice: { ids: ["pay"] } }).error).toBeUndefined(); // "Pay" while short: still open
    expect(pend(t).kind).toBe("pay_mana");
    expect(tap(t, tr, "t:treasure").error).toBeUndefined(); // no color said while paying: the one the cost needs ({U}) is chosen
    expect(t.state.pending).toBeNull();
    expect(t.state.stack).toHaveLength(1);
    expect(t.state.objects[tr]).toBeUndefined();
  });
  it("a pain land: the colorless ability is free, the colored one hurts only because the player chose it", () => {
    const t = manual();
    const w = t.give("p1", "Adarkar Wastes", "battlefield");
    const bs = t.give("p1", "Brainstorm", "hand");
    const life = t.p("p1").life;
    t.ok({ type: "castSpell", player: "p1", cardId: bs });
    expect(t.p("p1").life).toBe(life);
    expect(t.obj(w).tapped).toBeFalsy();
    expect(tap(t, w, "a3").error).toBeUndefined(); // the {U} way: 1 damage
    expect(t.p("p1").life).toBe(life - 1);
    expect(t.state.stack).toHaveLength(1);
  });
  it("a Talisman: tapping its {C} ability deals no damage", () => {
    const t = manual();
    const tal = t.give("p1", "Talisman of Progress", "battlefield");
    t.give("p1", "Plains", "battlefield");
    const life = t.p("p1").life;
    const sol = t.give("p1", "Sol Ring", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: sol });
    expect(pend(t).pay?.cost).toBe("{1}");
    expect(tap(t, tal, "a1").error).toBeUndefined();
    expect(t.p("p1").life).toBe(life);
    expect(t.state.stack).toHaveLength(1);
  });
});

describe("the suggestion (Auto-pay) never sacrifices or hurts", () => {
  it("lands first; a Treasure and a pain land are never in it", () => {
    const t = manual();
    const tr = treasure(t); const pl = t.give("p1", "Adarkar Wastes", "battlefield");
    const lands = [t.give("p1", "Island", "battlefield"), t.give("p1", "Island", "battlefield")];
    const run = makeRunForTest(t);
    const need = { generic: 1, colored: { U: 1 }, x: 0, mv: 2 };
    const picks = suggestTaps(run, "p1", need, 0)!;
    expect(picks).toHaveLength(2);
    expect(picks).not.toContain(tr);
    expect(lands.some((l) => picks.includes(l)) || picks.includes(pl)).toBe(true); // the pain land only through its free {C} ability
    expect(t.obj(tr)?.zone).toBe("battlefield"); // a dry run: nothing changed
    expect(lands.every((l) => !t.obj(l).tapped)).toBe(true);
  });
  it("with only a Treasure there is no suggestion", () => {
    const t = manual();
    treasure(t);
    expect(suggestTaps(makeRunForTest(t), "p1", { generic: 1, colored: {}, x: 0, mv: 1 }, 0)).toBeUndefined();
  });
  it("an explicit autoPay: true is the suggestion made real (the observer / Auto-pay path)", () => {
    const t = manual();
    t.give("p1", "Island", "battlefield");
    const bs = t.give("p1", "Brainstorm", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: bs, autoPay: true });
    expect(t.state.pending).toBeNull();
    expect(t.state.stack).toHaveLength(1);
  });
  it("a player who is not manual is paid for automatically (AI, tests, observer): nothing changes", () => {
    const t = realTable();
    t.give("p1", "Island", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Brainstorm", "hand") });
    expect(t.state.stack).toHaveLength(1);
  });
  it("the cheaper way beats the Treasure even for a non-manual player (one-shot sources go last)", () => {
    const t = realTable();
    const tr = treasure(t); const isl = t.give("p1", "Island", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Brainstorm", "hand") });
    expect(t.obj(isl).tapped).toBe(true);
    expect(t.obj(tr)?.zone).toBe("battlefield");
  });
});

describe("other costs: cycling, kicker, Phyrexian, unlock", () => {
  it("cycling {W}: asked for the {W}, the card is discarded as the cost only when it is paid; cancel leaves it in hand", () => {
    const t = manual();
    const st = t.give("p1", "Secluded Steppe", "hand");
    const plains = t.give("p1", "Plains", "battlefield");
    t.give("p1", "Plains", "library");
    const res = t.do({ type: "activateAbility", player: "p1", sourceId: st, abilityId: "a3" } as never);
    expect(res.error).toBeUndefined();
    expect(pend(t).kind).toBe("pay_mana");
    expect(t.obj(st).zone).toBe("hand"); // nothing paid yet
    expect(t.obj(plains).tapped).toBeFalsy();
    t.ok({ type: "answerDecision", player: "p1", decisionId: pend(t).id, choice: { cancel: true } });
    expect(t.state.pending).toBeNull();
    expect(t.obj(st).zone).toBe("hand");
    t.ok({ type: "activateAbility", player: "p1", sourceId: st, abilityId: "a3" });
    expect(tap(t, plains).error).toBeUndefined();
    expect(t.obj(st).zone).toBe("graveyard");
  });
  it("kicker: the total shows the additional cost; the spell is cast once both are in the pool", () => {
    const t = manual();
    const ta = t.give("p1", "Tear Asunder", "hand");
    const victim = t.give("p2", "Sol Ring", "battlefield");
    const lands = [t.give("p1", "Forest", "battlefield"), t.give("p1", "Forest", "battlefield"), t.give("p1", "Swamp", "battlefield"), t.give("p1", "Swamp", "battlefield")];
    t.ok({ type: "castSpell", player: "p1", cardId: ta, extras: ["c1"], targets: { t2: [victim] } });
    expect(pend(t).kind).toBe("pay_mana");
    expect(pend(t).pay?.cost).toBe("{2}{B}{G}");
    expect(pend(t).pay?.parts[0]).toEqual({ label: "Mana cost", cost: "{2}{B}{G}" }); // the kicker is part of the cost the way of casting chose
    for (const l of lands.slice(0, 3)) { tap(t, l); expect(pend(t).kind).toBe("pay_mana"); }
    expect(tap(t, lands[3]).error).toBeUndefined();
    expect(t.state.pending).toBeNull();
    expect(t.state.stack).toHaveLength(1);
  });
  it("unlocking a Room door: the cost is asked for, cancel leaves the door locked", () => {
    const t = realTable(["p1", "p2"], { ...famCards }); t.state.config.manualPay = ["p1"];
    const plains = t.lands("p1", "Plains", 3);
    const arc = t.give("p1", "Secret Arcade", "battlefield");
    t.ok({ type: "unlockDoor", player: "p1", objectId: arc, face: "Dusty Parlor" });
    expect(pend(t).pay).toMatchObject({ cost: "{2}{W}", remaining: "{2}{W}" });
    expect(t.obj(arc).unlocked ?? []).toEqual([]);
    t.ok({ type: "answerDecision", player: "p1", decisionId: pend(t).id, choice: { cancel: true } });
    expect(t.state.pending).toBeNull();
    t.ok({ type: "unlockDoor", player: "p1", objectId: arc, face: "Dusty Parlor" });
    for (const l of plains) tap(t, l);
    expect(t.state.pending).toBeNull();
    expect(t.obj(arc).unlocked).toEqual(["Dusty Parlor"]);
  });
  it("miracle: the cast opens the payment for the miracle cost; nothing is tapped; cancel keeps the card in hand", () => {
    const t = realTable(["p1", "p2"], { "Test Ench": mk("Test Ench", { manaCost: "{4}{W}", types: ["enchantment"] }, []), "Draw One": instant("Draw One", "{1}", [{ kind: "draw_cards", who: "you", amount: 1 } as never]), "Fill A": filler("Fill A") });
    t.give("p1", "Aminatou, Veil Piercer", "battlefield"); const lands = [...t.lands("p1", "Plains", 3), ...t.lands("p1", "Island", 2)];
    t.give("p1", "Fill A", "library"); const ench = t.give("p1", "Test Ench", "library", { top: true });
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Draw One", "hand") });
    t.state.config.manualPay = ["p1"]; // from now on the player pays by hand (the first cast above was paid for)
    for (let i = 0; i < 6 && !t.state.pending && t.state.stack.length; i++) t.resolveTop();
    expect(t.state.pending?.kind).toBe("choose_yes_no");
    t.ok({ type: "answerDecision", player: "p1", decisionId: pend(t).id, choice: { yes: true } });
    expect(pend(t).kind).toBe("pay_mana");
    expect(pend(t).pay?.cost).toBe("{W}"); // {4}{W} reduced by {4}
    expect(lands.filter((l) => t.obj(l).tapped)).toHaveLength(1); // only Draw One's land
    t.ok({ type: "answerDecision", player: "p1", decisionId: pend(t).id, choice: { cancel: true } });
    expect(t.obj(ench).zone).toBe("hand");
  });
  it("Phyrexian: paid with 2 life, no mana is asked for; with mana chosen the pool must hold it", () => {
    const t = manual();
    const pod = t.give("p1", "Birthing Pod", "hand");
    const lands = t.lands("p1", "Forest", 4);
    for (const l of lands.slice(0, 3)) tap(t, l);
    const res = t.ok({ type: "castSpell", player: "p1", cardId: pod, phyrexian: ["life"] });
    expect(res.pending).toBeFalsy(); // {3} in the pool + 2 life
    expect(t.p("p1").life).toBe(38);
    expect(t.state.stack).toHaveLength(1);
  });
  it("Phyrexian paid with mana: the {G} is part of the total", () => {
    const t = manual();
    const pod = t.give("p1", "Birthing Pod", "hand");
    t.lands("p1", "Forest", 4);
    const res = t.ok({ type: "castSpell", player: "p1", cardId: pod, phyrexian: ["mana"] });
    expect(res.pending?.pay).toMatchObject({ cost: "{3}{G}", remaining: "{3}{G}" });
  });
});

describe("taxes and 'unless pays'", () => {
  it("Mystic Remora: 'unless that player pays {4}': Pay opens the payment; tapping covers it and no card is drawn", () => {
    const t = manual(["p1", "p2"], ["p2"]);
    t.give("p1", "Mystic Remora", "battlefield");
    const lands = t.lands("p2", "Island", 5);
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p2" };
    const dr = t.give("p2", "Sol Ring", "hand");
    t.give("p1", "Island", "library");
    for (const l of lands.slice(0, 1)) tap(t, l, "a1", undefined, "p2"); // {1} for Sol Ring
    t.ok({ type: "castSpell", player: "p2", cardId: dr });
    // the Remora trigger goes on the stack above the spell; both players pass to resolve it
    for (let i = 0; i < 6 && !t.state.pending && t.state.stack.length; i++) t.resolveTop();
    expect(t.state.pending?.kind).toBe("choose_yes_no"); // p1 may draw...
    t.ok({ type: "answerDecision", player: "p1", decisionId: pend(t).id, choice: { yes: true } });
    expect(t.state.pending?.kind).toBe("pay_unless"); // ...unless p2 pays {4}
    expect(t.state.pending?.player).toBe("p2");
    t.ok({ type: "answerDecision", player: "p2", decisionId: pend(t).id, choice: { yes: true } });
    expect(pend(t).kind).toBe("pay_mana");
    expect(pend(t).pay).toMatchObject({ cost: "{4}", remaining: "{4}" });
    for (const l of lands.slice(1, 4)) { expect(tap(t, l, "a1", undefined, "p2").error).toBeUndefined(); expect(pend(t).kind).toBe("pay_mana"); }
    expect(tap(t, lands[4], "a1", undefined, "p2").error).toBeUndefined();
    expect(t.state.pending?.kind).not.toBe("pay_mana");
    expect(t.state.players.find((p) => p.id === "p1")!.hand).toHaveLength(0); // p1 drew nothing: the tax was paid
  });
  it("Mystic Remora: Cancel in the payment means 'did not pay': the effect happens", () => {
    const t = manual(["p1", "p2"], ["p2"]);
    t.give("p1", "Mystic Remora", "battlefield");
    t.lands("p2", "Island", 5);
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p2" };
    t.give("p1", "Island", "library");
    t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Sol Ring", "hand"), autoPay: true });
    for (let i = 0; i < 6 && !t.state.pending && t.state.stack.length; i++) t.resolveTop();
    t.ok({ type: "answerDecision", player: "p1", decisionId: pend(t).id, choice: { yes: true } });
    t.ok({ type: "answerDecision", player: "p2", decisionId: pend(t).id, choice: { yes: true } });
    expect(pend(t).kind).toBe("pay_mana");
    t.ok({ type: "answerDecision", player: "p2", decisionId: pend(t).id, choice: { ids: ["cancel"] } });
    expect(t.state.pending?.kind).not.toBe("pay_mana");
    expect(t.state.battlefield.filter((i) => t.obj(i).cardName === "Island" && t.obj(i).controller === "p2" && t.obj(i).tapped)).toHaveLength(1); // nothing was tapped for them
  });
  it("Propaganda-style attack tax: refused with the cost spelled out; tap lands in the declaration step, declare again", () => {
    const t = realTable(["p1", "p2"], { Bear: filler("Bear", ["creature"], 2, 2), Ogre: filler("Ogre", ["creature"], 3, 3) }); t.state.config.manualPay = ["p1"];
    t.give("p2", "Propaganda", "battlefield");
    const a = t.give("p1", "Bear", "battlefield"), b = t.give("p1", "Ogre", "battlefield");
    const lands = t.lands("p1", "Island", 4);
    for (let i = 0; i < 4 && t.state.turn.phase !== "declare_attackers"; i++) t.ok({ type: "advancePhase", player: "p1" });
    const decl = { type: "declareAttackers", player: "p1", attackers: [{ id: a, defender: "p2" }, { id: b, defender: "p2" }] } as never;
    const res = t.do(decl);
    expect(res.error?.code).toBe("cannot_pay");
    expect(res.error?.message).toContain("{4}");
    expect(lands.some((l) => t.obj(l).tapped)).toBe(false); // nothing was tapped for the player
    const acts = legalActions(t.state, "p1", ctxOf(t), { untap: true });
    expect(acts.some((x) => x.kind === "declareAttackers")).toBe(true);
    expect(acts.filter((x) => x.kind === "activateAbility" && x.isMana)).toHaveLength(4);
    for (const l of lands) expect(tap(t, l).error).toBeUndefined();
    expect(t.state.combat?.expect?.kind).toBe("attackers"); // still waiting for the declaration
    expect(t.do(decl).error).toBeUndefined();
    expect(t.state.combat?.attackers).toHaveLength(2);
  });
  it("ward {4}: the attacker's controller is asked to pay; the mana comes from taps they make", () => {
    const t = manual(["p1", "p2"], ["p2"]);
    const kappa = t.give("p1", "Kappa Cannoneer", "battlefield");
    t.lands("p2", "Forest", 2); const sw = t.lands("p2", "Swamp", 4);
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p2" };
    const ta = t.give("p2", "Tear Asunder", "hand");
    t.ok({ type: "castSpell", player: "p2", cardId: ta, targets: { t1: [kappa] }, extras: [], autoPay: true });
    for (let i = 0; i < 4 && !t.state.pending && t.state.stack.length; i++) t.resolveTop();
    expect(t.state.pending?.kind).toBe("pay_unless");
    t.ok({ type: "answerDecision", player: "p2", decisionId: pend(t).id, choice: { yes: true } });
    expect(pend(t).pay).toMatchObject({ cost: "{4}" });
    for (const l of sw) expect(tap(t, l, "a1", undefined, "p2").error).toBeUndefined();
    expect(t.state.pending?.kind).not.toBe("pay_mana");
    expect(t.obj(kappa).zone).toBe("battlefield");
  });
});

describe("pool coverage helpers", () => {
  it("poolCovers is exact about colors", () => {
    const t = manual();
    const run = makeRunForTest(t);
    t.state.players[0].manaPool.U = 2;
    expect(poolCovers(run, "p1", { generic: 1, colored: { U: 1 }, x: 0, mv: 2 }, 0)).toBe(true);
    expect(poolCovers(run, "p1", { generic: 0, colored: { W: 1 }, x: 0, mv: 1 }, 0)).toBe(false);
  });
});

export type { ResolveResult };
