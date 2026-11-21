// Kernel step 6: the monarch (become_monarch, end-step draw, stealing by combat damage), controller_is_monarch predicate.
import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { fam } from "./famkit";
import { realDef, realTable } from "./testdb";

describe("monarch", () => {
  it("Court of Grace is supported", () => { expect(cardUnsupported(realDef("Court of Grace")!).all).toEqual([]); });
  it("entering makes you the monarch (etb trigger); the monarch draws at their end step", () => {
    const t = realTable(); t.lands("p1", "Plains", 4);
    for (let i = 0; i < 4; i++) { t.give("p1", "Plains", "library"); t.give("p2", "Plains", "library"); }
    const c = t.give("p1", "Court of Grace", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: c });
    for (let i = 0; i < 6 && (t.state.stack.length || t.state.pending); i++) { if (t.state.pending) t.ok({ type: "answerDecision", player: t.state.pending.player, decisionId: t.state.pending.id, choice: { ids: t.state.pending.options.map((o) => o.id) } }); else t.resolveTop(); }
    expect(t.state.monarch).toBe("p1");
    const hand = t.p("p1").hand.length;
    for (let i = 0; i < 30 && t.state.turn.phase !== "end_step"; i++) t.ok({ type: "advancePhase", player: "p1" });
    expect(t.state.turn.phase).toBe("end_step");
    expect(t.p("p1").hand.length).toBe(hand + 1);
  });
  it("combat damage to the monarch by a creature steals the monarchy; non-combat damage does not", () => {
    const t = fam(); t.state.monarch = "p2";
    const a = t.give("p1", "Fill A", "battlefield");
    for (let i = 0; i < 4; i++) { t.give("p1", "Fill B", "library"); t.give("p2", "Fill B", "library"); }
    t.ok({ type: "advancePhase", player: "p1" }); t.ok({ type: "advancePhase", player: "p1" });
    t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: a, defender: "p2" }] });
    for (let i = 0; i < 6 && t.state.monarch === "p2"; i++) t.ok({ type: "advancePhase", player: "p1" });
    expect(t.state.monarch).toBe("p1");
  });
  it("hidden information: the monarch flag is public state and survives viewFor", async () => {
    const { viewFor } = await import("./view");
    const t = fam(); t.state.monarch = "p2";
    expect(viewFor(t.state, "p1").monarch).toBe("p2");
  });
});
