import { describe, expect, it } from "vitest";
import { canAnswer, escapeToggles, initialVisibility, isHidden, keyAnswers, setHidden, showLabel, toggleHidden, visibilityFor } from "./kernelDialogVisibility";

describe("kernel dialog hide / show", () => {
  it("starts visible and toggles", () => {
    let s = initialVisibility;
    expect(isHidden(s, "d1")).toBe(false);
    s = toggleHidden(s, "d1");
    expect(isHidden(s, "d1")).toBe(true);
    s = toggleHidden(s, "d1");
    expect(isHidden(s, "d1")).toBe(false);
  });
  it("a new decision id is visible again", () => {
    const s = toggleHidden(initialVisibility, "d1");
    expect(isHidden(s, "d2")).toBe(false);
    expect(visibilityFor(s, "d2")).toEqual({ decisionId: "d2", hidden: false });
    expect(isHidden(toggleHidden(s, "d2"), "d2")).toBe(true);
  });
  it("no decision: nothing to hide", () => {
    expect(toggleHidden(initialVisibility, undefined)).toBe(initialVisibility);
    expect(isHidden(initialVisibility, undefined)).toBe(false);
  });
  it("setHidden works; toggling does not touch anything else (the window stays mounted, so its picks are kept)", () => {
    expect(isHidden(setHidden(initialVisibility, "d1", true), "d1")).toBe(true);
    expect(isHidden(setHidden(initialVisibility, "d1", false), "d1")).toBe(false);
  });
  it("Escape toggles only when no inspector / zone viewer is on top and not on repeat", () => {
    expect(escapeToggles({ key: "Escape" }, false)).toBe(true);
    expect(escapeToggles({ key: "Escape" }, true)).toBe(false);
    expect(escapeToggles({ key: "Escape", repeat: true }, false)).toBe(false);
    expect(escapeToggles({ key: "Enter" }, false)).toBe(false);
  });
  it("Escape never answers; Enter answers only while visible; a hidden window cannot answer", () => {
    expect(keyAnswers("Escape", false)).toBe(false);
    expect(keyAnswers("Escape", true)).toBe(false);
    expect(keyAnswers("Enter", false)).toBe(true);
    expect(keyAnswers("Enter", true)).toBe(false);
    expect(canAnswer(true)).toBe(false);
    expect(canAnswer(false)).toBe(true);
  });
  it("label", () => { expect(showLabel("Scry 2")).toBe("Show choice: Scry 2"); });
});
