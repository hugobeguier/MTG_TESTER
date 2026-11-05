import { describe, expect, it } from "vitest";
import { cardPickOptions, toggleCardSelection } from "./cardPick";

describe("card pick helpers", () => {
  it("toggles within a cap", () => {
    expect(toggleCardSelection([], "a", 2)).toEqual(["a"]);
    expect(toggleCardSelection(["a"], "b", 2)).toEqual(["a", "b"]);
    expect(toggleCardSelection(["a", "b"], "c", 2)).toEqual(["a", "b"]);
    expect(toggleCardSelection(["a", "b"], "a", 2)).toEqual(["b"]);
  });
  it("single-pick replaces the previous choice", () => {
    expect(toggleCardSelection(["a"], "b", 1)).toEqual(["b"]);
  });
  it("maps cards to options with selected state and labels", () => {
    const options = cardPickOptions([{ id: "1", name: "Swamp", manaCost: "", typeLine: "Basic Land - Swamp" }, { id: "2", name: "Shock", manaCost: "{R}", typeLine: "Instant" }], ["2"]);
    expect(options[0]).toMatchObject({ selected: false, ariaLabel: "Swamp", detail: "Basic Land - Swamp" });
    expect(options[1]).toMatchObject({ selected: true, ariaLabel: "Selected: Shock", detail: "{R} · Instant" });
  });
});
