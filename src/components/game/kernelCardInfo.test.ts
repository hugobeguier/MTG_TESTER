import { describe, expect, it } from "vitest";
import type { VisibleCard } from "@/lib/types";
import type { DecisionView } from "@/kernel/integration/tableState";
import { cardImageUrl, cardInfo, cardSummary, optionCards, pileDestination } from "./kernelCardInfo";
import { splitCardNames, visibleCardsByName } from "./logCards";

const card = (p: Partial<VisibleCard> = {}): VisibleCard => ({ id: "#1", name: "Sol Ring", typeLine: "Artifact", oracleText: "{T}: Add {C}{C}.", manaCost: "{1}", manaValue: 1, colors: [], role: "permanent", zone: "library", ...p } as VisibleCard);

describe("card info", () => {
  it("picks the wanted image size and falls back to other sizes, then the first face", () => {
    expect(cardImageUrl(card({ imageUris: { small: "s", normal: "n", large: "l" } }), "large")).toBe("l");
    expect(cardImageUrl(card({ imageUris: { small: "s" } }), "large")).toBe("s");
    expect(cardImageUrl(card({ faces: [{ imageUris: { normal: "f" } } as never] }), "normal")).toBe("f");
    expect(cardImageUrl(card(), "normal")).toBeUndefined();
  });
  it("text fallback has name, cost, type, rules, P/T, counters when there is no art", () => {
    const i = cardInfo(card({ power: "3", toughness: "4", counters: [{ kind: "+1/+1", count: 2 }] }));
    expect(i).toMatchObject({ name: "Sol Ring", manaCost: "{1}", typeLine: "Artifact", stats: "3/4", counters: "2 +1/+1" });
    expect(i.imageUrl).toBeUndefined();
    expect(cardSummary(card())).toContain("{T}: Add {C}{C}.");
    expect(cardInfo(card({ loyalty: "4" })).stats).toBe("Loyalty 4");
  });
  it("optionCards lists only options that carry a card", () => {
    expect(optionCards([{ id: "a", card: card() }, { id: "b" }]).map((o) => o.id)).toEqual(["a"]);
  });
});

describe("pileDestination", () => {
  const d = (instruction: string, zone: VisibleCard["zone"] = "library"): Pick<DecisionView, "kind" | "instruction" | "title" | "options"> => ({ kind: "choose_cards", title: "", instruction, options: [{ id: "#1", label: "x", card: card({ zone }) }] });
  it("reads where the picked cards go from the kernel's own text", () => {
    expect(pileDestination(d("Choose any cards to put on the bottom of your library; the rest stay on top."))).toBe("bottom");
    expect(pileDestination(d("Choose any cards to put into your graveyard; the rest stay on top."))).toBe("graveyard");
  });
  it("is not a pile for cards outside the library or other kinds", () => {
    expect(pileDestination(d("put into your graveyard", "graveyard"))).toBeUndefined();
    expect(pileDestination({ ...d("put on the bottom"), kind: "choose_targets" })).toBeUndefined();
  });
});

describe("log card names", () => {
  it("links names of visible cards only, longest first", () => {
    const session = { seats: [{ board: { hand: [card({ id: "a", name: "Sol Ring" }), card({ id: "h", name: "Hidden card", role: "hidden" })], battlefield: [card({ id: "b", name: "Sol" })] }, library: [] }] } as never;
    const m = visibleCardsByName(session);
    expect([...m.keys()].sort()).toEqual(["Sol", "Sol Ring"]);
    const parts = splitCardNames("You cast Sol Ring.", m);
    expect(parts.map((p) => p.text)).toEqual(["You cast ", "Sol Ring", "."]);
    expect(parts[1].card?.id).toBe("a");
    expect(splitCardNames("Nothing here", m)).toEqual([{ text: "Nothing here" }]);
  });
});
