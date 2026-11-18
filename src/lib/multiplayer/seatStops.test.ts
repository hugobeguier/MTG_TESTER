import { describe, expect, it } from "vitest";
import { DEFAULT_STOP_SETTINGS } from "../priorityStops";
import { applySeatStopChange, clearHoldOnce, defaultSeatStopSettings, seatStopSettingsOf } from "./seatStops";

describe("seat stop settings", () => {
  it("default to the host's rules (same flags), with the grid seen from the seat", () => {
    const stops = defaultSeatStopSettings(2, 4);
    expect(stops).toMatchObject({ stopOnStackResponse: true, stopOnAttacked: true, stopOnTargeted: true, stopOnChoicePrompt: true, fullControl: false });
    expect(Object.keys(stops.phaseStops).filter((key) => key.startsWith("2:")).sort()).toEqual(["2:declare attackers step", "2:postcombat main phase", "2:precombat main phase"]);
    expect(stops.phaseStops["0:end step"]).toBe(true);
    expect(stops.phaseStops["2:end step"]).toBeUndefined();
    // seat 0 of 4 is exactly the host's shipped default grid
    expect(defaultSeatStopSettings(0, 4).phaseStops).toEqual(DEFAULT_STOP_SETTINGS.phaseStops);
  });
  it("applies each toggle without touching the input", () => {
    const base = defaultSeatStopSettings(1, 3);
    expect(applySeatStopChange(base, { kind: "fullControl" }).fullControl).toBe(true);
    expect(applySeatStopChange(base, { kind: "stopNext" }).holdOnce).toBe(true);
    expect(applySeatStopChange(base, { kind: "stackResponse" }).stopOnStackResponse).toBe(false);
    expect(applySeatStopChange(base, { kind: "attacked" }).stopOnAttacked).toBe(false);
    expect(applySeatStopChange(base, { kind: "targeted" }).stopOnTargeted).toBe(false);
    expect(applySeatStopChange(base, { kind: "choicePrompt" }).stopOnChoicePrompt).toBe(false);
    const ticked = applySeatStopChange(base, { kind: "phase", phase: "upkeep step", seatIndex: 0 });
    expect(ticked.phaseStops["0:upkeep step"]).toBe(true);
    expect(applySeatStopChange(ticked, { kind: "phase", phase: "upkeep step", seatIndex: 0 }).phaseStops["0:upkeep step"]).toBe(false);
    expect(base.fullControl).toBe(false);
  });
  it("falls back to the defaults for a seat with no entry, and Stop Next is used up once", () => {
    expect(seatStopSettingsOf({}, "x", 1, 3)).toEqual(defaultSeatStopSettings(1, 3));
    const map = { x: { ...defaultSeatStopSettings(1, 3), holdOnce: true } };
    expect(clearHoldOnce(map).x.holdOnce).toBe(false);
    const none = { x: defaultSeatStopSettings(1, 3) };
    expect(clearHoldOnce(none)).toBe(none);
  });
});
