import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

// saveStore.ts always calls the real getCardDb() (src/lib/cardDb.ts), which is a singleton backed
// by the real data/cards.db file — there's no existing seam in this codebase for redirecting it to
// an isolated database (cardDb.ts has no test file of its own either). Mocking the module here
// swaps in a fresh in-memory SQLite database with just the one table saveStore.ts actually touches,
// so these tests exercise the real prepared-statement/upsert logic without ever opening the real
// on-disk database.
let testDb: Database.Database;
vi.mock("./cardDb", () => ({
  getCardDb: () => testDb
}));

// Imported after the mock is set up so saveStore.ts's own `import { getCardDb } from "./cardDb"`
// resolves to the mocked version above.
const { deleteSavedGame, getSavedGame, listSavedGames, writeSavedGame } = await import("./saveStore");
const { SAVE_FORMAT_VERSION } = await import("./saveGame");
import type { GameSnapshot } from "./saveGame";

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    formatVersion: SAVE_FORMAT_VERSION,
    savedAt: "2026-01-01T00:00:00.000Z",
    session: {
      id: "s1",
      createdAt: "",
      status: "playing",
      phase: "precombat main phase",
      turn: 5,
      xmage: { enabled: false, status: "not_configured", message: "" },
      seats: [],
      events: []
    },
    gameStage: "playing",
    holdPriorityOnce: false,
    priorityPasses: [],
    mulligans: {},
    keptHands: {},
    manaPools: {},
    manaContributions: {},
    restrictedManaBatches: {},
    turnCounters: {
      landPlaysThisTurn: [],
      spellsCastThisTurn: [],
      firstDrawThisTurn: [],
      loyaltyActivationsThisTurn: [],
      phaseTriggersChecked: [],
      cleanupDiscardChecked: [],
      cleanupRestrictedManaChecked: [],
      agentMainActions: [],
      commanderZoneChoiceAsked: [],
      auraRetargetAsked: []
    },
    ...overrides
  };
}

beforeEach(() => {
  testDb = new Database(":memory:");
  testDb.exec(`
    CREATE TABLE saved_games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      format_version INTEGER NOT NULL,
      turn INTEGER NOT NULL,
      phase TEXT NOT NULL,
      summary TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      state TEXT NOT NULL
    );
  `);
});

describe("saveStore — write, list, get, delete", () => {
  it("writes a save and reads it back in full via getSavedGame", () => {
    writeSavedGame({ id: "save-1", name: "Turn 5", turn: 5, phase: "precombat main phase", summary: "Turn 5 — precombat main phase", savedAt: "2026-01-01T00:00:00.000Z", snapshot: snapshot() });
    const loaded = getSavedGame("save-1");
    expect(loaded?.session.turn).toBe(5);
    expect(loaded?.formatVersion).toBe(SAVE_FORMAT_VERSION);
  });

  it("lists saves with the summary columns matching the snapshot's own turn/phase, without needing to parse state", () => {
    writeSavedGame({ id: "save-1", name: "Turn 5", turn: 5, phase: "precombat main phase", summary: "Turn 5 — precombat main phase", savedAt: "2026-01-01T00:00:00.000Z", snapshot: snapshot() });
    const list = listSavedGames();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "save-1", name: "Turn 5", turn: 5, phase: "precombat main phase" });
  });

  it("overwrites rather than duplicating a second write with the same id", () => {
    writeSavedGame({ id: "save-1", name: "Turn 5", turn: 5, phase: "precombat main phase", summary: "s", savedAt: "2026-01-01T00:00:00.000Z", snapshot: snapshot() });
    writeSavedGame({
      id: "save-1",
      name: "Turn 6",
      turn: 6,
      phase: "combat",
      summary: "s2",
      savedAt: "2026-01-01T01:00:00.000Z",
      snapshot: snapshot({ session: { ...snapshot().session, turn: 6, phase: "combat" } })
    });
    const list = listSavedGames();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Turn 6", turn: 6 });
  });

  it("deletes a save", () => {
    writeSavedGame({ id: "save-1", name: "Turn 5", turn: 5, phase: "precombat main phase", summary: "s", savedAt: "2026-01-01T00:00:00.000Z", snapshot: snapshot() });
    deleteSavedGame("save-1");
    expect(listSavedGames()).toHaveLength(0);
    expect(getSavedGame("save-1")).toBeUndefined();
  });
});
