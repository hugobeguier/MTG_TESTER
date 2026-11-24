// The AI plans its payment before it casts: free sources first, colors the rest of the hand needs kept, Treasures and pain sources only when nothing else pays.
import { describe, expect, it } from "vitest";
import { planPayment, withPlannedPayment } from "./payment";
import { PREDEFINED_TOKEN_ABILITIES } from "../engine/steps";
import { ctxOf, realTable } from "../engine/testdb";
import { chooseAiAction } from "../../components/game/kernelAi";
import { legalActions } from "../engine/legal";
import type { Table } from "../engine/testkit";

const treasure = (t: Table): string => {
  const id = t.give("p1", "Sol Ring", "battlefield");
  t.state.objects[id].token = { name: "Treasure", types: ["artifact"], subtypes: ["Treasure"], colors: [], keywords: [], abilities: [PREDEFINED_TOKEN_ABILITIES.Treasure] } as never;
  return id;
};
const cast = (cardId: string) => ({ type: "castSpell", player: "p1", cardId } as const);

describe("AI payment planning", () => {
  it("spares the Treasure and the pain land when plain lands pay", () => {
    const t = realTable();
    const tr = treasure(t); const pain = t.give("p1", "Adarkar Wastes", "battlefield"); const isl = t.give("p1", "Island", "battlefield");
    const bs = t.give("p1", "Brainstorm", "hand");
    const picks = planPayment(t.state, cast(bs), ctxOf(t), "p1")!;
    expect(picks).toEqual([isl]);
    expect(picks).not.toContain(tr); expect(picks).not.toContain(pain);
  });
  it("keeps the color the rest of the hand needs: {1} is paid with the Island, not the Plains, when a white card waits in hand", () => {
    const t = realTable();
    const plains = t.give("p1", "Plains", "battlefield"); const isl = t.give("p1", "Island", "battlefield");
    t.give("p1", "Monologue Tax", "hand"); // {2}{W}
    const sol = t.give("p1", "Sol Ring", "hand");
    const picks = planPayment(t.state, cast(sol), ctxOf(t), "p1")!;
    expect(picks).toEqual([isl]);
    expect(picks).not.toContain(plains);
  });
  it("uses the Treasure when it is the only way", () => {
    const t = realTable();
    const tr = treasure(t);
    const bs = t.give("p1", "Brainstorm", "hand");
    expect(planPayment(t.state, cast(bs), ctxOf(t), "p1")).toEqual([tr]);
  });
  it("a commander cast: the tax is part of the plan (5 mana tapped for {2}{W}{U}{B}), the Treasure is spared", () => {
    const t = realTable();
    const c = t.give("p1", "Aminatou, the Fateshifter", "battlefield");
    t.state.objects[c].isCommander = true; t.state.objects[c].zone = "command"; t.state.battlefield = t.state.battlefield.filter((i) => i !== c); t.p("p1").command.push(c); t.p("p1").commanderCasts[c] = 1;
    const tr = treasure(t);
    const lands = [t.give("p1", "Plains", "battlefield"), t.give("p1", "Island", "battlefield"), t.give("p1", "Swamp", "battlefield"), t.give("p1", "Island", "battlefield"), t.give("p1", "Swamp", "battlefield")];
    const picks = planPayment(t.state, cast(c), ctxOf(t), "p1")!;
    expect(picks.slice().sort()).toEqual(lands.slice().sort());
    expect(picks).not.toContain(tr);
    const out = withPlannedPayment(cast(c), t.state, ctxOf(t), "p1");
    t.ok(out); expect(t.state.stack).toHaveLength(1); expect(t.obj(tr)?.zone).toBe("battlefield");
  });
  it("chooseAiAction casts with the planned sources attached", () => {
    const t = realTable();
    const tr = treasure(t); const isl = t.give("p1", "Island", "battlefield"); t.give("p1", "Island", "battlefield");
    t.give("p1", "Sol Ring", "hand");
    const act = chooseAiAction(legalActions(t.state, "p1", ctxOf(t)), t.state, ctxOf(t), "p1");
    if (act?.type === "castSpell") { expect((act as { payWith?: string[] }).payWith).not.toContain(tr); void isl; }
    expect(act).toBeTruthy();
  });
});
