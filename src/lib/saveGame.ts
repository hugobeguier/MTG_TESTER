// Shared types and pure helpers for saving/loading a game in progress. Deliberately has no
// node:fs/better-sqlite3 import (see saveStore.ts for the actual DB access) so this module is safe
// to import from both a client component (AppFlow.tsx, to build/apply a snapshot) and a server route
// (app/api/saves/*, to validate one).
//
// GameSession (src/lib/types.ts) already round-trips through JSON today (it's what /api/session
// serves) and holds essentially all real game state — seats, libraries, boards, graveyards, life,
// commander damage, the event log, every pendingXxx queue. The only other real state lives in
// AppFlow.tsx's own React hooks (mana pools, priority, the stack, the mulligan bookkeeping, and a
// handful of per-turn useRef counters) — GameSnapshot below captures exactly that, and nothing more.
import type { GameSession, ManaContribution, ManaPool, RestrictedManaBatch } from "./types";

// Bump whenever GameSnapshot's shape (or anything it embeds, like GameSession itself) changes —
// VisibleCard/GameSession gain fields regularly in this project, and an old save loading into a
// newer shape would silently produce a board missing whatever was added since. applySnapshot (in
// AppFlow.tsx) refuses to load a snapshot whose formatVersion doesn't match this constant.
export const SAVE_FORMAT_VERSION = 1;

// The useRef-held per-turn counters flattened to plain arrays for JSON — see each ref's own comment
// in AppFlow.tsx for what it tracks and why it matters on reload (phaseTriggersChecked is the one
// that most obviously does: without it, loading a save taken right after your upkeep would fire
// every upkeep trigger a second time).
export interface TurnCountersSnapshot {
  landPlaysThisTurn: string[];
  spellsCastThisTurn: Array<[string, number]>;
  firstDrawThisTurn: string[];
  loyaltyActivationsThisTurn: string[];
  phaseTriggersChecked: string[];
  cleanupDiscardChecked: string[];
  cleanupRestrictedManaChecked: string[];
  agentMainActions: string[];
  commanderZoneChoiceAsked: string[];
  auraRetargetAsked: string[];
}

// The live Set/Map values those same refs actually hold, as read directly off `.current` — the
// input to serializeTurnCounters and the output of deserializeTurnCounters.
export interface TurnCounters {
  landPlaysThisTurn: Set<string>;
  spellsCastThisTurn: Map<string, number>;
  firstDrawThisTurn: Set<string>;
  loyaltyActivationsThisTurn: Set<string>;
  phaseTriggersChecked: Set<string>;
  cleanupDiscardChecked: Set<string>;
  cleanupRestrictedManaChecked: Set<string>;
  agentMainActions: Set<string>;
  commanderZoneChoiceAsked: Set<string>;
  auraRetargetAsked: Set<string>;
}

export function serializeTurnCounters(counters: TurnCounters): TurnCountersSnapshot {
  return {
    landPlaysThisTurn: [...counters.landPlaysThisTurn],
    spellsCastThisTurn: [...counters.spellsCastThisTurn.entries()],
    firstDrawThisTurn: [...counters.firstDrawThisTurn],
    loyaltyActivationsThisTurn: [...counters.loyaltyActivationsThisTurn],
    phaseTriggersChecked: [...counters.phaseTriggersChecked],
    cleanupDiscardChecked: [...counters.cleanupDiscardChecked],
    cleanupRestrictedManaChecked: [...counters.cleanupRestrictedManaChecked],
    agentMainActions: [...counters.agentMainActions],
    commanderZoneChoiceAsked: [...counters.commanderZoneChoiceAsked],
    auraRetargetAsked: [...counters.auraRetargetAsked]
  };
}

export function deserializeTurnCounters(snapshot: TurnCountersSnapshot): TurnCounters {
  return {
    landPlaysThisTurn: new Set(snapshot.landPlaysThisTurn),
    spellsCastThisTurn: new Map(snapshot.spellsCastThisTurn),
    firstDrawThisTurn: new Set(snapshot.firstDrawThisTurn),
    loyaltyActivationsThisTurn: new Set(snapshot.loyaltyActivationsThisTurn),
    phaseTriggersChecked: new Set(snapshot.phaseTriggersChecked),
    cleanupDiscardChecked: new Set(snapshot.cleanupDiscardChecked),
    cleanupRestrictedManaChecked: new Set(snapshot.cleanupRestrictedManaChecked),
    agentMainActions: new Set(snapshot.agentMainActions),
    commanderZoneChoiceAsked: new Set(snapshot.commanderZoneChoiceAsked),
    auraRetargetAsked: new Set(snapshot.auraRetargetAsked)
  };
}

export interface GameSnapshot {
  formatVersion: number;
  savedAt: string;
  session: GameSession;
  activeSeatId?: string;
  prioritySeatId?: string;
  gameStage: "mulligan" | "playing";
  holdPriorityOnce: boolean;
  priorityPasses: string[];
  mulligans: Record<string, number>;
  keptHands: Record<string, boolean>;
  manaPools: Record<string, ManaPool>;
  manaContributions: Record<string, ManaContribution[]>;
  restrictedManaBatches: Record<string, RestrictedManaBatch[]>;
  turnCounters: TurnCountersSnapshot;
}

// The row shape the setup screen's saved-games list renders — deliberately without `state` (the
// full GameSnapshot), so listing every save is a cheap query rather than parsing a multi-megabyte
// blob per row just to show a name and a turn number.
export interface SavedGameSummary {
  id: string;
  name: string;
  savedAt: string;
  formatVersion: number;
  turn: number;
  phase: string;
  summary: string;
}

export interface CleanSaveStopInput {
  mode: "setup" | "game";
  gameStage: "mulligan" | "playing";
  sessionStatus: GameSession["status"];
  hasPendingAction: boolean;
  stackActionCount: number;
  // True if ANY transient modal/choice state is open — blockChoice, libraryLook,
  // manualLibrarySearch, pendingRuleChoice, manaChoice, myriadSearch, myriadTapChoice,
  // urzaSagaSearch, basicLandFetchSearch, inspectedCard, a selected hand card, selected blockers, or
  // a mulligan return-card selection in progress. Collapsed to one boolean here since the caller
  // (AppFlow.tsx) already has all of those as component state and isCleanSaveStop doesn't need to
  // know which one specifically — only the Save button's disabled title needs a human-readable
  // reason, which this function already supplies for every OTHER blocking condition.
  hasOpenModal: boolean;
  pendingDeathsCount: number;
  pendingEntriesCount: number;
  pendingCombatDamageToPlayerCount: number;
  pendingGraveyardDeparturesCount: number;
  anyAgentThinking: boolean;
  prioritySeatId: string | undefined;
  humanSeatId: string;
}

// Save is only ever offered at a "clean stop" — every transient/in-flight value is provably empty,
// so the snapshot never has to serialize PendingAction, the stack, any open choice modal, or an
// in-flight agent LLM call. Returns why saving is blocked so the disabled Save button can explain
// itself (e.g. "wait for the stack to clear") instead of just being greyed out with no context.
export function isCleanSaveStop(input: CleanSaveStopInput): { ok: boolean; reason?: string } {
  if (input.mode !== "game") return { ok: false, reason: "No game in progress." };
  if (input.gameStage !== "playing") return { ok: false, reason: "Still choosing whether to keep your opening hand." };
  if (input.sessionStatus !== "playing") return { ok: false, reason: "The game isn't currently in progress." };
  if (input.hasPendingAction) return { ok: false, reason: "A spell or ability is still resolving." };
  if (input.stackActionCount > 0) return { ok: false, reason: "The stack isn't empty yet." };
  if (input.hasOpenModal) return { ok: false, reason: "A choice is still open." };
  if (
    input.pendingDeathsCount > 0 ||
    input.pendingEntriesCount > 0 ||
    input.pendingCombatDamageToPlayerCount > 0 ||
    input.pendingGraveyardDeparturesCount > 0
  ) {
    return { ok: false, reason: "A trigger is still being resolved." };
  }
  if (input.anyAgentThinking) return { ok: false, reason: "An agent is still deciding its action." };
  if (input.prioritySeatId !== input.humanSeatId) return { ok: false, reason: "It isn't your priority yet." };
  return { ok: true };
}
