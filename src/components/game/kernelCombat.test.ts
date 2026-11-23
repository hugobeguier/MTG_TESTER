// Combat on the kernel runs through the LEGACY combat UI props: attack targets in the card inspector + Continue, and the per-attacker block panel
// (blockChoice / selectedBlockerIds / onToggleBlocker / onConfirmBlockers / onPassBlocks). Headless on real cards.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "./kernelController";
import { DEFAULT_STOP_SETTINGS } from "@/lib/priorityStops";
import type { VisibleCard } from "@/lib/types";

function settle(c: KernelGameController, max = 200): void { let n = 0; while (n < max && c.needsStep() && c.step()) n++; }

function game(active: "p1" | "p2", humanBoard: string[], aiBoard: string[]) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 10; i++) { t.give("p1", "Swamp", "library"); t.give("p2", "Swamp", "library"); }
  for (const n of humanBoard) t.give("p1", n, "battlefield");
  for (const n of aiBoard) t.give("p2", n, "battlefield");
  if (active === "p2") t.state = { ...t.state, turn: { ...t.state.turn, active: "p2", number: 2 }, priority: "p2", passes: [] };
  const ks = KernelSession.fromState(t.state, { ctx, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } });
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0, stops: DEFAULT_STOP_SETTINGS });
  return { ks, c };
}
const board = (c: KernelGameController, seat: string): VisibleCard[] => c.table().session.seats.find((s) => s.id === seat)!.board.battlefield;
const byName = (c: KernelGameController, seat: string, name: string): VisibleCard => board(c, seat).find((x) => x.name === name)!;

/** drive until the human is asked for blockers after p2 attacks with every creature */
function aiAttacks(ks: KernelSession, c: KernelGameController): void {
  for (let i = 0; i < 40 && ks.state.combat?.expect?.kind !== "attackers"; i++) { if (c.needsStep()) c.step(); else break; }
  const ex = ks.state.combat?.expect;
  expect(ex?.kind).toBe("attackers");
  const legal = ks.legal("p2").find((a) => a.kind === "declareAttackers")!;
  expect(ks.dispatch("p2", { type: "declareAttackers", player: "p2", attackers: legal.attackers!.map((a) => ({ id: a.id, defender: "p1" })) }).ok).toBe(true);
}

describe("declaring attackers with the legacy UI", () => {
  it("offers 'Attack <player>' for a legal attacker, shows it attacking, and Continue declares it", () => {
    const { ks, c } = game("p1", ["Gravecrawler", "Undead Augur"], ["Undead Augur"]);
    c.advanceTurn(); settle(c);
    expect(c.declaration()?.kind).toBe("attackers");
    const gc = byName(c, "p1", "Gravecrawler");
    expect(c.combatProps().humanAttackTargets).toBeUndefined(); // nothing open in the inspector yet
    c.inspectCard(gc);
    const targets = c.combatProps().humanAttackTargets as Array<{ targetId: string; label: string }>;
    expect(targets.map((t) => t.label)).toEqual(["Attack p2"]);
    c.declareAttack(gc.id, targets[0].targetId);
    expect(byName(c, "p1", "Gravecrawler")).toMatchObject({ attacking: true, attackTargetId: "p2" });
    // taking it back: the inspector then offers "Do not attack"
    c.inspectCard(byName(c, "p1", "Gravecrawler"));
    const again = c.combatProps().humanAttackTargets as Array<{ targetId: string; label: string }>;
    expect(again.map((t) => t.label)).toContain("Do not attack");
    c.declareAttack(gc.id, "");
    expect(byName(c, "p1", "Gravecrawler").attacking).toBeFalsy();
    c.declareAttack(gc.id, "p2");
    c.advanceTurn();
    expect(ks.state.combat?.attackers.map((a) => a.id).length).toBe(1);
  });
  it("refuses an illegal attacker or defender with a log note", () => {
    const { c } = game("p1", ["Gravecrawler"], ["Undead Augur"]);
    c.advanceTurn(); settle(c);
    c.declareAttack("not-a-creature", "p2");
    c.declareAttack(byName(c, "p1", "Gravecrawler").id, "nobody");
    expect(c.table().session.events.filter((e) => e.detail === "Rules").length).toBe(2);
  });
});

describe("declaring blockers with the legacy UI", () => {
  it("asks about one attacker at a time with the legal blockers, and declares once the last one is settled", () => {
    const { ks, c } = game("p2", ["Undead Augur", "Undead Augur"], ["Gravecrawler", "Undead Augur"]);
    aiAttacks(ks, c);
    settle(c);
    expect(c.declaration()?.kind).toBe("blockers");
    const first = c.combatProps().blockChoice as { attackingCard: VisibleCard; blockers: VisibleCard[]; attackerName: string };
    expect(first.attackerName).toBe("p2");
    expect(first.blockers.length).toBe(2);
    const [b1, b2] = first.blockers;
    c.toggleBlocker(b1.id); c.toggleBlocker(b2.id);
    expect(c.combatProps().selectedBlockerIds).toEqual([b1.id, b2.id]); // tap order = damage order
    c.toggleBlocker(b1.id);
    expect(c.combatProps().selectedBlockerIds).toEqual([b2.id]);
    expect(c.confirmCurrentBlock()).toBe(true);
    // second attacker: the creature that already blocks is not offered again
    const second = c.combatProps().blockChoice as { attackingCard: VisibleCard; blockers: VisibleCard[] };
    expect(second.attackingCard.id).not.toBe(first.attackingCard.id);
    expect(second.blockers.map((x) => x.id)).toEqual([b1.id]);
    expect(ks.state.combat?.expect?.kind).toBe("blockers"); // nothing sent to the kernel yet
    expect(c.passCurrentBlock()).toBe(true);
    const blocked = ks.state.combat?.attackers.find((a) => a.blockers.length);
    expect(blocked?.blockers).toHaveLength(1);
    expect(c.combatProps().blockChoice).toBeUndefined();
  });
  it("refuses a creature that cannot block the shown attacker", () => {
    const { ks, c } = game("p2", ["Undead Augur"], ["Gravecrawler"]);
    aiAttacks(ks, c); settle(c);
    c.toggleBlocker("bogus");
    expect(c.combatProps().selectedBlockerIds).toEqual([]);
    expect(c.passCurrentBlock()).toBe(true);
  });
});
