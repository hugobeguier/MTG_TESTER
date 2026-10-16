// drainEntryTriggers is the headless stand-in for AppFlow.tsx's pendingEntries effect: a permanent that just entered
// (cast, land drop, token, reanimated, fetched) must fire its own enters trigger and the board's watchers.
import { describe, expect, it } from "vitest";
import { advanceSagaLoreCountersHeadless } from "@/components/AppFlow";
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

describe("Sagas in the simulator", () => {
  const sagaText = "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — You gain 2 life.\nII — You gain 3 life.\nIII — You gain 4 life.";

  it("chapter I fires when the Saga enters, and each later draw step advances it until it is sacrificed", () => {
    const saga = permanent("s", "Test Saga", "Enchantment — Saga", sagaText);
    let s = drainEntryTriggers(sessionWith([saga], saga));
    expect(s.seats[0].life).toBe(42);
    expect(s.seats[0].board.battlefield[0].counters?.find((c) => c.kind === "lore")?.count).toBe(1);
    s = advanceSagaLoreCountersHeadless(s, "p");
    expect(s.seats[0].life).toBe(45);
    s = advanceSagaLoreCountersHeadless(s, "p");
    expect(s.seats[0].life).toBe(49);
    expect(s.seats[0].board.battlefield.some((c) => c.id === "s")).toBe(false);
  });

  it("does not fire chapter I a second time for a Saga that already has a lore counter", () => {
    const saga = permanent("s", "Test Saga", "Enchantment — Saga", sagaText);
    const once = drainEntryTriggers(sessionWith([saga], saga));
    const again = drainEntryTriggers({ ...once, pendingEntries: [{ seatId: "p", card: once.seats[0].board.battlefield[0] }] });
    expect(again.seats[0].life).toBe(42);
  });
});
