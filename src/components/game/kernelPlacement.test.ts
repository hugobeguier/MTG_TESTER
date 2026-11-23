import { describe, expect, it } from "vitest";
import { classifyDecision } from "./kernelDecisionView";
import {
  canConfirmPlacement, emptyPlacement, escapeCancels, keepAllAnswer, placementChoice, previewLine, putAwayLabel, putOnTop, putTopLabel, resetPlacement, sendAway, slotLabel, undoPlacement, unplace,
  unplacedIds, type PlaceDecision
} from "./kernelPlacement";

const opts = (...names: string[]) => names.map((n) => ({ id: `#${n}`, label: n }));
const scry: PlaceDecision = { options: opts("A", "B", "C"), placement: { to: "bottom", stack: "top" } };
const surveil: PlaceDecision = { options: opts("A", "B"), placement: { to: "graveyard", stack: "top" } };
const putBack: PlaceDecision = { options: opts("A", "B", "C"), placement: { to: "none", stack: "top" } };
const name = (id: string) => id.slice(1);

describe("classification", () => {
  it("order_library gets the placement layout", () => {
    const d = { kind: "order_library", options: scry.options, min: 0, max: 3, cancellable: false, placement: scry.placement } as never;
    expect(classifyDecision(d)).toMatchObject({ layout: "place", board: false });
  });
  it("Escape never cancels a placement, other cancellable decisions still can", () => {
    expect(escapeCancels({ kind: "order_library", cancellable: true })).toBe(false);
    expect(escapeCancels({ kind: "choose_cards", cancellable: true })).toBe(true);
    expect(escapeCancels({ kind: "choose_cards", cancellable: false })).toBe(false);
  });
});

describe("building the top of the library", () => {
  it("clicking cards in the order you want them drawn builds the stack (Place Next muscle memory)", () => {
    let p = emptyPlacement();
    p = putOnTop(scry, p, "#C"); p = putOnTop(scry, p, "#A"); p = putOnTop(scry, p, "#B");
    expect(p.top).toEqual(["#C", "#A", "#B"]);
    expect(canConfirmPlacement(scry, p)).toBe(true);
    expect(placementChoice(scry, p)).toEqual({ place: { top: ["#C", "#A", "#B"], toBottom: [] } });
  });
  it("placing at a slot inserts there; placing a placed card moves it", () => {
    let p = emptyPlacement();
    p = putOnTop(scry, p, "#A"); p = putOnTop(scry, p, "#B");
    p = putOnTop(scry, p, "#C", 0);
    expect(p.top).toEqual(["#C", "#A", "#B"]);
    p = putOnTop(scry, p, "#B", 0);
    expect(p.top).toEqual(["#B", "#C", "#A"]);
  });
  it("scry: cards sent to the bottom keep their order; a card can move between piles", () => {
    let p = emptyPlacement();
    p = sendAway(scry, p, "#B"); p = sendAway(scry, p, "#A");
    expect(p.away).toEqual(["#B", "#A"]);
    p = putOnTop(scry, p, "#B");
    expect(p).toMatchObject({ top: ["#B"], away: ["#A"] });
    p = putOnTop(scry, p, "#C");
    expect(placementChoice(scry, p)).toEqual({ place: { top: ["#B", "#C"], toBottom: ["#A"] } });
  });
  it("surveil answers with toGraveyard; a put-back (no away pile) cannot send cards away", () => {
    let p = sendAway(surveil, emptyPlacement(), "#A");
    p = putOnTop(surveil, p, "#B");
    expect(placementChoice(surveil, p)).toEqual({ place: { top: ["#B"], toGraveyard: ["#A"] } });
    expect(sendAway(putBack, emptyPlacement(), "#A").away).toEqual([]);
    expect(putAwayLabel(putBack)).toBeUndefined();
    expect(placementChoice(putBack, keepAllAnswer(putBack))).toEqual({ place: { top: ["#A", "#B", "#C"] } });
  });
  it("ids that are not options are ignored", () => {
    expect(putOnTop(scry, emptyPlacement(), "#Z").top).toEqual([]);
    expect(sendAway(scry, emptyPlacement(), "#Z").away).toEqual([]);
  });
});

describe("undo, reset, unplace", () => {
  it("undo steps back one placement at a time; reset clears", () => {
    let p = emptyPlacement();
    p = putOnTop(scry, p, "#A"); p = sendAway(scry, p, "#B"); p = putOnTop(scry, p, "#C");
    p = undoPlacement(p);
    expect(p).toMatchObject({ top: ["#A"], away: ["#B"] });
    p = undoPlacement(p); p = undoPlacement(p);
    expect(p).toMatchObject({ top: [], away: [] });
    expect(undoPlacement(p)).toBe(p);
    expect(resetPlacement()).toEqual(emptyPlacement());
  });
  it("unplace returns a card to the unplaced row, and undo brings it back", () => {
    let p = putOnTop(scry, putOnTop(scry, emptyPlacement(), "#A"), "#B");
    p = unplace(p, "#A");
    expect(p.top).toEqual(["#B"]);
    expect(unplacedIds(scry, p)).toEqual(["#A", "#C"]);
    expect(undoPlacement(p).top).toEqual(["#A", "#B"]);
  });
});

describe("confirm gating", () => {
  it("is enabled only when every card is placed", () => {
    let p = emptyPlacement();
    expect(canConfirmPlacement(scry, p)).toBe(false);
    p = putOnTop(scry, p, "#A"); p = sendAway(scry, p, "#B");
    expect(canConfirmPlacement(scry, p)).toBe(false);
    p = putOnTop(scry, p, "#C");
    expect(canConfirmPlacement(scry, p)).toBe(true);
    expect(canConfirmPlacement({ options: [] }, emptyPlacement())).toBe(false);
  });
});

describe("labels", () => {
  it("slots are numbered and descriptive", () => {
    expect(slotLabel(scry, 0)).toBe("Next draw (top of library)");
    expect(slotLabel(scry, 1)).toBe("2nd");
    expect(slotLabel(scry, 2)).toBe("3rd");
    expect(slotLabel(scry, 3)).toBe("4th");
  });
  it("button labels", () => {
    expect(putTopLabel(scry, emptyPlacement())).toBe("Put on top (next draw)");
    expect(putTopLabel(scry, putOnTop(scry, emptyPlacement(), "#A"))).toBe("Put on top (after the ones already placed)");
    expect(putAwayLabel(scry)).toBe("Put on the bottom");
    expect(putAwayLabel(surveil)).toBe("Put into the graveyard");
  });
  it("the live preview line", () => {
    let p = emptyPlacement();
    expect(previewLine(scry, p, name)).toBe("Top of library after this: 1) (unplaced) 2) (unplaced) 3) (unplaced)");
    p = putOnTop(scry, p, "#C"); p = putOnTop(scry, p, "#A");
    expect(previewLine(scry, p, name)).toBe("Top of library after this: 1) C 2) A 3) (unplaced)");
    p = sendAway(scry, p, "#B");
    expect(previewLine(scry, p, name)).toBe("Top of library after this: 1) C 2) A | Bottom: B");
    expect(previewLine(surveil, sendAway(surveil, emptyPlacement(), "#A"), name)).toContain("Graveyard: A");
  });
});
