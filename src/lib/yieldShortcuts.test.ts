import { describe, expect, it } from "vitest";
import { priorityShortcut, type ShortcutFacts, type ShortcutKeyEvent } from "./yieldShortcuts";

const key = (patch: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({ key: " ", code: "Space", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...patch });
const facts = (patch: Partial<ShortcutFacts> = {}): ShortcutFacts => ({ active: true, canPass: true, promptOpen: false, ...patch });

describe("priorityShortcut", () => {
  it("Space passes when the viewer holds priority, Shift+Space yields", () => {
    expect(priorityShortcut(key(), facts())).toBe("pass");
    expect(priorityShortcut(key({ shiftKey: true }), facts())).toBe("yield");
    expect(priorityShortcut(key({ shiftKey: true }), facts({ canPass: false }))).toBe("yield");
  });
  it("Space does nothing without a priority window of your own", () => {
    expect(priorityShortcut(key(), facts({ canPass: false }))).toBeUndefined();
  });
  it("never fires while typing, on a focused button, with a prompt/modal open, as a spectator, or with other modifiers", () => {
    expect(priorityShortcut(key({ targetTag: "TEXTAREA" }), facts())).toBeUndefined();
    expect(priorityShortcut(key({ targetTag: "input", shiftKey: true }), facts())).toBeUndefined();
    expect(priorityShortcut(key({ targetEditable: true }), facts())).toBeUndefined();
    expect(priorityShortcut(key({ targetTag: "BUTTON" }), facts())).toBeUndefined();
    expect(priorityShortcut(key(), facts({ promptOpen: true }))).toBeUndefined();
    expect(priorityShortcut(key(), facts({ active: false }))).toBeUndefined();
    expect(priorityShortcut(key({ ctrlKey: true }), facts())).toBeUndefined();
    expect(priorityShortcut(key({ repeat: true }), facts())).toBeUndefined();
    expect(priorityShortcut(key({ key: "a", code: "KeyA" }), facts())).toBeUndefined();
  });
});
