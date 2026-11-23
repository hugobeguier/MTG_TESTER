// "Exile ... you may play it until ...": the five REAL drafts that save the exiled cards (saveAs "exiled") and then grant a durable permission.
// Each test plays the whole card: the trigger, the exile, the permission (legalActions of the owner, the action it lists, never the opponent),
// the stated duration, and that nothing unsupported / unresolved happens. Also: a free cast that fails is logged (cast_now_failed).
import { describe, expect, it } from "vitest";
import { formatEvent } from "../integration/eventLog";
import { legalActions } from "./legal";
import { ctxOf, realTable } from "./testdb";
import type { Table } from "./testkit";
import type { GameEvent, ResolveResult } from "./types";
import { filler } from "./famkit";

const extra = { "Fill Artifact": filler("Fill Artifact", ["artifact"], 0, 0) };
const eventsAll: GameEvent[] = [];
const track = (res: ResolveResult) => { eventsAll.push(...res.events); return res; };

function advanceTo(t: Table, turnNo: number, phase: string): void {
  for (let i = 0; i < 80; i++) {
    if (t.state.pending || (t.state.turn.number === turnNo && t.state.turn.phase === phase)) return;
    const s = t.state;
    if (s.combat?.expect?.kind === "attackers") { track(t.ok({ type: "declareAttackers", player: s.combat.expect.player, attackers: [] })); continue; }
    if (s.combat?.expect?.kind === "blockers") { for (const p of s.combat.expect.players) track(t.ok({ type: "declareBlockers", player: p, blocks: {} } as never)); continue; }
    if (s.stack.length) { track(t.ok({ type: "passPriority", player: s.priority!, fastForward: true })); continue; }
    track(t.ok({ type: "advancePhase", player: s.turn.active }));
  }
  throw new Error(`did not reach turn ${turnNo} ${phase}: at ${t.state.turn.number} ${t.state.turn.phase}`);
}
const fill = (t: Table, who: string, n: number) => { for (let i = 0; i < n; i++) t.give(who, "Island", "library"); };
const legalCast = (t: Table, who: string, id: string) => legalActions(t.state, who, ctxOf(t)).filter((a) => a.kind === "castSpell" && a.objectId === id);
const legalPlay = (t: Table, who: string, id: string) => legalActions(t.state, who, ctxOf(t)).filter((a) => a.kind === "playLand" && a.objectId === id);
const permsOf = (t: Table) => (t.state.durableEffects ?? []).filter((d) => d.permission);
const noTrouble = () => { expect(eventsAll.filter((e) => e.type === "unresolved" || e.type === "cast_now_failed")).toEqual([]); };
/** let the stack empty, answering a pending yes/no or choice with the first legal answer */
type Pend = { kind: string; options: Array<{ id: string; label?: string }> };
function settle(t: Table, pick?: (p: Pend) => unknown): void {
  for (let i = 0; i < 12 && (t.state.stack.length || t.state.pending); i++) {
    if (t.state.pending) { const p = t.state.pending; track(t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: (pick?.(p as unknown as Pend) ?? { ids: [p.options[0]?.id].filter(Boolean) }) as never })); continue; }
    track(t.ok({ type: "passPriority", player: t.state.priority! }));
  }
}
const nameOf = (t: Table, id: string) => t.obj(id).cardName;
const stackSpells = (t: Table) => t.state.stack.filter((s) => s.kind === "spell");

function castFromExile(t: Table, who: string, id: string): void {
  const [la] = legalCast(t, who, id);
  expect(la, `${nameOf(t, id)} is castable from exile`).toBeTruthy();
  expect(la.zone).toBe("exile");
  track(t.ok(la.action as never));
}

describe("Count on Luck (real draft): exile the top card at upkeep, play it this turn", () => {
  it("land is playable only by its owner this turn, then the permission ends at end of turn; no question is asked", () => {
    eventsAll.length = 0;
    const t = realTable(["p1", "p2"], extra);
    t.give("p1", "Count on Luck", "battlefield");
    fill(t, "p1", 4); fill(t, "p2", 4);
    const forest = t.give("p1", "Forest", "library", { top: true });
    advanceTo(t, 3, "upkeep");
    settle(t); // trigger resolves (no yes/no is asked)
    expect(t.state.pending).toBeFalsy();
    expect(t.obj(forest).zone).toBe("exile");
    expect(permsOf(t)).toHaveLength(1);
    advanceTo(t, 3, "precombat_main");
    expect(legalPlay(t, "p1", forest)).toHaveLength(1);
    expect(legalPlay(t, "p2", forest)).toHaveLength(0);
    expect(t.do({ type: "playLand", player: "p2", cardId: forest }).error).toBeTruthy();
    advanceTo(t, 4, "upkeep");
    expect(permsOf(t)).toHaveLength(0);
    expect(legalPlay(t, "p1", forest)).toHaveLength(0);
    noTrouble();
  });
  it("a spell is cast from exile with the listed action (paying its cost) and the permission is used up", () => {
    eventsAll.length = 0;
    const t = realTable(["p1", "p2"], extra);
    t.give("p1", "Count on Luck", "battlefield");
    fill(t, "p1", 4); fill(t, "p2", 4);
    const ring = t.give("p1", "Sol Ring", "library", { top: true });
    advanceTo(t, 3, "upkeep");
    settle(t);
    t.give("p1", "Island", "battlefield");
    advanceTo(t, 3, "precombat_main");
    expect(legalCast(t, "p2", ring)).toHaveLength(0);
    expect(t.do({ type: "castSpell", player: "p2", cardId: ring }).error).toBeTruthy();
    castFromExile(t, "p1", ring);
    expect(stackSpells(t)).toHaveLength(1);
    expect(permsOf(t)).toHaveLength(0);
    noTrouble();
  });
});

describe("Outpost Siege (real draft, Khans): same, from the chosen mode's upkeep trigger", () => {
  it("exiled card playable this turn only, by its owner only", () => {
    eventsAll.length = 0;
    const t = realTable(["p1", "p2"], extra);
    fill(t, "p1", 4); fill(t, "p2", 4);
    t.lands("p1", "Mountain", 4);
    const siege = t.give("p1", "Outpost Siege", "hand");
    const ring = t.give("p1", "Sol Ring", "library", { top: true });
    track(t.ok({ type: "castSpell", player: "p1", cardId: siege }));
    settle(t, (pe) => { const p = pe.options; return { ids: [(p.find((o) => /khans/i.test(String(o.label ?? o.id))) ?? p[0]).id] }; });
    expect(t.obj(siege).zone).toBe("battlefield");
    advanceTo(t, 3, "upkeep");
    settle(t);
    expect(t.state.pending).toBeFalsy();
    const exiled = t.p("p1").exile;
    expect(exiled.length).toBeGreaterThan(0);
    expect(t.obj(ring).zone).toBe("exile"); // the top card (the siege mode must have been Khans)
    advanceTo(t, 3, "precombat_main");
    expect(legalCast(t, "p1", ring)).toHaveLength(1);
    expect(legalCast(t, "p2", ring)).toHaveLength(0);
    expect(t.do({ type: "castSpell", player: "p2", cardId: ring }).error).toBeTruthy();
    advanceTo(t, 4, "upkeep");
    expect(legalCast(t, "p1", ring)).toHaveLength(0);
    expect(permsOf(t)).toHaveLength(0);
    noTrouble();
  });
});

describe("Atsushi, the Blazing Sky (real draft): dies, exile two, play them until the end of your next turn", () => {
  it("both cards playable now, on the opponent's turn at instant speed only, until the end of p1's next turn, never by p2", () => {
    eventsAll.length = 0;
    const t = realTable(["p1", "p2"], extra);
    fill(t, "p1", 6); fill(t, "p2", 6);
    const atsushi = t.give("p1", "Atsushi, the Blazing Sky", "battlefield");
    t.lands("p1", "Swamp", 2);
    const forest = t.give("p1", "Forest", "library", { top: true });
    const ring = t.give("p1", "Sol Ring", "library", { top: true }); // on top: first exiled
    track(t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Go for the Throat", "hand"), targets: { t1: [atsushi] } } as never));
    settle(t, (p) => { return p.kind === "choose_yes_no" ? { yes: true } : { ids: [(p.options.find((o) => /exile/i.test(String(o.label ?? ""))) ?? p.options[0]).id] }; });
    expect(t.obj(atsushi).zone).toBe("graveyard");
    expect(t.obj(ring).zone).toBe("exile");
    expect(t.obj(forest).zone).toBe("exile");
    expect(permsOf(t)).toHaveLength(2);
    expect(permsOf(t).every((d) => d.owner === "p1")).toBe(true);
    // p2's turn 2: the land cannot be played (not p1's turn), p2 cannot touch either card
    advanceTo(t, 2, "precombat_main");
    expect(legalPlay(t, "p1", forest)).toHaveLength(0);
    for (const c of [ring, forest]) { expect(legalCast(t, "p2", c)).toHaveLength(0); expect(legalPlay(t, "p2", c)).toHaveLength(0); }
    expect(permsOf(t)).toHaveLength(2); // still alive through p2's turn
    // p1's turn 3: both playable
    advanceTo(t, 3, "precombat_main");
    expect(legalPlay(t, "p1", forest)).toHaveLength(1);
    expect(legalCast(t, "p1", ring)).toHaveLength(1);
    expect(legalPlay(t, "p2", forest)).toHaveLength(0);
    track(t.ok(legalPlay(t, "p1", forest)[0].action as never));
    expect(t.obj(forest).zone).toBe("battlefield");
    advanceTo(t, 4, "upkeep"); // the end of p1's next turn has passed
    expect(permsOf(t)).toHaveLength(0);
    expect(legalCast(t, "p1", ring)).toHaveLength(0);
    noTrouble();
  });
  it("the card can be cast from exile with the listed action on the turn it died", () => {
    eventsAll.length = 0;
    const t = realTable(["p1", "p2"], extra);
    fill(t, "p1", 6); fill(t, "p2", 6);
    const atsushi = t.give("p1", "Atsushi, the Blazing Sky", "battlefield");
    t.lands("p1", "Swamp", 3);
    const ring = t.give("p1", "Sol Ring", "library", { top: true });
    track(t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Go for the Throat", "hand"), targets: { t1: [atsushi] } } as never));
    settle(t, (p) => { return p.kind === "choose_yes_no" ? { yes: true } : { ids: [(p.options.find((o) => /exile/i.test(String(o.label ?? ""))) ?? p.options[0]).id] }; });
    castFromExile(t, "p1", ring);
    expect(stackSpells(t).map((x) => nameOf(t, (x as { objectId: string }).objectId))).toContain("Sol Ring");
    noTrouble();
  });
});

describe("Parapet Thrasher (real draft): exile the top card, you may play it this turn", () => {
  it("combat damage by a Dragon, third mode: the card is playable this turn by p1 only and gone next turn", () => {
    eventsAll.length = 0;
    const t = realTable(["p1", "p2"], extra);
    fill(t, "p1", 6); fill(t, "p2", 6);
    const thr = t.give("p1", "Parapet Thrasher", "battlefield");
    const forest = t.give("p1", "Forest", "library", { top: true });
    void thr;
    advanceTo(t, 1, "declare_attackers");
    const att = legalActions(t.state, "p1", ctxOf(t)).find((a) => a.kind === "declareAttackers");
    expect(att).toBeTruthy();
    track(t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: thr, defender: "p2" }] } as never));
    for (let i = 0; i < 20 && t.state.turn.phase !== "postcombat_main" && t.state.turn.number === 1; i++) {
      if (t.state.combat?.expect?.kind === "blockers") { for (const p of t.state.combat.expect.players) track(t.ok({ type: "declareBlockers", player: p, blocks: {} } as never)); continue; }
      if (t.state.pending) { const p = t.state.pending; const pick = p.options.find((o) => /exile|play/i.test(String((o as { label?: string }).label ?? ""))) ?? p.options[0]; track(t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: p.kind === "choose_yes_no" ? { yes: true } : { ids: [pick.id] } } as never)); continue; }
      if (t.state.stack.length) { track(t.ok({ type: "passPriority", player: t.state.priority! })); continue; }
      track(t.ok({ type: "advancePhase", player: t.state.turn.active }));
    }
    expect(t.obj(forest).zone).toBe("exile");
    expect(permsOf(t)).toHaveLength(1);
    expect(legalPlay(t, "p2", forest)).toHaveLength(0);
    expect(legalPlay(t, "p1", forest)).toHaveLength(1);
    advanceTo(t, 2, "upkeep");
    expect(permsOf(t)).toHaveLength(0);
    expect(legalPlay(t, "p1", forest)).toHaveLength(0);
    noTrouble();
  });
});

describe("Dragonhawk, Fate's Tempest (real draft): exile X, play them until your next end step", () => {
  // cast in p1's main phase, "your next end step" is THIS turn's end step: the cards are playable for the rest of this turn only
  const start = () => {
    eventsAll.length = 0;
    const t = realTable(["p1", "p2"], extra);
    fill(t, "p1", 8); fill(t, "p2", 8);
    t.lands("p1", "Mountain", 5);
    const forest = t.give("p1", "Forest", "library", { top: true });
    const dh = t.give("p1", "Dragonhawk, Fate's Tempest", "hand");
    track(t.ok({ type: "castSpell", player: "p1", cardId: dh }));
    settle(t);
    expect(t.obj(dh).zone).toBe("battlefield");
    expect(t.obj(forest).zone).toBe("exile"); // X = 1 (Dragonhawk is the only creature with power 4+)
    return { t, forest };
  };
  it("playable this turn by p1 only; at the end step the permission ends and the card still exiled costs the opponent 2 life", () => {
    const { t, forest } = start();
    expect(permsOf(t)).toHaveLength(1);
    expect(legalPlay(t, "p1", forest)).toHaveLength(1);
    expect(legalPlay(t, "p2", forest)).toHaveLength(0);
    expect(t.do({ type: "playLand", player: "p2", cardId: forest }).error).toBeTruthy();
    expect(t.state.delayedTriggers ?? []).toHaveLength(1);
    advanceTo(t, 1, "end_step");
    settle(t);
    expect(permsOf(t)).toHaveLength(0);
    expect(legalPlay(t, "p1", forest)).toHaveLength(0);
    expect(t.p("p2").life).toBe(38);
    noTrouble();
  });
  it("a card played from exile is no longer exiled: no damage", () => {
    const { t, forest } = start();
    track(t.ok(legalPlay(t, "p1", forest)[0].action as never));
    advanceTo(t, 1, "end_step");
    settle(t);
    expect(t.p("p2").life).toBe(40);
    noTrouble();
  });
});

describe("a free cast that cannot happen is visible to the player (cast_now_failed)", () => {
  it("Mind's Dilation exiles a removal spell with no legal target: the log says 'Could not cast <card>: no legal target.'", () => {
    eventsAll.length = 0;
    const t = realTable(["p1", "p2"], extra);
    t.give("p1", "Mind's Dilation", "battlefield");
    t.lands("p2", "Island", 3);
    const aura = t.give("p2", "Go for the Throat", "library", { top: true });
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p2", stack: [], passes: [] };
    // no creature anywhere: Go for the Throat has no legal target
    const id = t.give("p2", "Fill Artifact", "hand");
    track(t.ok({ type: "castSpell", player: "p2", cardId: id }));
    const res = track(t.resolveTop());
    if (res.pending) track(t.answer(res, { yes: true }));
    const ev = eventsAll.find((e) => e.type === "cast_now_failed");
    expect(ev).toBeTruthy();
    const line = formatEvent(ev!, { player: (p: unknown) => String(p), card: (c: unknown) => nameOf(t, String(c)) } as never);
    expect(line?.message).toBe("Could not cast Go for the Throat: no legal target.");
    expect(t.obj(aura).zone).toBe("exile");
  });
});

describe("prompts for durable permissions", () => {
  it("a stale stored question is removed and none is generated; a real 'you may' step is not garbled", async () => {
    const { generatePrompts, promptForMay } = await import("../prompts");
    const { loadDraft } = await import("./testkit");
    const card = loadDraft("count-on-luck");
    const stale = structuredClone(card) as typeof card;
    (stale.abilities[0].steps as Array<Record<string, unknown>>)[1].prompt = { title: "x", instruction: "Do you want to you may play exiled until end of turn?" };
    const out = generatePrompts(stale, "Count on Luck");
    expect(JSON.stringify(out)).not.toMatch(/you may play|Do you want to you may/);
    expect((out.abilities[0].steps as Array<Record<string, unknown>>)[1].prompt).toBeUndefined();
    expect(promptForMay("X", "you may play exiled until end of turn").instruction).toBe("Do you want to play exiled until end of turn?");
    expect(promptForMay("X", "exile it; you may cast it").instruction).toBe("Do you want to exile it; cast it?");
    // every stored draft: no durable permission carries a prompt and no prompt text contains the garbled phrase
    const { allDraftFiles } = await import("./testkit");
    const fs = await import("node:fs");
    for (const f of allDraftFiles()) { const txt = fs.readFileSync(f, "utf8"); expect(txt, f).not.toMatch(/Do you want to you may/); }
  });
});
