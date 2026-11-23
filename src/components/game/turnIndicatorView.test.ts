import { describe, expect, it } from "vitest";
import { TURN_PHASES } from "@/lib/priorityStops";
import { buildIndicatorView, normalizePhase, phaseTrack, type IndicatorInput } from "./turnIndicatorView";

const seats = (n: number) => ["You", "Ann", "Bo", "Cy"].slice(0, n).map((name, k) => ({ id: `s${k}`, name }));
const base = (over: Partial<IndicatorInput> = {}): IndicatorInput => ({ seats: seats(4), humanSeatId: "s0", activeSeatId: "s1", prioritySeatId: "s1", phase: "upkeep step", turnNumber: 5, stackSize: 0, ...over });

describe("phase track", () => {
  it.each(TURN_PHASES.map((p, i) => [p, i] as const))("marks %s current with earlier ones past", (p, i) => {
    const t = phaseTrack(p);
    expect(t).toHaveLength(12);
    expect(t.filter((c) => c.state === "current").map((c) => c.id)).toEqual([p]);
    expect(t.slice(0, i).every((c) => c.state === "past")).toBe(true);
    expect(t.slice(i + 1).every((c) => c.state === "future")).toBe(true);
  });
  it("shows the first-strike step only when it is current", () => {
    const t = phaseTrack("first_strike_damage");
    expect(t.map((c) => c.id)).toContain("first strike damage step");
    expect(t.find((c) => c.state === "current")?.id).toBe("first strike damage step");
    expect(t.find((c) => c.id === "combat damage step")?.state).toBe("future");
    expect(phaseTrack("combat damage step").some((c) => c.id === "first strike damage step")).toBe(false);
  });
  it("maps kernel ids and tolerates unknown ones", () => {
    expect(normalizePhase("postcombat_main")).toBe("postcombat main phase");
    expect(phaseTrack("nonsense").every((c) => c.state === "future")).toBe(true);
  });
});

describe("indicator view", () => {
  it("names the active player and the turn", () => {
    const v = buildIndicatorView(base());
    expect(v.banner).toBe("Turn 5 - Ann's turn");
    expect(v.phaseLabel).toBe("Upkeep step");
    expect(v.seats.find((s) => s.id === "s1")?.marker).toBe("both");
    expect(buildIndicatorView(base({ activeSeatId: "s0", prioritySeatId: "s0" })).banner).toBe("Turn 5 - Your turn");
  });
  it("priority on a non-active player", () => {
    const v = buildIndicatorView(base({ prioritySeatId: "s2" }));
    expect(v.status).toBe("Waiting for Bo (priority)");
    expect(v.seats.map((s) => s.marker)).toEqual(["none", "active", "priority", "none"]);
    expect(v.humanPriority).toBe(false);
  });
  it("human priority pulses", () => {
    const v = buildIndicatorView(base({ prioritySeatId: "s0" }));
    expect(v.status).toBe("Your priority");
    expect(v.humanPriority).toBe(true);
  });
  it("stack lines", () => {
    expect(buildIndicatorView(base()).stackLine).toBeUndefined();
    expect(buildIndicatorView(base({ stackSize: 1, prioritySeatId: "s2" })).stackLine).toBe("Stack: 1 item - Bo must respond or pass");
    expect(buildIndicatorView(base({ stackSize: 3, prioritySeatId: "s0" })).stackLine).toBe("Stack: 3 items - You must respond or pass");
  });
  it("pending decisions override priority", () => {
    const o = buildIndicatorView(base({ pendingDecisionSeatId: "s3", pendingKind: "choice" }));
    expect(o.status).toBe("Waiting for Cy to choose");
    expect(o.humanPriority).toBe(false);
    expect(buildIndicatorView(base({ pendingDecisionSeatId: "s0", pendingKind: "blockers" })).status).toBe("Your choice: declare blockers");
    expect(buildIndicatorView(base({ prioritySeatId: undefined, pendingDecisionSeatId: "s2", pendingKind: "attackers" })).status).toBe("Waiting for Bo to declare attackers");
  });
  it("no priority holder and game over", () => {
    expect(buildIndicatorView(base({ prioritySeatId: undefined })).status).toBe("Resolving...");
    expect(buildIndicatorView(base({ gameOver: true })).status).toBe("Game over");
  });
  it.each([2, 3, 4])("works with %i players", (n) => {
    const v = buildIndicatorView(base({ seats: seats(n), activeSeatId: "s1", prioritySeatId: "s1" }));
    expect(v.seats).toHaveLength(n);
    expect(v.seats.filter((s) => s.active)).toHaveLength(1);
  });
  it("flags eliminated players", () => {
    const v = buildIndicatorView(base({ seats: [{ id: "s0", name: "You" }, { id: "s1", name: "Ann", hasLost: true }, { id: "s2", name: "Bo", life: 0 }, { id: "s3", name: "Cy", life: 12 }] }));
    expect(v.seats.map((s) => s.eliminated)).toEqual([false, true, true, false]);
    expect(v.seats[1].label).toContain("eliminated");
  });
});
