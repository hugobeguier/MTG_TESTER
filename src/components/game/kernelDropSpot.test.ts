// A permanent dropped on the battlefield keeps the spot of the yellow landing preview when it enters (after sitting on the stack).
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "./kernelController";
import { payIfAsked } from "./kernelPaymentKit";

function setup() {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 4; i++) { t.give("p1", "Swamp", "library"); t.give("p2", "Swamp", "library"); }
  for (let i = 0; i < 4; i++) t.give("p1", "Swamp", "battlefield"); t.give("p1", "Gravecrawler", "hand"); t.give("p1", "Swamp", "hand"); t.give("p1", "Duress", "hand"); t.give("p1", "Sol Ring", "hand"); t.give("p1", "Phyrexian Arena", "hand");
  const ks = KernelSession.fromState(t.state, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } } as never);
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  const hand = (n: string) => ks.state.players[0].hand.find((id) => ks.state.objects[id].cardName === n)!;
  const onBoard = (n: string) => c.table().session.seats[0].board.battlefield.find((x) => x.name === n);
  const settle = () => { for (let i = 0; i < 10 && ks.state.stack.length && ks.state.priority; i++) ks.dispatch(ks.state.priority, { type: "passPriority", player: ks.state.priority }); (c as unknown as { bump(): void }).bump(); };
  return { ks, c, hand, onBoard, settle };
}

const positionsOf = (c: KernelGameController): Array<{ n: string; p: unknown }> => c.table().session.seats[0].board.battlefield.map((x) => ({ n: x.name, p: x.battlefieldPosition }));

describe("render between every step (the React table re-reads table() constantly)", () => {
  const cases: Array<[string, string, { x: number; z: number }]> = [["creature", "Gravecrawler", { x: 1.25, z: -0.5 }], ["artifact", "Sol Ring", { x: -1.5, z: 0.25 }], ["land", "Swamp", { x: 2.5, z: 1 }], ["enchantment", "Phyrexian Arena", { x: 0.5, z: 0.5 }]];
  for (const [kind, name, pos] of cases) it(kind + " " + name, () => {
    const { ks, c, hand, settle } = setup();
    const t = ks as unknown as { state: { objects: Record<string, { cardName: string }> } };
    void t;
    const id = ks.state.players[0].hand.find((x) => ks.state.objects[x].cardName === name) ?? (() => { throw new Error("not in hand " + name); })();
    c.table();
    c.playCard("p1", id, pos);
    c.table(); payIfAsked(c); c.table();
    settle(); c.table();
    expect(positionsOf(c).filter((x) => x.n === name && x.p).map((x) => x.p), JSON.stringify(ks.state.pending)).toEqual([pos]);
  });
});

describe("drop spot of a cast permanent", () => {
  it("a creature keeps the dropped position through stack and battlefield", () => {
    const { ks, c, hand, onBoard, settle } = setup();
    c.playCard("p1", hand("Gravecrawler"), { x: 1.25, z: -0.5 });
    payIfAsked(c);
    expect(ks.state.stack).toHaveLength(1);
    settle();
    expect(onBoard("Gravecrawler")?.battlefieldPosition).toEqual({ x: 1.25, z: -0.5 });
  });
  it("a land dropped keeps it too; a card played without a drop has no fixed position", () => {
    const { c, hand, onBoard } = setup();
    c.playCard("p1", hand("Swamp"), { x: -2, z: 0.75 });
    expect(c.table().session.seats[0].board.battlefield.filter((x) => x.battlefieldPosition).map((x) => x.battlefieldPosition)).toEqual([{ x: -2, z: 0.75 }]);
    expect(onBoard("Swamp")).toBeDefined();
  });
  it("a spell that is never cast (refused) does not leave a spot behind", () => {
    const { ks, c, hand } = setup();
    ks.state.turn.phase = "end_step" as never;
    c.playCard("p1", hand("Gravecrawler"), { x: 3, z: 3 });
    c.table();
    expect((c as unknown as { pendingDrops: Map<string, unknown> }).pendingDrops.size).toBe(0);
  });
});

// The real app path: legacy hand-off (table card ids are the legacy ids), a real Aminatou game.
import { dl } from "@/kernel/integration/testgame";
import { createSelfPlayGame, seedRuntime } from "@/lib/selfplay/orchestrator";

describe("real hand-off game (legacy card ids)", () => {
  it("lands and spells dropped at a spot keep it when they enter", () => {
    const restore = seedRuntime(77);
    const legacy = (() => { try { return createSelfPlayGame({ deckListPaths: ["Aminatou.txt", "Aminatou.txt"], seed: 77, forceFirstSeatIndex: 0 }); } finally { restore(); } })();
    const ks = KernelSession.fromLegacyHandoff(legacy, { ctx, lookup: dl });
    const human = legacy.seats[0].id;
    const c = new KernelGameController(ks, { human, pace: () => 0 });
    const hand = () => c.table().session.seats[0].board.hand;
    for (let i = 0; i < 12 && ks.state.turn.phase !== "precombat_main"; i++) ks.dispatch(ks.actor!, { type: "advancePhase", player: ks.actor! });
    const land = hand().find((x) => x.typeLine.includes("Land"))!;
    c.table();
    c.playCard(human, land.id, { x: 1.5, z: 0.25 });
    const bf = c.table().session.seats[0].board.battlefield.find((x) => x.id === land.id);
    expect(bf?.battlefieldPosition, JSON.stringify(c.table().session.events.slice(0, 2))).toEqual({ x: 1.5, z: 0.25 });
  });
});

import { debugPlaceCard } from "@/kernel/engine/setup";
describe("real hand-off game: a spell that needs the payment banner", () => {
  it("artifact dropped at a spot, paid in the banner, keeps its spot", () => {
    const restore = seedRuntime(77);
    const legacy = (() => { try { return createSelfPlayGame({ deckListPaths: ["Aminatou.txt", "Aminatou.txt"], seed: 77, forceFirstSeatIndex: 0 }); } finally { restore(); } })();
    const ks = KernelSession.fromLegacyHandoff(legacy, { ctx, lookup: dl });
    const human = legacy.seats[0].id;
    const c = new KernelGameController(ks, { human, pace: () => 0 });
    for (let i = 0; i < 12 && ks.state.turn.phase !== "precombat_main"; i++) ks.dispatch(ks.actor!, { type: "advancePhase", player: ks.actor! });
    const res = debugPlaceCard(ks.state, dl.lookup, human, "Sol Ring", "hand"); Object.assign(ks.state, res.state);
    const res2 = debugPlaceCard(ks.state, dl.lookup, human, "Plains", "battlefield"); Object.assign(ks.state, res2.state);
    (c as unknown as { bump(): void }).bump();
    const hand = c.table().session.seats[0].board.hand;
    const ring = hand.find((x) => x.name === "Sol Ring")!;
    expect(ring).toBeDefined();
    c.playCard(human, ring.id, { x: -1.75, z: 0.5 });
    c.table(); payIfAsked(c); c.table();
    for (let i = 0; i < 10 && ks.state.stack.length && ks.state.priority; i++) { ks.dispatch(ks.state.priority, { type: "passPriority", player: ks.state.priority }); (c as unknown as { bump(): void }).bump(); c.table(); }
    const bf = c.table().session.seats[0].board.battlefield.find((x) => x.name === "Sol Ring");
    expect(bf?.battlefieldPosition, JSON.stringify([ks.state.pending?.kind, ks.state.stack.length, c.table().session.events.slice(0, 2)])).toEqual({ x: -1.75, z: 0.5 });
  });
});

describe("the commander dragged from the command zone", () => {
  it("keeps the dropped spot (castCommander reads the table before the cast starts: that read must not forget the drop)", () => {
    const t = mini(["p1", "p2"], { phase: "precombat_main" });
    for (let i = 0; i < 4; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
    const cmd = t.give("p1", "Gravecrawler", "battlefield");
    t.state.objects[cmd].isCommander = true; t.state.objects[cmd].zone = "command";
    t.state.battlefield = t.state.battlefield.filter((i) => i !== cmd); t.state.players[0].command.push(cmd);
    t.give("p1", "Swamp", "battlefield");
    const ks = KernelSession.fromState(t.state, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } } as never);
    const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
    c.table();
    c.castCommander("p1", { x: -6.5, z: 2.25 });
    c.table(); payIfAsked(c); c.table();
    for (let i = 0; i < 10 && ks.state.stack.length && ks.state.priority; i++) { ks.dispatch(ks.state.priority, { type: "passPriority", player: ks.state.priority }); (c as unknown as { bump(): void }).bump(); c.table(); }
    expect(c.table().session.seats[0].board.battlefield.find((x) => x.name === "Gravecrawler")?.battlefieldPosition).toEqual({ x: -6.5, z: 2.25 });
  });
});
