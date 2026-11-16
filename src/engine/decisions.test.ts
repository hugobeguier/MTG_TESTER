import { describe, expect, it } from "vitest";
import { decisionIdFor, openDecision, validateAnswer, viewForSeat, type PendingDecision } from "./decisions";

const mana: PendingDecision = { id: "d1", seatId: "s1", visibility: "private", kind: "mana_color", cardId: "c1", cardName: "Command Tower", location: "battlefield", choices: ["W", "U"], sourceCardName: "Command Tower" };
const block: PendingDecision = { id: "d2", seatId: "s2", visibility: "public", kind: "declare_blockers", attackerSeatId: "s1", defenderSeatId: "s2", attackerCardId: "a1", targetId: "s2" };

describe("decisions", () => {
  it("opens once and refuses a double open", () => {
    const first = openDecision(undefined, mana);
    expect(first).toEqual({ decision: mana, ok: true });
    const second = openDecision(first.decision, block);
    expect(second.ok).toBe(false);
    expect(second.decision).toBe(mana);
  });

  it("builds deterministic ids", () => {
    expect(decisionIdFor(3)).toBe("decision-3");
  });

  it("validates answers", () => {
    expect(validateAnswer(mana, { id: "x", kind: "color", color: "W" }, "s1").ok).toBe(false);
    expect(validateAnswer(mana, { id: "d1", kind: "blockers", cardIds: [] }, "s1").ok).toBe(false);
    expect(validateAnswer(mana, { id: "d1", kind: "color", color: "R" }, "s1").ok).toBe(false);
    expect(validateAnswer(mana, { id: "d1", kind: "color", color: "U" }, "s2").ok).toBe(false);
    expect(validateAnswer(mana, { id: "d1", kind: "color", color: "U" }, "s1")).toEqual({ ok: true });
    expect(validateAnswer(mana, { id: "d1", kind: "decline" }, "s1")).toEqual({ ok: true });
    expect(validateAnswer(block, { id: "d2", kind: "blockers", cardIds: ["b1"] }, "s2")).toEqual({ ok: true });
    expect(validateAnswer(block, { id: "d2", kind: "color", color: "W" }, "s2").ok).toBe(false);
  });

  it("redacts private decisions for other seats only", () => {
    expect(viewForSeat(mana, "s1")).toBe(mana);
    expect(viewForSeat(mana, "s2")).toEqual({ id: "d1", seatId: "s1", kind: "mana_color", visibility: "private", sourceCardName: "Command Tower", redacted: true });
    expect(viewForSeat(block, "s1")).toBe(block);
  });

  it("round-trips through JSON", () => {
    expect(JSON.parse(JSON.stringify(mana))).toEqual(mana);
    expect(JSON.parse(JSON.stringify(block))).toEqual(block);
  });
});
