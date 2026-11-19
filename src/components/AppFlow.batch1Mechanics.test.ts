// Batch 1 shared mechanics, tested with the REAL Oracle text from the card catalog (data/commander-cards.json), never wording typed into the test:
//  A. cost reductions / alternative costs / Phyrexian mana / {C} pips   B. Urborg & Yavimaya land-type grants
//  C. token creation pipeline (Chatterfang, Academy Manufactor, ...)   D. mana sources that only produce mana in a trigger
import { describe, expect, it } from "vitest";
import { adjustedCastingCost, totalCastingCost } from "@/engine/costs";
import { chooseManaSourcesForCost, isAvailableManaSource, lifeGainForTap, manaChoicesForCard, manaProducedBy, payCostFromPool, spendManaSources, emptyManaPool } from "@/engine/mana";
import { runStateBasedActionsPass } from "@/engine/stateBased";
import { legalMainPhaseActions } from "@/engine/legalActions";
import { findCommonTriggersForPermanentEntered, resolveTriggerEffect } from "@/engine/triggers";
import { basicLandTypes } from "@/engine/shared";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, ManaColor, PlayerSeat, VisibleCard } from "@/lib/types";

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
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 5, activePlayerId: seats[0].id, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] } as GameSession;
}

const land = (id: string, name: string) => real(name, id, { typeLine: `Basic Land — ${name}`, oracleText: "", producedMana: [{ Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" }[name] as ManaColor] } as Partial<VisibleCard>);
const bear = (id: string, power = "2", extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power, toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;
const settle = (seats: PlayerSeat[]) => runStateBasedActionsPass(session(seats)).session.seats;
const mine = (seats: PlayerSeat[]) => seats.find((item) => item.id === "a")!;
const find = (seats: PlayerSeat[], id: string) => seats.flatMap((item) => item.board.battlefield).find((card) => card.id === id)!;

describe("A. The Great Henge (real Oracle text)", () => {
  it("costs {X} less, X = greatest power among creatures you control, never below its {G}{G}", () => {
    const henge = real("The Great Henge", "gh");
    const none = seat("a", []);
    expect(totalCastingCost(none, henge, henge.manaValue, 0, [none])).toBe(9);
    const six = seat("a", [bear("big", "6")]);
    expect(adjustedCastingCost(six, henge, henge.manaValue, "hand", "a", [six])).toBe(3);
    expect(totalCastingCost(six, henge, henge.manaValue, 0, [six])).toBe(3);
    const huge = seat("a", [bear("huge", "12")]);
    expect(adjustedCastingCost(huge, henge, henge.manaValue, "hand", "a", [huge])).toBe(2);
  });

  it("tapping it adds {G}{G} and gains 2 life", () => {
    const henge = real("The Great Henge", "gh");
    expect(lifeGainForTap(henge)).toBe(2);
    const me = seat("a", [henge], { life: 30 });
    const payment = chooseManaSourcesForCost(me, { ...henge, id: "x", typeLine: "", manaCost: "{G}{G}", oracleText: "" } as VisibleCard, 2);
    expect(payment.ok).toBe(true);
    expect(spendManaSources(me, payment.sourceIds).life).toBe(32);
  });

  it("whenever a nontoken creature you control enters: +1/+1 counter on it AND draw a card", () => {
    const henge = real("The Great Henge", "gh");
    const entering = bear("e1");
    const library = Array.from({ length: 3 }, (_, i) => bear(`lib${i}`, "1", { zone: "library" }));
    const me = seat("a", [henge, entering], { library, zones: { library: 3, hand: 0, battlefield: 2, graveyard: 0, exile: 0, command: 0 } });
    let s = session([me, seat("b", [])]);
    const triggers = findCommonTriggersForPermanentEntered(s, "a", entering);
    expect(triggers.length).toBeGreaterThan(0);
    for (const trigger of triggers) s = resolveTriggerEffect(s, trigger);
    const after = find(s.seats, "e1");
    expect(after.counters?.find((counter) => counter.kind === "+1/+1")?.count).toBe(1);
    expect(mine(s.seats).board.hand.length).toBe(1);
  });
});

describe("A. Dracogenesis (real Oracle text)", () => {
  it("Dragon spells cost nothing; other spells are unchanged", () => {
    const draco = real("Dracogenesis", "dg");
    const me = seat("a", [draco]);
    const dragon = real("Goldspan Dragon", "gd", { zone: "hand" });
    const other = bear("hb", "2", { zone: "hand", manaCost: "{1}{G}", manaValue: 2 });
    expect(adjustedCastingCost(me, dragon, dragon.manaValue, "hand", "a", [me])).toBe(0);
    expect(adjustedCastingCost(me, dragon, dragon.manaValue, "command", "a", [me])).toBe(0);
    expect(adjustedCastingCost(me, other, other.manaValue, "hand", "a", [me])).toBe(2);
    const without = seat("a", []);
    expect(adjustedCastingCost(without, dragon, dragon.manaValue, "hand", "a", [without])).toBe(dragon.manaValue);
  });
});

describe("A. Scion of Draco (real Oracle text)", () => {
  it("costs {2} less for each basic land type among lands you control", () => {
    const scion = real("Scion of Draco", "sd");
    const five = seat("a", [land("i", "Island"), land("m", "Mountain"), land("f", "Forest"), land("s", "Swamp"), land("p", "Plains")]);
    expect(adjustedCastingCost(five, scion, scion.manaValue, "hand", "a", [five])).toBe(2);
    const two = seat("a", [land("i", "Island"), land("i2", "Island"), land("m", "Mountain")]);
    expect(adjustedCastingCost(two, scion, scion.manaValue, "hand", "a", [two])).toBe(8);
    const none = seat("a", []);
    expect(adjustedCastingCost(none, scion, scion.manaValue, "hand", "a", [none])).toBe(12);
  });
  it("Urborg and Yavimaya count as extra land types for domain", () => {
    const scion = real("Scion of Draco", "sd");
    const seats = settle([seat("a", [real("Urborg, Tomb of Yawgmoth", "ur"), land("m", "Mountain")])]);
    expect(adjustedCastingCost(mine(seats), scion, scion.manaValue, "hand", "a", seats)).toBe(8);
  });
});

describe("A. Morophon, the Boundless (real Oracle text)", () => {
  const morophon = () => real("Morophon, the Boundless", "mo", { chosenCreatureType: "Dragon" });
  it("Dragon spells cost {W}{U}{B}{R}{G} less: coloured pips only, never generic", () => {
    const me = seat("a", [morophon()]);
    const tiamat = real("Tiamat", "ti");
    expect(tiamat.manaCost).toBe("{2}{W}{U}{B}{R}{G}");
    expect(adjustedCastingCost(me, tiamat, tiamat.manaValue, "hand", "a", [me])).toBe(2);
    const goldspan = real("Goldspan Dragon", "gd");
    expect(goldspan.manaCost).toBe("{3}{R}{R}");
    expect(adjustedCastingCost(me, goldspan, goldspan.manaValue, "hand", "a", [me])).toBe(4);
    const bearSpell = bear("b", "2", { typeLine: "Creature — Bear", manaCost: "{3}{R}{R}", manaValue: 5 });
    expect(adjustedCastingCost(me, bearSpell, 5, "hand", "a", [me])).toBe(5);
  });
  it("payment demands only the remaining pips: Tiamat is payable with two colourless, Goldspan needs one red", () => {
    const tiamat = real("Tiamat", "ti");
    const me = seat("a", [morophon(), real("Sol Ring", "sr")]);
    expect(chooseManaSourcesForCost(me, tiamat, 2, undefined, [me]).ok).toBe(true);
    const goldspan = real("Goldspan Dragon", "gd");
    const noRed = seat("a", [morophon(), land("i1", "Island"), land("i2", "Island"), land("i3", "Island"), land("i4", "Island")]);
    expect(chooseManaSourcesForCost(noRed, goldspan, 4, undefined, [noRed]).ok).toBe(false);
    const oneRed = seat("a", [morophon(), land("m1", "Mountain"), land("i2", "Island"), land("i3", "Island"), land("i4", "Island")]);
    expect(chooseManaSourcesForCost(oneRed, goldspan, 4, undefined, [oneRed]).ok).toBe(true);
    const pool = { ...emptyManaPool(), R: 1, U: 3 };
    expect(payCostFromPool(pool, goldspan, 4, { seat: oneRed, allSeats: [oneRed] }).ok).toBe(true);
    expect(payCostFromPool(pool, goldspan, 4).ok).toBe(false);
  });
});

describe("A. Phyrexian mana (Birthing Pod, Heliod)", () => {
  const offered = (s: GameSession, id: string) => legalMainPhaseActions(s.seats[0], true, "a", 5, new Set(), s).filter((action) => action.cardId === id);
  it("Birthing Pod: {1}{G/P} is payable with one Swamp plus 2 life (it used to need two lands of any colour)", () => {
    const pod = real("Birthing Pod", "pod");
    const withOne = session([seat("a", [pod, bear("b1"), land("s1", "Swamp")], { kind: "human" }), seat("o", [])]);
    expect(offered(withOne, "pod").length).toBeGreaterThan(0);
    const none = session([seat("a", [pod, bear("b1")], { kind: "human" }), seat("o", [])]);
    expect(offered(none, "pod").length).toBe(0);
  });
  it("pays the colour with mana when it can, otherwise 2 life (the life is charged by spendManaSources)", () => {
    const pod = real("Birthing Pod", "pod");
    const ability = { ...pod, id: "shim", typeLine: "", oracleText: "", manaCost: "{1}{G/P}" } as VisibleCard;
    const withForest = seat("a", [land("f1", "Forest"), land("s1", "Swamp")], { life: 40 });
    const viaMana = chooseManaSourcesForCost(withForest, ability, 2);
    expect(viaMana.ok && "lifeCost" in viaMana).toBe(false);
    expect(spendManaSources(withForest, viaMana.sourceIds).life).toBe(40);
    const swampOnly = seat("a", [land("s1", "Swamp")], { life: 40 });
    const viaLife = chooseManaSourcesForCost(swampOnly, ability, 2);
    expect(viaLife.ok).toBe(true);
    expect(spendManaSources(swampOnly, viaLife.sourceIds).life).toBe(38);
  });
  it("cannot pay life you do not have (rule 119.4): at 1 life a lone Swamp is not enough", () => {
    const pod = real("Birthing Pod", "pod");
    const ability = { ...pod, id: "shim", typeLine: "", oracleText: "", manaCost: "{1}{G/P}" } as VisibleCard;
    expect(chooseManaSourcesForCost(seat("a", [land("s1", "Swamp")], { life: 1 }), ability, 2).ok).toBe(false);
  });
  it("a human pays Birthing Pod's {3}{G/P} from a pool with no green by spending 2 life", () => {
    const pod = real("Birthing Pod", "pod");
    const pool = { ...emptyManaPool(), B: 3 };
    expect(payCostFromPool(pool, pod, 4).ok).toBe(false);
    const paid = payCostFromPool(pool, pod, 4, { life: 40 });
    expect(paid.ok).toBe(true);
    expect("lifeCost" in paid && paid.lifeCost).toBe(2);
  });
  it("Heliod: the {3}{U/P} transform is offered with three Swamps (2 life for the blue)", () => {
    const heliod = real("Heliod, the Radiant Dawn // Heliod, the Warped Eclipse", "h");
    const s = session([seat("a", [heliod, land("s1", "Swamp"), land("s2", "Swamp"), land("s3", "Swamp")], { kind: "human" }), seat("o", [])]);
    expect(offered(s, "h").length).toBeGreaterThan(0);
  });
});

describe("A. Utter Insignificance {C} pip (real Oracle text)", () => {
  const offered = (s: GameSession, id: string) => legalMainPhaseActions(s.seats[0], true, "a", 5, new Set(), s).filter((action) => action.cardId === id);
  it("{2}{C} is not payable with coloured mana alone, but is with Sol Ring + a land", () => {
    const aura = real("Utter Insignificance", "x", { attachedToId: "b1" });
    const colouredOnly = session([seat("a", [aura, bear("b1"), land("p", "Plains"), land("i", "Island"), land("s", "Swamp")], { kind: "human" }), seat("o", [])]);
    expect(offered(colouredOnly, "x").length).toBe(0);
    const withRing = session([seat("a", [aura, bear("b1"), real("Sol Ring", "sr"), land("p", "Plains")], { kind: "human" }), seat("o", [])]);
    expect(offered(withRing, "x").length).toBeGreaterThan(0);
  });
});

describe("B. Urborg, Tomb of Yawgmoth / Yavimaya, Cradle of Growth (real Oracle text)", () => {
  it("every land becomes a Swamp: a Forest taps for B or G, a Mountain for B or R, even an opponent's land", () => {
    const seats = settle([seat("a", [real("Urborg, Tomb of Yawgmoth", "ur"), land("f", "Forest")]), seat("b", [land("m", "Mountain")])]);
    expect(basicLandTypes(find(seats, "f"))).toContain("Swamp");
    expect(manaChoicesForCard(find(seats, "f"), mine(seats), seats).sort()).toEqual(["B", "G"]);
    expect(manaChoicesForCard(find(seats, "m"), seats[1], seats).sort()).toEqual(["B", "R"]);
    expect(manaChoicesForCard(find(seats, "ur"), mine(seats), seats)).toEqual(["B"]);
  });
  it("a nonbasic land keeps its own mana and also taps for B", () => {
    const seats = settle([seat("a", [real("Urborg, Tomb of Yawgmoth", "ur"), real("Command Tower", "ct")], { deck: { colors: ["G", "U"] } } as never)]);
    expect(manaChoicesForCard(find(seats, "ct"), mine(seats), seats).sort()).toEqual(["B", "G", "U"]);
  });
  it("Yavimaya makes every land a Forest, so a lone Island pays for green", () => {
    const seats = settle([seat("a", [real("Yavimaya, Cradle of Growth", "yv"), land("i", "Island")])]);
    expect(manaChoicesForCard(find(seats, "i"), mine(seats), seats).sort()).toEqual(["G", "U"]);
    const pay = chooseManaSourcesForCost(mine(seats), { ...real("Llanowar Elves", "e"), manaCost: "{G}{G}" }, 2, undefined, seats);
    expect(pay.ok).toBe(true);
  });
  it("the grant ends when Urborg leaves, phases out, or loses its abilities (recomputed every pass)", () => {
    const urborg = real("Urborg, Tomb of Yawgmoth", "ur");
    const field = [urborg, land("f", "Forest")];
    expect(find(settle([seat("a", field)]), "f").grantedTypes).toContain("Swamp");
    expect(find(settle([seat("a", [{ ...urborg, phasedOut: true }, land("f", "Forest")])]), "f").grantedTypes).toBeUndefined();
    expect(find(settle([seat("a", [{ ...urborg, abilitiesStripped: true }, land("f", "Forest")])]), "f").grantedTypes).toBeUndefined();
    const withGrant = settle([seat("a", field)]);
    const gone = runStateBasedActionsPass({ ...session(withGrant), seats: withGrant.map((item) => ({ ...item, board: { ...item.board, battlefield: item.board.battlefield.filter((card) => card.id !== "ur") } })) }).session.seats;
    expect(find(gone, "f").grantedTypes).toBeUndefined();
    expect(manaChoicesForCard(find(gone, "f"), mine(gone), gone)).toEqual(["G"]);
  });
  it("is not a nonland grant: creatures and non-lands never gain a land type", () => {
    const seats = settle([seat("a", [real("Urborg, Tomb of Yawgmoth", "ur"), bear("c1")])]);
    expect(find(seats, "c1").grantedTypes).toBeUndefined();
  });
  it("a land that is not available (tapped) is not offered", () => {
    const seats = settle([seat("a", [real("Urborg, Tomb of Yawgmoth", "ur", { tapped: true })])]);
    expect(isAvailableManaSource(find(seats, "ur"), mine(seats), seats)).toBe(false);
  });
});

describe("D. mana that only exists inside a trigger is not a free mana source (real Oracle text)", () => {
  const me = (...cards: VisibleCard[]) => seat("a", cards);
  for (const name of ["Savage Ventmaw", "Klauth, Unrivaled Ancient", "Forsaken Monument"]) {
    it(`${name} is never offered as a mana source, and auto-payment does not tap it`, () => {
      const card = real(name, "x");
      const owner = me(card);
      expect(manaChoicesForCard(card, owner, [owner])).toEqual([]);
      expect(isAvailableManaSource(card, owner, [owner])).toBe(false);
      expect(chooseManaSourcesForCost(owner, { ...card, id: "spell", typeLine: "", manaCost: "{1}", oracleText: "" } as VisibleCard, 1).ok).toBe(false);
    });
  }
  it("Forsaken Monument still adds its extra {C} to a colourless tap (Sol Ring = 3)", () => {
    const owner = me(real("Forsaken Monument", "fm"), real("Sol Ring", "sr"));
    const pay = chooseManaSourcesForCost(owner, { ...real("Sol Ring", "q"), id: "spell", typeLine: "", manaCost: "{3}", oracleText: "" } as VisibleCard, 3);
    expect(pay.ok).toBe(true);
    expect(pay.sourceIds).toEqual(["sr"]);
  });
  it("genuine tap abilities of other cards are untouched", () => {
    const owner = me(real("Sol Ring", "sr"), land("f", "Forest"));
    expect(isAvailableManaSource(owner.board.battlefield[0], owner, [owner])).toBe(true);
    expect(manaChoicesForCard(owner.board.battlefield[1], owner, [owner])).toEqual(["G"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// C. The token creation pipeline (src/engine/tokens.ts: applyTokenCreationReplacements / createTokenBatch)
// ---------------------------------------------------------------------------------------------------------------------------------------------
import { createCopyTokenForSeat, createCopyTokensForSeat, createTokensForSeat, parseCreateTokenSpecs, predefinedTokenSpec } from "@/engine/tokens";
import { applySpellExtraEffect } from "@/engine/effects";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
import { etbEffectText } from "@/lib/oracleClauses";

const names = (cards: VisibleCard[]) => cards.map((card) => card.name).sort();
const tokensOf = (seats: PlayerSeat[], id = "a") => seats.find((item) => item.id === id)!.board.battlefield.filter((card) => card.token);
const countNamed = (cards: VisibleCard[], name: string) => cards.filter((card) => card.name === name).length;

describe("C. Chatterfang, Squirrel General (real Oracle text)", () => {
  it("every token creation adds that many 1/1 Squirrels: a Treasure becomes Treasure + Squirrel", () => {
    const s = session([seat("a", [real("Chatterfang, Squirrel General", "cf")]), seat("b", [])]);
    const { session: next, createdTokens } = createTokensForSeat(s, "a", "src", [predefinedTokenSpec("Treasure")]);
    const tokens = tokensOf(next.seats);
    expect(names(tokens)).toEqual(["Squirrel Token", "Treasure"]);
    expect(createdTokens.length).toBe(2);
    expect(tokens.find((card) => card.name === "Squirrel Token")).toMatchObject({ power: "1", toughness: "1", colors: ["G"] });
  });
  it("counts the whole event: three Zombies make three Squirrels; nothing happens for another player's tokens", () => {
    const s = session([seat("a", [real("Chatterfang, Squirrel General", "cf")]), seat("b", [])]);
    const zombies = parseCreateTokenSpecs("Create three 2/2 black Zombie creature tokens.");
    expect(tokensOf(createTokensForSeat(s, "a", "src", zombies).session.seats).length).toBe(6);
    expect(tokensOf(createTokensForSeat(s, "b", "src", zombies).session.seats, "b").length).toBe(3);
  });
  it("a token that is a copy is also a created token: copy + Squirrel", () => {
    const s = session([seat("a", [real("Chatterfang, Squirrel General", "cf"), bear("c1")]), seat("b", [])]);
    const { session: next, token } = createCopyTokenForSeat(s, "a", bear("c1"));
    expect(token.name).toBe("Bear c1");
    expect(names(tokensOf(next.seats))).toEqual(["Bear c1", "Squirrel Token"]);
  });
  it("does not replace anything when its abilities are gone or it is phased out", () => {
    for (const patch of [{ abilitiesStripped: true }, { phasedOut: true }]) {
      const s = session([seat("a", [real("Chatterfang, Squirrel General", "cf", patch)]), seat("b", [])]);
      expect(tokensOf(createTokensForSeat(s, "a", "src", [predefinedTokenSpec("Food")]).session.seats).length).toBe(1);
    }
  });
});

describe("C. Academy Manufactor (real Oracle text)", () => {
  it("a Food becomes a Clue, a Food and a Treasure", () => {
    const s = session([seat("a", [real("Academy Manufactor", "am")]), seat("b", [])]);
    const next = createTokensForSeat(s, "a", "src", [predefinedTokenSpec("Food")]).session;
    expect(names(tokensOf(next.seats))).toEqual(["Clue", "Food", "Treasure"]);
  });
  it("two Treasures become two of each; a Zombie is untouched", () => {
    const s = session([seat("a", [real("Academy Manufactor", "am")]), seat("b", [])]);
    const next = createTokensForSeat(s, "a", "src", [{ ...predefinedTokenSpec("Treasure"), count: 2 }, ...parseCreateTokenSpecs("Create a 2/2 black Zombie creature token.")]).session;
    const tokens = tokensOf(next.seats);
    expect(countNamed(tokens, "Treasure")).toBe(2);
    expect(countNamed(tokens, "Clue")).toBe(2);
    expect(countNamed(tokens, "Food")).toBe(2);
    expect(countNamed(tokens, "Zombie Token")).toBe(1);
  });
  it("with Chatterfang as well: Manufactor first, then a Squirrel for each of the three tokens", () => {
    const s = session([seat("a", [real("Academy Manufactor", "am"), real("Chatterfang, Squirrel General", "cf")]), seat("b", [])]);
    const next = createTokensForSeat(s, "a", "src", [predefinedTokenSpec("Clue")]).session;
    const tokens = tokensOf(next.seats);
    expect(countNamed(tokens, "Squirrel Token")).toBe(3);
    expect(tokens.length).toBe(6);
  });
});

describe("C. Chittering Witch (real Oracle text)", () => {
  it("creates one Rat per opponent still in the game, and Chatterfang adds Squirrels", () => {
    const witch = real("Chittering Witch", "cw");
    const opponents = [seat("b", []), seat("c", []), seat("d", [], { hasLost: true })];
    const s = session([seat("a", [witch]), ...opponents]);
    let next = s;
    for (const trigger of findCommonTriggersForPermanentEntered(s, "a", witch)) next = resolveTriggerEffect(next, trigger);
    expect(countNamed(tokensOf(next.seats), "Rat Token")).toBe(2);
    const withFang = session([seat("a", [witch, real("Chatterfang, Squirrel General", "cf")]), ...opponents]);
    let fanged = withFang;
    for (const trigger of findCommonTriggersForPermanentEntered(withFang, "a", witch)) fanged = resolveTriggerEffect(fanged, trigger);
    expect(countNamed(tokensOf(fanged.seats), "Rat Token")).toBe(2);
    expect(countNamed(tokensOf(fanged.seats), "Squirrel Token")).toBe(2);
  });
  it("with no opponents it makes none", () => {
    const witch = real("Chittering Witch", "cw");
    const s = session([seat("a", [witch])]);
    let next = s;
    for (const trigger of findCommonTriggersForPermanentEntered(s, "a", witch)) next = resolveTriggerEffect(next, trigger);
    expect(tokensOf(next.seats).length).toBe(0);
  });
});

describe("C. Second Harvest (real Oracle text)", () => {
  const harvest = () => real("Second Harvest", "sh", { zone: "stack" as never });
  it("copies every token you control (other players' and nontokens untouched)", () => {
    const squirrels = createTokensForSeat(session([seat("a", [])]), "a", "x", parseCreateTokenSpecs("Create two 1/1 green Squirrel creature tokens.")).createdTokens;
    const s = session([seat("a", [...squirrels, real("Sol Ring", "sr")]), seat("b", [])]);
    const effect = parseSpellExtraEffects(etbEffectText(harvest().oracleText)).find((item) => item.kind === "copy_each_token_you_control")!;
    expect(effect).toBeDefined();
    const next = applySpellExtraEffect(s, "a", harvest(), effect);
    expect(countNamed(tokensOf(next.seats), "Squirrel Token")).toBe(4);
    expect(next.seats[0].board.battlefield.length).toBe(5);
  });
  it("is one creation event: with Chatterfang, 3 tokens -> 3 copies + exactly 3 Squirrels", () => {
    const fang = real("Chatterfang, Squirrel General", "cf");
    const base = createTokensForSeat(session([seat("a", [])]), "a", "x", parseCreateTokenSpecs("Create three 2/2 black Zombie creature tokens.")).createdTokens;
    const s = session([seat("a", [fang, ...base]), seat("b", [])]);
    const effect = parseSpellExtraEffects(etbEffectText(harvest().oracleText)).find((item) => item.kind === "copy_each_token_you_control")!;
    const next = applySpellExtraEffect(s, "a", harvest(), effect);
    const tokens = tokensOf(next.seats);
    expect(countNamed(tokens, "Zombie Token")).toBe(6);
    expect(countNamed(tokens, "Squirrel Token")).toBe(3);
  });
  it("createCopyTokensForSeat does nothing for an empty list", () => {
    const s = session([seat("a", [])]);
    expect(createCopyTokensForSeat(s, "a", []).tokens).toEqual([]);
  });
});

describe("C. Swarmyard Massacre (real Oracle text)", () => {
  it("makes two Squirrels, then every other creature gets -1/-1 per Insect/Rat/Spider/Squirrel you control", () => {
    const massacre = real("Swarmyard Massacre", "sm", { zone: "stack" as never });
    const victim = bear("v1", "2", { toughness: "1" });
    const sturdy = bear("v2", "2", { toughness: "5" });
    const ownBear = bear("mine", "3", { toughness: "3" });
    let s = session([seat("a", [ownBear]), seat("b", [victim, sturdy])]);
    s = createTokensForSeat(s, "a", massacre.id, parseCreateTokenSpecs(etbEffectText(massacre.oracleText))).session;
    for (const effect of parseSpellExtraEffects(etbEffectText(massacre.oracleText))) s = applySpellExtraEffect(s, "a", massacre, effect);
    const after = runStateBasedActionsPass(s).session.seats;
    expect(after[1].board.battlefield.map((card) => card.id)).toEqual(["v2"]);
    expect(after[1].board.battlefield[0].temporaryToughnessBonus).toBe(-2);
    // The Squirrels themselves are not shrunk; the caster's own non-listed creature is (3/3 -> 1/1).
    expect(countNamed(after[0].board.battlefield, "Squirrel Token")).toBe(2);
    expect(after[0].board.battlefield.find((card) => card.id === "mine")!.temporaryToughnessBonus).toBe(-2);
  });
});

import { applyRemovalEffect } from "@/engine/effects";
import { parseRemovalEffect } from "@/lib/removalSpells";

describe("C. Saw in Half and Decree of Pain (real Oracle text)", () => {
  const cast = (name: string, s: GameSession, targetId?: string) => {
    const card = real(name, "spell", { zone: "stack" as never });
    const effect = parseRemovalEffect(etbEffectText(card.oracleText))!;
    expect(effect).toBeDefined();
    return applyRemovalEffect(s, "a", card.name, card, effect, undefined, targetId ? { kind: "card", seatId: "b", cardId: targetId } : undefined);
  };
  it("Saw in Half: the destroyed creature's controller gets two half-size copies (round up)", () => {
    const big = bear("big", "5", { toughness: "3", name: "Grizzly Elder" });
    const after = cast("Saw in Half", session([seat("a", []), seat("b", [big])]), "big");
    const tokens = tokensOf(after.seats, "b");
    expect(tokens.map((token) => [token.name, token.power, token.toughness])).toEqual([["Grizzly Elder", "3", "2"], ["Grizzly Elder", "3", "2"]]);
    expect(after.seats[1].board.graveyard?.some((card) => card.id === "big")).toBe(true);
  });
  it("Saw in Half: no copies if the creature does not die (indestructible)", () => {
    const tough = bear("tough", "4", { toughness: "4", oracleText: "Indestructible" });
    const after = cast("Saw in Half", session([seat("a", []), seat("b", [tough])]), "tough");
    expect(tokensOf(after.seats, "b").length).toBe(0);
  });
  it("Saw in Half under Chatterfang: its controller's two copies are one event, so two Squirrels too", () => {
    const big = bear("big", "2", { toughness: "2" });
    const after = cast("Saw in Half", session([seat("a", []), seat("b", [big, real("Chatterfang, Squirrel General", "cf")])]), "big");
    expect(countNamed(tokensOf(after.seats, "b"), "Squirrel Token")).toBe(2);
    expect(countNamed(tokensOf(after.seats, "b"), "Bear big")).toBe(2);
  });
  it("Decree of Pain: destroys every creature and draws one card per creature destroyed", () => {
    const library = Array.from({ length: 6 }, (_, i) => bear(`lib${i}`, "1", { zone: "library" }));
    const a = seat("a", [bear("m1")], { library, zones: { library: 6, hand: 0, battlefield: 1, graveyard: 0, exile: 0, command: 0 } });
    const after = cast("Decree of Pain", session([a, seat("b", [bear("o1"), bear("o2")])]));
    expect(after.seats.flatMap((item) => item.board.battlefield.filter((card) => card.typeLine.includes("Creature"))).length).toBe(0);
    expect(after.seats[0].board.hand.length).toBe(3);
  });
});

import { applyDeterministicPhaseTrigger, commonTriggerEffect, phaseEffectText } from "@/engine/triggers";
import { targetedEffectSpec } from "@/lib/targetedEffects";
import { legalTargets } from "@/lib/targeting";

describe("C. Hazel of the Rootbloom end-step copy (real Oracle text)", () => {
  const hazel = () => real("Hazel of the Rootbloom", "hz");
  const squirrel = () => createTokensForSeat(session([seat("a", [])]), "a", "x", parseCreateTokenSpecs("Create a 1/1 green Squirrel creature token.")).createdTokens[0];
  const zombie = () => createTokensForSeat(session([seat("a", [])]), "a", "x", parseCreateTokenSpecs("Create a 2/2 black Zombie creature token.")).createdTokens[0];

  it("the clause parses as a copy-token effect aimed only at a TOKEN you control, doubled for a Squirrel", () => {
    const clause = phaseEffectText(hazel().oracleText, "end step");
    const parsed = commonTriggerEffect(clause, "clause");
    expect(parsed).toMatchObject({ kind: "targeted_effect", effect: { verb: { kind: "copy_token", doubleIfSubtype: "squirrel" }, who: { kind: "permanent", controller: "you", tokenOnly: true } } });
    const spec = targetedEffectSpec((parsed as Extract<typeof parsed, { kind: "targeted_effect" }>).effect, "hz", "Hazel");
    const s = session([seat("a", [hazel(), squirrel(), bear("nontoken")]), seat("b", [{ ...squirrel(), id: "theirs" }])]);
    const legal = legalTargets(s, "a", spec, hazel()).map((target) => (target.kind === "card" ? target.card.name : "player"));
    expect(legal).toEqual(["Squirrel Token"]);
  });

  it("an agent copies a Squirrel token twice at its end step", () => {
    const s = session([seat("a", [hazel(), squirrel()]), seat("b", [])]);
    const next = applyDeterministicPhaseTrigger(s, "a", hazel(), "end step")!;
    expect(next).toBeDefined();
    expect(countNamed(tokensOf(next.seats), "Squirrel Token")).toBe(3);
  });

  it("any other token is copied once; with no token it does nothing", () => {
    const s = session([seat("a", [hazel(), zombie()]), seat("b", [])]);
    expect(countNamed(tokensOf(applyDeterministicPhaseTrigger(s, "a", hazel(), "end step")!.seats), "Zombie Token")).toBe(2);
    const none = session([seat("a", [hazel()]), seat("b", [])]);
    expect(tokensOf(applyDeterministicPhaseTrigger(none, "a", hazel(), "end step")!.seats).length).toBe(0);
  });

  it("with Chatterfang the two Squirrel copies are one event: two more Squirrels", () => {
    const s = session([seat("a", [hazel(), squirrel(), real("Chatterfang, Squirrel General", "cf")]), seat("b", [])]);
    const next = applyDeterministicPhaseTrigger(s, "a", hazel(), "end step")!;
    expect(countNamed(tokensOf(next.seats), "Squirrel Token")).toBe(5);
  });
});

describe("C. Hazel of the Rootbloom mana ability (real Oracle text)", () => {
  const hazel = (extra: Partial<VisibleCard> = {}) => real("Hazel of the Rootbloom", "hz", extra);
  const tokens = (n: number) => createTokensForSeat(session([seat("a", [])]), "a", "x", [{ ...parseCreateTokenSpecs("Create a 1/1 green Squirrel creature token.")[0], count: n }]).createdTokens.map((token, i) => ({ ...token, id: `t${i}`, summoningSick: true }));
  const spell = (cost: string) => ({ id: "spell", name: "Spell", typeLine: "Sorcery", oracleText: "", manaCost: cost, manaValue: 0, colors: [], role: "spell", zone: "hand" }) as VisibleCard;

  it("taps for as many mana as untapped tokens, in any colour (summoning-sick tokens count: tapping them is a cost, not a {T} ability)", () => {
    const me = seat("a", [hazel(), ...tokens(3)]);
    expect(manaChoicesForCard(me.board.battlefield[0], me, [me]).sort()).toEqual(["B", "G", "R", "U", "W"]);
    expect(manaProducedBy(me.board.battlefield[0], me)).toBe(3);
  });
  it("pays {B}{U}{1} (colours from Hazel's any-colour choice) by tapping 3 tokens and paying 2 life; the tokens end up tapped", () => {
    const me = seat("a", [hazel(), ...tokens(3)], { life: 40 });
    const payment = chooseManaSourcesForCost(me, spell("{2}{R}"), 3, undefined, [me]);
    expect(payment.ok).toBe(true);
    const after = spendManaSources(me, payment.sourceIds);
    expect(after.life).toBe(38);
    expect(after.board.battlefield.filter((card) => card.token && card.tapped).length).toBe(3);
    expect(after.board.battlefield.find((card) => card.id === "hz")!.tapped).toBe(true);
  });
  it("is not a source with no untapped tokens, while summoning sick, tapped, or at 2 life or less", () => {
    const check = (me: PlayerSeat) => isAvailableManaSource(me.board.battlefield[0], me, [me]);
    expect(check(seat("a", [hazel()]))).toBe(false);
    expect(check(seat("a", [hazel({ summoningSick: true }), ...tokens(2)]))).toBe(false);
    expect(check(seat("a", [hazel({ tapped: true }), ...tokens(2)]))).toBe(false);
    expect(check(seat("a", [hazel(), ...tokens(2)], { life: 2 }))).toBe(false);
    expect(check(seat("a", [hazel(), ...tokens(2)], { life: 3 }))).toBe(true);
    expect(check(seat("a", [hazel(), ...tokens(2).map((token) => ({ ...token, tapped: true }))]))).toBe(false);
  });
  it("does not double-count a Treasure (a token that is its own mana source)", () => {
    const treasure = createTokensForSeat(session([seat("a", [])]), "a", "x", [predefinedTokenSpec("Treasure")]).createdTokens[0];
    const me = seat("a", [hazel(), treasure, ...tokens(1)]);
    expect(manaProducedBy(me.board.battlefield[0], me)).toBe(1);
  });
});

import { resolveDeferredChoice } from "@/engine/effects";

describe("C. Chitterspitter acorn counters (real Oracle text)", () => {
  const spitter = (extra: Partial<VisibleCard> = {}) => real("Chitterspitter", "cs", extra);
  const squirrels = (n: number) => createTokensForSeat(session([seat("a", [])]), "a", "x", [{ ...parseCreateTokenSpecs("Create a 1/1 green Squirrel creature token.")[0], count: n }]).createdTokens;
  const acorns = (s: PlayerSeat[]) => find(s, "cs").counters?.find((counter) => counter.kind === "acorn")?.count ?? 0;

  it("an agent sacrifices a Squirrel at upkeep while it controls three or more, and the counter lands on Chitterspitter", () => {
    const s = session([seat("a", [spitter(), ...squirrels(3)]), seat("b", [])]);
    const next = applyDeterministicPhaseTrigger(s, "a", spitter(), "upkeep step")!;
    expect(next).toBeDefined();
    expect(acorns(next.seats)).toBe(1);
    expect(countNamed(tokensOf(next.seats), "Squirrel Token")).toBe(2);
  });
  it("an agent with fewer than three Squirrels keeps them", () => {
    const s = session([seat("a", [spitter(), ...squirrels(2)]), seat("b", [])]);
    const next = applyDeterministicPhaseTrigger(s, "a", spitter(), "upkeep step")!;
    expect(acorns(next.seats)).toBe(0);
    expect(countNamed(tokensOf(next.seats), "Squirrel Token")).toBe(2);
  });
  it("a human is asked which token to sacrifice (de-duplicated), and 'none' sacrifices nothing", () => {
    const s = session([seat("a", [spitter(), ...squirrels(3), real("Sol Ring", "sr")], { kind: "human" }), seat("b", [])]);
    const asked = applyDeterministicPhaseTrigger(s, "a", spitter(), "upkeep step")!;
    const prompt = asked.pendingPlayerChoices![0];
    expect(prompt.resolver).toBe("sacrifice_token_for_counter");
    expect(prompt.options.map((option) => option.label)).toEqual(["Squirrel Token (1/1)", "Don't sacrifice"]);
    const done = resolveDeferredChoice(asked, "a", "cs", "Chitterspitter", prompt.resolver, prompt.data, prompt.options[0].value);
    expect(acorns(done.seats)).toBe(1);
    expect(countNamed(tokensOf(done.seats), "Squirrel Token")).toBe(2);
    const declined = resolveDeferredChoice(asked, "a", "cs", "Chitterspitter", prompt.resolver, prompt.data, "none");
    expect(acorns(declined.seats)).toBe(0);
  });
  it("Squirrels you control get +1/+1 for each acorn counter (and only Squirrels)", () => {
    const withCounters = spitter({ counters: [{ kind: "acorn", count: 2 }] });
    const seats = settle([seat("a", [withCounters, ...squirrels(1), bear("other")])]);
    const token = seats[0].board.battlefield.find((card) => card.token)!;
    expect(token.attachmentPowerBonus).toBe(2);
    expect(token.attachmentToughnessBonus).toBe(2);
    expect(find(seats, "other").attachmentPowerBonus).toBeUndefined();
  });
});
