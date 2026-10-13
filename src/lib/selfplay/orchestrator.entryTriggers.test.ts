// drainEntryTriggers is the headless stand-in for AppFlow.tsx's pendingEntries effect: a permanent that just entered
// (cast, land drop, token, reanimated, fetched) must fire its own enters trigger and the board's watchers.
import { describe, expect, it } from "vitest";
import { drainEntryTriggers } from "./orchestrator";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

function permanent(id: string, name: string, typeLine: string, oracleText: string): VisibleCard {
  return { id, name, typeLine, oracleText, manaValue: 0, colors: [], role: "permanent", zone: "battlefield" };
}

function sessionWith(battlefield: VisibleCard[], entering: VisibleCard): GameSession {
  const seat: PlayerSeat = {
    id: "p",
    name: "You",
    kind: "agent",
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield },
    library: []
  };
  return {
    id: "test",
    createdAt: "",
    status: "playing",
    phase: "precombat main phase",
    turn: 1,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats: [seat],
    events: [],
    pendingEntries: [{ seatId: "p", card: entering }]
  };
}

describe("drainEntryTriggers", () => {
  it("fires the entering creature's own 'when this creature enters' trigger", () => {
    const priest = permanent("c", "Test Priest", "Creature — Cleric", "When this creature enters, you gain 3 life.");
    const after = drainEntryTriggers(sessionWith([priest], priest));
    expect(after.seats[0].life).toBe(43);
    expect(after.pendingEntries).toBeUndefined();
  });

  it("fires another permanent's landfall watcher when a land enters", () => {
    const watcher = permanent("w", "Test Watcher", "Enchantment", "Landfall — Whenever a land enters under your control, you gain 1 life.");
    const land = permanent("l", "Test Land", "Land", "");
    const after = drainEntryTriggers(sessionWith([watcher, land], land));
    expect(after.seats[0].life).toBe(41);
  });

  it("ignores an entry that already left the battlefield", () => {
    const priest = permanent("c", "Test Priest", "Creature — Cleric", "When this creature enters, you gain 3 life.");
    const after = drainEntryTriggers(sessionWith([], priest));
    expect(after.seats[0].life).toBe(40);
  });
});
