import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyChange, delayFor, PacingClock, PACE_ITEM_MS, PHASE_PACE_CAP_MS, type PaceSnap } from "./kernelPacing";
import { DEFAULT_STOP_SETTINGS } from "@/lib/priorityStops";
import { KernelGameController } from "./kernelController";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { buildPack } from "@/kernel/integration/nodePack";
import { packKit } from "@/kernel/integration/cardPack";
import { ctx, mini } from "@/kernel/integration/testgame";

const snap = (o: Partial<PaceSnap> = {}): PaceSnap => ({ stack: [], turn: 1, phase: "precombat_main", attackers: 0, blockers: 0, ...o });

describe("delays per event kind", () => {
  it("push and resolve use the full per-item delay, combat 60%, land 40%, phase is short and capped", () => {
    expect(delayFor("push", "normal")).toBe(2500);
    expect(delayFor("resolve", "normal")).toBe(2500);
    expect(delayFor("combat", "normal")).toBe(1500);
    expect(delayFor("damage", "normal")).toBe(1500);
    expect(delayFor("land", "normal")).toBe(1000);
    expect(delayFor("phase", "slow")).toBeLessThanOrEqual(PHASE_PACE_CAP_MS);
    expect(delayFor("none", "normal")).toBe(0);
    expect(PACE_ITEM_MS).toMatchObject({ fast: 800, normal: 2500, slow: 4000, off: 0 });
  });
  it("Off is instant for every kind", () => {
    for (const k of ["push", "resolve", "combat", "damage", "land", "phase"] as const) expect(delayFor(k, "off")).toBe(0);
  });
});

describe("classifyChange", () => {
  it("tells casts / triggers, resolutions, combat, damage, land and phase changes apart", () => {
    expect(classifyChange(snap(), snap({ stack: ["a"] }))).toBe("push");
    expect(classifyChange(snap({ stack: ["a"] }), snap({ stack: ["a", "t"] }))).toBe("push");
    expect(classifyChange(snap({ stack: ["a"] }), snap({ stack: [] }))).toBe("resolve");
    expect(classifyChange(snap({ stack: ["a"] }), snap({ stack: ["t"] }))).toBe("resolve"); // one resolved, its trigger appeared
    expect(classifyChange(snap({ phase: "declare_attackers" }), snap({ phase: "declare_attackers", attackers: 2 }), { type: "declareAttackers" })).toBe("combat");
    expect(classifyChange(snap({ phase: "declare_blockers", attackers: 1 }), snap({ phase: "declare_blockers", attackers: 1, blockers: 1 }), { type: "declareBlockers" })).toBe("combat");
    expect(classifyChange(snap({ phase: "declare_blockers" }), snap({ phase: "combat_damage" }))).toBe("damage");
    expect(classifyChange(snap(), snap(), { type: "playLand" })).toBe("land");
    expect(classifyChange(snap({ phase: "upkeep" }), snap({ phase: "draw" }))).toBe("phase");
    expect(classifyChange(snap(), snap())).toBe("none");
  });
});

describe("PacingClock", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  it("holds for the delay, then releases", () => {
    const c = new PacingClock({ speed: "normal" });
    expect(c.note("push", 1)).toBe(2500);
    expect(c.active).toBe(true);
    vi.advanceTimersByTime(2499);
    expect(c.remaining()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(c.active).toBe(false);
  });
  it("waits do not stack: the longest pending one wins", () => {
    const c = new PacingClock({ speed: "normal" });
    c.note("push", 1);
    vi.advanceTimersByTime(1000);
    c.note("phase", 1);
    expect(c.remaining()).toBe(1500);
  });
  it("skip ends the wait now; cancel too", () => {
    const c = new PacingClock({ speed: "normal" });
    c.note("resolve", 1); c.skip();
    expect(c.remaining()).toBe(0);
    c.note("resolve", 1); c.cancel();
    expect(c.active).toBe(false);
  });
  it("Off and disabled (headless) never wait", () => {
    const off = new PacingClock({ speed: "off" });
    expect(off.note("push", 1)).toBe(0); expect(off.active).toBe(false);
    const headless = new PacingClock({ speed: "slow", enabled: false });
    expect(headless.note("push", 1)).toBe(0); expect(headless.remaining()).toBe(0);
    const live = new PacingClock({ speed: "normal" });
    live.note("push", 1); live.setSpeed("off");
    expect(live.active).toBe(false);
  });
  it("a per-turn budget stops the waiting from dragging on; a new turn resets it", () => {
    const c = new PacingClock({ speed: "normal", turnBudgetMs: 5000 });
    expect(c.note("push", 1)).toBe(2500);
    vi.advanceTimersByTime(2500);
    expect(c.note("push", 1)).toBe(2500);
    vi.advanceTimersByTime(2500);
    expect(c.note("push", 1)).toBe(0);
    expect(c.note("push", 2)).toBe(2500);
  });
  it("saves the speed through onSpeed", () => {
    const seen: string[] = [];
    new PacingClock({ onSpeed: (s) => seen.push(s) }).setSpeed("slow");
    expect(seen).toEqual(["slow"]);
  });
});

describe("controller pacing (driver)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  const pack = JSON.parse(JSON.stringify(buildPack("wretched-ranks", { catalog: false })));
  const kit = packKit([pack]);

  /** p1 (human) holds Go for the Throat and has two Swamps; p2 (AI) has a victim; p1 is the active player in main phase */
  function game(speed: "off" | "normal") {
    const t = mini(["p1", "p2"], { phase: "precombat_main" });
    t.give("p1", "Swamp", "battlefield"); t.give("p1", "Swamp", "battlefield");
    for (let i = 0; i < 8; i++) { t.give("p1", "Swamp", "library"); t.give("p2", "Swamp", "library"); }
    t.give("p1", "Go for the Throat", "hand");
    const victim = t.give("p2", "Undead Augur", "battlefield");
    const ks = KernelSession.fromState(t.state, { ctx, display: kit.display, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } });
    const pacing = new PacingClock({ speed });
    const c = new KernelGameController(ks, { human: "p1", pace: () => 0, pacing, stops: { ...DEFAULT_STOP_SETTINGS, phaseStops: {}, stopOnStackResponse: false, stopOnAttacked: false, stopOnTargeted: false, fullControl: false } });
    const spell = ks.state.players[0].hand.find((id) => ks.state.objects[id].cardName === "Go for the Throat")!;
    return { ks, c, pacing, spell, victim };
  }

  it("a cast is shown on the stack for 2500 ms before anyone passes; the AI then passes and the resolution is held again", () => {
    const { ks, c, pacing, spell, victim } = game("normal");
    const stop = c.startDriver();
    c.playCard("p1", spell);
    // the spell may need a target answer
    if (ks.state.pending) { const d = c.table().decision!; c.answer(d.id, { ids: [victim] }); }
    expect(ks.state.stack.length).toBe(1);
    expect(pacing.remaining()).toBe(2500);
    expect(c.isPacing()).toBe(true);
    expect(c.stackFeed()[0]?.status).toBe("resolving");
    vi.advanceTimersByTime(2400);
    expect(ks.state.stack.length).toBe(1); // nothing passed yet
    vi.advanceTimersByTime(100);
    // auto-passes now go one by one; the stack empties only on the last pass
    vi.advanceTimersByTime(10);
    // whatever happened, each resolution is held for its own wait
    for (let i = 0; i < 20 && ks.state.stack.length; i++) vi.advanceTimersByTime(2600);
    expect(ks.state.stack.length).toBe(0);
    expect(c.stackFeed().some((e) => e.status === "resolved")).toBe(true);
    stop();
  });

  it("skipPacing releases the wait at once", () => {
    const { ks, c, pacing, spell, victim } = game("normal");
    const stop = c.startDriver();
    c.playCard("p1", spell);
    if (ks.state.pending) { const d = c.table().decision!; c.answer(d.id, { ids: [victim] }); }
    expect(pacing.active).toBe(true);
    c.skipPacing();
    expect(pacing.active).toBe(false);
    expect(c.isPacing()).toBe(false);
    vi.advanceTimersByTime(1000);
    stop();
  });

  it("Off is instant: no wait is ever recorded", () => {
    const { ks, c, pacing, spell, victim } = game("off");
    c.playCard("p1", spell);
    if (ks.state.pending) { const d = c.table().decision!; c.answer(d.id, { ids: [victim] }); }
    expect(pacing.remaining()).toBe(0);
  });

  it("a controller without a clock (tests, headless) never waits", () => {
    const t = mini(["p1", "p2"], { phase: "precombat_main" });
    const ks = KernelSession.fromState(t.state, { ctx, display: kit.display, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } });
    const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
    expect(c.isPacing()).toBe(false);
    expect(c.stackFeed()).toEqual([]);
  });
});
