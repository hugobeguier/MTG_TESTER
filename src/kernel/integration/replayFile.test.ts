// Replay / bug-report file: a recorded game replays to an identical final state and stack log; a diverging step is reported; the payload validator and the
// file store are strict.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import "../engine/resolve";
import { ctx, mini, realGame } from "./testgame";
import { legalActions } from "../engine/legal";
import { actorOf, mulberry, pickAction } from "./randomPlay";
import { KernelSession } from "./kernelSession";
import { buildReplayFile, replayGame, validateReplayFile, fingerprint, type ReplayFile } from "./replayFile";
import { readReplayFile, saveReplayFile } from "./replayStore";

function playRedressFate(): KernelSession {
  const m = mini();
  for (let i = 0; i < 6; i++) { m.give("p1", "Forest", "library"); m.give("p2", "Island", "library"); }
  m.give("p1", "Doomwake Giant", "battlefield");
  m.give("p2", "Grizzly Bears", "battlefield");
  for (const n of ["Sphere of Safety", "Greed", "Sphere of Safety"]) m.give("p1", n, "graveyard");
  for (let i = 0; i < 8; i++) m.give("p1", "Plains", "battlefield");
  const spell = m.give("p1", "Redress Fate", "hand");
  const ks = KernelSession.fromState(m.state, { ctx, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } });
  expect(ks.dispatch("p1", { type: "castSpell", player: "p1", cardId: spell, autoPay: true }).ok).toBe(true);
  for (let i = 0; i < 80; i++) {
    const s = ks.state;
    if (s.pending) { const p = s.pending; ks.dispatch(p.player, { type: "answerDecision", player: p.player, decisionId: p.id, choice: p.kind === "pay_mana" ? { ids: ["pay"] } : p.numeric ? { number: p.min } : { ids: p.options.slice(0, Math.max(p.min, 1)).map((o) => o.id) } }); continue; }
    if (s.stack.length && s.priority) { ks.dispatch(s.priority, { type: "passPriority", player: s.priority }); continue; }
    break;
  }
  // a few more turns of passing so the recording contains phase changes too
  for (let i = 0; i < 12 && !ks.state.gameOver && ks.state.priority; i++) ks.dispatch(ks.state.priority, { type: "passPriority", player: ks.state.priority });
  return ks;
}

const meta = { gameId: "t", decks: ["A", "B"], draftHashes: { aminatou: "abc" }, human: "p1" };
const roundTrip = (f: ReplayFile): ReplayFile => JSON.parse(JSON.stringify(f)) as ReplayFile;

describe("replay file", () => {
  it("records every accepted action in order and replays to an identical game", () => {
    const ks = playRedressFate();
    const file = roundTrip(buildReplayFile(ks, { viewer: "p1", meta, savedAt: "2026-01-01T00:00:00.000Z" }));
    expect(file.steps.length).toBeGreaterThan(5);
    expect(file.steps[0].a.type).toBe("castSpell");
    expect(file.steps.some((s) => s.a.type === "answerDecision")).toBe(true); // decision answers are recorded too
    const valid = validateReplayFile(file);
    expect(valid).toBeDefined();
    const res = replayGame(valid!, ctx);
    expect(res.divergence).toBeUndefined();
    expect(res.applied).toBe(file.steps.length);
    expect(JSON.stringify(res.ks.state)).toBe(JSON.stringify(ks.state)); // identical final state
    expect(res.stackLog).toBe(file.stackLog); // and the same stack log
    expect(file.stackLog).toContain("p1 casts Redress Fate");
    expect(file.final.players.map((p) => p.life)).toEqual(ks.state.players.map((p) => p.life));
    expect(file.final.players[0].battlefield).toContain("Doomwake Giant");
  });

  it("a long random game on real decks (AI-style actions and answers) replays to an identical final state", () => {
    const ks = KernelSession.fromState(realGame(["Wretched Ranks", "Wretched Ranks"], { upkeep: true }), { ctx });
    const rng = mulberry(5);
    for (let i = 0; i < 600; i++) {
      const actor = actorOf(ks.state);
      if (!actor) break;
      const act = pickAction(legalActions(ks.state, actor, ctx), rng, ks.state);
      if (!act) break;
      ks.dispatch(actor, act);
    }
    const file = roundTrip(buildReplayFile(ks, { viewer: "p1", meta }));
    expect(file.steps.length).toBeGreaterThan(300);
    const res = replayGame(file, ctx);
    expect(res.divergence).toBeUndefined();
    expect(res.applied).toBe(file.steps.length);
    expect(JSON.stringify(res.ks.state)).toBe(JSON.stringify(ks.state));
    expect(res.stackLog).toBe(file.stackLog);
  }, 60_000);

  it("--until N stops after N actions in the same state the recording had there", () => {
    const ks = playRedressFate();
    const file = roundTrip(buildReplayFile(ks, { viewer: "p1", meta }));
    const res = replayGame(file, ctx, { until: 4 });
    expect(res.applied).toBe(4);
    expect(fingerprint(res.ks.state)).toBe(file.steps[3].fp);
  });

  it("reports the first step that differs from the recording", () => {
    const ks = playRedressFate();
    const file = roundTrip(buildReplayFile(ks, { viewer: "p1", meta }));
    file.steps[2] = { ...file.steps[2], fp: "tampered" };
    const res = replayGame(file, ctx);
    expect(res.divergence).toMatchObject({ step: 2, expected: "tampered" });
    expect(res.applied).toBe(3); // the divergent action itself was applied; the replay stops after it
  });

  it("validation rejects anything that is not a replay file", () => {
    const ks = playRedressFate();
    const good = roundTrip(buildReplayFile(ks, { viewer: "p1", meta }));
    expect(validateReplayFile(good)).toBeDefined();
    expect(validateReplayFile(null)).toBeUndefined();
    expect(validateReplayFile({ ...good, v: 2 })).toBeUndefined();
    expect(validateReplayFile({ ...good, steps: [{ p: "p1", fp: "x", a: { type: "rm -rf", player: "p1" } }] })).toBeUndefined();
    expect(validateReplayFile({ ...good, steps: [{ p: "p2", fp: "x", a: { type: "passPriority", player: "p1" } }] })).toBeUndefined();
    expect(validateReplayFile({ ...good, meta: { ...good.meta, decks: new Array(50).fill("x") } })).toBeUndefined();
    expect(validateReplayFile({ ...good, initialState: { version: 1 } })).toBeUndefined();
    const extra = validateReplayFile({ ...good, evil: "payload" }) as unknown as Record<string, unknown>;
    expect(extra).not.toHaveProperty("evil"); // unknown fields are dropped
  });

  it("the store writes data/observer/live-logs/<timestamp>.json under the given root and refuses invalid payloads", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "mtg-livelog-"));
    try {
      const file = buildReplayFile(playRedressFate(), { viewer: "p1", meta });
      expect(saveReplayFile({ nope: true }, { root })).toBeUndefined();
      const rel = saveReplayFile(roundTrip(file), { root, now: new Date("2026-11-24T12:30:05.123Z") });
      expect(rel).toBe("data/observer/live-logs/2026-11-24T12-30-05-123Z.json");
      expect(readdirSync(path.join(root, "data/observer/live-logs"))).toEqual(["2026-11-24T12-30-05-123Z.json"]);
      expect(readReplayFile(path.join(root, rel!)).steps.length).toBe(file.steps.length);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
