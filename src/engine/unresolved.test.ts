import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { findUnresolvedClauses, recordUnresolved, reportUnresolvedForCard, unresolvedMessage } from "@/engine/unresolved";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
function real(name: string): VisibleCard {
  const c = lookupCard(catalog, name);
  if (!c) throw new Error(`card missing from catalog: ${name}`);
  return { id: `id-${name}`, name: c.name, typeLine: c.typeLine, oracleText: c.oracleText, manaValue: c.manaValue, colors: c.colors, zone: "stack" } as unknown as VisibleCard;
}
function eventFor(card: VisibleCard): string {
  return card.typeLine.includes("Saga") ? "saga_chapter" : card.typeLine.includes("Land") ? "land_played" : /Instant|Sorcery/.test(card.typeLine) ? "spell_resolved_to_graveyard" : "spell_resolved_to_battlefield";
}
function seat(id: string, kind: "human" | "agent", deckName: string): PlayerSeat {
  return { id, name: id, kind, life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield: [] }, deck: { id: deckName, name: deckName } as never } as unknown as PlayerSeat;
}
function game(): GameSession {
  return { id: "g1", createdAt: "", status: "playing", phase: "precombat main phase", turn: 3, xmage: { enabled: false, status: "not_configured", message: "" }, seats: [seat("h", "human", "Deck H"), seat("a", "agent", "Deck A")], events: [] } as unknown as GameSession;
}
const unresolvedLines = (s: GameSession) => s.events.filter((e) => e.detail === "Unresolved").map((e) => e.message);

describe("legacy 'Couldn't resolve' log", () => {
  // These are the cards from the Rules Advisor removal whose text no legacy parser takes: exactly one line each (some have two separate unhandled clauses, named individually).
  const oneLine: Array<[string, string]> = [
    ["Agadeem's Awakening", "Return from your graveyard"],
    ["Shadrix Silverquill", "Target player puts a +1/+1 counter"],
    ["The Ozolith", "leaves the battlefield"],
    ["Reluctant Role Model", "put those counters on up to one target creature"],
    ["Necroblossom Snarl", "reveal a Swamp or Forest"],
    ["The Odd Acorn Gang", "Squirrels you control have"]
  ];
  for (const [name, fragment] of oneLine) {
    for (const kind of ["human", "agent"] as const) {
      it(`${name} logs exactly one unresolved clause (${kind} seat)`, () => {
        const card = real(name);
        const s = game();
        const before = reportUnresolvedForCard(s, kind === "human" ? "h" : "a", card, eventFor(card));
        const lines = unresolvedLines(before).filter((m) => m.startsWith(`Couldn't resolve: ${card.name} - `));
        const clauses = findUnresolvedClauses(card, eventFor(card));
        expect(clauses.length).toBeGreaterThan(0);
        expect(lines.length).toBe(clauses.length);
        expect(lines.join("\n")).toContain(fragment);
        expect(before.unresolvedEffects?.every((r) => r.engine === "legacy" && r.seatKind === kind && r.decks.includes("Deck H"))).toBe(true);
        // A retried resolution of the same card object adds nothing.
        const again = reportUnresolvedForCard(before, kind === "human" ? "h" : "a", card, eventFor(card));
        expect(unresolvedLines(again)).toEqual(unresolvedLines(before));
      });
    }
  }

  it("Shadrix and the Ozolith each log one line per unhandled clause, not one blob", () => {
    expect(findUnresolvedClauses(real("The Ozolith"), "spell_resolved_to_battlefield")).toHaveLength(2);
    expect(findUnresolvedClauses(real("Shadrix Silverquill"), "spell_resolved_to_battlefield")).toHaveLength(1);
  });

  it("cards the engine handles produce no line", () => {
    for (const name of ["Divination", "Lightning Bolt", "Doom Blade", "Cultivate", "Rampant Growth", "Brainstorm", "Beast Within", "Swan Song", "Cankerbloom", "Temporal Mastery", "Sol Ring", "Llanowar Elves", "Eternal Witness", "Skullclamp"]) {
      const card = real(name);
      expect(findUnresolvedClauses(card, eventFor(card)), name).toEqual([]);
      expect(unresolvedLines(reportUnresolvedForCard(game(), "h", card, eventFor(card))), name).toEqual([]);
    }
  });

  it("a multi-clause spell with one unhandled clause logs only that clause", () => {
    const card = { ...real("Divination"), name: "Test Spell", oracleText: "Draw two cards. Put a zorb counter on every frobnitz in the multiverse." };
    const out = reportUnresolvedForCard(game(), "h", card, "spell_resolved_to_graveyard");
    expect(unresolvedLines(out)).toEqual([unresolvedMessage("Test Spell", "Put a zorb counter on every frobnitz in the multiverse.")]);
  });

  it("names only the resolving card and tags the entry; never throws on odd input", () => {
    const s = game();
    const out = recordUnresolved(s, "h", { id: "c", name: "Swan Song" }, "x", "spell");
    expect(out.events[0].detail).toBe("Unresolved");
    expect(out.events[0].message).toBe("Couldn't resolve: Swan Song - x");
    expect(() => recordUnresolved({ ...s, seats: undefined } as never, "h", { id: "c", name: "n" }, "x", "spell")).not.toThrow();
    expect(() => findUnresolvedClauses({ ...real("Divination"), oracleText: undefined } as never, "land_played")).not.toThrow();
    expect(findUnresolvedClauses(real("Giada, Font of Hope"), "card_moved_to_graveyard")).toEqual([]);
    // Static/replacement abilities (Giada) belong to the static systems and are not judged at resolution.
    expect(findUnresolvedClauses(real("Giada, Font of Hope"), "spell_resolved_to_battlefield")).toEqual([]);
  });
});
