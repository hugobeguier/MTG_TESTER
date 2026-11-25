// Which priority windows the human is actually ASKED in (the stops setting) with an instant-speed activated ability available (Zur, Eternal Schemer + 2 Plains).
// The ability is legal in every window (kernelInstantActivate.test.ts); whether the game waits for the human there is the stops grid / Stop Next, not the ability.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "./kernelController";
import { DEFAULT_STOP_SETTINGS, stopKey } from "@/lib/priorityStops";

function setup(stops = DEFAULT_STOP_SETTINGS) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 12; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
  t.give("p1", "Zur, Eternal Schemer", "battlefield"); t.give("p1", "Sigil of the Empty Throne", "battlefield");
  t.give("p1", "Plains", "battlefield"); t.give("p1", "Plains", "battlefield");
  const ks = KernelSession.fromState(t.state, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } } as never);
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0, stops });
  return { ks, c };
}
/** run the game forward; `onWindow` is called at every window the human is asked in and returns how to leave it */
function run(c: KernelGameController, turns: number, leave: (c: KernelGameController) => void): string[] {
  const seen: string[] = [];
  for (let i = 0; i < 600; i++) {
    const st = (c as unknown as { ks: { state: import("@/kernel/engine/types").GameState } }).ks.state;
    if (st.turn.number > turns) break;
    if (c.needsStep()) { c.step(); continue; }
    if (st.priority === "p1" && !st.pending && !st.combat?.expect) {
      seen.push(`${st.turn.active}:${st.turn.phase}:${c.stopReason()}${c.options().some((a) => a.kind === "activateAbility") ? ":zur" : ""}`);
      leave(c);
    } else if (st.combat?.expect) { const e = st.combat.expect; const who = "player" in e ? e.player : e.players[0]; c.advanceTurn(); (c as never as { act: (a: unknown) => void }).act({ type: "advancePhase", player: who }); }
    else break;
  }
  return seen;
}

describe("priority windows with an instant-speed activation", () => {
  it("default stops: the human is asked only at own main phases / declare attackers and the opponent's end step", () => {
    const { c } = setup();
    const seen = run(c, 3, (x) => x.passPriority());
    expect(seen.some((w) => w.startsWith("p1:beginning_of_combat"))).toBe(false);
    expect(seen.some((w) => w.startsWith("p2:upkeep"))).toBe(false);
    expect(seen).toContain("p2:end_step:phase_stop:zur");
    expect(seen).toContain("p1:postcombat_main:own_turn:zur");
  });
  it("ticking the opponent's upkeep / beginning of combat and own beginning of combat in the stops grid opens those windows with the ability available", () => {
    const stops = { ...DEFAULT_STOP_SETTINGS, phaseStops: { ...DEFAULT_STOP_SETTINGS.phaseStops, [stopKey("upkeep step", 1)]: true, [stopKey("beginning of combat step", 1)]: true, [stopKey("beginning of combat step", 0)]: true } };
    const { c } = setup(stops);
    const seen = run(c, 3, (x) => x.passPriority());
    for (const w of ["p2:upkeep:phase_stop:zur", "p2:beginning_of_combat:phase_stop:zur", "p1:beginning_of_combat:own_turn:zur"]) expect(seen).toContain(w);
  });
  it("Pass to next step (Stop Next) opens every single step of both turns, each with the ability available", () => {
    const { c } = setup();
    const seen = run(c, 3, (x) => x.advanceTurn());
    for (const ph of ["upkeep", "draw", "precombat_main", "beginning_of_combat", "end_of_combat", "postcombat_main", "end_step"]) {
      expect(seen.some((w) => w.startsWith(`p2:${ph}:`) && w.endsWith(":zur")), `opponent's ${ph}`).toBe(true);
    }
    expect(seen.some((w) => w.startsWith("p1:beginning_of_combat:") && w.endsWith(":zur"))).toBe(true);
  });
});
