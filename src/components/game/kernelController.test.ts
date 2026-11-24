// Headless tests for the kernel game controller on real Wretched Ranks cards: a scripted human turn (land, targeted spell, attack, pass), the AI turn, the decision
// answer flow (stale answers ignored), inert intents, the dev flag, and the hand-off gate.
import { payIfAsked } from "./kernelPaymentKit";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ctx, mini, deckNames } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { buildPack } from "@/kernel/integration/nodePack";
import { packKit } from "@/kernel/integration/cardPack";
import { createSelfPlayGame, seedRuntime } from "@/lib/selfplay/orchestrator";
import { kernelEngineWanted } from "@/lib/kernelFlag";
import { KernelGameController, MAX_AUTO_ACTIONS_PER_TURN } from "./kernelController";
import { kernelReadiness, setLoadedKernelPacks, type LoadedPacks } from "./kernelPacks";
import { startKernelGame } from "./useKernelGame";
import { KernelDecisionDialog } from "@/components/KernelDecisionDialog";

const pack = JSON.parse(JSON.stringify(buildPack("wretched-ranks", { catalog: false })));
const kit = packKit([pack]);
const loaded: LoadedPacks = { kit, packs: [pack], readyCommanders: new Set(["Ghoulcaller Gisa"]) };

/** the human (p1) has a land and Go for the Throat in hand, Gravecrawler on the board; p2 has Undead Augur */
function scripted(phase: "precombat_main" | "upkeep" = "precombat_main") {
  const t = mini(["p1", "p2"], { phase });
  t.give("p1", "Swamp", "hand"); t.give("p1", "Swamp", "battlefield"); t.give("p1", "Swamp", "battlefield");
  for (let i = 0; i < 8; i++) { t.give("p1", "Swamp", "library"); t.give("p2", "Swamp", "library"); }
  t.give("p1", "Go for the Throat", "hand");
  const att = t.give("p1", "Gravecrawler", "battlefield");
  const victim = t.give("p2", "Undead Augur", "battlefield");
  t.state.players[0].hand.sort();
  const ks = KernelSession.fromState(t.state, { ctx, display: kit.display, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } });
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  const hand = (name: string) => ks.state.players[0].hand.find((id) => ks.state.objects[id].cardName === name)!;
  return { ks, c, att, victim, land: hand("Swamp"), spell: hand("Go for the Throat") };
}

/** let the driver act until it waits for the human (or `max` actions) */
function settle(c: KernelGameController, max = 120): number {
  let n = 0;
  while (n < max && c.needsStep() && c.step()) n++;
  return n;
}

describe("dev flag", () => {
  it("is on only for ?engine=kernel, and the env kill switch wins", () => {
    expect(kernelEngineWanted("?engine=kernel", undefined)).toBe(true);
    expect(kernelEngineWanted("?x=1&engine=kernel", "1")).toBe(true);
    expect(kernelEngineWanted("", undefined)).toBe(false);
    expect(kernelEngineWanted(undefined, undefined)).toBe(false);
    expect(kernelEngineWanted("?engine=legacy", undefined)).toBe(false);
    expect(kernelEngineWanted("?engine=kernel", "0")).toBe(false);
  });
});

describe("hand-off gate and start", () => {
  const restore = seedRuntime(77);
  const legacy = (() => { try { return createSelfPlayGame({ deckListPaths: ["Wretched Ranks.txt", "Wretched Ranks.txt"], seed: 77, forceFirstSeatIndex: 0 }); } finally { restore(); } })();
  const solo = { ...legacy, seats: legacy.seats.map((s, i) => ({ ...s, kind: i === 0 ? ("human" as const) : ("agent" as const) })) };
  it("passes a solo table of ready decks and refuses everything else with a reason", () => {
    expect(kernelReadiness(solo, loaded)).toEqual({ ok: true });
    expect(kernelReadiness(solo, undefined)).toMatchObject({ ok: false, reason: expect.stringContaining("bundle-drafts") });
    const two = { ...solo, seats: solo.seats.map((s) => ({ ...s, kind: "human" as const })) };
    expect(kernelReadiness(two, loaded)).toMatchObject({ ok: false, reason: expect.stringContaining("solo") });
    const other = { ...solo, seats: solo.seats.map((s, i) => (i === 1 ? { ...s, board: { ...s.board, commander: s.board.commander && { ...s.board.commander, name: "Some Other Commander" } } } : s)) };
    expect(kernelReadiness(other, loaded)).toMatchObject({ ok: false, reason: expect.stringContaining("not kernel-ready") });
  });
  it("startKernelGame builds a controller on the real opening position; an unready table stays legacy", () => {
    setLoadedKernelPacks(loaded);
    const r = startKernelGame(solo, { seed: 5, pace: () => 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.controller.human).toBe(solo.seats[0].id);
    const t = r.controller.table();
    expect(t.session.seats[0].board.hand).toHaveLength(solo.seats[0].board.hand.length);
    expect(r.controller.table()).toBe(t); // stable identity
    setLoadedKernelPacks(undefined);
    expect(startKernelGame(solo)).toMatchObject({ ok: false });
  });
});

describe("a scripted human turn on the kernel", () => {
  it("plays a land, casts a targeted spell through the decision dialog, resolves it, attacks, passes the turn, and the AI plays its turn", () => {
    const { ks, c, att, victim, land, spell } = scripted();
    const t0 = c.table();
    expect(t0.session.seats[0].board.hand.some((x) => x.id === land)).toBe(true);

    c.playCard("p1", land);
    expect(ks.state.battlefield).toContain(land);

    c.playCard("p1", spell);
    const d = c.table().decision!;
    expect(d.kind).toBe("choose_targets");
    // the dialog offers exactly what the kernel listed, with the card behind each object option
    expect(d.options.map((o) => o.id)).toEqual(ks.state.pending!.options.map((o) => o.id));
    expect(d.options.some((o) => o.id === victim && o.card?.name === "Undead Augur")).toBe(true);
    const html = renderToStaticMarkup(createElement(KernelDecisionDialog, { decision: d, onAnswer: () => undefined }));
    expect(html).toContain("Undead Augur");
    expect(html).toContain(d.title);

    // a stale answer (an id that is not the open decision) changes nothing
    const v = ks.version;
    expect(c.answer("d-stale", { ids: [victim] })).toBe(false);
    expect(ks.version).toBe(v);
    expect(c.answer(d.id, { ids: [victim] })).toBe(true);
    payIfAsked(c);
    expect(c.table().decision).toBeUndefined();
    expect(ks.state.stack).toHaveLength(1);
    // answering the same id again is a quiet no-op
    expect(c.answer(d.id, { ids: [victim] })).toBe(false);

    // the human auto-passes; the AI passes; the spell resolves
    settle(c);
    expect(ks.state.stack).toHaveLength(0);
    expect(ks.state.players[1].graveyard.some((id) => ks.state.objects[id].cardName === "Undead Augur")).toBe(true);

    // to combat: "next phase" from main, then the driver walks to the declaration
    c.advanceTurn();
    settle(c);
    const decl = c.declaration();
    expect(decl?.kind).toBe("attackers");
    if (decl?.kind !== "attackers") return;
    // the LEGACY flow: open the creature, pick "Attack <player>", then Continue
    const gc = c.table().session.seats.find((x) => x.id === "p1")!.board.battlefield.find((x) => x.name === "Gravecrawler")!;
    c.inspectCard(gc);
    const targets = (c.combatProps().humanAttackTargets as Array<{ targetId: string; label: string }>);
    expect(targets.map((t) => t.label)).toContain("Attack p2");
    c.declareAttack(gc.id, targets[0].targetId);
    expect(c.table().session.seats.find((x) => x.id === "p1")!.board.battlefield.find((x) => x.name === "Gravecrawler")!.attacking).toBe(true);
    c.advanceTurn();
    settle(c);
    expect(ks.state.players[1].life).toBeLessThan(40);

    // pass the turn; AI turn runs and gives the turn back, never more than the per-turn cap
    const turn = ks.state.turn.number;
    for (let i = 0; i < 6 && c.declaration(); i++) c.noAttack();
    c.endTurn();
    settle(c, 400);
    expect(ks.state.turn.number).toBeGreaterThanOrEqual(turn + 1);
    expect(ks.degraded).toBeUndefined();
  });

  it("a refused action is a log note, never an exception, and changes nothing", () => {
    const { ks, c, land } = scripted();
    c.playCard("p1", land);
    const v = ks.version;
    const l2 = ks.state.players[0].hand.find((id) => ks.state.objects[id].cardName === "Swamp");
    expect(l2).toBeUndefined(); // only one land in hand: cast the spell with too little mana instead
    const g = ks.state.players[0].hand[0];
    c.tapForMana("p1", "#nonexistent");
    expect(ks.version).toBe(v);
    expect(c.table().session.events[0].message).toMatch(/no mana ability|can't/i);
    void g;
  });

  it("intents without a kernel meaning are inert: a visible log note, no throw", () => {
    const { ks, c } = scripted();
    const props = c.tableProps() as Record<string, (...a: unknown[]) => void>;
    const v = ks.version;
    expect(() => props.onDrawCard("p1")).not.toThrow();
    expect(() => props.onChangeLife("p1", 1)).not.toThrow();
    expect(() => props.onMoveBattlefieldCard("p1", "x", { x: 0, z: 0 })).not.toThrow(); // silent
    expect(ks.version).toBe(v);
    expect(c.table().session.events[0].message).toMatch(/Not available in kernel mode/);
    expect(c.tableProps()).toBe(props); // built once
  });

  it("the table object keeps its identity until something changes", () => {
    const { c, land } = scripted();
    const a = c.table();
    expect(c.table()).toBe(a);
    c.playCard("p1", land);
    const b = c.table();
    expect(b).not.toBe(a);
    expect(b.session.seats[1]).toBe(a.session.seats[1]); // the untouched seat is the same object
  });

  it("passing priority out of turn or with a decision open is refused with a note", () => {
    const { ks, c, spell } = scripted();
    c.playCard("p1", spell);
    expect(ks.state.pending).toBeTruthy();
    c.passPriority();
    expect(ks.state.pending).toBeTruthy();
    expect(c.table().session.events[0].message).toMatch(/can't pass/i);
  });
});

describe("the AI driver", () => {
  it("plays a whole AI turn from the upkeep, bounded, with no stall note", () => {
    const { ks, c } = scripted("upkeep");
    // hand the first turn to the AI by ending the human's turn, then let the driver run
    const startTurn = ks.state.turn.number;
    for (let i = 0; i < 5; i++) { if (c.declaration()) c.noAttack(); settle(c, 60); if (ks.state.turn.active !== "p1") break; c.endTurn(); }
    settle(c, MAX_AUTO_ACTIONS_PER_TURN * 3);
    expect(ks.state.turn.number).toBeGreaterThan(startTurn);
    expect(c.table().session.events.some((e) => /kernel game is waiting/i.test(e.message))).toBe(false);
    expect(ks.degraded).toBeUndefined();
  });

  it("startDriver paces the steps with the injected timer and stops when asked", () => {
    const { c } = scripted("upkeep");
    const queue: Array<() => void> = [];
    const stop = c.startDriver((fn) => { queue.push(fn); return queue.length as never; }, () => undefined);
    expect(queue.length).toBe(1); // armed: the human's automatic upkeep pass
    queue.shift()!();
    expect(c.ks.state.turn.phase).not.toBe("upkeep");
    stop();
    const n = queue.length;
    c.note("x");
    expect(queue.length).toBe(n); // stopped: no new timer
  });
});

describe("decision dialog markup", () => {
  it("renders yes/no, numbers and splits from the kernel decision shape", () => {
    const base = { id: "d1", player: "p1", title: "Pay?", instruction: "", options: [], min: 0, max: 1, cancellable: false };
    expect(renderToStaticMarkup(createElement(KernelDecisionDialog, { decision: { ...base, kind: "choose_yes_no" }, onAnswer: () => undefined }))).toContain("Yes");
    expect(renderToStaticMarkup(createElement(KernelDecisionDialog, { decision: { ...base, kind: "choose_x", numeric: true, min: 0, max: 3 }, onAnswer: () => undefined }))).toContain("0 to 3");
    const split = renderToStaticMarkup(createElement(KernelDecisionDialog, { decision: { ...base, kind: "assign_mana", mana: { total: 2, colors: ["B", "G"] }, min: 2, max: 2 }, onAnswer: () => undefined }));
    expect(split).toContain("Assigned 0 of 2");
  });
});

void deckNames;
