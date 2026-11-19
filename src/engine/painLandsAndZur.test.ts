// Playtest bugs: pain lands ("{T}: Add {W} or {B}. This land deals 1 damage to you.") and Zur, Eternal Schemer's {1}{W} ability.
import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { chooseManaSourcesForCost, manaChoicesForCard, painDamageForTap, spendManaSources } from "@/engine/mana";
import { applyGenericAbilityEffect, parseGenericAbilityEffect, payGenericManaCost } from "@/engine/abilities";
import { parseGenericManaAbilities } from "@/lib/activatedAbilities";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
function seat(id: string, battlefield: VisibleCard[]): PlayerSeat {
  return { id, name: id, kind: "agent", life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield, graveyard: [] } };
}
const shim = (cost: string, extra: Partial<VisibleCard> = {}): VisibleCard => ({ id: "cost-shim", name: "cost", typeLine: "", oracleText: "", manaCost: cost, manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...extra }) as VisibleCard;

describe("Zur, Eternal Schemer {1}{W}", () => {
  it("its real Oracle line parses as a mana ability whose effect is the enchantment animation", () => {
    const zur = real("Zur, Eternal Schemer", "zur");
    const ability = parseGenericManaAbilities(zur.oracleText).find((a) => a.costManaText === "{1}{W}");
    expect(ability).toBeDefined();
    expect(parseGenericAbilityEffect(ability!.effectText)?.kind).toBe("animate_enchantment");
  });
  it("{1}{W} is payable from a Plains and any other land", () => {
    const s = seat("a", [real("Plains", "p"), real("Island", "i")]);
    expect(chooseManaSourcesForCost(s, shim("{1}{W}"), 2, undefined, [s]).ok).toBe(true);
  });
});

describe("pain lands", () => {
  it("Caves of Koilos offers C, W and B", () => {
    const s = seat("a", [real("Caves of Koilos", "c")]);
    expect([...manaChoicesForCard(s.board.battlefield[0], s)].sort()).toEqual(["B", "C", "W"]);
  });
  it("tapping Caves of Koilos for {C} costs no life; for {W} or {B} costs 1", () => {
    const s = seat("a", [real("Caves of Koilos", "c")]);
    expect(spendManaSources(s, ["c"], { c: "C" }).life).toBe(40);
    expect(spendManaSources(s, ["c"], { c: "W" }).life).toBe(39);
    expect(spendManaSources(s, ["c"], { c: "B" }).life).toBe(39);
  });
  it("auto-payment of a generic cost uses the free {C} ability (no damage), a colored pip pays the damage", () => {
    const s = seat("a", [real("Caves of Koilos", "c")]);
    const generic = chooseManaSourcesForCost(s, shim("{1}"), 1, undefined, [s]);
    expect(generic.ok).toBe(true);
    if (generic.ok) expect(spendManaSources(s, generic.sourceIds).life).toBe(40);
    const colored = chooseManaSourcesForCost(s, shim("{B}", { manaValue: 1 }), 1, undefined, [s]);
    expect(colored.ok).toBe(true);
    if (colored.ok) expect(spendManaSources(s, colored.sourceIds).life).toBe(39);
  });
  it("City of Brass (single ability) and Ancient Tomb always cost life", () => {
    const s = seat("a", [real("City of Brass", "cb"), real("Ancient Tomb", "at")]);
    expect(spendManaSources(s, ["cb"]).life).toBe(39);
    expect(spendManaSources(s, ["at"]).life).toBe(38);
  });
});

describe("Zur, Eternal Schemer activation end to end", () => {
  const sess = (seats: PlayerSeat[]): GameSession => ({ id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] });
  it("pays {1}{W} from Plains + Island and makes the enchantment a creature", () => {
    const s = seat("a", [real("Zur, Eternal Schemer", "zur"), real("Plains", "p"), real("Island", "i"), real("Always Watching", "e1")]);
    const paid = payGenericManaCost(sess([s]), "a", "zur", 0);
    expect(paid?.effect.kind).toBe("animate_enchantment");
    const after = applyGenericAbilityEffect(paid!.session, "a", paid!.card, paid!.effect);
    const lands = after.seats[0].board.battlefield.filter((c) => c.typeLine.includes("Land"));
    expect(lands.every((l) => l.tapped)).toBe(true);
    expect(after.seats[0].board.battlefield.find((c) => c.id === "e1")?.animatedAsCreature).toBe(true);
  });
  it("is not payable without a white source", () => {
    const s = seat("a", [real("Zur, Eternal Schemer", "zur"), real("Island", "i"), real("Island", "i2"), real("Always Watching", "e1")]);
    expect(payGenericManaCost(sess([s]), "a", "zur", 0)).toBeUndefined();
  });
  it("a pain land pays the {W} and costs 1 life; Plains is preferred over it", () => {
    const s = seat("a", [real("Zur, Eternal Schemer", "zur"), real("Caves of Koilos", "c"), real("Plains", "p"), real("Always Watching", "e1")]);
    const paid = payGenericManaCost(sess([s]), "a", "zur", 0)!;
    expect(paid.session.seats[0].life).toBe(40);
    const s2 = seat("a", [real("Zur, Eternal Schemer", "zur"), real("Caves of Koilos", "c"), real("Always Watching", "e1"), real("Island", "i")]);
    const paid2 = payGenericManaCost(sess([s2]), "a", "zur", 0)!;
    expect(paid2.session.seats[0].life).toBe(39);
  });
});

describe("painDamageForTap", () => {
  it("per colour", () => {
    const caves = real("Caves of Koilos", "c");
    expect([painDamageForTap(caves, "C"), painDamageForTap(caves, "W"), painDamageForTap(caves, "B")]).toEqual([0, 1, 1]);
    const brass = real("City of Brass", "cb");
    expect(painDamageForTap(brass, "R")).toBe(1);
    expect(painDamageForTap(real("Plains", "p"), "W")).toBe(0);
  });
});

describe("every pain source in the shipped decks", () => {
  it.each(["Adarkar Wastes", "Caves of Koilos", "Llanowar Wastes", "Shivan Reef", "Underground River", "Talisman of Creativity", "Talisman of Dominance", "Talisman of Hierarchy", "Talisman of Progress"])("%s: {C} is free, a coloured tap costs 1", (name) => {
    const card = real(name, "x");
    const colored = manaChoicesForCard(card, seat("a", [card])).filter((c) => c !== "C");
    expect(colored.length).toBeGreaterThan(0);
    expect(painDamageForTap(card, "C")).toBe(0);
    for (const color of colored) expect(painDamageForTap(card, color)).toBe(1);
  });
});
