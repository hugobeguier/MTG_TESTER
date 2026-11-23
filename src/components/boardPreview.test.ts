import { describe, expect, it } from "vitest";
import type { VisibleCard } from "@/lib/types";
import { battlefieldPreviewCard, isLeftAlt } from "./boardPreview";

const card = (patch: Partial<VisibleCard> = {}) => ({ id: "c", name: "Bear", typeLine: "Creature", oracleText: "", manaValue: 2, colors: [], role: "permanent", zone: "battlefield", ...patch }) as VisibleCard;

describe("Alt battlefield preview", () => {
  it("enlarges public battlefield cards of any seat", () => {
    const c = card();
    expect(battlefieldPreviewCard(c, "battlefield")).toBe(c);
  });
  it("never enlarges hidden stubs, face-down permanents or other zones", () => {
    expect(battlefieldPreviewCard(card({ role: "hidden" }), "battlefield")).toBeUndefined();
    expect(battlefieldPreviewCard(card({ faceDownCardName: "Secret" }), "battlefield")).toBeUndefined();
    expect(battlefieldPreviewCard(card({ name: "Manifested Creature" }), "battlefield")).toBeUndefined();
    expect(battlefieldPreviewCard(card(), "hand")).toBeUndefined();
    expect(battlefieldPreviewCard(undefined, "battlefield")).toBeUndefined();
  });
  it("only Left Alt triggers it", () => {
    expect(isLeftAlt({ code: "AltLeft" })).toBe(true);
    expect(isLeftAlt({ code: "AltRight" })).toBe(false);
  });
});

import { listedPreviewCard } from "./boardPreview";
describe("listed card preview (dialog, stack, log, piles)", () => {
  it("enlarges listed cards of any zone, including library / graveyard / stack", () => {
    for (const zone of ["library", "graveyard", "exile", "hand", "stack"] as const) {
      const c = card({ zone: zone as VisibleCard["zone"] });
      expect(listedPreviewCard(c)).toBe(c);
    }
  });
  it("never enlarges hidden stubs or anonymous face-down cards", () => {
    expect(listedPreviewCard(card({ role: "hidden" }))).toBeUndefined();
    expect(listedPreviewCard(card({ id: "hidden:p2:hand:0" }))).toBeUndefined();
    expect(listedPreviewCard(card({ name: "Hidden card" }))).toBeUndefined();
    expect(listedPreviewCard(card({ name: "Face-down card" }))).toBeUndefined();
    expect(listedPreviewCard(undefined)).toBeUndefined();
  });
});
