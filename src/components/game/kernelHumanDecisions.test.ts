// A decision addressed to the HUMAN seat always opens and waits, whoever's turn it is: the AI / default policy never answers it, the driver never steps past it.
// User report: Mind's Dilation exiled Foundry Inspector on the AI's turn and the 'cast it for free?' question never came. Real cards, headless, through the controller.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "./kernelController";
import { payIfAsked } from "./kernelPaymentKit";

interface Opt { humanBoard?: string[]; humanHand?: string[]; aiBoard?: string[]; aiHand?: string[]; aiLands?: string[]; humanLands?: string[]; aiTop?: string }
function game(o: Opt) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 12; i++) { t.give("p1", "Swamp", "library"); t.give("p2", "Swamp", "library"); }
  for (const n of o.humanLands ?? []) t.give("p1", n, "battlefield");
  for (const n of o.aiLands ?? []) t.give("p2", n, "battlefield");
  for (const n of o.humanBoard ?? []) t.give("p1", n, "battlefield");
  for (const n of o.aiBoard ?? []) t.give("p2", n, "battlefield");
  for (const n of o.humanHand ?? []) t.give("p1", n, "hand");
  for (const n of o.aiHand ?? []) t.give("p2", n, "hand");
  if (o.aiTop) t.give("p2", o.aiTop, "library", { top: true });
  t.state = { ...t.state, turn: { ...t.state.turn, active: "p2", number: 2 }, priority: "p2", passes: [] };
  const ks = KernelSession.fromState(t.state, { ctx, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } });
  ks.state.config.manualPay = ["p1"];
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  const idOf = (seat: 0 | 1, zone: "hand" | "battlefield", name: string) => (zone === "hand" ? ks.state.players[seat].hand : ks.state.battlefield).find((id) => ks.state.objects[id].cardName === name && (zone === "hand" || ks.state.objects[id].controller === (seat ? "p2" : "p1")))!;
  return { ks, c, idOf };
}
const settle = (c: KernelGameController, max = 200): void => { for (let n = 0; n < max && c.needsStep() && c.step(); n++); };
/** the AI casts a spell (its own policy never chooses one of these reliably, so the cast is dispatched as the AI's action) */
function aiCasts(ks: KernelSession, id: string): void { expect(ks.dispatch("p2", { type: "castSpell", player: "p2", cardId: id }).ok).toBe(true); }
const owes = (ks: KernelSession, c: KernelGameController) => ({ pending: ks.state.pending?.player, kind: ks.state.pending?.kind, driver: c.needsStep(), dialog: c.table().decision?.id });

describe("a human decision on the AI's turn opens and waits", () => {
  it("Mind's Dilation: the AI's first spell exiles Foundry Inspector; the human is asked 'cast it without paying?' and the driver does not move", () => {
    const { ks, c, idOf } = game({ humanBoard: ["Mind's Dilation"], aiLands: ["Swamp", "Swamp"], aiHand: ["Gravecrawler"], aiTop: "Foundry Inspector" });
    aiCasts(ks, idOf(1, "hand", "Gravecrawler"));
    settle(c);
    const o = owes(ks, c);
    expect(o).toMatchObject({ pending: "p1", kind: "choose_yes_no", driver: false });
    expect(o.dialog).toBeTruthy();
    expect(c.table().decision?.source?.card).toBe("Mind's Dilation");
    // nothing answers it for the human, however often the driver is poked
    for (let i = 0; i < 5; i++) expect(c.step()).toBe(false);
    expect(ks.state.pending?.kind).toBe("choose_yes_no");
    expect(ks.state.players[1].exile.map((id) => ks.state.objects[id].cardName)).toEqual(["Foundry Inspector"]);
    expect(c.answer(o.dialog!, { yes: true })).toBe(true);
    payIfAsked(c);
    expect(ks.state.stack.some((i) => i.kind === "spell" && ks.state.objects[i.objectId!]?.cardName === "Foundry Inspector")).toBe(true);
    expect(ks.state.players[1].exile).toHaveLength(0);
  });

  it("Mind's Dilation: saying no leaves it in exile", () => {
    const { ks, c, idOf } = game({ humanBoard: ["Mind's Dilation"], aiLands: ["Swamp", "Swamp"], aiHand: ["Gravecrawler"], aiTop: "Foundry Inspector" });
    aiCasts(ks, idOf(1, "hand", "Gravecrawler"));
    settle(c);
    expect(c.answer(c.table().decision!.id, { yes: false })).toBe(true);
    expect(ks.state.players[1].exile).toHaveLength(1);
  });

  it("Mystic Remora: 'you may draw unless that player pays {4}' is asked of the human when the AI casts a noncreature spell", () => {
    const { ks, c, idOf } = game({ humanBoard: ["Mystic Remora"], aiLands: ["Swamp", "Swamp"], aiHand: ["Dark Ritual"] });
    const handBefore = ks.state.players[0].hand.length;
    aiCasts(ks, idOf(1, "hand", "Dark Ritual"));
    settle(c);
    expect(owes(ks, c)).toMatchObject({ pending: "p1", driver: false });
    for (let i = 0; i < 3; i++) expect(c.step()).toBe(false);
    expect(ks.state.pending?.player).toBe("p1");
    c.answer(c.table().decision!.id, { yes: true });
    settle(c); // the AI answers its own 'pay {4}?' question
    expect(ks.state.players[0].hand.length).toBeGreaterThanOrEqual(handBefore + 1); // the Remora draw (the game then runs on into the human's own turn and draw step)
  });

  it("Esper Sentinel (the AI's): the human casting in response owes the 'pay {1}' decision, and it stays open", () => {
    const { ks, c, idOf } = game({ humanLands: ["Swamp", "Swamp", "Swamp"], humanHand: ["Go for the Throat"], humanBoard: ["Gravecrawler"], aiBoard: ["Esper Sentinel", "Undead Augur"], aiLands: ["Swamp", "Swamp"], aiHand: ["Dark Ritual"] });
    aiCasts(ks, idOf(1, "hand", "Dark Ritual"));
    settle(c);
    expect(ks.state.priority).toBe("p1"); // the human may respond
    c.playCard("p1", idOf(0, "hand", "Go for the Throat"));
    let d = c.table().decision; if (d) c.answer(d.id, { ids: [idOf(1, "battlefield", "Undead Augur")] });
    payIfAsked(c);
    c.passPriority();
    settle(c);
    const o = owes(ks, c);
    expect(o).toMatchObject({ pending: "p1", kind: "pay_unless", driver: false });
    for (let i = 0; i < 3; i++) expect(c.step()).toBe(false);
    expect(ks.state.pending?.kind).toBe("pay_unless");
  });

  it("Council's Judgment: the AI casts it; the human's vote is a real question that waits", () => {
    const { ks, c, idOf } = game({ humanBoard: ["Gravecrawler"], aiLands: ["Plains", "Plains", "Plains"], aiHand: ["Council's Judgment"] });
    aiCasts(ks, idOf(1, "hand", "Council's Judgment"));
    settle(c);
    for (let i = 0; i < 6 && ks.state.stack.length && !ks.state.pending; i++) { c.passPriority(); settle(c); }
    expect(ks.state.pending?.player).toBe("p1");
    expect(c.needsStep()).toBe(false);
    for (let i = 0; i < 3; i++) expect(c.step()).toBe(false);
    expect(c.table().decision?.id).toBeTruthy();
  });
});

describe("a free cast that fails is always logged", () => {
  it("any reason code produces a 'Could not cast <card>' line (the engine's reason when it is not 'no legal target')", async () => {
    const { formatEvent } = await import("@/kernel/integration/eventLog");
    const names = { card: () => "Foundry Inspector", player: () => "p1" };
    expect(formatEvent({ type: "cast_now_failed", seq: 1, player: "p1", id: "#1", code: "illegal_target", reason: "x" } as never, names)?.message).toBe("Could not cast Foundry Inspector: no legal target.");
    expect(formatEvent({ type: "cast_now_failed", seq: 1, player: "p1", id: "#1", code: "cannot_cast", reason: "it cannot be cast now" } as never, names)?.message).toBe("Could not cast Foundry Inspector: it cannot be cast now.");
    expect(formatEvent({ type: "cast_now_failed", seq: 1, player: "p1", id: "#1", code: "gone", reason: "the card is no longer there" } as never, names)?.message).toContain("Could not cast Foundry Inspector");
  });
});
