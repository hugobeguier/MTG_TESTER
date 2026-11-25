// An activated ability with no timing restriction (Zur, Eternal Schemer's "{1}{W}: Target non-Aura enchantment you control becomes a creature") is instant speed:
// it must be offered by the kernel and activatable through the controller path the inspector button / glowing source uses in EVERY step of both players' turns,
// with and without a spell on the stack. Whether the human is ASKED in a window is the stops setting (kernelStops.ts); that is checked separately below.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "./kernelController";
import { DEFAULT_STOP_SETTINGS } from "@/lib/priorityStops";
import type { GameState, PlayerId } from "@/kernel/engine/types";

const STEPS = ["upkeep", "draw", "precombat_main", "beginning_of_combat", "declare_attackers", "declare_blockers", "combat_damage", "end_of_combat", "postcombat_main", "end_step"] as const;

function game(active: PlayerId, phase: string, spellOnStack: boolean) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 6; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
  const zur = t.give("p1", "Zur, Eternal Schemer", "battlefield");
  const ench = t.give("p1", "Sigil of the Empty Throne", "battlefield");
  const lands = [t.give("p1", "Plains", "battlefield"), t.give("p1", "Plains", "battlefield")];
  const spell = spellOnStack ? t.give("p2", "Lightning Bolt", "hand") : undefined;
  t.give("p2", "Mountain", "battlefield");
  let st: GameState = { ...t.state, turn: { ...t.state.turn, active, phase: phase as never }, priority: spellOnStack ? "p2" : "p1", passes: [] };
  const ks = KernelSession.fromState(st, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } } as never);
  ks.state.config.manualPay = ["p1"];
  if (spell) {
    // the opponent casts Bolt at the human's player, then priority is the human's
    const cast = ks.legal("p2").find((a) => a.kind === "castSpell" && a.objectId === spell && a.action);
    if (cast?.action) { ks.dispatch("p2", cast.action); if (ks.state.pending) { const p = ks.state.pending as never as { id: string; options?: Array<{ id: string }> }; ks.dispatch("p2", { type: "answerDecision", player: "p2", decisionId: p.id, choice: { ids: [p.options?.[0]?.id ?? "p1"] } } as never); } }
  }
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0, stops: DEFAULT_STOP_SETTINGS });
  return { ks, c, zur, ench, lands, spell };
}

describe("Zur's unrestricted activated ability at instant speed", () => {
  for (const active of ["p1", "p2"] as PlayerId[]) for (const phase of STEPS) for (const withSpell of [false, true]) {
    it(`${active === "p1" ? "own" : "opponent's"} ${phase}${withSpell ? " with a spell on the stack" : ""}`, () => {
      const { ks, c, zur, ench } = game(active, phase, withSpell);
      ks.state.priority = "p1";
      if (withSpell) expect(ks.state.stack.length).toBeGreaterThan(0);
      const acts = ks.legal("p1").filter((a) => a.kind === "activateAbility" && a.objectId === zur && !a.isMana);
      expect(acts.length, "legal list offers the ability").toBe(1);
      expect(c.cardActions(zur).map((a) => a.label).join("|"), "inspector lists it").toContain("becomes a creature");
      c.activateAbility("p1", zur, 0);
      const pend = ks.state.pending as never as { kind: string; id: string } | null;
      expect(pend?.kind, "target prompt opens").toBe("choose_targets");
      c.answer(pend!.id, { ids: [ench] });
      expect(ks.state.pending?.kind).toBe("pay_mana");
    });
  }
});
