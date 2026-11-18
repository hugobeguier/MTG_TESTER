// A remote friend's OWN priority-stop settings. The friend gets the same defaults the host's own seat has (DEFAULT_STOP_SETTINGS: stop on their own main
// phases / declare attackers, on a response window with something on the stack, when attacked, targeted, or about to be asked a choice) and the same
// controls (Full Control, Stop Next, the stops grid), applied to THEIR seat only. Pure; the host keeps the map in the game context and the friend's
// toggles arrive as whitelisted intents (intentSpecs.ts).
import { DEFAULT_STOP_SETTINGS, stopKey, type PriorityStopSettings, type SeatStopSettings } from "../priorityStops";

/**
 * The host's default grid, seen from seat `seatIndex` of `seatCount`: its three own-turn stops, plus declare blockers and end step on every OTHER seat's
 * turn (the host's default does the same for the three agent seats). Everything else is the shared default.
 */
export function defaultSeatStopSettings(seatIndex: number, seatCount: number): SeatStopSettings {
  const phaseStops: Record<string, boolean> = {};
  for (const phase of ["precombat main phase", "declare attackers step", "postcombat main phase"]) phaseStops[stopKey(phase, seatIndex)] = true;
  for (let other = 0; other < seatCount; other += 1) {
    if (other === seatIndex) continue;
    phaseStops[stopKey("declare blockers step", other)] = true;
    phaseStops[stopKey("end step", other)] = true;
  }
  const { stopOnStackResponse, stopOnAttacked, stopOnTargeted, stopOnChoicePrompt, fullControl } = DEFAULT_STOP_SETTINGS;
  return { phaseStops, stopOnStackResponse, stopOnAttacked, stopOnTargeted, stopOnChoicePrompt, fullControl };
}

/** What a seat's settings are right now: its own entry in `stops.bySeat`, or the defaults. */
export function seatStopSettingsOf(stops: Pick<PriorityStopSettings, "bySeat">, seatId: string, seatIndex: number, seatCount: number): SeatStopSettings {
  return stops.bySeat?.[seatId] ?? defaultSeatStopSettings(seatIndex, seatCount);
}

/** One change a friend can make to their settings (the same toggles the host's table offers). */
export type SeatStopChange = { kind: "fullControl" } | { kind: "stopNext" } | { kind: "stackResponse" } | { kind: "attacked" } | { kind: "targeted" } | { kind: "choicePrompt" } | { kind: "phase"; phase: string; seatIndex: number };

export function applySeatStopChange(prev: SeatStopSettings, change: SeatStopChange): SeatStopSettings {
  switch (change.kind) {
    case "fullControl":
      return { ...prev, fullControl: !prev.fullControl };
    case "stopNext":
      return { ...prev, holdOnce: true };
    case "stackResponse":
      return { ...prev, stopOnStackResponse: !prev.stopOnStackResponse };
    case "attacked":
      return { ...prev, stopOnAttacked: !prev.stopOnAttacked };
    case "targeted":
      return { ...prev, stopOnTargeted: !prev.stopOnTargeted };
    case "choicePrompt":
      return { ...prev, stopOnChoicePrompt: prev.stopOnChoicePrompt === false };
    case "phase": {
      const key = stopKey(change.phase, change.seatIndex);
      return { ...prev, phaseStops: { ...prev.phaseStops, [key]: !prev.phaseStops[key] } };
    }
  }
}

/** The one-shot "Stop Next" flags are used up the moment the next priority window opens (same as the host's holdPriorityOnce). Returns `bySeat` itself when none is set. */
export function clearHoldOnce(bySeat: Record<string, SeatStopSettings>): Record<string, SeatStopSettings> {
  if (!Object.values(bySeat).some((settings) => settings.holdOnce)) return bySeat;
  return Object.fromEntries(Object.entries(bySeat).map(([id, settings]) => [id, settings.holdOnce ? { ...settings, holdOnce: false } : settings]));
}
