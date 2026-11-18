// Event-log wording per viewer. The host's own seat is literally named "You" and its events are written in the second person ("You pass to main.");
// a friend's screen must read "Hugo passes to main." instead. Other seats' events already use their names. Pure, best-effort prose rewriting.
import type { GameEvent } from "../types";

export const HOST_SEAT_NAME = "You";

const IRREGULAR_THIRD: Record<string, string> = { have: "has", are: "is", were: "was", do: "does", go: "goes", don: "doesn", can: "can", cannot: "cannot", may: "may", must: "must", will: "will", would: "would", could: "could", should: "should", did: "did", had: "had", was: "was", is: "is", has: "has" };
// Past-tense forms that do not end in "-ed" (events mix tenses); left alone.
const IRREGULAR_PAST = new Set(["drew", "took", "lost", "won", "saw", "got", "paid", "sold", "made", "gave", "found", "kept", "left", "brought", "sacrificed", "began", "ran", "put", "set", "cast", "hit", "cut", "read", "let", "shuffled"]);

/** "pass" -> "passes", "try" -> "tries", "have" -> "has"; a past-tense verb or a modal stays as it is. */
export function thirdPersonVerb(verb: string): string {
  const lower = verb.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(IRREGULAR_THIRD, lower)) return IRREGULAR_THIRD[lower];
  if (/ed$/.test(lower) || IRREGULAR_PAST.has(lower)) return verb;
  if (/(s|x|z|ch|sh|o)$/.test(lower)) return `${verb}es`;
  if (/[^aeiou]y$/.test(lower)) return `${verb.slice(0, -1)}ies`;
  return `${verb}s`;
}

/** Rewrites one host-voice message ("You pass to X. Search your library.") for a viewer who is not the host. */
export function hostVoiceToName(message: string, hostName: string): string {
  let text = message.replace(/^You (can't|cannot|don't|may|must|will|would|could|should|can) /, `${hostName} $1 `);
  text = text.replace(/^You(?= )( ?)([A-Za-z']+)/, (_m, space: string, verb: string) => `${hostName}${space}${thirdPersonVerb(verb.replace(/'t$/, "n't"))}`);
  text = text.replace(/\bYou\b/g, hostName).replace(/\byour\b/g, "their").replace(/\byourself\b/g, "themselves");
  return text;
}

/** Event list for a viewer: the host's second-person lines become "<hostName> ...". Events carry no viewer-specific data otherwise. */
export function eventsForViewer(events: GameEvent[], hostSeatId: string, hostName: string): GameEvent[] {
  if (hostName === HOST_SEAT_NAME) return events;
  return events.map((event) => {
    if (!/\b(You|your|yourself)\b/.test(event.message)) return event;
    // Only lines about the host's seat (or unattributed ones) are in the host's voice.
    if (event.seatId !== undefined && event.seatId !== hostSeatId && !/\bYou\b/.test(event.message)) return event;
    return { ...event, message: hostVoiceToName(event.message, hostName) };
  });
}
