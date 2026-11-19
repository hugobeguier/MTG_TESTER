// Batch 3: activated abilities, lands and leftovers of the shipped decks, tested with the REAL Oracle text from the card catalog (never wording typed
// into a test). Engine/unit tests only: nothing here drives the browser UI.
import { describe, expect, it } from "vitest";
import { chooseManaSourcesForCost, isAvailableManaSource, manaChoicesForCard, manaProducedBy, spendManaSources } from "./AppFlow";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
export function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
export const bear = (id: string, extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;
export function seat(id: string, battlefield: VisibleCard[], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return {
    id, name: id, kind: "human", life: 40, commanderDamage: {},
    zones: { library: (extra.library ?? []).length, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield, graveyard: [] }, ...extra
  };
}
export function session(seats: PlayerSeat[], extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 6, activePlayerId: seats[0].id, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra } as GameSession;
}
export const by = (s: GameSession, id: string) => s.seats.find((x) => x.id === id)!;
export const onBoard = (s: GameSession, id: string, seatId = "a") => by(s, seatId).board.battlefield.find((c) => c.id === id);

describe("Viridescent Bog: {1}, {T}: Add {B}{G}.", () => {
  it("is a mana source making B and G when another land can pay the {1}", () => {
    const bog = real("Viridescent Bog", "bog");
    const s = seat("a", [bog, real("Swamp", "sw1")]);
    expect(manaChoicesForCard(bog, s, [s]).sort().join("")).toBe("BG");
    expect(manaProducedBy(bog, s)).toBe(1);
  });
  it("pays {2}{B}{G} together with two more lands", () => {
    const bog = real("Viridescent Bog", "bog");
    const s = seat("a", [bog, real("Swamp", "sw1"), real("Forest", "f1"), real("Forest", "f2")]);
    const spell = real("Swamp", "spell", { manaValue: 4, manaCost: "{2}{B}{G}", typeLine: "Sorcery" });
    const paid = chooseManaSourcesForCost(s, spell, 4, undefined, [s]);
    expect(paid.ok).toBe(true);
    expect(isAvailableManaSource(bog, s, [s])).toBe(true);
    expect(spendManaSources(s, paid.sourceIds).board.battlefield.every((c) => c.tapped)).toBe(true);
  });
});

describe("Crypt of Agadeem: {2}, {T}: Add {B} for each black creature card in your graveyard.", () => {
  const dead = (id: string, colors: string[]) => bear(id, { zone: "graveyard", colors: colors as never });
  it("makes B per black creature card in the graveyard (net of the {2})", () => {
    const crypt = real("Crypt of Agadeem", "cr");
    const lands = [real("Swamp", "s1"), real("Swamp", "s2"), real("Swamp", "s3")];
    const gy = [dead("g1", ["B"]), dead("g2", ["B"]), dead("g3", ["B"]), dead("g4", ["B"]), dead("g5", ["G"])];
    const s = seat("a", [crypt, ...lands], { board: { hand: [], battlefield: [crypt, ...lands], graveyard: gy } });
    expect(manaChoicesForCard(crypt, s, [s]).join("")).toContain("B");
    expect(manaProducedBy(crypt, s)).toBe(2);
  });
  it("is not worth tapping with too few black creature cards", () => {
    const crypt = real("Crypt of Agadeem", "cr");
    const lands = [real("Swamp", "s1"), real("Swamp", "s2")];
    const s = seat("a", [crypt, ...lands], { board: { hand: [], battlefield: [crypt, ...lands], graveyard: [dead("g1", ["B"]), dead("g2", ["B"])] } });
    // still has its plain {T}: Add {B}
    expect(manaChoicesForCard(crypt, s, [s]).join("")).toBe("B");
    expect(manaProducedBy(crypt, s)).toBe(1);
  });
});
