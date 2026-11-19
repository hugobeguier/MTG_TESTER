// Keyboard shortcuts for priority: Space = pass priority (when the viewer holds priority on something), Shift+Space = yield until end of turn (toggle).
// Pure decision so it is testable without a DOM: the table's key listener builds the plain event description and the facts and acts on the answer.

export interface ShortcutKeyEvent {
  key: string;
  code?: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat?: boolean;
  /** Where the key went: tag name of the focused element and whether it is editable. */
  targetTag?: string;
  targetEditable?: boolean;
}

export interface ShortcutFacts {
  /** A seated human is looking at the table in a running game. */
  active: boolean;
  /** Something is on the stack and the viewer holds priority. */
  canPass: boolean;
  /** Some modal / prompt / choice box is open (the shortcut never answers or dismisses it). */
  promptOpen: boolean;
}

export type ShortcutAction = "pass" | "yield";

const IGNORED_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "SUMMARY"]);

export function priorityShortcut(event: ShortcutKeyEvent, facts: ShortcutFacts): ShortcutAction | undefined {
  if (event.key !== " " && event.code !== "Space") return undefined;
  if (!facts.active || facts.promptOpen || event.repeat) return undefined;
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  if (event.targetEditable || (event.targetTag !== undefined && IGNORED_TAGS.has(event.targetTag.toUpperCase()))) return undefined;
  if (event.shiftKey) return "yield";
  return facts.canPass ? "pass" : undefined;
}

/** Reads the plain description off a DOM keyboard event. */
export function describeKeyEvent(event: KeyboardEvent): ShortcutKeyEvent {
  const target = event.target instanceof HTMLElement ? event.target : undefined;
  return {
    key: event.key,
    code: event.code,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    repeat: event.repeat,
    targetTag: target?.tagName,
    targetEditable: Boolean(target?.isContentEditable)
  };
}
