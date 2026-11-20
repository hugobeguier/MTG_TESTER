import { describe, expect, it } from "vitest";
import { classifyCard, complexityOf, heuristicFlags } from "./deckAudit";

describe("deck audit classification", () => {
  it("classifies by row status and validator result", () => {
    expect(classifyCard({ rowStatus: undefined })).toBe("missing");
    expect(classifyCard({ rowStatus: "declined" })).toBe("declined");
    expect(classifyCard({ rowStatus: "failed" })).toBe("failed");
    expect(classifyCard({ rowStatus: "ok", validatorOk: true })).toBe("verified-candidate");
    expect(classifyCard({ rowStatus: "ok", validatorOk: false })).toBe("suspect");
  });
  it("flags heuristic words, ignoring reminder text", () => {
    expect(heuristicFlags("Draw two cards. You gain 2 life only if you cast this during your main phase.")).toEqual(["if", "only", "during"]);
    expect(heuristicFlags("Flying (if blocked, whatever)")).toEqual([]);
  });
  it("splits simple from complex", () => {
    expect(complexityOf("{T}: Add {G}.").level).toBe("simple");
    expect(complexityOf("Choose one —\n• Draw a card.\n• Gain 3 life.").level).toBe("complex");
  });
});
