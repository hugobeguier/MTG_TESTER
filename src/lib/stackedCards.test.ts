// Rule 601.2a: a spell being cast is on the stack, not in hand, so no hand-based choice may offer it (reported live: Ledger Shredder's
// connive trigger from casting a spell listed that spell as a discard candidate).
import { describe, expect, it } from "vitest";
import { real, seat, session } from "@/components/AppFlow.batch3Abilities.test";
import { chooseWorstHandCardToDiscard, discardableHandCards } from "@/engine/effects";
import { applyConniveDiscard } from "@/engine/oneShotEffects";
import { resolveTriggerEffect } from "@/engine/triggers";
import { discardOptions } from "@/engine/castTargets";
import type { PendingAction } from "@/engine/types";
import { handExcludingStack, seatWithoutStackedCards, spellCardIdsOnStack } from "@/lib/stackedCards";

const spell = (id: string, actorSeatId = "a", extra: Partial<PendingAction> = {}) => ({ id: `act-${id}`, type: "spell", actorSeatId, cardId: id, cardName: id, ...extra }) as PendingAction;

describe("spellCardIdsOnStack", () => {
  it("lists spells on the stack plus the pending window, skips copies, triggers and phases", () => {
    const trigger = { id: "t1", type: "trigger", actorSeatId: "a" } as unknown as PendingAction;
    expect(spellCardIdsOnStack([spell("x"), trigger, spell("c", "a", { isCopy: true } as never)], spell("y"))).toEqual(["x", "y"]);
  });
});

describe("a spell on the stack can't be discarded", () => {
  const hand = () => [real("Ritual of Soot", "cast-me", { manaValue: 4 }), real("Island", "isl", { manaValue: 0 }), real("Opt", "opt", { manaValue: 1 })];
  const stacked = ["cast-me"];

  it("discardable/choose-worst skip the stacked card even when it is the priciest", () => {
    const s = seat("a", [], { board: { hand: hand(), battlefield: [], graveyard: [] } });
    expect(chooseWorstHandCardToDiscard(s)?.id).toBe("cast-me");
    expect(chooseWorstHandCardToDiscard(s, undefined, stacked)?.id).toBe("opt");
    expect(discardableHandCards(s, undefined, stacked).map((c) => c.id)).toEqual(["isl", "opt"]);
    expect(handExcludingStack(s, stacked).map((c) => c.id)).toEqual(["isl", "opt"]);
    expect(seatWithoutStackedCards({ stackSpellCardIds: stacked }, s).board.hand).toHaveLength(2);
    expect(discardOptions(s, [], stacked).map((o) => o.label)).toEqual(["Discard Island", "Discard Opt", "Discard nothing"]);
  });

  it("Ledger Shredder connive (cast trigger): the spell stays in hand, never discarded", () => {
    const shredder = real("Ledger Shredder", "ls");
    const library = [real("Island", "lib1", { zone: "library" })];
    const s = seat("a", [shredder], { library, board: { hand: [real("Ritual of Soot", "cast-me", { manaValue: 4 })], battlefield: [shredder], graveyard: [] } });
    const game = session([s], { stackSpellCardIds: stacked });
    const trigger = { id: "tr", type: "trigger", actorSeatId: "a", controllerSeatId: "a", sourceCardId: "ls", sourceCardName: "Ledger Shredder", effect: { kind: "connive", amount: 1 }, message: "" } as unknown as Extract<PendingAction, { type: "trigger" }>;
    const after = resolveTriggerEffect(game, trigger);
    const hand = after.seats[0]!.board.hand.map((c) => c.id);
    expect(hand).toContain("cast-me");
    expect((after.seats[0]!.board.graveyard ?? []).map((c) => c.id)).toEqual(["lib1"]);
  });

  it("applyConniveDiscard refuses a stacked card (stale or forged pick)", () => {
    const s = seat("a", [], { board: { hand: hand(), battlefield: [], graveyard: [] } });
    const game = session([s], { stackSpellCardIds: stacked });
    expect(applyConniveDiscard(game, "a", "ls", "Ledger Shredder", "cast-me")).toBe(game);
    expect(applyConniveDiscard(game, "a", "ls", "Ledger Shredder", "isl")).not.toBe(game);
  });
});
