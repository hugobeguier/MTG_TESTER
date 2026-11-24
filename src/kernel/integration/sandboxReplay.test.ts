// Debug mode through KernelSession: the switch and every sandbox action are recorded, the replay file carries them (and says the game used debug mode), the log shows
// "Debug: ..." lines, and a guest cannot reach them.
import { describe, expect, it } from "vitest";
import "../engine/resolve";
import { ctx, mini } from "./testgame";
import { KernelSession } from "./kernelSession";
import { buildReplayFile, replayGame, validateReplayFile, type ReplayFile } from "./replayFile";
import { legalActions } from "../engine/legal";

const meta = { gameId: "t", decks: ["A", "B"], draftHashes: {}, human: "p1" };
const roundTrip = (f: ReplayFile): ReplayFile => JSON.parse(JSON.stringify(f)) as ReplayFile;

function game(): { ks: KernelSession; lib: string[]; hand: string } {
  const m = mini();
  const lib = ["Forest", "Island", "Swamp", "Plains", "Forest"].map((n) => m.give("p1", n, "library"));
  for (let i = 0; i < 5; i++) m.give("p2", "Island", "library");
  const hand = m.give("p1", "Sol Ring", "hand");
  return { ks: KernelSession.fromState(m.state, { ctx, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } }), lib, hand };
}

describe("debug mode in a kernel session", () => {
  it("is off by default and every debug action is refused", () => {
    const { ks, hand } = game();
    expect(ks.sandbox).toBe(false);
    const res = ks.dispatch("p1", { type: "sandboxCast", player: "p1", cardId: hand });
    expect(res.ok).toBe(false); expect(res.error?.code).toBe("sandbox_disabled");
    expect(ks.recording().steps.length).toBe(0); // refused actions are not recorded
  });

  it("the switch, a free cast, a tutor, draw and life are recorded and replay to the identical game; the log and the replay file say Debug", () => {
    const { ks, lib, hand } = game();
    expect(ks.setSandbox("p1", true).ok).toBe(true);
    expect(ks.dispatch("p1", { type: "sandboxCast", player: "p1", cardId: hand }).ok).toBe(true);
    expect(ks.dispatch("p1", { type: "passPriority", player: "p1" }).ok).toBe(true);
    expect(ks.dispatch("p2", { type: "passPriority", player: "p2" }).ok).toBe(true);
    expect(ks.dispatch("p1", { type: "sandboxTutor", player: "p1", cardId: lib[2], to: "hand" }).ok).toBe(true);
    expect(ks.dispatch("p1", { type: "sandboxDraw", player: "p1", count: 2 }).ok).toBe(true);
    expect(ks.dispatch("p1", { type: "sandboxSetLife", player: "p1", life: 3 }).ok).toBe(true);
    expect(ks.setSandbox("p1", false).ok).toBe(true);
    expect(ks.dispatch("p1", { type: "sandboxDraw", player: "p1", count: 1 }).error?.code).toBe("sandbox_disabled");
    expect(ks.sandboxUsed).toBe(true);
    const lines = ks.log("p1").map((l) => l.message);
    expect(lines).toContain("Debug mode ON"); expect(lines).toContain("Debug mode OFF");
    expect(lines.some((l) => l.startsWith("Debug: ") && l.includes("Sol Ring"))).toBe(true);
    // the opponent sees the switch and the cast too, but not which card the tutor took
    const theirs = ks.log("p2").map((l) => l.message);
    expect(theirs).toContain("Debug mode ON");
    expect(theirs.some((l) => l.includes("Swamp"))).toBe(false);

    const file = roundTrip(buildReplayFile(ks, { viewer: "p1", meta, savedAt: "2026-01-01T00:00:00.000Z" }));
    expect(file.steps.map((s) => s.a.type)).toEqual(expect.arrayContaining(["sandboxMode", "sandboxCast", "sandboxTutor", "sandboxDraw", "sandboxSetLife"]));
    expect(file.final.sandboxUsed).toBe(true);
    expect(file.stackLog).toContain("Debug mode was used");
    const valid = validateReplayFile(file);
    expect(valid).toBeDefined();
    const res = replayGame(valid!, ctx);
    expect(res.divergence).toBeUndefined();
    expect(res.applied).toBe(file.steps.length);
    expect(JSON.stringify(res.ks.state)).toBe(JSON.stringify(ks.state));
    expect(res.stackLog).toBe(file.stackLog);
  });

  it("legalActions lists the debug casts only when asked and only while debug mode is on", () => {
    const { ks, hand } = game();
    const asked = (): string[] => legalActions(ks.state, "p1", ctx, { sandbox: true }).map((a) => a.kind);
    expect(asked()).not.toContain("sandboxCast");
    ks.setSandbox("p1", true);
    expect(asked()).toContain("sandboxCast");
    expect(ks.legal("p1").map((a) => a.kind)).not.toContain("sandboxCast");
    expect(legalActions(ks.state, "p1", ctx, { sandbox: true }).find((a) => a.kind === "sandboxCast")?.objectId).toBe(hand);
  });
});
