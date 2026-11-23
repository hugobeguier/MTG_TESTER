// Pure view-model for the ordered-placement decision (kind "order_library": scry, surveil, "put them back in any order"). No React, no DOM.
// The player builds the new top of the library one card at a time (the first card placed is the NEXT card drawn, like "Place Next" in the legacy game),
// sends cards to the bottom (scry) or the graveyard (surveil), can undo the last placement or reset, and confirms when every card is placed.
// It never invents ids: every id it returns came from decision.options.
import type { Choice } from "@/kernel/engine/types";
import type { DecisionView } from "@/kernel/integration/tableState";

export type PlaceDecision = Pick<DecisionView, "options"> & { placement?: { to: "bottom" | "graveyard" | "none"; stack: "top" | "bottom" } };

export interface PlacementState {
  /** the ordered stack, first = next card drawn (or nearest the top of the bottom group when stack is "bottom") */
  top: string[];
  /** cards sent to the bottom / graveyard, in the order they were sent (first = closest to the top of the bottom group) */
  away: string[];
  /** earlier states, for Undo */
  history: Array<{ top: string[]; away: string[] }>;
}

export const emptyPlacement = (): PlacementState => ({ top: [], away: [], history: [] });

const snap = (p: PlacementState): PlacementState["history"] => [...p.history, { top: [...p.top], away: [...p.away] }];
const without = (xs: readonly string[], id: string): string[] => xs.filter((x) => x !== id);
const known = (d: PlaceDecision, id: string): boolean => d.options.some((o) => o.id === id);

/** can cards be sent away (scry: bottom, surveil: graveyard) by this decision? */
export function canSendAway(d: PlaceDecision): boolean { return d.placement?.to === "bottom" || d.placement?.to === "graveyard"; }
export function awayName(d: PlaceDecision): "bottom" | "graveyard" | undefined { return canSendAway(d) ? (d.placement!.to as "bottom" | "graveyard") : undefined; }

/** put `id` into the ordered stack: at the end (default) or at slot `at` (0 = next draw); a card already placed is moved */
export function putOnTop(d: PlaceDecision, p: PlacementState, id: string, at?: number): PlacementState {
  if (!known(d, id)) return p;
  const top = without(p.top, id);
  const i = at === undefined ? top.length : Math.max(0, Math.min(at, top.length));
  top.splice(i, 0, id);
  return { top, away: without(p.away, id), history: snap(p) };
}
/** send `id` to the bottom / graveyard (scry / surveil only) */
export function sendAway(d: PlaceDecision, p: PlacementState, id: string): PlacementState {
  if (!known(d, id) || !canSendAway(d)) return p;
  return { top: without(p.top, id), away: [...without(p.away, id), id], history: snap(p) };
}
/** take `id` back out of every pile (it is unplaced again) */
export function unplace(p: PlacementState, id: string): PlacementState {
  if (!p.top.includes(id) && !p.away.includes(id)) return p;
  return { top: without(p.top, id), away: without(p.away, id), history: snap(p) };
}
export function undoPlacement(p: PlacementState): PlacementState {
  const last = p.history[p.history.length - 1];
  return last ? { top: [...last.top], away: [...last.away], history: p.history.slice(0, -1) } : p;
}
export const resetPlacement = (): PlacementState => emptyPlacement();

export function unplacedIds(d: PlaceDecision, p: PlacementState): string[] { return d.options.map((o) => o.id).filter((id) => !p.top.includes(id) && !p.away.includes(id)); }
export function placementComplete(d: PlaceDecision, p: PlacementState): boolean { return d.options.length > 0 && unplacedIds(d, p).length === 0; }

/** the answer: every card exactly once */
export function placementChoice(d: PlaceDecision, p: PlacementState): Choice {
  const to = d.placement?.to;
  return { place: { top: [...p.top], ...(to === "bottom" ? { toBottom: [...p.away] } : {}), ...(to === "graveyard" ? { toGraveyard: [...p.away] } : {}) } };
}

/** the default stack the player starts from when they just want "leave it as it is": every card on top in the current order */
export function keepAllAnswer(d: PlaceDecision): PlacementState { return d.options.reduce((s, o) => putOnTop(d, s, o.id), emptyPlacement()); }

/** "Next draw (top of library)", "2nd", "3rd", "4th" ... (for a stack that goes to the bottom: nearest the top of the bottom group first) */
export function slotLabel(d: PlaceDecision, i: number): string {
  if (d.placement?.stack === "bottom") return i === 0 ? "1st (nearest the top of the bottom group)" : i === 1 ? "2nd" : i === 2 ? "3rd" : `${i + 1}th`;
  return i === 0 ? "Next draw (top of library)" : i === 1 ? "2nd" : i === 2 ? "3rd" : `${i + 1}th`;
}
export function stackTitle(d: PlaceDecision): string { return d.placement?.stack === "bottom" ? "Bottom of the library, in this order" : "Top of library (first = next card you draw)"; }
export function awayTitle(d: PlaceDecision): string { return d.placement?.to === "graveyard" ? "Graveyard" : "Bottom of library"; }

/** the button labels for one unplaced card */
export function putTopLabel(d: PlaceDecision, p: PlacementState): string {
  if (d.placement?.stack === "bottom") return p.top.length === 0 ? "Put first (nearest the top of the bottom group)" : "Put next in the bottom order";
  return p.top.length === 0 ? "Put on top (next draw)" : "Put on top (after the ones already placed)";
}
export function putAwayLabel(d: PlaceDecision): string | undefined { const a = awayName(d); return a === "bottom" ? "Put on the bottom" : a === "graveyard" ? "Put into the graveyard" : undefined; }

/** "Top of library after this: 1) Sol Ring 2) Island 3) (unplaced)" */
export function previewLine(d: PlaceDecision, p: PlacementState, nameOf: (id: string) => string): string {
  const placed = p.top.map((id, i) => `${i + 1}) ${nameOf(id)}`);
  const n = p.top.length;
  const open = unplacedIds(d, p).map((_, i) => `${n + i + 1}) (unplaced)`);
  const head = d.placement?.stack === "bottom" ? "Bottom of library after this" : "Top of library after this";
  const away = awayName(d);
  const tail = away && p.away.length ? ` | ${away === "bottom" ? "Bottom" : "Graveyard"}: ${p.away.map(nameOf).join(", ")}` : "";
  const body = [...placed, ...open].join(" ");
  return `${head}: ${body || "(nothing)"}${tail}`;
}

/** Enter and the Confirm button work only when every card is placed */
export function canConfirmPlacement(d: PlaceDecision, p: PlacementState): boolean { return placementComplete(d, p); }
/** a rules-required decision: Escape never cancels it */
export function escapeCancels(d: Pick<DecisionView, "kind" | "cancellable">): boolean { return d.kind !== "order_library" && d.cancellable; }
