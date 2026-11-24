// Replay / bug-report file of one kernel game ("Save game log" in the table, `npm run kernel:replay -- <file>`).
// The engine is deterministic: the state the game started from (shuffled libraries and RNG state included) plus the ordered list of accepted actions and decision
// answers (human AND AI: both go through KernelSession.dispatch) rebuilds the exact game. Each step carries a cheap fingerprint of the state after it, so a replay that
// diverges (a changed engine, stale drafts) says at which step. Pure TypeScript: no fs here (the dev route and the script do the file I/O).
import type { Action, EngineContext, GameState, PlayerId } from "../engine/types";
import { KernelSession } from "./kernelSession";
import type { DisplayCard } from "./cardPack";
import type { SeatMeta } from "./toSession";
import { stackLogText } from "./stackLog";

export interface RecordedStep { p: PlayerId; a: Action; fp: string }

/** A short digest of the state: enough to notice any divergence of a replay (RNG position, ids handed out, clock, lives, zone sizes). */
export function fingerprint(s: GameState): string {
  return [s.rngState, s.nextId, s.clock, s.decisionSeq, `${s.turn.number}${s.turn.phase}`, s.players.map((p) => `${p.life}/${p.hand.length}/${p.library.length}/${p.graveyard.length}/${p.exile.length}`).join(","), s.stack.length, s.battlefield.length].join("|");
}

export interface FinalSummary {
  turn: number; phase: string; stack: number; gameOver: GameState["gameOver"];
  players: Array<{ id: string; name: string; life: number; hand: number; library: number; graveyard: number; exile: number; command: number; battlefield: string[] }>;
}

export function finalSummary(s: GameState): FinalSummary {
  return {
    turn: s.turn.number, phase: s.turn.phase, stack: s.stack.length, gameOver: s.gameOver,
    players: s.players.map((p) => ({
      id: p.id, name: p.name, life: p.life, hand: p.hand.length, library: p.library.length, graveyard: p.graveyard.length, exile: p.exile.length, command: p.command.length,
      battlefield: s.battlefield.filter((id) => s.objects[id]?.controller === p.id).map((id) => s.objects[id].token?.name ?? s.objects[id].cardName)
    }))
  };
}

export interface ReplayMeta {
  gameId: string;
  /** deck display names, seat order */
  decks: string[];
  /** deck folder slug -> draft hash of the packs the game ran on */
  draftHashes: Record<string, string>;
  human: PlayerId;
}

export interface ReplayFile {
  v: 1;
  savedAt: string;
  meta: ReplayMeta;
  seed: number;
  seats: Record<PlayerId, SeatMeta> | undefined;
  initialState: GameState;
  steps: RecordedStep[];
  /** the stack log as text (as the saving player saw it) */
  stackLog: string;
  /** the last ~200 action-log lines, newest first */
  recentLog: string[];
  final: FinalSummary;
}

export function buildReplayFile(ks: KernelSession, o: { viewer: PlayerId; meta: ReplayMeta; savedAt?: string; recentLog?: readonly string[] }): ReplayFile {
  const rec = ks.recording();
  return {
    v: 1, savedAt: o.savedAt ?? new Date().toISOString(), meta: o.meta, seed: rec.initialState.seed, seats: rec.seats,
    initialState: rec.initialState, steps: [...rec.steps],
    stackLog: stackLogText(ks.stackLog(o.viewer).groups),
    recentLog: (o.recentLog ?? ks.log(o.viewer).map((l) => l.message)).slice(0, 200),
    final: finalSummary(ks.state)
  };
}

// ---------------------------------------------------------------- validation (the dev route trusts nothing)

const ACTIONS = new Set(["castSpell", "activateAbility", "untapForMana", "playLand", "passPriority", "answerDecision", "advancePhase", "turnFaceUp", "unlockDoor", "castPrepared", "declareAttackers", "declareBlockers"]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 200): v is string => typeof v === "string" && v.length <= max;

export const MAX_REPLAY_STEPS = 200_000;
export const MAX_REPLAY_BYTES = 60 * 1024 * 1024;

/** Returns a clean copy with only the known fields, or undefined when anything is off. */
export function validateReplayFile(raw: unknown): ReplayFile | undefined {
  if (!isObj(raw) || raw.v !== 1 || !isStr(raw.savedAt, 40)) return undefined;
  const m = raw.meta;
  if (!isObj(m) || !isStr(m.gameId, 200) || !isStr(m.human, 64) || !Array.isArray(m.decks) || m.decks.length > 12 || !m.decks.every((d) => isStr(d)) || !isObj(m.draftHashes)) return undefined;
  const hashes = Object.entries(m.draftHashes);
  if (hashes.length > 24 || !hashes.every(([k, v]) => isStr(k, 100) && isStr(v, 64))) return undefined;
  if (typeof raw.seed !== "number" || !Number.isFinite(raw.seed)) return undefined;
  if (!Array.isArray(raw.steps) || raw.steps.length > MAX_REPLAY_STEPS) return undefined;
  const steps: RecordedStep[] = [];
  for (const s of raw.steps) {
    if (!isObj(s) || !isStr(s.p, 64) || !isStr(s.fp, 400) || !isObj(s.a) || !isStr(s.a.type, 40) || !ACTIONS.has(s.a.type) || s.a.player !== s.p) return undefined;
    steps.push({ p: s.p, a: s.a as unknown as Action, fp: s.fp });
  }
  const st = raw.initialState;
  if (!isObj(st) || st.version !== 1 || !Array.isArray(st.players) || !isObj(st.objects) || !isObj(st.turn) || typeof st.seed !== "number") return undefined;
  if (!isStr(raw.stackLog, 8_000_000) || !Array.isArray(raw.recentLog) || raw.recentLog.length > 400 || !raw.recentLog.every((l) => isStr(l, 2000))) return undefined;
  const fin = raw.final;
  if (!isObj(fin) || !Array.isArray(fin.players) || fin.players.length > 12) return undefined;
  let seats: ReplayFile["seats"];
  if (raw.seats !== undefined && raw.seats !== null) {
    if (!isObj(raw.seats) || Object.keys(raw.seats).length > 12) return undefined;
    seats = {};
    for (const [id, v] of Object.entries(raw.seats)) {
      if (!isStr(id, 64) || !isObj(v)) return undefined;
      seats[id] = { ...(isStr(v.kind, 20) ? { kind: v.kind as SeatMeta["kind"] } : {}), ...(isStr(v.agentName, 100) ? { agentName: v.agentName as SeatMeta["agentName"] } : {}) } as SeatMeta;
    }
  }
  return {
    v: 1, savedAt: raw.savedAt, meta: { gameId: m.gameId, decks: m.decks as string[], draftHashes: Object.fromEntries(hashes) as Record<string, string>, human: m.human },
    seed: raw.seed, seats, initialState: st as unknown as GameState, steps, stackLog: raw.stackLog, recentLog: raw.recentLog as string[], final: fin as unknown as FinalSummary
  };
}

// ---------------------------------------------------------------- replay

export interface ReplayResult {
  ks: KernelSession;
  /** steps applied */
  applied: number;
  /** the first step whose result differs from the recording (or that the engine refused) */
  divergence?: { step: number; why: string; expected: string; got: string };
  /** the stack log of the replayed game (the human's view) */
  stackLog: string;
}

/** Rebuilds the game from the file and replays its steps (`until` = stop after that many). */
export function replayGame(file: ReplayFile, ctx: EngineContext, o: { until?: number; display?: (name: string) => DisplayCard | undefined } = {}): ReplayResult {
  const ks = KernelSession.fromState(file.initialState, { ctx, ...(file.seats ? { seats: file.seats } : {}), ...(o.display ? { display: o.display } : {}), gameId: file.meta.gameId });
  const limit = Math.min(o.until ?? file.steps.length, file.steps.length);
  let applied = 0;
  let divergence: ReplayResult["divergence"];
  for (let i = 0; i < limit; i++) {
    const step = file.steps[i];
    const res = ks.dispatch(step.p, step.a);
    if (!res.ok) { divergence = { step: i, why: `the engine refused the action: ${res.error?.message ?? "?"}`, expected: step.fp, got: "(refused)" }; break; }
    applied++;
    const fp = fingerprint(ks.state);
    if (fp !== step.fp) { divergence = { step: i, why: "state differs from the recording", expected: step.fp, got: fp }; break; }
  }
  const viewer = ks.state.players.some((p) => p.id === file.meta.human) ? file.meta.human : ks.state.players[0].id;
  return { ks, applied, ...(divergence ? { divergence } : {}), stackLog: stackLogText(ks.stackLog(viewer).groups) };
}
