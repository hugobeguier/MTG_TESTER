// Second batch of B/G sacrifice-deck checks (real Oracle text): Craterhoof, Heroic Intervention, Guardian Project,
// Chupacabra's opponent-only target, Champion of Lambholt's block restriction, and the deck's mana lands.
import { describe, expect, it } from "vitest";
import {
  applySpellExtraEffect,
  assignBlockers,
  findCommonTriggersForPermanentEntered,
  manaChoicesForCard,
  resolveTriggerEffect,
  runStateBasedActionsPass
} from "./AppFlow";
import { parseRemovalEffect } from "@/lib/removalSpells";
import { removalEffectTargetSpec } from "@/lib/targetSpecs";
import { legalTargets } from "@/lib/targeting";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
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
    board: { hand: [], battlefield, graveyard: [] }, library: [], ...extra
  };
}

function session(seats: PlayerSeat[]): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] };
}

const bear = (id: string, extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;

describe("Craterhoof Behemoth (real Oracle text)", () => {
  it("gives every creature you control trample and +X/+X, X = the number of creatures you control", () => {
    const hoof = real("Craterhoof Behemoth", "hf", { power: "5", toughness: "5" });
    const s = session([seat("a", [hoof, bear("x"), bear("y")]), seat("b", [bear("o")])]);
    const trigger = findCommonTriggersForPermanentEntered(s, "a", hoof)[0];
    expect(trigger?.effect).toMatchObject({ kind: "mass_pump", scope: "controlled", grantsKeyword: "trample", xFromCreatureCount: true });
    const after = resolveTriggerEffect(s, trigger);
    const mine = after.seats[0].board.battlefield;
    for (const card of mine) {
      expect(card.temporaryPowerBonus).toBe(3);
      expect(card.temporaryToughnessBonus).toBe(3);
      expect(card.temporaryGrantedKeywords).toContain("trample");
    }
    expect(after.seats[1].board.battlefield[0].temporaryPowerBonus).toBeUndefined();
  });
});

describe("Heroic Intervention (real Oracle text)", () => {
  it("is parsed as a spell extra, and gives ALL your permanents hexproof and indestructible until end of turn", () => {
    const card = real("Heroic Intervention", "hi");
    const extras = parseSpellExtraEffects(etbEffectText(card.oracleText));
    expect(extras).toEqual([{ kind: "grant_keywords_all_permanents", keywords: ["hexproof", "indestructible"] }]);
    const land = real("Forest", "f1");
    const s = session([seat("a", [bear("x"), land]), seat("b", [bear("o")])]);
    const after = applySpellExtraEffect(s, "a", card, extras[0]);
    for (const permanent of after.seats[0].board.battlefield) expect(permanent.temporaryGrantedKeywords).toEqual(["hexproof", "indestructible"]);
    expect(after.seats[1].board.battlefield[0].temporaryGrantedKeywords).toBeUndefined();
  });
});

describe("Guardian Project (real Oracle text)", () => {
  const draws = (s: GameSession, entering: VisibleCard) => findCommonTriggersForPermanentEntered(s, "a", entering).filter((t) => t.sourceCardName === "Guardian Project").length;

  it("draws for a nontoken creature with a new name", () => {
    const project = real("Guardian Project", "gp");
    const newcomer = bear("n");
    expect(draws(session([seat("a", [project, newcomer]), seat("b", [])]), newcomer)).toBe(1);
  });

  it("does not draw when you already control a creature with the same name", () => {
    const project = real("Guardian Project", "gp");
    const first = bear("first", { name: "Grizzly Bears" });
    const second = bear("second", { name: "Grizzly Bears" });
    expect(draws(session([seat("a", [project, first, second]), seat("b", [])]), second)).toBe(0);
  });

  it("does not draw when a creature card with the same name is in your graveyard", () => {
    const project = real("Guardian Project", "gp");
    const incoming = bear("incoming", { name: "Grizzly Bears" });
    const s = session([seat("a", [project, incoming], { board: { hand: [], battlefield: [project, incoming], graveyard: [bear("old", { name: "Grizzly Bears", zone: "graveyard" })] } }), seat("b", [])]);
    expect(draws(s, incoming)).toBe(0);
  });

  it("does not draw for a token", () => {
    const project = real("Guardian Project", "gp");
    const token = bear("tok", { token: true });
    expect(draws(session([seat("a", [project, token]), seat("b", [])]), token)).toBe(0);
  });
});

describe("Ravenous Chupacabra (real Oracle text)", () => {
  it("can only target a creature an OPPONENT controls", () => {
    const chupa = real("Ravenous Chupacabra", "rc");
    const effect = parseRemovalEffect(etbEffectText(chupa.oracleText));
    expect(effect).toMatchObject({ kind: "destroy", targetType: "creature", opponentOnly: true });
    const spec = removalEffectTargetSpec(effect!, chupa.id)!;
    const s = session([seat("a", [chupa, bear("mine")]), seat("b", [bear("theirs")])]);
    const pool = legalTargets(s, "a", spec, chupa);
    expect(pool.map((target) => (target.kind === "card" ? target.card.id : ""))).toEqual(["theirs"]);
  });
});

describe("Champion of Lambholt (real Oracle text)", () => {
  it("creatures with less power than the Champion can't block your creatures; equal or greater power can", () => {
    const champion = real("Champion of Lambholt", "ch", { power: "3", toughness: "3" });
    const attacker = bear("att", { attacking: true, attackTargetId: "b", power: "2", toughness: "2" });
    const s0 = session([seat("a", [champion, attacker]), seat("b", [bear("small", { power: "2", toughness: "2" }), bear("big", { power: "3", toughness: "3" })])]);
    const s = runStateBasedActionsPass(s0).session;
    const choice = { attackerSeatId: "a", defenderSeatId: "b", attackerCardId: "att", targetId: "b" };
    const blocking = (ids: string[]) => assignBlockers(s, choice, ids).seats[1].board.battlefield.filter((c) => c.blocking).map((c) => c.id);
    expect(blocking(["small"])).toEqual([]);
    expect(blocking(["big"])).toEqual(["big"]);
  });
});

describe("mana lands (real Oracle text)", () => {
  it("Reflecting Pool taps for the colors your other lands can make, and not for ones they can't", () => {
    const pool = real("Reflecting Pool", "rp");
    const s = seat("a", [pool, real("Forest", "f"), real("Swamp", "sw")]);
    const colors = manaChoicesForCard(pool, s, [s]);
    expect(colors.sort()).toEqual(["B", "G"]);
  });

  it("Exotic Orchard taps for colors an opponent's land could make", () => {
    const orchard = real("Exotic Orchard", "eo");
    const mine = seat("a", [orchard, real("Forest", "f")]);
    const theirs = seat("b", [real("Island", "i")]);
    expect(manaChoicesForCard(orchard, mine, [mine, theirs])).toEqual(["U"]);
  });

  it("Temple of the False God makes no mana with fewer than five lands", () => {
    const temple = real("Temple of the False God", "tf");
    const four = seat("a", [temple, real("Forest", "f1"), real("Forest", "f2"), real("Forest", "f3")]);
    expect(manaChoicesForCard(temple, four, [four])).toEqual([]);
    const five = seat("a", [temple, real("Forest", "f1"), real("Forest", "f2"), real("Forest", "f3"), real("Forest", "f4")]);
    expect(manaChoicesForCard(temple, five, [five]).length).toBeGreaterThan(0);
  });
});

import { applyZoneEffect, nextCastPrompt, type CastChoices } from "./AppFlow";
import { parseZoneEffect } from "@/lib/zoneEffects";
import type { ChosenTarget } from "@/lib/targeting";

describe("Victimize (real Oracle text)", () => {
  const setup = () => {
    const victimize = real("Victimize", "vic", { zone: "hand" });
    const g1 = bear("g1", { zone: "graveyard", manaValue: 3 });
    const g2 = bear("g2", { zone: "graveyard", manaValue: 5 });
    const g3 = bear("g3", { zone: "graveyard", manaValue: 1 });
    const s = session([
      seat("a", [bear("fodder"), bear("keeper")], { board: { hand: [victimize], battlefield: [bear("fodder"), bear("keeper")], graveyard: [g1, g2, g3] } }),
      seat("b", [])
    ]);
    return { victimize, s };
  };

  it("asks for the two graveyard creatures and then the creature to sacrifice, never offering a pick twice", () => {
    const { victimize, s } = setup();
    const answers: CastChoices = { targets: [] };
    const first = nextCastPrompt(s, "a", victimize, undefined, answers);
    expect(first?.kind).toBe("target");
    expect(first && first.kind === "target" ? first.options.length : 0).toBe(3);
    answers.targets.push({ kind: "card", seatId: "a", cardId: "g2" });
    const second = nextCastPrompt(s, "a", victimize, undefined, answers);
    expect(second && second.kind === "target" ? second.options.map((o) => (o.target.kind === "card" ? o.target.cardId : "")) : []).toEqual(["g1", "g3"]);
    answers.targets.push({ kind: "card", seatId: "a", cardId: "g3" });
    const third = nextCastPrompt(s, "a", victimize, undefined, answers);
    expect(third && third.kind === "target" ? third.options.map((o) => (o.target.kind === "card" ? o.target.cardId : "")).sort() : []).toEqual(["fodder", "keeper"]);
  });

  it("returns the player's chosen cards tapped, sacrifices the chosen creature, and fires sacrifice/death hooks", () => {
    const { victimize, s } = setup();
    const effect = parseZoneEffect(etbEffectText(victimize.oracleText))!;
    const targets: ChosenTarget[] = [
      { kind: "card", seatId: "a", cardId: "g2" },
      { kind: "card", seatId: "a", cardId: "g3" },
      { kind: "card", seatId: "a", cardId: "keeper" }
    ];
    const after = applyZoneEffect(s, "a", "Victimize", effect, undefined, targets[0], targets);
    const mine = after.seats[0];
    expect(mine.board.battlefield.map((c) => c.id).sort()).toEqual(["fodder", "g2", "g3"]);
    expect(mine.board.battlefield.filter((c) => c.id === "g2" || c.id === "g3").every((c) => c.tapped)).toBe(true);
    expect(mine.board.graveyard?.map((c) => c.id).sort()).toEqual(["g1", "keeper"]);
    expect(after.pendingDeaths?.some((death) => death.card.id === "keeper" && death.sacrificed)).toBe(true);
  });
});

import { parseSimpleDrawEffect, createTokensForSeat, clearTemporaryBuffs, legalPriorityActions } from "./AppFlow";
import { deterministicRuleWorkflow } from "@/lib/rulesAdvisor";
import { parseGenericTapAbilities } from "@/lib/activatedAbilities";

describe("Read the Bones (real Oracle text)", () => {
  it("scries 2 and THEN draws 2 (the draw is part of the scry workflow, not an immediate draw)", () => {
    const card = real("Read the Bones", "rb", { zone: "hand" });
    expect(parseSimpleDrawEffect(etbEffectText(card.oracleText))).toBeUndefined();
    const workflow = deterministicRuleWorkflow({ event: "spell_resolved_to_graveyard", actorName: "a", sourceCard: card, battlefield: [], hand: [], graveyard: [], exile: [], libraryPreview: [] });
    expect(workflow).toMatchObject({ workflow: "scry_cards", maxChoices: 2, drawCountAfter: 2 });
  });
});

describe("Reanimate (real Oracle text)", () => {
  it("returns the creature and the caster loses life equal to its mana value", () => {
    const reanimate = real("Reanimate", "re", { zone: "hand" });
    const effect = parseZoneEffect(etbEffectText(reanimate.oracleText))!;
    const dead = bear("dead", { zone: "graveyard", manaValue: 6 });
    const s = session([seat("a", [], { board: { hand: [], battlefield: [], graveyard: [dead] } }), seat("b", [])]);
    const after = applyZoneEffect(s, "a", "Reanimate", effect);
    expect(after.seats[0].board.battlefield.map((c) => c.id)).toEqual(["dead"]);
    expect(after.seats[0].life).toBe(34);
  });
});

describe("Idol of Oblivion (real Oracle text)", () => {
  it("its draw ability is restricted to turns you created a token, and the flag resets with the turn", () => {
    const idol = real("Idol of Oblivion", "io");
    const clause = parseGenericTapAbilities(idol.oracleText).find((ability) => /draw a card/i.test(ability.clause))!.clause;
    expect(clause).toMatch(/activate only if you created a token this turn/i);
    const s = session([seat("a", [idol]), seat("b", [])]);
    const afterToken = createTokensForSeat(s, "a", "x", [{ count: 1, name: "Treasure", colors: [], typeLine: "Token Artifact - Treasure", power: undefined, toughness: undefined, oracleText: "", role: "permanent" } as never]).session;
    expect(afterToken.seats[0].createdTokenThisTurn).toBe(true);
    expect(clearTemporaryBuffs(afterToken).seats[0].createdTokenThisTurn).toBeUndefined();
  });
});

describe("mana rocks and lands keyed to the commander (real Oracle text)", () => {
  const commander = (identity: string[]) => real("Mazirek, Kraul Death Priest", "cmd", { zone: "command", colorIdentity: identity, commander: true });
  const withCommander = (cards: VisibleCard[], identity: string[]) => seat("a", cards, { board: { hand: [], battlefield: cards, graveyard: [], commander: commander(identity) } });

  it("Command Tower, Arcane Signet, Commander's Sphere and Path of Ancestry make only the commander's colors", () => {
    for (const name of ["Command Tower", "Arcane Signet", "Commander's Sphere", "Path of Ancestry"]) {
      const card = real(name, "c1");
      const s = withCommander([card], ["B", "G"]);
      expect(manaChoicesForCard(card, s, [s]).sort(), name).toEqual(["B", "G"]);
    }
  });

  it("Sol Ring, Mind Stone and Thought Vessel make colorless mana", () => {
    for (const name of ["Sol Ring", "Mind Stone", "Thought Vessel"]) {
      const card = real(name, "c1");
      const s = withCommander([card], ["B", "G"]);
      expect(manaChoicesForCard(card, s, [s]), name).toEqual(["C"]);
    }
  });

  it("Fellwar Stone makes a color an opponent's land could make", () => {
    const stone = real("Fellwar Stone", "fs");
    const mine = withCommander([stone], ["B", "G"]);
    const theirs = seat("b", [real("Mountain", "m")]);
    expect(manaChoicesForCard(stone, mine, [mine, theirs])).toEqual(["R"]);
  });
});

describe("Avenger of Zendikar (real Oracle text)", () => {
  it("makes one 0/1 Plant per land you control when it enters, and each landfall offers counters for every Plant", () => {
    const avenger = real("Avenger of Zendikar", "av");
    const lands = ["l1", "l2", "l3", "l4"].map((id) => real("Forest", id));
    const s = session([seat("a", [avenger, ...lands]), seat("b", [])]);
    const etb = findCommonTriggersForPermanentEntered(s, "a", avenger).filter((t) => t.sourceCardName === "Avenger of Zendikar");
    expect(etb).toHaveLength(1);
    const after = resolveTriggerEffect(s, etb[0]);
    expect(after.seats[0].board.battlefield.filter((c) => /Plant/.test(c.name))).toHaveLength(4);
    const plant = after.seats[0].board.battlefield.find((c) => /Plant/.test(c.name))!;
    const newLand = real("Forest", "l5");
    const afterLand = { ...after, seats: after.seats.map((x) => (x.id === "a" ? { ...x, board: { ...x.board, battlefield: [...x.board.battlefield, newLand] } } : x)) };
    const landfall = findCommonTriggersForPermanentEntered(afterLand, "a", newLand).filter((t) => t.sourceCardName === "Avenger of Zendikar");
    expect(landfall).toHaveLength(1);
    expect(landfall[0].effect).toMatchObject({ kind: "add_counter", scope: "each_matching_you_control", optional: true });
    const counted = resolveTriggerEffect(afterLand, landfall[0]);
    const plants = counted.seats[0].board.battlefield.filter((c) => /Plant/.test(c.name));
    expect(plants.every((c) => (c.counters ?? []).some((k) => k.kind === "+1/+1" && k.count === 1))).toBe(true);
    expect(plant.name).toMatch(/Plant/);
  });
});

import { applyBraidsEndStep, braidsDeclinePenalty, braidsRunOpponents, braidsSharedTypeFilter, isBraidsEndStepText, BRAIDS_TYPE_FILTER } from "./AppFlow";

describe("Braids, Arisen Nightmare (real Oracle text)", () => {
  const braids = () => real("Braids, Arisen Nightmare", "br");
  const land = (id: string) => real("Forest", id);
  const lib = (n: number) => Array.from({ length: n }, (_, i) => bear(`lib${i}`, { zone: "library" as const }));
  const braidsSeat = (battlefield: VisibleCard[]) => seat("a", battlefield, { library: lib(3), zones: { library: 3, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 } });

  it("recognizes its end-step text (and not other cards)", () => {
    expect(isBraidsEndStepText(braids().oracleText)).toBe(true);
    expect(isBraidsEndStepText(real("Viscera Seer", "vs").oracleText)).toBe(false);
  });

  it("the shared-type filter is built from the sacrificed permanent's card types", () => {
    expect(braidsSharedTypeFilter(land("l"))).toBe("land");
    expect(braidsSharedTypeFilter({ ...bear("ac"), typeLine: "Artifact Creature — Golem" })).toBe("artifact or creature");
    expect(BRAIDS_TYPE_FILTER).toContain("planeswalker");
  });

  it("an opponent who doesn't sacrifice loses 2 life and Braids' controller draws a card", () => {
    const s = session([braidsSeat([braids()]), seat("b", [])]);
    const after = braidsDeclinePenalty(s, "b", "a", "Braids, Arisen Nightmare");
    expect(after.seats[1].life).toBe(38);
    expect(after.seats[0].board.hand).toHaveLength(1);
  });

  it("an agent opponent with no permanent of that type takes the penalty; one with a token sacrifices it instead", () => {
    const noLand = session([braidsSeat([braids()]), seat("b", [bear("c")])]);
    const penalized = braidsRunOpponents(noLand, "a", "Braids", "br", "land", ["b"]);
    expect(penalized.seats[1].life).toBe(38);
    expect(penalized.seats[0].board.hand).toHaveLength(1);

    const token = { ...land("tok"), token: true };
    const hasToken = session([braidsSeat([braids()]), seat("b", [token])]);
    const sacrificed = braidsRunOpponents(hasToken, "a", "Braids", "br", "land", ["b"]);
    expect(sacrificed.seats[1].life).toBe(40);
    expect(sacrificed.seats[1].board.battlefield).toHaveLength(0);
    expect(sacrificed.seats[0].board.hand).toHaveLength(0);
  });

  it("a HUMAN opponent with a matching permanent is queued for a prompt (not auto-decided); one without just takes the penalty", () => {
    const withLand = session([braidsSeat([braids()]), seat("b", [land("f")], { kind: "human" }), seat("c", [], { kind: "human" })]);
    const queued = braidsRunOpponents(withLand, "a", "Braids", "br", "land", ["b", "c"]);
    expect(queued.pendingBraidsChoices).toEqual([
      { stage: "opponent", seatId: "b", braidsSeatId: "a", sourceName: "Braids", sourceCardId: "br", typeFilter: "land", remainingOpponentIds: ["c"] }
    ]);
    expect(queued.seats[1].board.battlefield).toHaveLength(1);
    const penaltyOnly = braidsRunOpponents(withLand, "a", "Braids", "br", "land", ["c"]);
    expect(penaltyOnly.seats[2].life).toBe(38);
    expect(penaltyOnly.pendingBraidsChoices).toBeUndefined();
  });

  it("an agent controller with nothing spare to sacrifice does nothing (no free card)", () => {
    const b = braids();
    const s = session([braidsSeat([b, bear("keeper")]), seat("b", [])]);
    const after = applyBraidsEndStep(s, "a", b);
    expect(after.seats[0].board.hand).toHaveLength(0);
    expect(after.seats[0].board.battlefield).toHaveLength(2);
  });

  it("an agent controller sacrifices a token, and each opponent then answers", () => {
    const b = braids();
    const token = { ...bear("tok"), token: true };
    const s = session([braidsSeat([b, token]), seat("b", [bear("theirs")])]);
    const after = applyBraidsEndStep(s, "a", b);
    expect(after.seats[0].board.battlefield.map((c) => c.id)).toEqual(["br"]);
    expect(after.seats[1].board.battlefield).toHaveLength(1);
    // The opponent keeps its real (non-token) creature and takes the penalty instead.
    expect(after.seats[1].life).toBe(38);
    expect(after.seats[0].board.hand).toHaveLength(1);
  });
});

import { chooseFreeCastCard, destroyCreatures, markHandCardFreeCastable, pathOfAncestryScries } from "./AppFlow";
import { drainDeathTriggers } from "@/lib/selfplay/orchestrator";

describe("Rishkar's Expertise free cast (helpers)", () => {
  it("an agent prefers the biggest permanent that fits, else the biggest spell", () => {
    const small = bear("s", { manaValue: 2 });
    const big = bear("b", { manaValue: 5 });
    const bolt = bear("bolt", { typeLine: "Instant", manaValue: 5 });
    expect(chooseFreeCastCard([small, big, bolt])?.id).toBe("b");
    expect(chooseFreeCastCard([bolt, { ...bolt, id: "sor", typeLine: "Sorcery", manaValue: 3 }])?.id).toBe("bolt");
  });

  it("the chosen hand card moves to exile with a free-cast permission for this turn", () => {
    const spell = bear("sp", { typeLine: "Sorcery", zone: "hand", manaValue: 4 });
    const s = session([seat("a", [], { board: { hand: [spell], battlefield: [], graveyard: [] } }), seat("b", [])]);
    const after = markHandCardFreeCastable(s, "a", "sp");
    const exiled = after.seats[0].board.exile?.find((c) => c.id === "sp");
    expect(after.seats[0].board.hand).toHaveLength(0);
    expect(exiled).toMatchObject({ exiledPlayableFree: true, exiledPlayableBySeatId: "a" });
  });
});

describe("Path of Ancestry (real Oracle text)", () => {
  it("scries only when its mana pays for a creature spell sharing a type with the commander", () => {
    const path = real("Path of Ancestry", "pa");
    const cmd = bear("cmd", { typeLine: "Legendary Creature — Squirrel", commander: true, zone: "command" });
    const s = session([seat("a", [path], { board: { hand: [], battlefield: [path], graveyard: [], commander: cmd } }), seat("b", [])]);
    const squirrel = bear("sq", { typeLine: "Creature — Squirrel Druid" });
    expect(pathOfAncestryScries(s, "a", squirrel, ["pa"])).toBe(true);
    expect(pathOfAncestryScries(s, "a", squirrel, ["other"])).toBe(false);
    expect(pathOfAncestryScries(s, "a", bear("wolf", { typeLine: "Creature — Wolf" }), ["pa"])).toBe(false);
    expect(pathOfAncestryScries(s, "a", { ...squirrel, typeLine: "Instant" }, ["pa"])).toBe(false);
  });
});

describe("self-play death drain mirrors the app", () => {
  it("Mazirek counters on a sacrifice, Blood Artist on a death, and Protean Hulk fetches creatures up to total mana value 6", () => {
    const mazirek = real("Mazirek, Kraul Death Priest", "mz", { power: "2", toughness: "2" });
    const hulk = real("Protean Hulk", "ph", { power: "6", toughness: "6", manaValue: 7 });
    const lib = [bear("l1", { manaValue: 4, zone: "library" }), bear("l2", { manaValue: 2, zone: "library" }), bear("l3", { manaValue: 3, zone: "library" })];
    const s = session([seat("a", [mazirek, hulk], { library: lib, zones: { library: 3, hand: 0, battlefield: 2, graveyard: 0, exile: 0, command: 0 } }), seat("b", [])]);
    const sacrificed = destroyCreatures(s, [{ seatId: "a", cardId: "ph", message: "a sacrifices Protean Hulk to something." }], "Rules action");
    const after = drainDeathTriggers(sacrificed);
    const mine = after.seats[0].board.battlefield;
    expect(mine.map((c) => c.id).sort()).toEqual(["l1", "l2", "mz"]);
    expect(mine.find((c) => c.id === "mz")?.counters?.some((k) => k.kind === "+1/+1")).toBe(true);
    expect(after.pendingDeaths).toBeUndefined();
  });
});
