import { describe, expect, it } from "vitest";
import { decisionIdFor, openDecision, slotKey, validateAnswer, viewForSeat, type PendingDecision } from "./decisions";
import type { VisibleCard } from "@/lib/types";

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

const card = (id: string) => ({ id, name: `Card ${id}`, typeLine: "Instant", oracleText: "" }) as unknown as VisibleCard;
const look: PendingDecision = { id: "d3", seatId: "s1", visibility: "private", kind: "library_look", sourceCardName: "Ponder", look: { seatId: "s1", mode: "reorder", cards: [card("k1"), card("k2")], remaining: 2, orderedCards: [] } };
const portent: PendingDecision = { id: "d3", seatId: "s1", visibility: "private", kind: "library_look", look: { seatId: "s2", lookerSeatId: "s1", mode: "reorder", cards: [card("k1")], remaining: 1 } };
const publicLook: PendingDecision = { ...look, id: "d4", visibility: "public" } as PendingDecision;
const manual: PendingDecision = { id: "d5", seatId: "s1", visibility: "private", kind: "library_search", flavor: "manual", destination: "hand" };
const myriad: PendingDecision = { id: "d6", seatId: "s1", visibility: "private", kind: "library_search", flavor: "myriad", sourceCardId: "m1" };
const fetch: PendingDecision = { id: "d7", seatId: "s1", visibility: "private", kind: "library_search", flavor: "basic_land_fetch", sourceCardId: "f1", sourceCardName: "Fetch" };
const tap: PendingDecision = { id: "d8", seatId: "s1", visibility: "private", kind: "myriad_tap", cardId: "m1", cardName: "Myriad Landscape" };

describe("library decisions", () => {
  it("opens once per decision and refuses a double open", () => {
    for (const d of [look, manual, myriad, fetch, tap]) {
      expect(openDecision(undefined, d)).toEqual({ decision: d, ok: true });
      expect(openDecision(d, d).ok).toBe(false);
    }
  });

  it("gives each library_search flavor its own slot and every other kind its kind", () => {
    expect([manual, myriad, fetch].map(slotKey)).toEqual(["library_search:manual", "library_search:myriad", "library_search:basic_land_fetch"]);
    expect([mana, block, look, tap].map(slotKey)).toEqual(["mana_color", "declare_blockers", "library_look", "myriad_tap"]);
  });

  it("validates library_look answers", () => {
    expect(validateAnswer(look, { id: "d3", kind: "look_pick", cardId: "k1", action: "top" }, "s1")).toEqual({ ok: true });
    expect(validateAnswer(look, { id: "d3", kind: "look_pick", cardId: "zz", action: "top" }, "s1").ok).toBe(false);
    expect(validateAnswer(look, { id: "d3", kind: "look_done" }, "s1")).toEqual({ ok: true });
    expect(validateAnswer(look, { id: "d3", kind: "look_done" }, "s2").ok).toBe(false);
    expect(validateAnswer(look, { id: "d3", kind: "search_pick", cardIds: [] }, "s1").ok).toBe(false);
    expect(validateAnswer(look, { id: "d3", kind: "decline" }, "s1")).toEqual({ ok: true });
  });

  it("validates library_search answers per flavor", () => {
    expect(validateAnswer(manual, { id: "d5", kind: "search_pick", cardIds: ["a"] }, "s1")).toEqual({ ok: true });
    expect(validateAnswer(manual, { id: "d5", kind: "search_pick", cardIds: ["a", "b"] }, "s1").ok).toBe(false);
    expect(validateAnswer(myriad, { id: "d6", kind: "search_pick", cardIds: ["a", "b"] }, "s1")).toEqual({ ok: true });
    expect(validateAnswer(myriad, { id: "d6", kind: "search_pick", cardIds: ["a", "b", "c"] }, "s1").ok).toBe(false);
    expect(validateAnswer(fetch, { id: "d7", kind: "search_pick", cardIds: [] }, "s1")).toEqual({ ok: true });
    expect(validateAnswer(fetch, { id: "d7", kind: "look_done" }, "s1").ok).toBe(false);
    expect(validateAnswer(fetch, { id: "d7", kind: "search_pick", cardIds: ["a"] }, "s2").ok).toBe(false);
  });

  it("validates myriad_tap answers", () => {
    expect(validateAnswer(tap, { id: "d8", kind: "tap_confirm" }, "s1")).toEqual({ ok: true });
    expect(validateAnswer(tap, { id: "d8", kind: "search_pick", cardIds: [] }, "s1").ok).toBe(false);
    expect(validateAnswer(tap, { id: "d9", kind: "tap_confirm" }, "s1").ok).toBe(false);
  });

  it("redacts private look payloads (cards, orderedCards) for other seats and shows the addressee everything", () => {
    expect(viewForSeat(look, "s1")).toBe(look);
    const seenByOther = viewForSeat(look, "s2");
    expect(seenByOther).toEqual({ id: "d3", seatId: "s1", kind: "library_look", visibility: "private", sourceCardName: "Ponder", cardCount: 2, redacted: true });
    expect(JSON.stringify(seenByOther)).not.toContain("k1");
    // Portent: the owner of the looked-at library (s2) is NOT the addressee and sees nothing of the cards.
    expect(viewForSeat(portent, "s2")).toMatchObject({ redacted: true, seatId: "s1" });
    expect(JSON.stringify(viewForSeat(portent, "s2"))).not.toContain("k1");
    expect(viewForSeat(manual, "s2")).toEqual({ id: "d5", seatId: "s1", kind: "library_search", visibility: "private", redacted: true });
  });

  it("shows a public look to every seat in full", () => {
    expect(viewForSeat(publicLook, "s2")).toBe(publicLook);
    expect(viewForSeat(publicLook, "s3")).toBe(publicLook);
  });

  it("round-trips through JSON", () => {
    for (const d of [look, portent, manual, myriad, fetch, tap]) expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });
});
