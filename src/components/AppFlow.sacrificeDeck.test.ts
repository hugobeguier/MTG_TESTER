// Tests for the B/G sacrifice deck (Braids / Mazirek / Protean Hulk / Putrefy / Acidic Slime / Torment of Hailfire ...),
// built from the REAL Oracle text in the card catalog. Each case guards a gap found while auditing that every card
// in the deck works and offers the human a prompt for each choice.
import { describe, expect, it } from "vitest";
import {
  destroyCreatures,
  findSacrificeWatcherTriggers,
  parsePunisherChoiceEffect,
  remainingLibraryTotalManaValue,
  resolveTriggerEffect,
  searchableLibraryCards
} from "./AppFlow";
import { parseRemovalEffect, matchesTargetType } from "@/lib/removalSpells";
import { deterministicRuleWorkflow } from "@/lib/rulesAdvisor";
import { etbEffectText } from "@/lib/oracleClauses";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();

function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}

function seat(id: string, battlefield: VisibleCard[], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return {
    id, name: id, kind: "agent", life: 40, commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield, graveyard: [] }, ...extra
  };
}

function session(seats: PlayerSeat[]): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] };
}

const bear = (id: string, extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;

describe("Putrefy / Acidic Slime target lists (real Oracle text)", () => {
  it("Putrefy can hit an artifact OR a creature (it used to parse as artifact only)", () => {
    const effect = parseRemovalEffect(etbEffectText(real("Putrefy", "p").oracleText));
    expect(effect).toMatchObject({ kind: "destroy", targetType: "artifact_or_creature" });
    expect(matchesTargetType(bear("b"), "artifact_or_creature")).toBe(true);
    expect(matchesTargetType({ typeLine: "Artifact" }, "artifact_or_creature")).toBe(true);
    expect(matchesTargetType({ typeLine: "Land" }, "artifact_or_creature")).toBe(false);
  });

  it("Acidic Slime can hit an artifact, an enchantment or a land", () => {
    const effect = parseRemovalEffect(etbEffectText(real("Acidic Slime", "s").oracleText));
    expect(effect).toMatchObject({ kind: "destroy", targetType: "artifact_enchantment_or_land" });
    for (const typeLine of ["Artifact", "Enchantment", "Land", "Basic Land — Forest"]) expect(matchesTargetType({ typeLine }, "artifact_enchantment_or_land")).toBe(true);
    expect(matchesTargetType(bear("b"), "artifact_enchantment_or_land")).toBe(false);
  });
});

describe("Torment of Hailfire (real Oracle text)", () => {
  it("is recognized as a punisher effect despite the printed 'of their choice'", () => {
    expect(parsePunisherChoiceEffect(etbEffectText(real("Torment of Hailfire", "t").oracleText))).toEqual({ lifeAmount: 3 });
  });
});

describe("Mazirek, Kraul Death Priest (real Oracle text)", () => {
  const mazirekSession = () => {
    const mazirek = real("Mazirek, Kraul Death Priest", "mz", { power: "2", toughness: "2" });
    return { mazirek, s: session([seat("a", [mazirek, bear("b1"), bear("fodder")]), seat("b", [bear("opp")])]) };
  };

  it("fires when a player sacrifices another permanent, and not for a plain destruction", () => {
    const { s } = mazirekSession();
    const sacrificed = destroyCreatures(s, [{ seatId: "a", cardId: "fodder", message: "a sacrifices Bear fodder to Viscera Seer." }], "Rules action");
    expect(findSacrificeWatcherTriggers(sacrificed, sacrificed.pendingDeaths!)).toHaveLength(1);
    const destroyed = destroyCreatures(s, [{ seatId: "a", cardId: "fodder", message: "Bear fodder is destroyed by Murder." }], "Rules action");
    expect(findSacrificeWatcherTriggers(destroyed, destroyed.pendingDeaths!)).toHaveLength(0);
  });

  it("also fires for an OPPONENT's sacrifice, but never for Mazirek sacrificing itself", () => {
    const { s } = mazirekSession();
    const opp = destroyCreatures(s, [{ seatId: "b", cardId: "opp", message: "b sacrifices Bear opp to Fleshbag Marauder." }], "Rules action");
    expect(findSacrificeWatcherTriggers(opp, opp.pendingDeaths!)).toHaveLength(1);
    const self = destroyCreatures(s, [{ seatId: "a", cardId: "mz", message: "a sacrifices Mazirek to something." }], "Rules action");
    expect(findSacrificeWatcherTriggers(self, self.pendingDeaths!)).toHaveLength(0);
  });

  it("resolving it puts a +1/+1 counter on each creature Mazirek's controller has", () => {
    const { s } = mazirekSession();
    const sacrificed = destroyCreatures(s, [{ seatId: "a", cardId: "fodder", message: "a sacrifices Bear fodder to Viscera Seer." }], "Rules action");
    const trigger = findSacrificeWatcherTriggers(sacrificed, sacrificed.pendingDeaths!)[0];
    const after = resolveTriggerEffect(sacrificed, trigger);
    const mine = after.seats.find((x) => x.id === "a")!.board.battlefield;
    const counters = (id: string) => mine.find((c) => c.id === id)?.counters?.find((k) => k.kind === "+1/+1")?.count ?? 0;
    expect(counters("mz")).toBe(1);
    expect(counters("b1")).toBe(1);
    expect(after.seats.find((x) => x.id === "b")!.board.battlefield[0].counters?.length ?? 0).toBe(0);
  });
});

describe("Protean Hulk (real Oracle text)", () => {
  it("its death trigger is a search for ANY NUMBER of creatures with total mana value 6 or less", () => {
    const hulk = real("Protean Hulk", "ph");
    const workflow = deterministicRuleWorkflow({
      event: "card_moved_to_graveyard", actorName: "a", sourceCard: hulk, battlefield: [], hand: [], graveyard: [], exile: [], libraryPreview: []
    });
    expect(workflow).toMatchObject({ workflow: "search_library_to_battlefield", destination: "battlefield", allowedCardFilter: "creature", totalManaValueLimit: 6 });
    expect(workflow!.maxChoices).toBeGreaterThan(1);
  });

  it("the picker only offers creatures that still fit under the remaining total", () => {
    const lib = [bear("c2", { manaValue: 2 }), bear("c4", { manaValue: 4 }), bear("c5", { manaValue: 5 }), { ...bear("land"), typeLine: "Basic Land — Forest", manaValue: 0 }];
    const choice = { allowedCardFilter: "creature", totalManaValueLimit: 6, chosenCardIds: ["c4"] };
    const remaining = remainingLibraryTotalManaValue(choice, lib);
    expect(remaining).toBe(2);
    expect(searchableLibraryCards(lib.filter((c) => c.id !== "c4"), { ...choice, remainingTotalManaValue: remaining }).map((c) => c.id)).toEqual(["c2"]);
  });
});

describe("library search picker enforces the printed restriction", () => {
  const lib = [
    { ...bear("f"), name: "Forest", typeLine: "Basic Land — Forest", manaValue: 0 },
    { ...bear("sf"), name: "Stomping Ground", typeLine: "Land — Mountain Forest", manaValue: 0 },
    { ...bear("sw"), name: "Swamp", typeLine: "Basic Land — Swamp", manaValue: 0 },
    bear("c")
  ];
  it("Three Visits / Nature's Lore only offer Forests (including dual lands with the Forest type)", () => {
    expect(searchableLibraryCards(lib, { allowedCardFilter: "Forest" }).map((c) => c.id)).toEqual(["f", "sf"]);
  });
  it("basic-land searches (Sakura-Tribe Elder, Solemn, Kodama's Reach) offer only basic lands, even with a trailing 'cards'", () => {
    expect(searchableLibraryCards(lib, { allowedCardFilter: "basic land" }).map((c) => c.id)).toEqual(["f", "sw"]);
    expect(searchableLibraryCards(lib, { allowedCardFilter: "basic land cards" }).map((c) => c.id)).toEqual(["f", "sw"]);
  });
  it("Entomb (no restriction) and the advisor's placeholder offer everything", () => {
    expect(searchableLibraryCards(lib, {})).toHaveLength(4);
    expect(searchableLibraryCards(lib, { allowedCardFilter: "cards matching the source effect" })).toHaveLength(4);
  });
  it("Buried Alive only offers creature cards", () => {
    expect(searchableLibraryCards(lib, { allowedCardFilter: "creature" }).map((c) => c.id)).toEqual(["c"]);
  });
});

describe("library search picker: landcycling-style filters", () => {
  it("'basic plains' offers only a basic Plains, not every card", () => {
    const lib = [
      { ...bear("p"), name: "Plains", typeLine: "Basic Land — Plains", manaValue: 0 },
      { ...bear("i"), name: "Island", typeLine: "Basic Land — Island", manaValue: 0 },
      { ...bear("tp"), name: "Temple Garden", typeLine: "Land — Forest Plains", manaValue: 0 },
      bear("c")
    ];
    expect(searchableLibraryCards(lib, { allowedCardFilter: "basic plains" }).map((c) => c.id)).toEqual(["p"]);
    expect(searchableLibraryCards(lib, { allowedCardFilter: "plains" }).map((c) => c.id)).toEqual(["p", "tp"]);
  });
});
