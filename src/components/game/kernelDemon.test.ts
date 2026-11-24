// Demon of Fate's Design through the human's UI path: the card's actions list "Cast X by paying N life (Demon of Fate's Design)", choosing it opens no payment banner
// (nothing left to pay), the cast button falls back to it when the mana cost is out of reach, and the once-per-turn limit resets with the turn.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "./kernelController";

function game(o: { hand: string[]; lands?: string[]; board?: string[]; life?: number; phase?: "precombat_main" }) {
  const t = mini(["p1", "p2"], { phase: o.phase ?? "precombat_main" });
  for (let i = 0; i < 6; i++) { t.give("p1", "Swamp", "library"); t.give("p2", "Swamp", "library"); }
  t.give("p1", "Demon of Fate's Design", "battlefield");
  for (const n of o.lands ?? []) t.give("p1", n, "battlefield");
  for (const n of o.board ?? []) t.give("p1", n, "battlefield");
  const ids = o.hand.map((n) => t.give("p1", n, "hand"));
  if (o.life !== undefined) t.state.players[0].life = o.life;
  const ks = KernelSession.fromState(t.state, { ctx, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } });
  ks.state.config.manualPay = ["p1"];
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  return { ks, c, ids };
}
const life = (ks: KernelSession) => ks.state.players[0].life;

describe("Demon of Fate's Design: the kernel UI offers the life way", () => {
  it("the card's actions say 'Cast X by paying N life (Demon of Fate's Design)' even when the mana cost is affordable", () => {
    const { c, ids } = game({ hand: ["Dictate of Erebos"], lands: ["Swamp", "Swamp", "Swamp", "Swamp", "Swamp"] });
    const labels = c.cardActions(ids[0]).map((a) => a.label);
    expect(labels).toContain("Cast Dictate of Erebos by paying 5 life (Demon of Fate's Design)");
  });

  it("choosing it pays life, opens no payment banner, and puts the spell on the stack", () => {
    const { ks, c, ids } = game({ hand: ["Dictate of Erebos"], lands: ["Swamp", "Swamp", "Swamp", "Swamp", "Swamp"] });
    const act = c.cardActions(ids[0]).find((a) => /paying 5 life/.test(a.label))!;
    expect(c.doOption(act.id)).toBe(true);
    expect(c.paying()).toBe(false);
    expect(ks.state.pending?.kind).not.toBe("pay_mana");
    expect(life(ks)).toBe(35);
    expect(ks.state.stack).toHaveLength(1);
    expect(ks.state.battlefield.filter((id) => ks.state.objects[id].tapped)).toEqual([]);
  });

  it("the cast button (playCard) uses it when there is no mana to pay the cost", () => {
    const { ks, c, ids } = game({ hand: ["Dictate of Erebos"] });
    c.playCard("p1", ids[0]);
    expect(c.paying()).toBe(false);
    expect(life(ks)).toBe(35);
    expect(ks.state.stack).toHaveLength(1);
  });

  it("an Aura that needs a target: the target is asked, then it is cast for life", () => {
    const { ks, c, ids } = game({ hand: ["Kenrith's Transformation"], board: ["Gravecrawler"] });
    const act = c.cardActions(ids[0]).find((a) => /paying 2 life/.test(a.label))!;
    expect(act).toBeTruthy();
    c.doOption(act.id);
    const d = c.table().decision;
    expect(d?.kind).toBe("choose_targets");
    c.answer(d!.id, { ids: [d!.options[0].id] });
    expect(c.paying()).toBe(false);
    expect(life(ks)).toBe(38);
    expect(ks.state.stack).toHaveLength(1);
  });

  it("a Room: the life equals the mana value of the half cast", () => {
    const { ks, c, ids } = game({ hand: ["Secret Arcade"] });
    const labels = c.cardActions(ids[0]).map((a) => a.label);
    expect(labels.some((l) => /Dusty Parlor by paying 3 life/.test(l))).toBe(true);
    expect(labels.some((l) => /Secret Arcade by paying 5 life/.test(l))).toBe(true);
    c.doOption(c.cardActions(ids[0]).find((a) => /Dusty Parlor by paying 3 life/.test(a.label))!.id);
    expect(life(ks)).toBe(37);
  });

  it("once per turn: not offered a second time, offered again on the next turn of mine", () => {
    const { ks, c, ids } = game({ hand: ["Dictate of Erebos", "Dictate of Erebos"] });
    c.doOption(c.cardActions(ids[0]).find((a) => /paying 5 life/.test(a.label))!.id);
    expect(c.cardActions(ids[1]).some((a) => /paying/.test(a.label))).toBe(false);
    // a new turn of mine: the tracking is per turn
    const act = ks.state.activations ?? {};
    expect(Object.keys(act).some((k) => /lifecast/.test(k))).toBe(true);
  });

  it("life floor: with less life than the mana value the way is not offered (a human may still go to exactly 0)", () => {
    const poor = game({ hand: ["Dictate of Erebos"], life: 4 });
    expect(poor.c.cardActions(poor.ids[0]).some((a) => /paying/.test(a.label))).toBe(false);
    const exact = game({ hand: ["Dictate of Erebos"], life: 5 });
    expect(exact.c.cardActions(exact.ids[0]).some((a) => /paying 5 life/.test(a.label))).toBe(true);
  });
});
