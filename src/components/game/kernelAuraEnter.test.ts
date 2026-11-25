// An Aura copy (Extravagant Replication) entering without being cast asks its controller what to enchant; the AI answers that prompt.
import { describe, expect, it } from "vitest";
import { ctx } from "@/kernel/integration/testgame";
import { legalActions } from "@/kernel/engine/legal";
import { G, base, toUpkeep } from "@/kernel/engine/aminatoukit";
import { chooseAiAction } from "./kernelAi";

describe("AI: what does the entering Aura enchant", () => {
  it("answers the choose_option prompt with a legal creature and the copy attaches to it", () => {
    const m = base(); m.give("p1", "Extravagant Replication", "battlefield");
    const a = m.give("p1", "Ledger Shredder", "battlefield"); const b = m.give("p2", "Esper Sentinel", "battlefield"); const aura = m.give("p1", "Vanishing", "battlefield");
    const st = m.state; st.objects[aura].attachedTo = a; st.objects[aura].attachedToTs = st.objects[a].timestamp;
    const g = new G(m);
    let picked = "";
    const ans = (p: { kind: string; prompt: { title: string } }) => {
      if (p.kind === "choose_targets") return { ids: [aura] };
      if (p.kind !== "choose_option") return undefined;
      expect(p.prompt.title).toMatch(/Vanishing/);
      const act = chooseAiAction(legalActions(g.s, "p1", ctx), g.s, ctx, "p1");
      expect(act?.type).toBe("answerDecision");
      const choice = (act as { choice: { ids: string[] } }).choice;
      picked = choice.ids[0];
      return choice;
    };
    toUpkeep(g, "p1", ans as never); g.drive(ans as never);
    expect([a, b]).toContain(picked);
    const copy = g.bf("Vanishing").find((i) => g.obj(i).token)!;
    expect(g.obj(copy).attachedTo).toBe(picked);
  });
});
