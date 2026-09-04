import { describe, expect, it } from "vitest";
import { DEFAULT_STOP_SETTINGS, shouldStopForPriority, stopKey, type PriorityStopSettings } from "./priorityStops";

function baseInput(overrides: Partial<Parameters<typeof shouldStopForPriority>[0]> = {}) {
  return {
    settings: DEFAULT_STOP_SETTINGS,
    phase: "untap step",
    turnOwnerSeatIndex: 0,
    actionType: "phase" as const,
    actionIsMine: false,
    hasLegalResponse: true,
    isDefendingPlayer: false,
    actionAffectsMe: false,
    holdOnce: false,
    ...overrides
  };
}

describe("shouldStopForPriority", () => {
  it("never stops when there is no legal response, regardless of any other setting", () => {
    const settings: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS, fullControl: true };
    expect(
      shouldStopForPriority(baseInput({ settings, hasLegalResponse: false, holdOnce: true, isDefendingPlayer: true, actionAffectsMe: true }))
    ).toBeUndefined();
  });

  it("stops for full control whenever a response exists", () => {
    const settings: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS, fullControl: true, phaseStops: {} };
    expect(shouldStopForPriority(baseInput({ settings }))).toBe("full_control");
  });

  it("stops once for a one-shot hold, independent of the phase grid", () => {
    const settings: PriorityStopSettings = { ...DEFAULT_STOP_SETTINGS, phaseStops: {} };
    expect(shouldStopForPriority(baseInput({ settings, holdOnce: true }))).toBe("hold_once");
  });

  it("never stops for my own bare phase-pass action, even with no other setting active", () => {
    const settings: PriorityStopSettings = {
      phaseStops: {},
      stopOnStackResponse: false,
      stopOnAttacked: false,
      stopOnTargeted: false,
      fullControl: false
    };
    expect(shouldStopForPriority(baseInput({ settings, actionType: "phase", actionIsMine: true }))).toBeUndefined();
  });

  it("does stop on a ticked phase, even for my own phase-pass", () => {
    const settings: PriorityStopSettings = {
      phaseStops: { [stopKey("precombat main phase", 0)]: true },
      stopOnStackResponse: false,
      stopOnAttacked: false,
      stopOnTargeted: false,
      fullControl: false
    };
    expect(
      shouldStopForPriority(baseInput({ settings, phase: "precombat main phase", turnOwnerSeatIndex: 0, actionType: "phase", actionIsMine: true }))
    ).toBe("phase_stop");
  });

  it("stops on an untagged phase for a stack response that isn't mine", () => {
    const settings: PriorityStopSettings = {
      phaseStops: {},
      stopOnStackResponse: true,
      stopOnAttacked: false,
      stopOnTargeted: false,
      fullControl: false
    };
    expect(shouldStopForPriority(baseInput({ settings, actionType: "spell", actionIsMine: false }))).toBe("stack_response");
  });

  it("does not stop for a spell that IS mine, even with stopOnStackResponse on", () => {
    const settings: PriorityStopSettings = {
      phaseStops: {},
      stopOnStackResponse: true,
      stopOnAttacked: false,
      stopOnTargeted: false,
      fullControl: false
    };
    expect(shouldStopForPriority(baseInput({ settings, actionType: "spell", actionIsMine: true }))).toBeUndefined();
  });

  it("stops when I'm the defending player and stopOnAttacked is set", () => {
    const settings: PriorityStopSettings = {
      phaseStops: {},
      stopOnStackResponse: false,
      stopOnAttacked: true,
      stopOnTargeted: false,
      fullControl: false
    };
    expect(shouldStopForPriority(baseInput({ settings, isDefendingPlayer: true }))).toBe("attacked");
  });

  it("stops when the action affects me and stopOnTargeted is set", () => {
    const settings: PriorityStopSettings = {
      phaseStops: {},
      stopOnStackResponse: false,
      stopOnAttacked: false,
      stopOnTargeted: true,
      fullControl: false
    };
    expect(shouldStopForPriority(baseInput({ settings, actionAffectsMe: true }))).toBe("targeted");
  });

  it("auto-passes when a legal response exists but nothing configured applies", () => {
    const settings: PriorityStopSettings = {
      phaseStops: {},
      stopOnStackResponse: false,
      stopOnAttacked: false,
      stopOnTargeted: false,
      fullControl: false
    };
    expect(shouldStopForPriority(baseInput({ settings }))).toBeUndefined();
  });

  it("default settings stop at declare attackers on my own turn (seat index 0)", () => {
    expect(
      shouldStopForPriority(
        baseInput({ phase: "declare attackers step", turnOwnerSeatIndex: 0, actionType: "phase", actionIsMine: true })
      )
    ).toBe("phase_stop");
  });

  it("default settings do not stop at untap step on my own turn", () => {
    expect(
      shouldStopForPriority(baseInput({ phase: "untap step", turnOwnerSeatIndex: 0, actionType: "phase", actionIsMine: true }))
    ).toBeUndefined();
  });

  it("stopKey distinguishes the same phase across different turn owners", () => {
    expect(stopKey("main phase", 0)).not.toBe(stopKey("main phase", 1));
  });

  // Regression: the default grid's "declare blockers/end step on each agent's turn" default was
  // first implemented keying only seat index 1 (whichever agent happened to sit there), silently
  // leaving the other two agent seats with no default stop at all — caught live in a playtest, not
  // by this suite, which is why every agent seat index is asserted individually here now.
  it.each([1, 2, 3])("default settings stop at declare blockers and end step on agent seat index %i", (agentSeatIndex) => {
    expect(
      shouldStopForPriority(
        baseInput({ phase: "declare blockers step", turnOwnerSeatIndex: agentSeatIndex, actionType: "phase", actionIsMine: false })
      )
    ).toBe("phase_stop");
    expect(
      shouldStopForPriority(baseInput({ phase: "end step", turnOwnerSeatIndex: agentSeatIndex, actionType: "phase", actionIsMine: false }))
    ).toBe("phase_stop");
  });
});
