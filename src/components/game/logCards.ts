// Pure: find the names of cards the viewer can see inside a game-log line, so the log can offer a hover preview on them.
// Only cards the session already shows to the viewer are candidates (battlefield, hand, graveyard, exile, commander, stack spells); a hidden card is "Hidden card" and never matches.
import { listedPreviewCard } from "../boardPreview";
import type { GameSession, VisibleCard } from "@/lib/types";

export type LogPart = { text: string; card?: VisibleCard };

/** every visible card of the session by name (the last one wins; any copy has the same printed text) */
export function visibleCardsByName(session: GameSession, extra: ReadonlyArray<VisibleCard | undefined> = []): Map<string, VisibleCard> {
  const m = new Map<string, VisibleCard>();
  const add = (c: VisibleCard | undefined) => { if (c && listedPreviewCard(c) && c.name.length > 2) m.set(c.name, c); };
  for (const s of session.seats) {
    for (const c of [...s.board.hand, ...s.board.battlefield, ...(s.board.graveyard ?? []), ...(s.board.exile ?? []), ...(s.library ?? [])]) add(c);
    add(s.board.commander);
  }
  for (const c of extra) add(c);
  return m;
}

/** split `message` into plain text and card-name parts (longest names first, so "Sol Ring" wins over "Sol") */
export function splitCardNames(message: string, cards: ReadonlyMap<string, VisibleCard>): LogPart[] {
  if (cards.size === 0 || !message) return [{ text: message }];
  const names = [...cards.keys()].filter((n) => message.includes(n)).sort((a, b) => b.length - a.length);
  if (names.length === 0) return [{ text: message }];
  const parts: LogPart[] = [];
  let i = 0;
  while (i < message.length) {
    let hit: string | undefined;
    for (const n of names) if (message.startsWith(n, i)) { hit = n; break; }
    if (hit) { parts.push({ text: hit, card: cards.get(hit)! }); i += hit.length; }
    else { const last = parts[parts.length - 1]; if (last && !last.card) last.text += message[i]; else parts.push({ text: message[i] }); i++; }
  }
  return parts;
}
