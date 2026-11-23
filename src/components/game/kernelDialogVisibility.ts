// Hide / show state of a kernel decision window (Esc peeks at the table, like the legacy "Minimize choice").
// Pure: the window stays mounted while hidden (its selections live in its own state), a different decision id always starts visible,
// and nothing here ever answers or cancels a decision.

export interface DialogVisibility { decisionId: string | undefined; hidden: boolean }

export const initialVisibility: DialogVisibility = { decisionId: undefined, hidden: false };

/** the state as it applies to the decision on screen now: a new decision id resets to visible */
export function visibilityFor(state: DialogVisibility, decisionId: string | undefined): DialogVisibility {
  return state.decisionId === decisionId ? state : { decisionId, hidden: false };
}

export function isHidden(state: DialogVisibility, decisionId: string | undefined): boolean {
  return decisionId !== undefined && visibilityFor(state, decisionId).hidden;
}

export function toggleHidden(state: DialogVisibility, decisionId: string | undefined): DialogVisibility {
  if (decisionId === undefined) return state;
  const cur = visibilityFor(state, decisionId);
  return { decisionId, hidden: !cur.hidden };
}

export function setHidden(state: DialogVisibility, decisionId: string | undefined, hidden: boolean): DialogVisibility {
  if (decisionId === undefined) return state;
  return { decisionId, hidden };
}

/** Esc toggles unless the card inspector or a zone viewer is open on top (Esc belongs to them) or the key is auto-repeating */
export function escapeToggles(e: { key: string; repeat?: boolean }, overlayOpen: boolean): boolean {
  return e.key === "Escape" && !e.repeat && !overlayOpen;
}

/** Esc never answers: the answer a key produces is always undefined for Escape (Enter confirms elsewhere) */
export function keyAnswers(key: string, hidden: boolean): boolean {
  return key === "Enter" && !hidden;
}

/** a hidden window leaves the table inspectable but the player may not answer through it; only the Show button / Esc bring it back */
export function canAnswer(hidden: boolean): boolean { return !hidden; }

export const hideHint = "Esc: hide / show this window";

export function showLabel(title: string): string { return `Show choice: ${title}`; }
