import { describe, expect, it } from "vitest";
import type { PendingRuleChoice } from "@/engine/types";
import type { LibraryLookState } from "@/engine/flowTypes";
import { promptOwnersOf, promptSlotsForSeat, type PromptSlots } from "./seatPrompts";

const look = (patch: Partial<LibraryLookState> = {}): LibraryLookState => ({ seatId: "friend", mode: "choose_one_bottom", cards: [], remaining: 5, allowedCardFilter: "creature or land", restDestination: "graveyard", ...patch });
const rule = (controllerSeatId: string) => ({ id: "r", kind: "choose_color", controllerSeatId, sourceCardId: "c", sourceCardName: "X", prompt: "?" }) as PendingRuleChoice;

describe("promptSlotsForSeat: every choice box goes to the seat it is addressed to only", () => {
  it("Grisly Salvage cast by a friend: the host's table gets nothing, the friend gets the look", () => {
    const slots: PromptSlots = { libraryLook: look({ seatId: "friend", lookerSeatId: undefined }) };
    expect(promptSlotsForSeat(slots, "host").libraryLook).toBeUndefined();
    expect(promptSlotsForSeat(slots, "friend").libraryLook).toBe(slots.libraryLook);
  });
  it("a look at another player's library belongs to the LOOKER, not the library owner (Portent)", () => {
    const slots: PromptSlots = { libraryLook: look({ seatId: "host", lookerSeatId: "friend", mode: "reorder" }) };
    expect(promptSlotsForSeat(slots, "host").libraryLook).toBeUndefined();
    expect(promptSlotsForSeat(slots, "friend").libraryLook).toBeDefined();
  });
  it("covers rule, block, mana, myriad and basic-land prompts and a manual search", () => {
    const slots: PromptSlots = {
      pendingRuleChoice: rule("friend"),
      libraryLook: look(),
      blockChoice: { attackerSeatId: "host", defenderSeatId: "friend", attackerCardId: "a" } as never,
      manaChoice: { seatId: "friend", cardId: "m", cardName: "M", location: "battlefield", choices: [] } as never,
      myriadTapChoice: { seatId: "friend", cardId: "t", cardName: "T" },
      myriadSearch: { seatId: "friend", sourceCardId: "s" },
      basicLandFetchSearch: { seatId: "friend", sourceCardId: "b", sourceCardName: "B" },
      manualLibrarySearch: { seatId: "friend", destination: "hand" }
    };
    expect(promptOwnersOf(slots)).toMatchObject({ rule: "friend", block: "friend", mana: "friend" });
    const host = promptSlotsForSeat(slots, "host");
    expect(Object.values(host).every((slot) => slot === undefined)).toBe(true);
    const friend = promptSlotsForSeat(slots, "friend");
    expect(Object.values(friend).every((slot) => slot !== undefined)).toBe(true);
  });
  it("a miracle offer for a friend's seat (Aminatou, Veil Piercer) reaches only that friend's snapshot", () => {
    const miracle = { id: "m", kind: "miracle_offer", controllerSeatId: "friend", sourceCardId: "e1", sourceCardName: "E", prompt: "?", miracleCost: 2 } as PendingRuleChoice;
    expect(promptSlotsForSeat({ pendingRuleChoice: miracle }, "host").pendingRuleChoice).toBeUndefined();
    expect(promptSlotsForSeat({ pendingRuleChoice: miracle }, "friend").pendingRuleChoice).toBe(miracle);
  });
  it("host-addressed prompts still reach the host and not a friend", () => {
    const slots: PromptSlots = { pendingRuleChoice: rule("host"), libraryLook: look({ seatId: "host" }) };
    expect(promptSlotsForSeat(slots, "host").pendingRuleChoice).toBeDefined();
    expect(promptSlotsForSeat(slots, "friend").libraryLook).toBeUndefined();
    expect(promptSlotsForSeat(slots, "friend").pendingRuleChoice).toBeUndefined();
  });
});
