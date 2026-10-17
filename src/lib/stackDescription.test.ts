import { describe, expect, it } from "vitest";
import { describeStackItem, formatStackTargets, type StackItemLike } from "./stackDescription";
import type { GameSession, PlayerSeat, VisibleCard } from "./types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...overrides };
}

function seat(overrides: Partial<PlayerSeat> & Pick<PlayerSeat, "id" | "name" | "kind">): PlayerSeat {
  return {
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield: [] },
    ...overrides
  };
}

const bears = card({ id: "bears", name: "Grizzly Bears", typeLine: "Creature - Bear" });
const wurm = card({ id: "wurm", name: "Wurm", typeLine: "Creature - Wurm" });

const session: GameSession = {
  id: "t",
  createdAt: "",
  status: "playing",
  phase: "precombat main phase",
  turn: 1,
  xmage: { enabled: false, status: "not_configured", message: "" },
  seats: [
    seat({ id: "me", name: "Hugo", kind: "human", board: { hand: [], battlefield: [bears] } }),
    seat({ id: "ai", name: "Bot", kind: "agent", board: { hand: [], battlefield: [wurm], graveyard: [card({ id: "gy1", name: "Old Spell", typeLine: "Instant", zone: "graveyard" })] } })
  ],
  events: []
};

describe("describeStackItem", () => {
  it("describes a spell with a card target and flags it when it hits the human", () => {
    const item: StackItemLike = {
      id: "s1", type: "spell", actorSeatId: "ai", cardId: "x", cardName: "Doom Blade", message: "Bot casts Doom Blade.",
      castChoices: { targets: [{ kind: "card", seatId: "me", cardId: "bears" }] },
      sourceCard: { typeLine: "Instant", oracleText: "Destroy target nonblack creature." }
    };
    const d = describeStackItem(session, item);
    expect(d.source).toBe("Doom Blade");
    expect(d.controller).toBe("Bot");
    expect(d.summary).toBe("Destroy target nonblack creature.");
    expect(d.targets).toEqual([expect.objectContaining({ kind: "card", label: "Grizzly Bears", seatId: "me", seatName: "Hugo" })]);
    expect(d.affectsPlayerSeatId).toBe("me");
    expect(formatStackTargets(d, "me")).toBe("Grizzly Bears (yours)");
  });

  it("does not flag the human's own spell targeting their own permanent", () => {
    const item: StackItemLike = { id: "s2", type: "spell", actorSeatId: "me", cardName: "Giant Growth", castChoices: { targets: [{ kind: "card", seatId: "me", cardId: "bears" }] } };
    expect(describeStackItem(session, item).affectsPlayerSeatId).toBeUndefined();
  });

  it("describes a player target", () => {
    const item: StackItemLike = { id: "s3", type: "spell", actorSeatId: "ai", cardName: "Lightning Bolt", castChoices: { targets: [{ kind: "player", seatId: "me" }] } };
    const d = describeStackItem(session, item);
    expect(d.targets[0]).toMatchObject({ kind: "player", label: "Hugo" });
    expect(d.affectsPlayerSeatId).toBe("me");
    expect(formatStackTargets(d, "me")).toBe("you");
  });

  it("reads trigger targets from chosenOption (encoded and bare ids) and ignores mode indices", () => {
    const item: StackItemLike = {
      id: "t1", type: "trigger", actorSeatId: "ai", controllerSeatId: "ai", sourceCardId: "wurm", sourceCardName: "Wurm", message: "Wurm triggers.",
      effect: { kind: "x", chosenOption: "0,bears,p:me" },
      sourceCard: { typeLine: "Creature", oracleText: "Flying\nWhen Wurm enters, tap target creature." }
    };
    const d = describeStackItem(session, item);
    expect(d.targets.map((t) => t.label)).toEqual(["Grizzly Bears", "Hugo"]);
    expect(d.summary).toBe("When Wurm enters, tap target creature.");
    expect(d.affectsPlayerSeatId).toBe("me");
  });

  it("finds a graveyard target and names its zone", () => {
    const item: StackItemLike = { id: "t2", type: "trigger", actorSeatId: "me", controllerSeatId: "me", sourceCardName: "Necro", effect: { chosenOption: "c:ai:gy1" } };
    const d = describeStackItem(session, item);
    expect(d.targets[0].label).toBe("Old Spell (in graveyard)");
    expect(d.affectsPlayerSeatId).toBeUndefined();
  });

  it("reports no targets, and pending targets when the text needs one but none was recorded", () => {
    const none = describeStackItem(session, { id: "s4", type: "spell", actorSeatId: "ai", cardName: "Ancestral Recall", sourceCard: { typeLine: "Instant", oracleText: "Target player draws three cards." } }, []);
    expect(none.targetsPending).toBe(true);
    expect(formatStackTargets(none)).toBe("target chosen on resolution");
    const plain = describeStackItem(session, { id: "s5", type: "spell", actorSeatId: "ai", cardName: "Divination", sourceCard: { typeLine: "Sorcery", oracleText: "Draw two cards." } });
    expect(plain.targetsPending).toBe(false);
    expect(formatStackTargets(plain)).toBe("no targets");
  });

  it("describes a counterspell's stack-item target", () => {
    const stack: StackItemLike[] = [
      { id: "s6", type: "spell", actorSeatId: "me", cardId: "c6", cardName: "Cultivate" },
      { id: "s7", type: "spell", actorSeatId: "ai", cardName: "Counterspell", counterTargetId: "s6" }
    ];
    const d = describeStackItem(session, stack[1], stack);
    expect(d.targets[0]).toMatchObject({ kind: "stack", label: "Cultivate", seatId: "me" });
    expect(d.affectsPlayerSeatId).toBe("me");
  });
});
