import { describe, expect, it } from "vitest";
import { deserializeTurnCounters, isCleanSaveStop, SAVE_FORMAT_VERSION, serializeTurnCounters, type CleanSaveStopInput, type GameSnapshot, type TurnCounters } from "./saveGame";

function snapshot(): GameSnapshot {
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
    activeSeatId: "seat-1",
    prioritySeatId: "seat-1",
    gameStage: "playing",
    holdPriorityOnce: false,
    priorityPasses: [],
    mulligans: { "seat-1": 0 },
    keptHands: { "seat-1": true },
    manaPools: { "seat-1": { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } },
    manaContributions: {},
    restrictedManaBatches: {},
    turnCounters: {
      landPlaysThisTurn: ["seat-1"],
      spellsCastThisTurn: [["5:seat-1", 2]],
      firstDrawThisTurn: [],
      loyaltyActivationsThisTurn: [],
      phaseTriggersChecked: ["5:seat-1:upkeep"],
      cleanupDiscardChecked: [],
      cleanupRestrictedManaChecked: [],
      agentMainActions: [],
      commanderZoneChoiceAsked: [],
      auraRetargetAsked: []
    }
  };
}

describe("GameSnapshot — round-trips through JSON", () => {
  it("survives a JSON.stringify/parse round trip byte-for-byte", () => {
    const original = snapshot();
    const roundTripped = JSON.parse(JSON.stringify(original));
    expect(roundTripped).toEqual(original);
  });
});

describe("serializeTurnCounters / deserializeTurnCounters", () => {
  it("round-trips a populated Set/Map pair", () => {
    const counters: TurnCounters = {
      landPlaysThisTurn: new Set(["seat-1"]),
      spellsCastThisTurn: new Map([["5:seat-1", 2]]),
      firstDrawThisTurn: new Set(["seat-2"]),
      loyaltyActivationsThisTurn: new Set(),
      phaseTriggersChecked: new Set(["5:seat-1:upkeep", "5:seat-1:draw"]),
      cleanupDiscardChecked: new Set(),
      cleanupRestrictedManaChecked: new Set(),
      agentMainActions: new Set(["5:seat-2"]),
      commanderZoneChoiceAsked: new Set(),
      auraRetargetAsked: new Set()
    };
    const snapshotted = serializeTurnCounters(counters);
    const restored = deserializeTurnCounters(snapshotted);
    expect(restored.landPlaysThisTurn).toEqual(counters.landPlaysThisTurn);
    expect(restored.spellsCastThisTurn).toEqual(counters.spellsCastThisTurn);
    expect(restored.phaseTriggersChecked).toEqual(counters.phaseTriggersChecked);
    expect(restored.agentMainActions).toEqual(counters.agentMainActions);
  });
});

describe("isCleanSaveStop", () => {
  const cleanInput: CleanSaveStopInput = {
    mode: "game",
    gameStage: "playing",
    sessionStatus: "playing",
    hasPendingAction: false,
    stackActionCount: 0,
    hasOpenModal: false,
    pendingDeathsCount: 0,
    pendingEntriesCount: 0,
    pendingCombatDamageToPlayerCount: 0,
    pendingGraveyardDeparturesCount: 0,
    anyAgentThinking: false,
    prioritySeatId: "seat-human",
    humanSeatId: "seat-human"
  };

  it("returns ok for a clean board", () => {
    expect(isCleanSaveStop(cleanInput)).toEqual({ ok: true });
  });

  it("blocks with a specific reason when the stack isn't empty", () => {
    const result = isCleanSaveStop({ ...cleanInput, stackActionCount: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/stack/i);
  });

  it("blocks with a specific reason when a modal choice is open", () => {
    const result = isCleanSaveStop({ ...cleanInput, hasOpenModal: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/choice/i);
  });

  it("blocks with a specific reason when an agent is still thinking", () => {
    const result = isCleanSaveStop({ ...cleanInput, anyAgentThinking: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/agent/i);
  });

  it("blocks with a specific reason when it isn't the human's priority", () => {
    const result = isCleanSaveStop({ ...cleanInput, prioritySeatId: "seat-agent" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/priority/i);
  });

  it("blocks when a pending trigger queue is non-empty", () => {
    expect(isCleanSaveStop({ ...cleanInput, pendingGraveyardDeparturesCount: 1 }).ok).toBe(false);
  });
});
