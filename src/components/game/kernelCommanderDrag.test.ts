// Dragging the commander out of the command zone onto the battlefield: castable only with the right timing and a payable cost (tax and floating mana counted).
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "./kernelController";
import { payIfAsked } from "./kernelPaymentKit";

function setup(o: { lands?: number; pool?: number; tax?: number; phase?: string; cmd?: string } = {}) {
  const t = mini(["p1", "p2"], { phase: (o.phase ?? "precombat_main") as "precombat_main" });
  for (let i = 0; i < 4; i++) { t.give("p1", "Swamp", "library"); t.give("p2", "Swamp", "library"); }
  for (let i = 0; i < (o.lands ?? 0); i++) t.give("p1", "Swamp", "battlefield");
  const id = t.give("p1", o.cmd ?? "Gravecrawler", "hand");
  const obj = t.state.objects[id];
  obj.isCommander = true; obj.zone = "command";
  t.state.players[0].hand = t.state.players[0].hand.filter((x) => x !== id);
  t.state.players[0].command.push(id);
  if (o.tax) t.state.players[0].commanderCasts[id] = o.tax;
  if (o.pool) t.state.players[0].manaPool.B = o.pool;
  const ks = KernelSession.fromState(t.state, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } } as never);
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  const settle = () => { for (let i = 0; i < 10 && ks.state.stack.length && ks.state.priority; i++) ks.dispatch(ks.state.priority, { type: "passPriority", player: ks.state.priority }); (c as unknown as { bump(): void }).bump(); };
  const onBoard = () => c.table().session.seats[0].board.battlefield.find((x) => x.name === "Gravecrawler");
  const log = () => c.table().session.events.map((e) => e.message).join(" | ");
  return { ks, c, id, settle, onBoard, log };
}
const spot = { x: 1.5, z: -0.75 };

describe("commander drag-cast", () => {
  it("castable from sources, with commander tax ({B} + 2), keeps the dropped spot", () => {
    const { ks, c, id, settle, onBoard } = setup({ lands: 3, tax: 1 });
    expect(c.commanderCast()).toEqual({ castable: true, cardId: id });
    c.castCommander("p1", spot);
    payIfAsked(c);
    expect(ks.state.stack).toHaveLength(1);
    settle();
    expect(onBoard()?.battlefieldPosition).toEqual(spot);
  });
  it("floating mana alone pays for it (no untapped sources)", () => {
    const { ks, c, settle, onBoard } = setup({ lands: 0, pool: 3, tax: 1 });
    expect(c.commanderCast().castable).toBe(true);
    c.castCommander("p1", spot);
    payIfAsked(c);
    expect(ks.state.stack).toHaveLength(1);
    expect(ks.state.players[0].manaPool.B ?? 0).toBe(0);
    settle();
    expect(onBoard()?.battlefieldPosition).toEqual(spot);
  });
  it("pool plus lands together cover the tax", () => {
    const { c } = setup({ lands: 1, pool: 2, tax: 1 });
    expect(c.commanderCast().castable).toBe(true);
  });
  it("not enough mana: refused with a visible 'Cannot cast' message and no spot left behind", () => {
    const { ks, c, id, log } = setup({ lands: 2, tax: 1 });
    const v = c.commanderCast();
    expect(v.castable).toBe(false);
    expect(v.reason).toBeTruthy();
    c.castCommander("p1", spot);
    expect(ks.state.stack).toHaveLength(0);
    expect(ks.state.objects[id].zone).toBe("command");
    expect(log()).toMatch(/Cannot cast Gravecrawler: /);
    c.table();
    expect((c as unknown as { pendingDrops: Map<string, unknown> }).pendingDrops.size).toBe(0);
  });
  it("wrong timing (end step, sorcery-speed permanent): refused with a message", () => {
    const { ks, c, log } = setup({ lands: 3, phase: "end_step" });
    expect(c.commanderCast().castable).toBe(false);
    c.castCommander("p1", spot);
    expect(ks.state.stack).toHaveLength(0);
    expect(log()).toMatch(/Cannot cast Gravecrawler: /);
  });
  it("the cast button path (no position) still works", () => {
    const { ks, c, settle, onBoard } = setup({ lands: 1 });
    c.castCommander("p1");
    payIfAsked(c);
    expect(ks.state.stack).toHaveLength(1);
    settle();
    expect(onBoard()?.battlefieldPosition).toBeUndefined();
  });
});
