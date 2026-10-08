// Tests built from the REAL Oracle text in the card catalog (data/commander-cards.json), never from wording typed into
// the test: two earlier tests passed on invented text while the real cards stayed broken (Court of Grace, the
// "with power N or greater" watchers). Skipped per card when the catalog doesn't have it.
import { describe, expect, it } from "vitest";
import { landDropsAllowed, landPlaysMade, recordLandPlay, findCastTriggers, seatHasFlashGrant, findLeavesBattlefieldTriggers, hideawayDamageConditionMet, legalMainPhaseActions, tapCreaturesAltCostFor, applyCastRemoval, nextCastPrompt, type CastChoices, spellModePrompt, applyDigPick, applyDigToBattlefield, applyTargetedEffect, castStructure, payGenericSacrificeCost, forcedAttackers, ventureIntoUndercity, applyPunisherChoiceEffect, openingHandBattlefieldCards, putOpeningHandCardOnBattlefield, untapForSeat, humanPhaseGraveyardChoice, clearTemporaryBuffs, playCardFromZone, resolveEndStepExileDamage, cleanupCombat, staticCostReduction, applyLabeledContinuation, spellTargetSlots, grantKeywordsToCreature, applyExalted, applySacrificeEffect, applyZoneEffect, totalAttackTax, applyEntersWithCounterReplacements, activateGraveyardReturnInSession, applyGenericTapEffect, chooseManaSourcesForCost, cycleCardInSession, assignBlockers, findCombatDamageToPlayerTriggers, findMultiAttackTriggers, adjustedCastingCost, findCommonTriggersForPermanentDied, resolveCombatDamage, payGenericTapCost, applySpellExtraEffect, parseSimpleDrawEffect, parseSimpleLifeChange, applyGenericAbilityEffect, parseGenericAbilityEffect, applyRemovalEffect, findLifeGainTriggers, lifeGainReplacementBonus, runStateBasedActionsPass } from "./AppFlow";
import { parseRemovalEffect } from "@/lib/removalSpells";
import { parseTargetedEffect } from "@/lib/targetedEffects";
import { canLegallyBlock } from "@/lib/combatSim";
import { parseZoneEffect } from "@/lib/zoneEffects";
import { permanentMatchesQualifier } from "@/lib/characteristics";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
import { etbEffectText, parseSagaChapters } from "@/lib/oracleClauses";
import { parseGenericManaAbilities, parseGenericSacrificeAbilities, parseGenericTapAbilities } from "@/lib/activatedAbilities";
import { zoneEffectTargetSpec } from "@/lib/targetSpecs";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import type { ChosenTarget } from "@/lib/targeting";

const catalog = loadCardCatalog();

function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return {
    manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "",
    ...found, id, summoningSick: false, ...extra
  } as VisibleCard;
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

const settle = (seats: PlayerSeat[]) => runStateBasedActionsPass(session(seats)).session.seats;
const find = (seats: PlayerSeat[], seatId: string, id: string) => seats.find((s) => s.id === seatId)!.board.battlefield.find((c) => c.id === id)!;
const bear = (id: string, extra: Partial<VisibleCard> = {}) => ({
  id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra
}) as VisibleCard;

describe("Calling All Angels anthems (real Oracle text)", () => {
  it("Always Watching: nontoken creatures you control get +1/+1 and vigilance", () => {
    const seats = settle([seat("a", [real("Always Watching", "aw"), bear("b1"), bear("tok", { token: true })])]);
    expect(find(seats, "a", "b1").attachmentPowerBonus).toBe(1);
    expect(find(seats, "a", "b1").grantedKeywords).toContain("vigilance");
    expect(find(seats, "a", "tok").attachmentPowerBonus).toBeUndefined();
  });

  it("Thraben Watcher: OTHER nontoken creatures", () => {
    const seats = settle([seat("a", [real("Thraben Watcher", "tw"), bear("b1")])]);
    expect(find(seats, "a", "b1").attachmentPowerBonus).toBe(1);
    expect(find(seats, "a", "tw").attachmentPowerBonus).toBeUndefined();
  });

  it("Lyra Dawnbringer: other Angels get +1/+1 and lifelink", () => {
    const angel = bear("an", { typeLine: "Creature — Angel" });
    const seats = settle([seat("a", [real("Lyra Dawnbringer", "ly"), angel, bear("b1")])]);
    expect(find(seats, "a", "an").attachmentPowerBonus).toBe(1);
    expect(find(seats, "a", "an").grantedKeywords).toContain("lifelink");
    expect(find(seats, "a", "b1").attachmentPowerBonus).toBeUndefined();
  });

  it("Angel of Vitality: +2/+2 only with 25 or more life", () => {
    const hi = settle([seat("a", [real("Angel of Vitality", "av")], { life: 30 })]);
    const lo = settle([seat("a", [real("Angel of Vitality", "av")], { life: 24 })]);
    expect(find(hi, "a", "av").attachmentPowerBonus).toBe(2);
    expect(find(lo, "a", "av").attachmentPowerBonus).toBeUndefined();
  });

  it("Righteous Valkyrie: creatures get +2/+2 at 7 life above the starting 40", () => {
    const hi = settle([seat("a", [real("Righteous Valkyrie", "rv"), bear("b1")], { life: 47 })]);
    const lo = settle([seat("a", [real("Righteous Valkyrie", "rv"), bear("b1")], { life: 46 })]);
    expect(find(hi, "a", "b1").attachmentPowerBonus).toBe(2);
    expect(find(lo, "a", "b1").attachmentPowerBonus).toBeUndefined();
  });

  it("Angelic Field Marshal's lieutenant: +2/+2 for itself and vigilance for your creatures while you control your commander", () => {
    const withCommander = settle([seat("a", [real("Angelic Field Marshal", "fm"), bear("b1"), bear("cmd", { commander: true })])]);
    const without = settle([seat("a", [real("Angelic Field Marshal", "fm"), bear("b1")])]);
    expect(find(withCommander, "a", "fm").attachmentPowerBonus).toBe(2);
    expect(find(withCommander, "a", "b1").grantedKeywords).toContain("vigilance");
    expect(find(without, "a", "fm").attachmentPowerBonus).toBeUndefined();
  });

  it("Heraldic Banner: creatures of the chosen color get +1/+0", () => {
    const banner = real("Heraldic Banner", "hb", { chosenColor: "W" });
    const seats = settle([seat("a", [banner, bear("white", { colors: ["W"] }), bear("green", { colors: ["G"] })])]);
    expect(find(seats, "a", "white").attachmentPowerBonus).toBe(1);
    expect(find(seats, "a", "green").attachmentPowerBonus).toBeUndefined();
  });
});

import { applyDeterministicPhaseTrigger, findCommonTriggersForPermanentEntered } from "./AppFlow";

describe("watchers and monarch (real Oracle text)", () => {
  it("Elemental Bond / Garruk's Packleader / Garruk's Uprising fire for a creature you control with power 3+/4+", () => {
    const big = bear("big", { power: "5", toughness: "5" });
    const small = bear("small", { power: "1", toughness: "1" });
    for (const [name, minPower] of [["Elemental Bond", 3], ["Garruk's Packleader", 3], ["Garruk's Uprising", 4]] as const) {
      const watcher = real(name, "w");
      const triggersFor = (entering: VisibleCard) => {
        const s = session([seat("a", [watcher, entering])]);
        return findCommonTriggersForPermanentEntered(s, "a", entering).filter((t) => t.sourceCardId === "w");
      };
      expect(triggersFor(big), `${name} with a 5-power creature (needs ${minPower}+)`).toHaveLength(1);
      expect(triggersFor(small), `${name} with a 1-power creature`).toHaveLength(0);
    }
  });

  it("Court of Grace: a 1/1 Spirit normally, a 4/4 Angel INSTEAD when you're the monarch", () => {
    const run = (monarch: boolean) => {
      const court = real("Court of Grace", "cg");
      const s: GameSession = { ...session([seat("a", [court])]), phase: "upkeep step", monarchSeatId: monarch ? "a" : undefined };
      return applyDeterministicPhaseTrigger(s, "a", court, "upkeep step")!.seats[0].board.battlefield.filter((c) => c.token);
    };
    expect(run(false).map((t) => `${t.power}/${t.toughness}`)).toEqual(["1/1"]);
    expect(run(true).map((t) => `${t.power}/${t.toughness}`)).toEqual(["4/4"]);
  });
});

describe("conditional enters triggers (real Oracle text)", () => {
  const triggersOf = (name: string, mine: VisibleCard[], others: VisibleCard[]) => {
    const source = real(name, "src");
    const me = seat("a", [source, ...mine]);
    const opp = seat("b", others, { life: 40 });
    const s = session([me, opp]);
    return findCommonTriggersForPermanentEntered(s, "a", source).map((t) => t.effect.kind);
  };

  it("Linvala: the 5 life needs an opponent with more life, the Angel needs an opponent with more creatures", () => {
    const meLife = (life: number) => {
      const source = real("Linvala, the Preserver", "src");
      const s = session([seat("a", [source], { life }), seat("b", [bear("o1"), bear("o2")], { life: 40 })]);
      return findCommonTriggersForPermanentEntered(s, "a", source).map((t) => t.effect.kind);
    };
    // Opponent has more life (40 > 30) AND more creatures (2 > 1).
    expect(meLife(30).sort()).toEqual(["create_tokens", "gain_life"]);
    // Equal life (40) but opponent still has more creatures: only the Angel.
    expect(meLife(40)).toEqual(["create_tokens"]);
  });

  it("Linvala does nothing when no opponent is ahead", () => {
    const source = real("Linvala, the Preserver", "src");
    const s = session([seat("a", [source, bear("m1"), bear("m2")], { life: 40 }), seat("b", [bear("o1")], { life: 20 })]);
    expect(findCommonTriggersForPermanentEntered(s, "a", source)).toHaveLength(0);
  });

  it("Garruk's Uprising draws on entering only with a power-4 creature", () => {
    expect(triggersOf("Garruk's Uprising", [bear("big", { power: "5", toughness: "5" })], [])).toContain("draw_cards");
    expect(triggersOf("Garruk's Uprising", [bear("small")], [])).not.toContain("draw_cards");
  });
});

import { findAttackTriggers, resolveTriggerEffect } from "./AppFlow";

describe("Dragon damage triggers (real Oracle text)", () => {
  it("Scourge of Valkas: when a Dragon enters, damage equal to the number of Dragons you control", () => {
    const scourge = real("Scourge of Valkas", "sv");
    const dragon = bear("d2", { typeLine: "Creature — Dragon", name: "Other Dragon" });
    const them = bear("target", { power: "1", toughness: "2" });
    const s = session([seat("a", [scourge, dragon]), seat("b", [them])]);
    const triggers = findCommonTriggersForPermanentEntered(s, "a", dragon).filter((t) => t.sourceCardId === "sv");
    expect(triggers).toHaveLength(1);
    expect(triggers[0].effect).toMatchObject({ kind: "damage_effect" });
    // 2 Dragons (Scourge is a Dragon too, per its type line, plus the other one): 2 damage kills a 1/2.
    const after = resolveTriggerEffect(s, triggers[0]);
    expect(after.seats.find((x) => x.id === "b")!.board.battlefield.map((c) => c.id)).not.toContain("target");
  });

  it("Warstorm Surge: the entering creature's power as damage", () => {
    const surge = real("Warstorm Surge", "ws");
    const big = bear("big", { power: "5", toughness: "5" });
    const s = session([seat("a", [surge, big]), seat("b", [], { life: 40 })]);
    const triggers = findCommonTriggersForPermanentEntered(s, "a", big).filter((t) => t.sourceCardId === "ws");
    expect(triggers).toHaveLength(1);
    const after = resolveTriggerEffect(s, triggers[0]);
    expect(after.seats.find((x) => x.id === "b")!.life).toBe(35);
  });

  it("Tyrant's Familiar's attack trigger needs your commander on the battlefield", () => {
    const familiar = real("Tyrant's Familiar", "tf", { attacking: true });
    const commander = bear("cmd", { commander: true });
    const victim = bear("v", { power: "1", toughness: "3" });
    const withCmd = session([seat("a", [familiar, commander]), seat("b", [victim])]);
    const withoutCmd = session([seat("a", [familiar]), seat("b", [victim])]);
    expect(findAttackTriggers(withCmd, { seatId: "a", card: familiar, defendingSeatId: "b" }).triggers).toHaveLength(1);
    expect(findAttackTriggers(withoutCmd, { seatId: "a", card: familiar, defendingSeatId: "b" }).triggers).toHaveLength(0);
  });

  it("Drakuseth: attacking deals 4 damage", () => {
    const drakuseth = real("Drakuseth, Maw of Flames", "dr", { attacking: true });
    const s = session([seat("a", [drakuseth]), seat("b", [], { life: 40 })]);
    const found = findAttackTriggers(s, { seatId: "a", card: drakuseth, defendingSeatId: "b" }).triggers;
    expect(found).toHaveLength(1);
    expect(resolveTriggerEffect(s, found[0]).seats.find((x) => x.id === "b")!.life).toBe(36);
  });
});

import { commonTriggerEffect } from "./AppFlow";

describe("pump abilities (real Oracle text)", () => {
  it("Scourge of Valkas: {R}: this creature gets +1/+0 — itself only", () => {
    const scourge = real("Scourge of Valkas", "sv");
    const other = bear("o1");
    const effect = commonTriggerEffect("This creature gets +1/+0 until end of turn.", "clause")!;
    expect(effect).toMatchObject({ kind: "self_pump", power: 1, toughness: 0 });
    const s = session([seat("a", [scourge, other]), seat("b", [bear("opp")])]);
    const after = resolveTriggerEffect(s, { id: "t", type: "trigger", actorSeatId: "a", controllerSeatId: "a", sourceCardId: "sv", sourceCardName: "Scourge of Valkas", triggerKind: "common", effect, message: "" } as never);
    expect(find(after.seats, "a", "sv").temporaryPowerBonus).toBe(1);
    expect(find(after.seats, "a", "o1").temporaryPowerBonus).toBeUndefined();
    expect(find(after.seats, "b", "opp").temporaryPowerBonus).toBeUndefined();
  });

  it("Lathliss: {1}{R}: Dragons you control get +1/+0 — your Dragons only", () => {
    const lathliss = real("Lathliss, Dragon Queen", "lq");
    const text = lathliss.oracleText.split("\n").find((line) => line.includes("Dragons you control get"))!.split(": ")[1];
    const effect = commonTriggerEffect(text, "clause")!;
    expect(effect).toMatchObject({ kind: "mass_pump", scope: "controlled", matcher: "dragon" });
    const dragon = bear("d1", { typeLine: "Creature — Dragon" });
    const s = session([seat("a", [lathliss, dragon, bear("b1")]), seat("b", [bear("od", { typeLine: "Creature — Dragon" })])]);
    const after = resolveTriggerEffect(s, { id: "t", type: "trigger", actorSeatId: "a", controllerSeatId: "a", sourceCardId: "lq", sourceCardName: "Lathliss", triggerKind: "common", effect, message: "" } as never);
    expect(find(after.seats, "a", "d1").temporaryPowerBonus).toBe(1);
    expect(find(after.seats, "a", "b1").temporaryPowerBonus).toBeUndefined();
    expect(find(after.seats, "b", "od").temporaryPowerBonus).toBeUndefined();
  });
});

describe("modal sweepers (real Oracle text)", () => {
  const artifact = (id: string) => bear(id, { typeLine: "Artifact", power: undefined, toughness: undefined, role: "permanent", manaValue: 2 });
  const run = (name: string, seats: PlayerSeat[]) => {
    const spell = real(name, "spell");
    const effect = parseRemovalEffect(spell.oracleText);
    expect(effect).toBeDefined();
    return applyRemovalEffect(session(seats), "a", name, spell, effect!).seats;
  };
  const ids = (seats: PlayerSeat[], seatId: string) => seats.find((s) => s.id === seatId)!.board.battlefield.map((c) => c.id);

  it("Austere Command picks the modes that hurt opponents, not your own artifacts", () => {
    const seats = run("Austere Command", [
      seat("a", [artifact("mine"), bear("mybear", { manaValue: 1, power: "1", toughness: "1" })]),
      seat("b", [bear("big1", { manaValue: 5, power: "5", toughness: "5" }), bear("big2", { manaValue: 6, power: "6", toughness: "6" })])
    ]);
    expect(ids(seats, "a")).toContain("mine");
    expect(ids(seats, "b")).toHaveLength(0);
  });

  it("Cleansing Nova's second mode destroys enchantments too", () => {
    const effect = parseRemovalEffect(real("Cleansing Nova", "n").oracleText);
    expect(JSON.stringify(effect)).toContain("artifact_or_enchantment");
  });
});

describe("life gain triggers (real Oracle text)", () => {
  const gain = (name: string, firstThisTurn = true) => {
    const s = session([seat("a", [real(name, "src")])]);
    return findLifeGainTriggers(s, { seatId: "a", amount: 3, firstThisTurn });
  };
  it("Archangel of Thune, Exemplar of Light and Ajani's Pridemate trigger on any life gain", () => {
    for (const name of ["Archangel of Thune", "Exemplar of Light", "Ajani's Pridemate"]) expect(gain(name), name).toHaveLength(1);
  });
  it("Vanguard Seraph only triggers for the first gain each turn", () => {
    expect(gain("Vanguard Seraph", true)).toHaveLength(1);
    expect(gain("Vanguard Seraph", false)).toHaveLength(0);
  });
  it("only the gaining player's permanents trigger", () => {
    const s = session([seat("a", [real("Archangel of Thune", "src")]), seat("b", [])]);
    expect(findLifeGainTriggers(s, { seatId: "b", amount: 2, firstThisTurn: true })).toHaveLength(0);
  });
  it("Angel of Vitality adds one life per gain", () => {
    expect(lifeGainReplacementBonus(seat("a", [real("Angel of Vitality", "av")]))).toBe(1);
    expect(lifeGainReplacementBonus(seat("a", [bear("x")]))).toBe(0);
  });
});

describe("Elder Gargaroth: attacks or blocks, choose one (real Oracle text)", () => {
  const garg = () => real("Elder Gargaroth", "garg", { power: "6", toughness: "6" });
  it("queues a modal trigger when it attacks and when it blocks, but not when another creature does", () => {
    const s = session([seat("a", [garg(), bear("other")]), seat("b", [])]);
    const attackTriggers = findAttackTriggers(s, { seatId: "a", card: garg(), defendingSeatId: "b" }).triggers;
    expect(attackTriggers).toHaveLength(1);
    expect(attackTriggers[0].effect.kind).toBe("modal");
    expect(findAttackTriggers(s, { seatId: "a", card: garg(), defendingSeatId: "b" }, "blocks").triggers).toHaveLength(1);
    expect(findAttackTriggers(s, { seatId: "a", card: bear("other"), defendingSeatId: "b" }).triggers).toHaveLength(0);
  });
  it("resolving the trigger performs a mode (a Beast token for the first viable mode)", () => {
    const s = session([seat("a", [garg()]), seat("b", [])]);
    const trigger = findAttackTriggers(s, { seatId: "a", card: garg(), defendingSeatId: "b" }).triggers[0];
    const after = resolveTriggerEffect(s, trigger);
    expect(after.seats[0].board.battlefield.some((card) => /Beast/.test(card.name))).toBe(true);
  });
});

describe("Scavenging Ooze (real Oracle text)", () => {
  const ooze = () => real("Scavenging Ooze", "ooze", { power: "2", toughness: "2" });
  const run = (graveyard: VisibleCard[], mine: VisibleCard[] = []) => {
    const mineSeat = seat("a", [ooze()]);
    mineSeat.board.graveyard = mine;
    const theirs = seat("b", []);
    theirs.board.graveyard = graveyard;
    const o = ooze();
    const effect = parseGenericManaAbilities(o.oracleText).map((ability) => parseGenericAbilityEffect(ability.effectText)).find(Boolean);
    expect(effect).toBeDefined();
    return applyGenericAbilityEffect(session([mineSeat, theirs]), "a", o, effect!).seats;
  };
  const gy = (id: string, typeLine: string) => ({ ...bear(id, { typeLine, zone: "graveyard" as const }) });
  it("exiling a creature card adds a +1/+1 counter and 1 life", () => {
    const seats = run([gy("dead", "Creature — Bear")]);
    expect(seats[1].board.graveyard).toHaveLength(0);
    expect(seats[0].life).toBe(41);
    expect(seats[0].board.battlefield[0].counters?.find((c) => c.kind === "+1/+1")?.count).toBe(1);
  });
  it("exiling a non-creature card gives nothing, and it prefers an opponent's creature card", () => {
    const seats = run([gy("land", "Land"), gy("dead", "Creature — Bear")], [gy("mine", "Creature — Bear")]);
    expect(seats[1].board.graveyard!.map((c) => c.id)).toEqual(["land"]);
    expect(seats[0].board.graveyard!.map((c) => c.id)).toEqual(["mine"]);
  });
});

describe("Collective Resistance and Valorous Stance (real Oracle text)", () => {
  const cast = (name: string, seats: PlayerSeat[]) => {
    const spell = real(name, "spell");
    const effect = parseRemovalEffect(spell.oracleText);
    expect(effect?.kind).toBe("modal");
    return { effect: effect as Extract<typeof effect, { kind: "modal" }>, seats: applyRemovalEffect(session(seats), "a", name, spell, effect!).seats };
  };
  const ids = (seats: PlayerSeat[], seatId: string) => seats.find((s) => s.id === seatId)!.board.battlefield.map((c) => c.id);
  it("Collective Resistance parses all three modes and takes one (escalate is not paid)", () => {
    const { effect, seats } = cast("Collective Resistance", [seat("a", [bear("mine")]), seat("b", [bear("art", { typeLine: "Artifact", role: "permanent" })])]);
    expect(effect.modes.map((m) => m.kind)).toEqual(["destroy", "destroy", "grant_keywords"]);
    expect(effect.chooseCount).toBe(1);
    expect(ids(seats, "b")).toHaveLength(0);
  });
  it("with nothing to destroy, Collective Resistance protects your creature", () => {
    const { seats } = cast("Collective Resistance", [seat("a", [bear("mine")]), seat("b", [])]);
    const mine = seats[0].board.battlefield[0];
    expect(mine.temporaryGrantedKeywords).toEqual(expect.arrayContaining(["hexproof", "indestructible"]));
  });
  it("Valorous Stance destroys a toughness-4+ creature, otherwise protects your own", () => {
    const big = bear("big", { power: "5", toughness: "5" });
    expect(ids(cast("Valorous Stance", [seat("a", [bear("mine")]), seat("b", [big])]).seats, "b")).toHaveLength(0);
    const protectedSeats = cast("Valorous Stance", [seat("a", [bear("mine")]), seat("b", [bear("small")])]).seats;
    expect(protectedSeats[0].board.battlefield[0].temporaryGrantedKeywords).toEqual(["indestructible"]);
    expect(ids(protectedSeats, "b")).toHaveLength(1);
  });
});

describe("one-shot spells (real Oracle text)", () => {
  const extrasFor = (name: string) => parseSpellExtraEffects(etbEffectText(real(name, "x").oracleText));
  const resolve = (name: string, seats: PlayerSeat[]) =>
    extrasFor(name).reduce((acc, effect) => applySpellExtraEffect(acc, "a", real(name, "spell"), effect), session(seats)).seats;
  const libSeat = (battlefield: VisibleCard[]) => {
    const s = seat("a", battlefield);
    s.library = Array.from({ length: 10 }, (_, i) => bear(`lib${i}`, { zone: "library" as const }));
    s.zones = { ...s.zones, library: 10 };
    return s;
  };

  it("Shamanic Revelation draws per creature and gains 4 life per creature with power 4+ (no flat life)", () => {
    expect(extrasFor("Shamanic Revelation").map((e) => e.kind)).toEqual(["draw_per_creature", "gain_life_per_creature"]);
    expect(parseSimpleLifeChange(etbEffectText(real("Shamanic Revelation", "x").oracleText))).toBeUndefined();
    expect(parseSimpleDrawEffect(etbEffectText(real("Shamanic Revelation", "x").oracleText))).toBeUndefined();
    const seats = resolve("Shamanic Revelation", [libSeat([bear("b1"), bear("b2"), bear("big", { power: "5", toughness: "5" })])]);
    expect(seats[0].board.hand).toHaveLength(3);
    expect(seats[0].life).toBe(44);
  });

  it("Tamiyo's Safekeeping grants hexproof and indestructible and gains 2 life", () => {
    expect(parseSimpleLifeChange(etbEffectText(real("Tamiyo's Safekeeping", "x").oracleText))).toEqual({ kind: "gain_life", amount: 2 });
    const seats = resolve("Tamiyo's Safekeeping", [libSeat([bear("b1")])]);
    expect(seats[0].board.battlefield[0].temporaryGrantedKeywords).toEqual(expect.arrayContaining(["hexproof", "indestructible"]));
  });

  it("Ram Through: your creature deals damage equal to its power; trample sends the excess to the controller", () => {
    const [effect] = extrasFor("Ram Through");
    expect(effect).toEqual({ kind: "creature_bites", trampleExcess: true });
    const trampler = bear("tr", { power: "6", toughness: "6", oracleText: "Trample" });
    const seats = resolve("Ram Through", [libSeat([trampler]), seat("b", [bear("victim")])]);
    expect(seats[1].board.battlefield).toHaveLength(0);
    expect(seats[1].life).toBe(36);
  });
});

describe("triggered abilities, batch 2 (real Oracle text)", () => {
  const attackWith = (name: string, extra: VisibleCard[] = [], opts: Partial<VisibleCard> = {}) => {
    const src = real(name, "src", { power: "4", toughness: "4", ...opts });
    const s = session([seat("a", [src, ...extra]), seat("b", [])]);
    const triggers = findAttackTriggers(s, { seatId: "a", card: src, defendingSeatId: "b" }).triggers;
    return { s, triggers, src };
  };
  const resolveAll = (s: GameSession, triggers: ReturnType<typeof findAttackTriggers>["triggers"]) => triggers.reduce((acc, t) => resolveTriggerEffect(acc, t), s);
  const onBoard = (s: GameSession, id: string) => s.seats.flatMap((x) => x.board.battlefield).find((c) => c.id === id)!;

  it("Herald of War puts a +1/+1 counter on itself when it attacks", () => {
    const { s, triggers } = attackWith("Herald of War");
    expect(triggers).toHaveLength(1);
    expect(onBoard(resolveAll(s, triggers), "src").counters?.find((c) => c.kind === "+1/+1")?.count).toBe(1);
  });

  it("Goreclaw pumps and tramples only creatures with power 4 or greater", () => {
    const { s, triggers } = attackWith("Goreclaw, Terror of Qal Sisma", [bear("big", { power: "5", toughness: "5" }), bear("small")]);
    expect(triggers).toHaveLength(1);
    const after = resolveAll(s, triggers);
    expect(onBoard(after, "big").temporaryPowerBonus).toBe(1);
    expect(onBoard(after, "big").temporaryGrantedKeywords).toContain("trample");
    expect(onBoard(after, "small").temporaryPowerBonus).toBeUndefined();
  });

  it("Pugnacious Hammerskull stuns itself only while you control no other Dinosaur", () => {
    const alone = attackWith("Pugnacious Hammerskull");
    expect(onBoard(resolveAll(alone.s, alone.triggers), "src").counters?.find((c) => c.kind === "stun")?.count).toBe(1);
    const withRaptor = attackWith("Pugnacious Hammerskull", [bear("raptor", { typeLine: "Creature — Dinosaur" })]);
    expect(onBoard(resolveAll(withRaptor.s, withRaptor.triggers), "src").counters?.find((c) => c.kind === "stun")).toBeUndefined();
  });

  it("Wojek Investigator makes one Clue per opponent with more cards in hand", () => {
    const mine = seat("a", [real("Wojek Investigator", "wi")]);
    const rich = seat("b", []);
    rich.board.hand = [bear("h1"), bear("h2")];
    const poor = seat("c", []);
    const s = session([mine, rich, poor]);
    const trigger = {
      id: "t", type: "trigger" as const, actorSeatId: "a", controllerSeatId: "a", sourceCardId: "wi", sourceCardName: "Wojek Investigator",
      triggerKind: "common" as const, effect: commonTriggerEffect(real("Wojek Investigator", "x").oracleText.split("\n").find((l) => /^At the beginning/.test(l))!, "clause")!, message: ""
    };
    expect(trigger.effect.kind).toBe("investigate_per_opponent_with_more_cards");
    const after = resolveTriggerEffect(s, trigger);
    expect(after.seats[0].board.battlefield.filter((c) => /Clue/.test(c.name))).toHaveLength(1);
  });

  it("Terror of Mount Velus gives your creatures double strike", () => {
    const effect = commonTriggerEffect(real("Terror of Mount Velus", "x").oracleText, "entered");
    expect(effect).toEqual({ kind: "creatures_gain_keywords", keywords: ["double strike"] });
  });

  it("Verdant Sun's Avatar and Righteous Valkyrie gain life equal to the entering creature's toughness", () => {
    for (const name of ["Verdant Sun's Avatar", "Righteous Valkyrie"]) {
      const watcher = real(name, "w", { power: "4", toughness: "4" });
      const entering = bear("ang", { typeLine: "Creature — Angel", toughness: "3" });
      const s = session([seat("a", [watcher, entering])]);
      const triggers = findCommonTriggersForPermanentEntered(s, "a", entering);
      expect(triggers.map((t) => t.effect.kind), name).toEqual(["gain_life_context_toughness"]);
      expect(resolveTriggerEffect(s, triggers[0]).seats[0].life, name).toBe(43);
    }
  });

  it("Thickest in the Thicket: counters equal to power; end-step draw only with the greatest power", () => {
    const [etb, endStep] = [real("Thickest in the Thicket", "x").oracleText.split("\n")[0], real("Thickest in the Thicket", "x").oracleText.split("\n")[1]];
    expect(commonTriggerEffect(etb, "clause")?.kind).toBe("double_power_counters");
    const draw = commonTriggerEffect(endStep, "clause")!;
    expect(draw).toMatchObject({ kind: "draw_cards", amount: 2, condition: { kind: "controls_greatest_power" } });
    const mk = (myPower: string, theirPower: string) => {
      const mine = seat("a", [bear("m", { power: myPower })]);
      mine.library = Array.from({ length: 5 }, (_, i) => bear(`l${i}`, { zone: "library" as const }));
      mine.zones = { ...mine.zones, library: 5 };
      return session([mine, seat("b", [bear("t", { power: theirPower })])]);
    };
    const trig = { id: "t", type: "trigger" as const, actorSeatId: "a", controllerSeatId: "a", sourceCardId: "x", sourceCardName: "Thickest", triggerKind: "common" as const, effect: draw, message: "" };
    expect(resolveTriggerEffect(mk("5", "3"), trig).seats[0].board.hand).toHaveLength(2);
    expect(resolveTriggerEffect(mk("2", "3"), trig).seats[0].board.hand).toHaveLength(0);
  });
});

describe("commander watchers (real Oracle text)", () => {
  const cmdr = (extra: Partial<VisibleCard> = {}) => bear("cmdr", { commander: true, ...extra });
  it("Norn's Choirmaster proliferates when your commander enters or attacks, not for other creatures", () => {
    const watcher = real("Norn's Choirmaster", "nc");
    const s = session([seat("a", [watcher, cmdr(), bear("other")]), seat("b", [])]);
    const onAttack = findAttackTriggers(s, { seatId: "a", card: cmdr(), defendingSeatId: "b" }).triggers;
    expect(onAttack.map((t) => t.effect.kind)).toEqual(["proliferate"]);
    expect(findAttackTriggers(s, { seatId: "a", card: bear("other"), defendingSeatId: "b" }).triggers).toHaveLength(0);
    expect(findCommonTriggersForPermanentEntered(s, "a", cmdr()).map((t) => t.effect.kind)).toEqual(["proliferate"]);
    expect(findCommonTriggersForPermanentEntered(s, "a", bear("other")).map((t) => t.effect.kind)).toEqual([]);
  });
  it("Tome of Legends adds a page counter when your commander enters or attacks", () => {
    const tome = real("Tome of Legends", "tome");
    const s = session([seat("a", [tome, cmdr()]), seat("b", [])]);
    const entered = findCommonTriggersForPermanentEntered(s, "a", cmdr());
    expect(entered).toHaveLength(1);
    const after = resolveTriggerEffect(s, entered[0]);
    expect(after.seats[0].board.battlefield.find((c) => c.id === "tome")!.counters?.find((c) => c.kind === "page")?.count).toBe(1);
    expect(findAttackTriggers(s, { seatId: "a", card: cmdr(), defendingSeatId: "b" }).triggers).toHaveLength(1);
  });
});

describe("tap abilities with counter costs and activation restrictions (real Oracle text)", () => {
  const tapAbilities = (name: string) => parseGenericTapAbilities(real(name, "x").oracleText);
  it("Dragon's Hoard and Tome of Legends parse a remove-counter draw ability", () => {
    expect(tapAbilities("Dragon's Hoard").find((a) => a.costRemoveCounter === "gold")?.effect.kind).toBe("draw_cards");
    const tome = tapAbilities("Tome of Legends").find((a) => a.costRemoveCounter === "page");
    expect(tome?.effect.kind).toBe("draw_cards");
    expect(tome?.costMana).toBe(1);
  });
  it("paying the cost removes the counter, taps the card, and needs a counter to start", () => {
    const hoard = (count: number) => real("Dragon's Hoard", "hoard", { counters: count > 0 ? [{ kind: "gold", count }] : undefined });
    const idx = tapAbilities("Dragon's Hoard").findIndex((a) => a.costRemoveCounter);
    const paid = payGenericTapCost(session([seat("a", [hoard(2)])]), "a", "hoard", idx);
    expect(paid?.session.seats[0].board.battlefield[0].counters?.find((c) => c.kind === "gold")?.count).toBe(1);
    expect(paid?.session.seats[0].board.battlefield[0].tapped).toBe(true);
    expect(payGenericTapCost(session([seat("a", [hoard(0)])]), "a", "hoard", idx)).toBeUndefined();
  });
  it("Endless Atlas needs three lands with the same name", () => {
    const [atlas] = tapAbilities("Endless Atlas");
    expect(atlas.effect.kind).toBe("draw_cards");
    const land = (id: string, name: string) => bear(id, { name, typeLine: "Basic Land — Forest", role: "land" });
    const rich = seat("a", [real("Endless Atlas", "atlas"), land("f1", "Forest"), land("f2", "Forest"), land("f3", "Forest"), land("f4", "Forest")]);
    const poor = seat("a", [real("Endless Atlas", "atlas"), land("f1", "Forest"), land("f2", "Forest"), land("p1", "Plains")]);
    expect(payGenericTapCost(session([rich]), "a", "atlas", 0)).toBeDefined();
    expect(payGenericTapCost(session([poor]), "a", "atlas", 0)).toBeUndefined();
  });
  it("Speaker of the Heavens needs life 7 above the starting total", () => {
    const speaker = real("Speaker of the Heavens", "sp");
    const [ability] = tapAbilities("Speaker of the Heavens");
    expect(ability.effect.kind).toBe("create_tokens");
    expect(payGenericTapCost(session([seat("a", [speaker], { life: 46 })]), "a", "sp", 0)).toBeUndefined();
    expect(payGenericTapCost(session([seat("a", [speaker], { life: 47 })]), "a", "sp", 0)).toBeDefined();
  });
});

describe("combat and player-level cards, batch 4 (real Oracle text)", () => {
  const fight = (attacker: VisibleCard, blocker: VisibleCard) => {
    const a = { ...attacker, attacking: true, attackTargetId: "b" };
    const b = { ...blocker, blocking: true, blockingTargetId: a.id };
    return resolveCombatDamage(session([seat("a", [a]), seat("b", [b])]), "a");
  };
  const alive = (s: GameSession, seatId: string, id: string) => s.seats.find((x) => x.id === seatId)!.board.battlefield.some((c) => c.id === id);

  it("Seraph of the Sword takes no combat damage but still deals it", () => {
    const seraph = real("Seraph of the Sword", "seraph", { power: "2", toughness: "4" });
    const after = fight(bear("big", { power: "7", toughness: "7" }), seraph);
    expect(alive(after, "b", "seraph")).toBe(true);
    const asAttacker = fight(seraph, bear("wall", { power: "9", toughness: "2" }));
    expect(alive(asAttacker, "a", "seraph")).toBe(true);
    expect(alive(asAttacker, "b", "wall")).toBe(false);
  });

  it("Herald of Eternal Dawn: its controller doesn't lose at 0 life", () => {
    const withHerald = seat("a", [real("Herald of Eternal Dawn", "h")], { life: 0 });
    const without = seat("c", [bear("x")], { life: 0 });
    const after = runStateBasedActionsPass(session([withHerald, without])).session.seats;
    expect(after.find((x) => x.id === "a")!.hasLost).toBeFalsy();
    expect(after.find((x) => x.id === "c")!.hasLost).toBe(true);
  });

  it("Metropolis Reformer: you have hexproof, and damage to it gains you that much life", () => {
    const reformer = real("Metropolis Reformer", "mr", { power: "2", toughness: "3" });
    const burn = real("Lightning Bolt", "bolt");
    const hexproofSeat = session([seat("a", [bear("mine")]), seat("b", [reformer])]);
    const target = applyRemovalEffect(hexproofSeat, "a", "Lightning Bolt", burn, { kind: "damage", amount: 3, targetType: "player" });
    expect(target.seats[1].life).toBe(40);
    const afterFight = fight(bear("big", { power: "2", toughness: "2" }), real("Metropolis Reformer", "mr2", { power: "2", toughness: "3" }));
    expect(afterFight.seats[1].life).toBe(42);
  });

  it("Ripjaw Raptor draws a card when dealt damage", () => {
    const raptor = real("Ripjaw Raptor", "rr", { power: "4", toughness: "5" });
    const owner = seat("b", [raptor]);
    owner.library = Array.from({ length: 5 }, (_, i) => bear(`l${i}`, { zone: "library" as const }));
    owner.zones = { ...owner.zones, library: 5 };
    const after = resolveCombatDamage(session([seat("a", [{ ...bear("atk", { power: "2", toughness: "2" }), attacking: true, attackTargetId: "b" }]), { ...owner, board: { ...owner.board, battlefield: [{ ...raptor, blocking: true, blockingTargetId: "atk" }] } }]), "a");
    expect(after.seats[1].board.hand).toHaveLength(1);
  });
});

describe("static abilities, batch 5 (real Oracle text)", () => {
  it("Sephara gives OTHER flyers you control indestructible", () => {
    const flyer = bear("fl", { oracleText: "Flying" });
    const seats = settle([seat("a", [real("Sephara, Sky's Blade", "seph", { power: "7", toughness: "7" }), flyer, bear("ground")])]);
    expect(find(seats, "a", "fl").grantedKeywords).toContain("indestructible");
    expect(find(seats, "a", "ground").grantedKeywords ?? []).not.toContain("indestructible");
    expect(find(seats, "a", "seph").grantedKeywords ?? []).not.toContain("indestructible");
  });
  it("Paradise Druid has hexproof only while untapped", () => {
    const untapped = settle([seat("a", [real("Paradise Druid", "pd", { tapped: false })])]);
    expect(find(untapped, "a", "pd").grantedKeywords).toContain("hexproof");
    const tapped = settle([seat("a", [real("Paradise Druid", "pd", { tapped: true })])]);
    expect(find(tapped, "a", "pd").grantedKeywords ?? []).not.toContain("hexproof");
  });
  it("Tangleweave Armor: living weapon makes a Germ that survives with +X/+X from your commander's mana value", () => {
    const armor = real("Tangleweave Armor", "armor");
    const cmdr = bear("cmdr", { commander: true, manaValue: 5 });
    const s0 = session([seat("a", [armor, cmdr])]);
    const triggers = findCommonTriggersForPermanentEntered(s0, "a", armor);
    expect(triggers.map((t) => t.effect.kind)).toEqual(["living_weapon"]);
    const after = resolveTriggerEffect(s0, triggers[0]);
    const germ = after.seats[0].board.battlefield.find((c) => /Germ/.test(c.name));
    expect(germ).toBeDefined();
    const settled = runStateBasedActionsPass(after).session.seats;
    const settledGerm = settled[0].board.battlefield.find((c) => /Germ/.test(c.name))!;
    expect(settledGerm.attachmentPowerBonus).toBe(5);
    expect(settled[0].board.battlefield.find((c) => c.id === "armor")!.attachedToId).toBe(settledGerm.id);
  });
  it("Rishkar: each creature you control with a counter gets a tap-for-G ability", () => {
    const seats = settle([seat("a", [real("Rishkar, Peema Renegade", "rk", { power: "2", toughness: "2" }), bear("wc", { counters: [{ kind: "+1/+1", count: 1 }] }), bear("plain")])]);
    expect(find(seats, "a", "wc").grantedManaAbilityText).toContain("{T}: Add {G}");
    expect(find(seats, "a", "plain").grantedManaAbilityText).toBeUndefined();
  });
  it("Rishkar's enters trigger puts a +1/+1 counter on up to two creatures", () => {
    const effect = commonTriggerEffect(real("Rishkar, Peema Renegade", "x").oracleText.split("\n")[0], "clause");
    expect(effect).toEqual({ kind: "counters_on_up_to_creatures", counterKind: "+1/+1", amount: 1, count: 2 });
  });
});

describe("modal death trigger: Atsushi (real Oracle text)", () => {
  it("queues a modal trigger when Atsushi dies, and resolving it does something", () => {
    const atsushi = real("Atsushi, the Blazing Sky", "ats", { power: "4", toughness: "4" });
    const mine = seat("a", [], { });
    mine.library = Array.from({ length: 6 }, (_, i) => bear(`l${i}`, { zone: "library" as const }));
    mine.zones = { ...mine.zones, library: 6 };
    const s = session([mine, seat("b", [])]);
    const triggers = findCommonTriggersForPermanentDied(s, "a", atsushi);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].effect.kind).toBe("modal");
    const after = resolveTriggerEffect(s, triggers[0]);
    expect(after.events.length).toBeGreaterThan(0);
    expect(after.seats[0].library!.length).toBeLessThan(6);
  });
});

describe("rummage triggers, cost reduction, changeling (real Oracle text)", () => {
  it("Bitter Reunion and Hazoret's Monument discard a card and then draw", () => {
    const lines = (n: string) => real(n, "x").oracleText.split("\n");
    const reunion = commonTriggerEffect(lines("Bitter Reunion")[0], "clause");
    expect(reunion).toMatchObject({ kind: "discard_then_draw", draw: 2 });
    const monument = commonTriggerEffect(lines("Hazoret's Monument")[1], "clause");
    expect(monument).toMatchObject({ kind: "discard_then_draw", draw: 1 });
    const mine = seat("a", []);
    mine.board.hand = [bear("h1")];
    mine.library = Array.from({ length: 5 }, (_, i) => bear(`l${i}`, { zone: "library" as const }));
    mine.zones = { ...mine.zones, library: 5, hand: 1 };
    const trigger = { id: "t", type: "trigger" as const, actorSeatId: "a", controllerSeatId: "a", sourceCardId: "x", sourceCardName: "Bitter Reunion", triggerKind: "common" as const, effect: reunion!, message: "" };
    const after = resolveTriggerEffect(session([mine]), trigger);
    expect(after.seats[0].board.hand).toHaveLength(2);
    expect(after.seats[0].board.graveyard).toHaveLength(1);
    const empty = seat("a", []);
    empty.library = mine.library;
    expect(resolveTriggerEffect(session([empty]), trigger).seats[0].board.hand).toHaveLength(0);
  });
  it("Taurean Mauler counts as a Dragon (changeling)", () => {
    expect(permanentMatchesQualifier(real("Taurean Mauler", "tm"), "dragon")).toBe(true);
    expect(permanentMatchesQualifier(bear("b"), "dragon")).toBe(false);
  });
  it("Hazoret's Monument makes red creature spells cost {1} less", () => {
    const monument = real("Hazoret's Monument", "hm");
    const s = seat("a", [monument]);
    const red = bear("r", { colors: ["R"], manaValue: 4, zone: "hand" as const });
    const green = bear("g", { colors: ["G"], manaValue: 4, zone: "hand" as const });
    expect(adjustedCastingCost(s, red, 4, "hand", "a", [s])).toBe(3);
    expect(adjustedCastingCost(s, green, 4, "hand", "a", [s])).toBe(4);
  });
});

describe("beginning-of-combat triggers (real Oracle text)", () => {
  it("Unnatural Growth doubles each of your creatures", () => {
    const s = session([seat("a", [real("Unnatural Growth", "ug"), bear("b1", { power: "3", toughness: "3" })])]);
    const after = applyDeterministicPhaseTrigger(s, "a", real("Unnatural Growth", "ug"), "beginning of combat step")!;
    expect(after.seats[0].board.battlefield.find((c) => c.id === "b1")!.temporaryPowerBonus).toBe(3);
    expect(after.seats[0].board.battlefield.find((c) => c.id === "b1")!.temporaryToughnessBonus).toBe(3);
  });
  it("Surrak gives haste only when your creatures have total power 8 or more", () => {
    const run = (powers: string[]) => {
      const creatures = powers.map((p, i) => bear(`c${i}`, { power: p, summoningSick: true }));
      const s = session([seat("a", [real("Surrak, the Hunt Caller", "sur", { power: "5", toughness: "4" }), ...creatures])]);
      return applyDeterministicPhaseTrigger(s, "a", real("Surrak, the Hunt Caller", "sur"), "beginning of combat step")!;
    };
    const big = run(["4"]);
    expect(big.seats[0].board.battlefield.some((c) => c.temporaryGrantedKeywords?.includes("haste"))).toBe(true);
    const small = run(["1"]);
    expect(small.seats[0].board.battlefield.some((c) => c.temporaryGrantedKeywords?.includes("haste"))).toBe(false);
  });
});

describe("extra combat and dethrone (real Oracle text)", () => {
  const scourge = () => real("Scourge of the Throne", "sc", { power: "5", toughness: "5", attacking: true });
  it("Scourge of the Throne: dethrone counter and an extra combat when attacking the life leader, once per turn", () => {
    const s = session([seat("a", [scourge()], { life: 30 }), seat("b", [], { life: 40 })]);
    const triggers = findAttackTriggers(s, { seatId: "a", card: scourge(), defendingSeatId: "b" }).triggers;
    expect(triggers.map((t) => t.effect.kind).sort()).toEqual(["add_counter", "additional_combat"]);
    const extra = triggers.find((t) => t.effect.kind === "additional_combat")!;
    const after = resolveTriggerEffect(s, extra);
    expect(after.extraCombatsPending).toBe(1);
    expect(findAttackTriggers(after, { seatId: "a", card: scourge(), defendingSeatId: "b" }).triggers.map((t) => t.effect.kind)).toEqual(["add_counter"]);
  });
  it("Scourge of the Throne does nothing special when the defender isn't the life leader", () => {
    const s = session([seat("a", [scourge()], { life: 40 }), seat("b", [], { life: 20 })]);
    expect(findAttackTriggers(s, { seatId: "a", card: scourge(), defendingSeatId: "b" }).triggers).toHaveLength(0);
  });
  it("Hellkite Charger: pays {5}{R}{R} for an extra combat, or does nothing if it can't", () => {
    const [trigger] = findAttackTriggers(session([seat("a", [real("Hellkite Charger", "hc", { attacking: true })]), seat("b", [])]), { seatId: "a", card: real("Hellkite Charger", "hc"), defendingSeatId: "b" }).triggers;
    expect(trigger.effect).toMatchObject({ kind: "additional_combat", payCostText: "{5}{R}{R}" });
    const broke = resolveTriggerEffect(session([seat("a", [real("Hellkite Charger", "hc", { attacking: true })]), seat("b", [])]), trigger);
    expect(broke.extraCombatsPending).toBeUndefined();
  });
});

describe("death-watching cards, batch 6 (real Oracle text)", () => {
  it("Angelic Destiny returns to its owner's hand when the enchanted creature dies", () => {
    const aura = real("Angelic Destiny", "ad", { zone: "graveyard" });
    const mine = seat("a", []);
    mine.board.graveyard = [aura];
    const s = session([mine]);
    const dead = bear("dead");
    const triggers = findCommonTriggersForPermanentDied(s, "a", dead, ["ad"]);
    expect(triggers.map((t) => t.effect.kind)).toEqual(["return_self_to_hand"]);
    const after = resolveTriggerEffect(s, triggers[0]);
    expect(after.seats[0].board.hand.map((c) => c.id)).toEqual(["ad"]);
    expect(after.seats[0].board.graveyard ?? []).toHaveLength(0);
    expect(findCommonTriggersForPermanentDied(s, "a", dead, [])).toHaveLength(0);
  });
  it("Merchant of Truth investigates when a nontoken creature you control dies, not for tokens", () => {
    const s = session([seat("a", [real("Merchant of Truth", "mt")])]);
    const triggers = findCommonTriggersForPermanentDied(s, "a", bear("dead"));
    expect(triggers).toHaveLength(1);
    expect(resolveTriggerEffect(s, triggers[0]).seats[0].board.battlefield.some((c) => /Clue/.test(c.name))).toBe(true);
    expect(findCommonTriggersForPermanentDied(s, "a", bear("tok", { token: true }))).toHaveLength(0);
  });
});

describe("Firemane Commando (real Oracle text)", () => {
  const attacking = (id: string, target: string) => bear(id, { attacking: true, attackTargetId: target });
  it("draws for you when you attack with two or more creatures, once per turn", () => {
    const s = session([seat("a", [real("Firemane Commando", "fc"), attacking("x1", "b"), attacking("x2", "b")]), seat("b", [])]);
    const { triggers, keys } = findMultiAttackTriggers(s, "a");
    expect(triggers.map((t) => t.effect.kind)).toEqual(["draw_cards"]);
    expect(findMultiAttackTriggers({ ...s, onceEachTurnEffectsUsed: keys }, "a").triggers).toHaveLength(0);
  });
  it("does not trigger for a single attacker", () => {
    const s = session([seat("a", [real("Firemane Commando", "fc"), attacking("x1", "b")]), seat("b", [])]);
    expect(findMultiAttackTriggers(s, "a").triggers).toHaveLength(0);
  });
  it("lets another player's draw happen only if none of their attackers hit the Commando's controller", () => {
    const commando = seat("a", [real("Firemane Commando", "fc")]);
    const missed = session([commando, seat("b", [attacking("y1", "c"), attacking("y2", "c")]), seat("c", [])]);
    expect(findMultiAttackTriggers(missed, "b").triggers.map((t) => t.effect.kind)).toEqual(["actor_draws_cards"]);
    const hit = session([commando, seat("b", [attacking("y1", "a"), attacking("y2", "c")]), seat("c", [])]);
    expect(findMultiAttackTriggers(hit, "b").triggers).toHaveLength(0);
  });
});

describe("Thunderbreak Regent (real Oracle text)", () => {
  it("deals 3 damage to an opponent who targets one of your Dragons, but not for other targets or your own spells", () => {
    const dragon = bear("drag", { typeLine: "Creature — Dragon" });
    const s = session([seat("a", [bear("mine")]), seat("b", [real("Thunderbreak Regent", "tr", { typeLine: "Creature — Dragon" }), dragon])]);
    const burn = real("Lightning Bolt", "bolt");
    const hitDragon = applyRemovalEffect(s, "a", "Lightning Bolt", burn, { kind: "damage", amount: 1, targetType: "creature" });
    expect(hitDragon.seats[0].life).toBe(37);
    const ownCast = applyRemovalEffect(s, "b", "Lightning Bolt", burn, { kind: "damage", amount: 1, targetType: "creature" });
    expect(ownCast.seats[1].life).toBe(40);
  });
});

describe("Parapet Thrasher (real Oracle text)", () => {
  const dragon = () => real("Parapet Thrasher", "pt", { power: "4", toughness: "3" });
  it("casting it doesn't resolve the combat-damage modes", () => {
    expect(etbEffectText(dragon().oracleText)).toBe("Flying");
  });
  it("triggers when a Dragon deals combat damage to an opponent, picking a different mode each time this turn", () => {
    const s0 = session([seat("a", [dragon()]), seat("b", [], { life: 40 }), seat("c", [], { life: 40 })]);
    s0.seats[0].library = Array.from({ length: 6 }, (_, i) => bear(`l${i}`, { zone: "library" as const }));
    s0.seats[0].zones = { ...s0.seats[0].zones, library: 6 };
    const [first] = findCombatDamageToPlayerTriggers(s0, "a", dragon(), "b");
    expect(first.effect.kind).toBe("modal");
    expect(first.actorSeatId).toBe("b");
    const afterFirst = resolveTriggerEffect(s0, first);
    // First viable mode: no artifact to destroy, so 4 damage to each OTHER opponent (c, not b).
    expect(afterFirst.seats[1].life).toBe(40);
    expect(afterFirst.seats[2].life).toBe(36);
    const [second] = findCombatDamageToPlayerTriggers(afterFirst, "a", dragon(), "b");
    const afterSecond = resolveTriggerEffect(afterFirst, second);
    expect(afterSecond.seats[2].life).toBe(36);
    expect(afterSecond.seats[0].library!.length).toBeLessThan(6);
  });
  it("a non-Dragon connecting does not trigger it", () => {
    const s0 = session([seat("a", [dragon(), bear("goblin")]), seat("b", [])]);
    expect(findCombatDamageToPlayerTriggers(s0, "a", bear("goblin"), "b")).toHaveLength(0);
  });
});

describe("Clifftop Lookout and Scrapshooter (real Oracle text)", () => {
  it("Clifftop Lookout puts the first land from the top onto the battlefield tapped, rest to the bottom", () => {
    const effect = commonTriggerEffect(real("Clifftop Lookout", "x").oracleText, "entered");
    expect(effect?.kind).toBe("reveal_until_land_to_battlefield");
    const mine = seat("a", [real("Clifftop Lookout", "cl")]);
    mine.library = [bear("n1", { zone: "library" as const }), bear("n2", { zone: "library" as const }), bear("land", { zone: "library" as const, typeLine: "Basic Land — Forest", role: "land" }), bear("n3", { zone: "library" as const })];
    mine.zones = { ...mine.zones, library: 4 };
    const trigger = { id: "t", type: "trigger" as const, actorSeatId: "a", controllerSeatId: "a", sourceCardId: "cl", sourceCardName: "Clifftop Lookout", triggerKind: "common" as const, effect: effect!, message: "" };
    const after = resolveTriggerEffect(session([mine]), trigger).seats[0];
    const land = after.board.battlefield.find((c) => c.id === "land");
    expect(land?.tapped).toBe(true);
    expect(after.library!.map((c) => c.id)[0]).toBe("n3");
    expect(after.library!.length).toBe(3);
  });
  it("Scrapshooter doesn't destroy anything when cast, but its enters trigger destroys an artifact and gives the gift", () => {
    expect(parseRemovalEffect(etbEffectText(real("Scrapshooter", "x").oracleText))).toBeUndefined();
    const effect = commonTriggerEffect(real("Scrapshooter", "x").oracleText, "entered");
    expect(effect?.kind).toBe("gift_destroy_artifact_or_enchantment");
    const theirs = seat("b", [bear("art", { typeLine: "Artifact", role: "permanent" })]);
    theirs.library = Array.from({ length: 3 }, (_, i) => bear(`l${i}`, { zone: "library" as const }));
    theirs.zones = { ...theirs.zones, library: 3 };
    const trigger = { id: "t", type: "trigger" as const, actorSeatId: "a", controllerSeatId: "a", sourceCardId: "ss", sourceCardName: "Scrapshooter", triggerKind: "common" as const, effect: effect!, message: "" };
    const after = resolveTriggerEffect(session([seat("a", [real("Scrapshooter", "ss")]), theirs]), trigger);
    expect(after.seats[1].board.battlefield).toHaveLength(0);
    expect(after.seats[1].board.hand).toHaveLength(1);
    const nothing = resolveTriggerEffect(session([seat("a", [real("Scrapshooter", "ss")]), seat("b", [])]), trigger);
    expect(nothing.seats[1].board.hand).toHaveLength(0);
  });
});

describe("Sarkhan, Dragon Ascendant (real Oracle text)", () => {
  const dragonCard = (id: string) => bear(id, { typeLine: "Creature — Dragon" });
  it("behold: a Treasure only if you control or hold a Dragon", () => {
    const sarkhan = real("Sarkhan, Dragon Ascendant", "sk", { power: "1", toughness: "1" });
    const [etb] = findCommonTriggersForPermanentEntered(session([seat("a", [sarkhan])]), "a", sarkhan);
    expect(etb.effect).toMatchObject({ kind: "create_tokens", condition: { kind: "behold" } });
    const withDragon = resolveTriggerEffect(session([seat("a", [sarkhan, dragonCard("d")])]), etb);
    expect(withDragon.seats[0].board.battlefield.some((c) => /Treasure/.test(c.name))).toBe(true);
    const inHand = seat("a", [sarkhan]);
    inHand.board.hand = [dragonCard("h")];
    expect(resolveTriggerEffect(session([inHand]), etb).seats[0].board.battlefield.some((c) => /Treasure/.test(c.name))).toBe(true);
    expect(resolveTriggerEffect(session([seat("a", [sarkhan])]), etb).seats[0].board.battlefield.some((c) => /Treasure/.test(c.name))).toBe(false);
  });
  it("grows and flies when another Dragon enters", () => {
    const sarkhan = real("Sarkhan, Dragon Ascendant", "sk", { power: "1", toughness: "1" });
    const entering = dragonCard("newdrag");
    const s = session([seat("a", [sarkhan, entering])]);
    const triggers = findCommonTriggersForPermanentEntered(s, "a", entering);
    expect(triggers).toHaveLength(1);
    const after = resolveTriggerEffect(s, triggers[0]);
    const sk = after.seats[0].board.battlefield.find((c) => c.id === "sk")!;
    expect(sk.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(1);
    expect(sk.temporaryGrantedKeywords).toContain("flying");
  });
});

describe("Leyline Tyrant (real Oracle text)", () => {
  it("when it dies, you may pay all your red for that much damage", () => {
    const tyrant = real("Leyline Tyrant", "lt", { power: "4", toughness: "4" });
    const mountains = [real("Mountain", "m1"), real("Mountain", "m2"), real("Mountain", "m3")];
    const s = session([seat("a", mountains), seat("b", [bear("victim", { toughness: "2", power: "2" })], { life: 40 })]);
    const triggers = findCommonTriggersForPermanentDied(s, "a", tyrant);
    expect(triggers.map((t) => t.effect.kind)).toEqual(["pay_red_for_damage"]);
    const after = resolveTriggerEffect(s, triggers[0]);
    expect(after.seats[0].board.battlefield.every((m) => m.tapped)).toBe(true);
    // 3 damage kills the 2/2 (a lethal creature is preferred to face damage).
    expect(after.seats[1].board.battlefield).toHaveLength(0);
  });
});

describe("Breaching Dragonstorm (real Oracle text)", () => {
  it("enters: exiles lands, the first nonland card waits in exile for a FREE cast (hand only if its mana value is over 8); a Dragon entering bounces it", () => {
    const storm = real("Breaching Dragonstorm", "bd");
    const mine = seat("a", [storm]);
    mine.library = [bear("l1", { zone: "library" as const, typeLine: "Basic Land — Forest", role: "land" }), bear("spell", { zone: "library" as const }), bear("after", { zone: "library" as const })];
    mine.zones = { ...mine.zones, library: 3 };
    const s = session([mine]);
    const triggers = findCommonTriggersForPermanentEntered(s, "a", storm);
    expect(triggers.map((t) => t.effect.kind)).toEqual(["dig_nonland_to_hand"]);
    const resolved = resolveTriggerEffect(s, triggers[0]);
    const after = resolved.seats[0];
    expect(after.board.hand).toHaveLength(0);
    expect(after.board.exile!.map((c) => c.id)).toEqual(["l1", "spell"]);
    expect(after.board.exile!.find((c) => c.id === "spell")).toMatchObject({ exiledPlayableBySeatId: "a", exiledPlayableFree: true });
    expect(resolved.pendingDiscoverChoices).toEqual([{ seatId: "a", cardId: "spell", cardName: expect.any(String), sourceName: expect.any(String) }]);
    expect(after.library!.map((c) => c.id)).toEqual(["after"]);

    const dragon = bear("drag", { typeLine: "Creature — Dragon" });
    const s2 = session([seat("a", [storm, dragon])]);
    const bounce = findCommonTriggersForPermanentEntered(s2, "a", dragon);
    expect(bounce.map((t) => t.effect.kind)).toEqual(["return_self_to_hand"]);
    const returned = resolveTriggerEffect(s2, bounce[0]).seats[0];
    expect(returned.board.battlefield.map((c) => c.id)).toEqual(["drag"]);
    expect(returned.board.hand.map((c) => c.id)).toEqual(["bd"]);
  });
});

describe("menace (real Oracle text)", () => {
  it("a lone blocker is rejected, two blockers are accepted", () => {
    const menacing = bear("mn", { attacking: true, attackTargetId: "b", power: "4", toughness: "4", oracleText: "Menace" });
    const s = session([seat("a", [menacing]), seat("b", [bear("b1"), bear("b2")])]);
    const choice = { attackerSeatId: "a", defenderSeatId: "b", attackerCardId: "mn", targetId: "b" };
    const blockedBy = (ids: string[]) => assignBlockers(s, choice, ids).seats[1].board.battlefield.filter((c) => c.blocking).length;
    expect(blockedBy(["b1"])).toBe(0);
    expect(blockedBy(["b1", "b2"])).toBe(2);
  });
});

describe("cycling (real Oracle text)", () => {
  it("Angel of the Ruins: Plainscycling {2} fetches a Plains instead of drawing", () => {
    const angel = real("Angel of the Ruins", "an");
    const mine = seat("a", [real("Swamp", "s1"), real("Swamp", "s2")]);
    mine.board.hand = [angel];
    mine.library = [bear("l0", { zone: "library" as const }), real("Plains", "pl", { zone: "library" as const })];
    mine.zones = { ...mine.zones, library: 2, hand: 1 };
    const result = cycleCardInSession(session([mine]), "a", "an");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.session.seats[0];
    expect(after.board.hand.map((c) => c.id)).toEqual(["pl"]);
    expect(after.board.graveyard!.map((c) => c.id)).toEqual(["an"]);
  });
  it("Barren Moor: pays {B}, discards itself, draws a card", () => {
    const moor = real("Barren Moor", "bm");
    const swamp = real("Swamp", "sw");
    const mine = seat("a", [swamp]);
    mine.board.hand = [moor];
    mine.library = Array.from({ length: 3 }, (_, i) => bear(`l${i}`, { zone: "library" as const }));
    mine.zones = { ...mine.zones, library: 3, hand: 1 };
    const result = cycleCardInSession(session([mine]), "a", "bm");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.session.seats[0];
    expect(after.board.hand.map((c) => c.id)).toEqual(["l0"]);
    expect(after.board.graveyard!.map((c) => c.id)).toEqual(["bm"]);
    expect(after.board.battlefield[0].tapped).toBe(true);
  });
  it("fails without mana", () => {
    const mine = seat("a", []);
    mine.board.hand = [real("Barren Moor", "bm")];
    expect(cycleCardInSession(session([mine]), "a", "bm").ok).toBe(false);
  });
});

describe("restricted mana (real Oracle text)", () => {
  it("Giada's {W} only pays for Angel spells", () => {
    const giada = real("Giada, Font of Hope", "gi", { summoningSick: false });
    const s = seat("a", [giada]);
    const angel = bear("an", { typeLine: "Creature — Angel", colors: ["W"], manaCost: "{W}", manaValue: 1 });
    const human = bear("hu", { typeLine: "Creature — Human", colors: ["W"], manaCost: "{W}", manaValue: 1 });
    expect(chooseManaSourcesForCost(s, angel, 1, undefined, [s]).ok).toBe(true);
    expect(chooseManaSourcesForCost(s, human, 1, undefined, [s]).ok).toBe(false);
  });
  it("Haven of the Spirit Dragon's any-color mana only pays for Dragon creature spells", () => {
    const haven = real("Haven of the Spirit Dragon", "hv");
    const s = seat("a", [haven]);
    const dragon = bear("dr", { typeLine: "Creature — Dragon", colors: ["R"], manaCost: "{R}", manaValue: 1 });
    const other = bear("ot", { typeLine: "Creature — Elf", colors: ["R"], manaCost: "{R}", manaValue: 1 });
    expect(chooseManaSourcesForCost(s, dragon, 1, undefined, [s]).ok).toBe(true);
    expect(chooseManaSourcesForCost(s, other, 1, undefined, [s]).ok).toBe(false);
  });
});

describe("restricted mana, colorless fallback (real Oracle text)", () => {
  it("Haven of the Spirit Dragon still pays {C} for any spell", () => {
    const haven = real("Haven of the Spirit Dragon", "hv");
    const s = seat("a", [haven]);
    const generic = bear("gen", { typeLine: "Creature — Elf", colors: [], manaCost: "{1}", manaValue: 1 });
    expect(chooseManaSourcesForCost(s, generic, 1, undefined, [s]).ok).toBe(true);
  });
});

describe("Herald of War cost reduction (real Oracle text)", () => {
  it("Angel and Human spells cost {1} less per +1/+1 counter on it", () => {
    const herald = real("Herald of War", "hw", { counters: [{ kind: "+1/+1", count: 2 }] });
    const s = seat("a", [herald]);
    const angel = bear("an", { typeLine: "Creature — Angel", manaValue: 5, zone: "hand" as const });
    const goblin = bear("go", { typeLine: "Creature — Goblin", manaValue: 5, zone: "hand" as const });
    expect(adjustedCastingCost(s, angel, 5, "hand", "a", [s])).toBe(3);
    expect(adjustedCastingCost(s, goblin, 5, "hand", "a", [s])).toBe(5);
  });
});

describe("utility lands, batch 7 (real Oracle text)", () => {
  const tap = (name: string) => parseGenericTapAbilities(real(name, "x").oracleText).find((a) => a.effect.kind !== "create_tokens" || true);
  it("Rogue's Passage: target creature can't be blocked, and then really can't be blocked", () => {
    const ability = tap("Rogue's Passage")!;
    expect(ability.effect.kind).toBe("target_unblockable");
    const attacker = bear("atk", { summoningSick: false, attacking: true, attackTargetId: "b" });
    const s = session([seat("a", [real("Rogue's Passage", "rp"), attacker]), seat("b", [bear("blocker")])]);
    const after = applyGenericTapEffect(s, "a", "rp", "Rogue's Passage", ability.effect, ability.clause);
    const unblockable = after.seats[0].board.battlefield.find((c) => c.id === "atk")!;
    const blocked = assignBlockers(after, { attackerSeatId: "a", defenderSeatId: "b", attackerCardId: "atk", targetId: "b" }, ["blocker"]);
    expect(unblockable.temporaryGrantedKeywords).toContain("can't be blocked");
    expect(blocked.seats[1].board.battlefield.filter((c) => c.blocking)).toHaveLength(0);
  });
  it("Witch's Clinic: your commander gains lifelink", () => {
    const ability = tap("Witch's Clinic")!;
    expect(ability.effect).toEqual({ kind: "commander_gains_keyword", keyword: "lifelink" });
    const s = session([seat("a", [real("Witch's Clinic", "wc"), bear("cmdr", { commander: true }), bear("other", { power: "9" })])]);
    const after = applyGenericTapEffect(s, "a", "wc", "Witch's Clinic", ability.effect, ability.clause);
    expect(after.seats[0].board.battlefield.find((c) => c.id === "cmdr")!.temporaryGrantedKeywords).toContain("lifelink");
    expect(after.seats[0].board.battlefield.find((c) => c.id === "other")!.temporaryGrantedKeywords).toBeUndefined();
  });
  it("War Room: pays life equal to the colors in your commander's identity to draw", () => {
    const ability = tap("War Room")!;
    expect(ability.effect.kind).toBe("draw_cards");
    expect(ability.costLifeCommanderColors).toBe(true);
    const mine = seat("a", [real("War Room", "wr"), real("Mountain", "m1"), real("Mountain", "m2"), real("Mountain", "m3"), bear("cmdr", { commander: true, colorIdentity: ["R", "G"] })]);
    const paid = payGenericTapCost(session([mine]), "a", "wr", 0);
    expect(paid?.session.seats[0].life).toBe(38);
  });
});

describe("Cryptbreaker's tap-three-Zombies ability (real Oracle text)", () => {
  const zombie = (id: string, extra: Partial<VisibleCard> = {}) => bear(id, { typeLine: "Creature — Zombie", ...extra });
  it("taps three untapped Zombies, draws a card and loses 1 life", () => {
    const abilities = parseGenericTapAbilities(real("Cryptbreaker", "x").oracleText);
    const index = abilities.findIndex((a) => a.costTapCreatures);
    expect(abilities[index].costTapCreatures).toEqual({ count: 3, subtype: "zombie" });
    expect(abilities[index].effect).toEqual({ kind: "draw_and_lose_life", draw: 1, lose: 1 });
    const mine = seat("a", [real("Cryptbreaker", "cb", { typeLine: "Creature — Zombie Warlock", summoningSick: true }), zombie("z1"), zombie("z2"), bear("human")]);
    mine.library = Array.from({ length: 3 }, (_, i) => bear(`l${i}`, { zone: "library" as const }));
    mine.zones = { ...mine.zones, library: 3 };
    const paid = payGenericTapCost(session([mine]), "a", "cb", index)!;
    expect(paid).toBeDefined();
    const tapped = paid.session.seats[0].board.battlefield.filter((c) => c.tapped).map((c) => c.id).sort();
    expect(tapped).toEqual(["cb", "z1", "z2"]);
    const done = applyGenericTapEffect(paid.session, "a", "cb", "Cryptbreaker", paid.ability.effect, paid.ability.clause);
    expect(done.seats[0].board.hand).toHaveLength(1);
    expect(done.seats[0].life).toBe(39);
  });
  it("needs three untapped Zombies", () => {
    const index = parseGenericTapAbilities(real("Cryptbreaker", "x").oracleText).findIndex((a) => a.costTapCreatures);
    const mine = seat("a", [real("Cryptbreaker", "cb", { typeLine: "Creature — Zombie Warlock" }), zombie("z1"), zombie("z2", { tapped: true })]);
    expect(payGenericTapCost(session([mine]), "a", "cb", index)).toBeUndefined();
  });
});

describe("Undead Butler (real Oracle text)", () => {
  it("mills three when it enters", () => {
    const butler = real("Undead Butler", "ub", { power: "3", toughness: "3" });
    const mine = seat("a", [butler]);
    mine.library = Array.from({ length: 6 }, (_, i) => bear(`l${i}`, { zone: "library" as const }));
    mine.zones = { ...mine.zones, library: 6 };
    const s = session([mine]);
    const triggers = findCommonTriggersForPermanentEntered(s, "a", butler);
    expect(triggers.map((t) => t.effect.kind)).toEqual(["zone_effect"]);
    const after = resolveTriggerEffect(s, triggers[0]).seats[0];
    expect(after.library!.length).toBe(3);
    expect(after.board.graveyard!.length).toBe(3);
  });
  it("when it dies, exiles itself and returns the best creature card in the graveyard to hand", () => {
    const mine = seat("a", []);
    mine.board.graveyard = [real("Undead Butler", "ub", { zone: "graveyard" }), bear("small", { zone: "graveyard" as const, manaValue: 1 }), bear("big", { zone: "graveyard" as const, manaValue: 6 })];
    const s = session([mine]);
    const [trigger] = findCommonTriggersForPermanentDied(s, "a", mine.board.graveyard[0]);
    expect(trigger.effect.kind).toBe("exile_self_return_creature_to_hand");
    const after = resolveTriggerEffect(s, trigger).seats[0];
    expect(after.board.hand.map((c) => c.id)).toEqual(["big"]);
    expect(after.board.graveyard!.map((c) => c.id)).toEqual(["small"]);
  });
});

describe("Razorlash Transmogrant (real Oracle text)", () => {
  const swamps = (n: number) => Array.from({ length: n }, (_, i) => real("Swamp", `sw${i}`));
  it("returns from the graveyard with a +1/+1 counter for {4}{B}{B}", () => {
    const mine = seat("a", swamps(6));
    mine.board.graveyard = [real("Razorlash Transmogrant", "rz", { zone: "graveyard" })];
    const result = activateGraveyardReturnInSession(session([mine]), "a", "rz");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const back = result.session.seats[0].board.battlefield.find((c) => c.id === "rz")!;
    expect(back.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(1);
    expect(result.session.seats[0].board.battlefield.filter((c) => c.tapped)).toHaveLength(6);
    expect(result.session.seats[0].board.graveyard ?? []).toHaveLength(0);
  });
  it("costs {4} less when an opponent controls four or more nonbasic lands, and fails without the mana", () => {
    const mine = seat("a", swamps(2));
    mine.board.graveyard = [real("Razorlash Transmogrant", "rz", { zone: "graveyard" })];
    const nonbasic = (i: number) => bear(`nb${i}`, { typeLine: "Land", role: "land" });
    const rich = seat("b", [nonbasic(1), nonbasic(2), nonbasic(3), nonbasic(4)]);
    expect(activateGraveyardReturnInSession(session([mine, rich]), "a", "rz").ok).toBe(true);
    expect(activateGraveyardReturnInSession(session([mine, seat("b", [])]), "a", "rz").ok).toBe(false);
  });
});

describe("God-Eternal Bontu (real Oracle text)", () => {
  it("when it dies, goes into its owner's library third from the top", () => {
    const bontu = real("God-Eternal Bontu", "gb", { zone: "graveyard" });
    const mine = seat("a", []);
    mine.board.graveyard = [bontu];
    mine.library = Array.from({ length: 5 }, (_, i) => bear(`l${i}`, { zone: "library" as const }));
    mine.zones = { ...mine.zones, library: 5, graveyard: 1 };
    const s = session([mine]);
    const triggers = findCommonTriggersForPermanentDied(s, "a", bontu);
    expect(triggers.map((t) => t.effect.kind)).toEqual(["self_to_library_third"]);
    const after = resolveTriggerEffect(s, triggers[0]).seats[0];
    expect(after.library!.map((c) => c.id)).toEqual(["l0", "l1", "gb", "l2", "l3", "l4"]);
    expect(after.board.graveyard ?? []).toHaveLength(0);
  });
});

describe("Witch's Cottage (real Oracle text)", () => {
  it("untapped: puts the best creature card from the graveyard on top; tapped: nothing", () => {
    const run = (tapped: boolean) => {
      const cottage = real("Witch's Cottage", "wc", { tapped });
      const mine = seat("a", [cottage]);
      mine.board.graveyard = [bear("small", { zone: "graveyard" as const, manaValue: 1 }), bear("big", { zone: "graveyard" as const, manaValue: 5 })];
      mine.library = [bear("l0", { zone: "library" as const })];
      mine.zones = { ...mine.zones, library: 1, graveyard: 2 };
      const s = session([mine]);
      const [trigger] = findCommonTriggersForPermanentEntered(s, "a", cottage);
      return resolveTriggerEffect(s, trigger).seats[0];
    };
    expect(run(false).library!.map((c) => c.id)).toEqual(["big", "l0"]);
    expect(run(true).library!.map((c) => c.id)).toEqual(["l0"]);
  });
});

describe("chosen-type and enters-with-counter permanents (real Oracle text)", () => {
  it("Vanquisher's Banner: +1/+1 for the chosen type only", () => {
    const banner = real("Vanquisher's Banner", "vb", { chosenCreatureType: "Angel" });
    const seats = settle([seat("a", [banner, bear("an", { typeLine: "Creature — Angel" }), bear("hu", { typeLine: "Creature — Human" })])]);
    expect(find(seats, "a", "an").attachmentPowerBonus).toBe(1);
    expect(find(seats, "a", "hu").attachmentPowerBonus).toBeUndefined();
  });
  it("Dragonstorm Globe: each Dragon you control enters with an additional +1/+1 counter", () => {
    const dragon = bear("drag", { typeLine: "Creature — Dragon" });
    const s = session([seat("a", [real("Dragonstorm Globe", "dg"), dragon, bear("elf", { typeLine: "Creature — Elf" })])]);
    const after = applyEntersWithCounterReplacements(s, "a", "drag");
    expect(after.seats[0].board.battlefield.find((c) => c.id === "drag")!.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(1);
    expect(applyEntersWithCounterReplacements(s, "a", "elf").seats[0].board.battlefield.find((c) => c.id === "elf")!.counters).toBeUndefined();
  });
});

describe("Haven of the Spirit Dragon's sacrifice ability (real Oracle text)", () => {
  it("parses a regrow-a-Dragon sacrifice ability", () => {
    const abilities = parseGenericSacrificeAbilities(real("Haven of the Spirit Dragon", "x").oracleText);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].effect.kind).toBe("zone_effect");
    expect(abilities[0].sacrificeTarget).toBe("self");
  });
});

describe("Archangel of Tithes (real Oracle text)", () => {
  const archangel = () => real("Archangel of Tithes", "aot", { attacking: true, attackTargetId: "b", power: "3", toughness: "5" });
  const choice = { attackerSeatId: "a", defenderSeatId: "b", attackerCardId: "aot", targetId: "b" };
  const defender = (lands: number) => seat("b", [bear("b1", { oracleText: "Reach" }), bear("b2", { oracleText: "Reach" }), ...Array.from({ length: lands }, (_, i) => real("Plains", `pl${i}`))]);
  it("taxes each attacker {1} while untapped, nothing while tapped", () => {
    expect(totalAttackTax(seat("a", [real("Archangel of Tithes", "aot")]), false)).toBe(1);
    expect(totalAttackTax(seat("a", [real("Archangel of Tithes", "aot", { tapped: true })]), false)).toBe(0);
  });
  it("blockers must be paid for: one land pays for one blocker", () => {
    const s = session([seat("a", [archangel()]), defender(1)]);
    const result = assignBlockers(s, choice, ["b1", "b2"]);
    expect(result.seats[1].board.battlefield.filter((c) => c.blocking)).toHaveLength(1);
    expect(result.seats[1].board.battlefield.filter((c) => c.tapped)).toHaveLength(1);
  });
  it("no mana, no blockers", () => {
    const result = assignBlockers(session([seat("a", [archangel()]), defender(0)]), choice, ["b1"]);
    expect(result.seats[1].board.battlefield.filter((c) => c.blocking)).toHaveLength(0);
  });
});

describe("Defy Death (real Oracle text)", () => {
  const defy = () => parseZoneEffect(real("Defy Death", "x").oracleText)!;
  const run = (typeLine: string) => {
    const mine = seat("a", []);
    mine.board.graveyard = [bear("dead", { typeLine, zone: "graveyard" as const })];
    return applyZoneEffect(session([mine]), "a", "Defy Death", defy()).seats[0].board.battlefield.find((c) => c.id === "dead");
  };
  it("returns the creature; an Angel gets two +1/+1 counters, others none", () => {
    expect(defy()).toMatchObject({ kind: "reanimate", counterIfType: { typeWord: "angel", count: 2 } });
    expect(run("Creature — Angel")?.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(2);
    expect(run("Creature — Human")?.counters).toBeUndefined();
  });
});

describe("Scavenger Grounds (real Oracle text)", () => {
  it("parses as a self-sacrifice that exiles every graveyard", () => {
    const [ability] = parseGenericSacrificeAbilities(real("Scavenger Grounds", "x").oracleText);
    expect(ability.sacrificeTarget).toBe("self");
    expect(ability.effect.kind).toBe("exile_all_graveyards");
    const a = seat("a", []);
    a.board.graveyard = [bear("g1", { zone: "graveyard" as const })];
    const b = seat("b", []);
    b.board.graveyard = [bear("g2", { zone: "graveyard" as const })];
    const after = applySacrificeEffect(session([a, b]), "a", real("Scavenger Grounds", "sg"), ability.effect, ability.clause);
    expect(after.seats.every((x) => (x.board.graveyard ?? []).length === 0)).toBe(true);
  });
});

describe("Exalted and Merchant of Truth (real Oracle text)", () => {
  const lone = () => bear("atk", { attacking: true, attackTargetId: "b" });
  it("a lone attacker gets +1/+1 per Clue with Merchant of Truth, nothing without it", () => {
    const clue = (id: string) => bear(id, { typeLine: "Token Artifact — Clue", role: "token" });
    const withMerchant = applyExalted(session([seat("a", [real("Merchant of Truth", "mt"), clue("c1"), clue("c2"), lone()]), seat("b", [])]), "a");
    expect(withMerchant.seats[0].board.battlefield.find((c) => c.id === "atk")!.temporaryPowerBonus).toBe(2);
    const without = applyExalted(session([seat("a", [clue("c1"), lone()]), seat("b", [])]), "a");
    expect(without.seats[0].board.battlefield.find((c) => c.id === "atk")!.temporaryPowerBonus).toBeUndefined();
  });
  it("two attackers: no exalted; and it only applies once", () => {
    const two = session([seat("a", [real("Merchant of Truth", "mt"), bear("c1", { typeLine: "Token Artifact — Clue" }), lone(), bear("atk2", { attacking: true })]), seat("b", [])]);
    expect(applyExalted(two, "a")).toBe(two);
    const once = applyExalted(session([seat("a", [real("Merchant of Truth", "mt"), bear("c1", { typeLine: "Token Artifact — Clue" }), lone()]), seat("b", [])]), "a");
    expect(applyExalted(once, "a")).toBe(once);
  });
});

describe("Outpost Siege (real Oracle text)", () => {
  it("Khans mode: at your upkeep, exile the top card and you may play it this turn", () => {
    const mine = seat("a", [real("Outpost Siege", "os")]);
    mine.library = [bear("top", { zone: "library" as const }), bear("next", { zone: "library" as const })];
    mine.zones = { ...mine.zones, library: 2 };
    const after = applyDeterministicPhaseTrigger(session([mine]), "a", real("Outpost Siege", "os"), "upkeep step");
    expect(after).toBeDefined();
    expect(after!.seats[0].library!.map((c) => c.id)).toEqual(["next"]);
  });
});

describe("God-Eternal Bontu enters (real Oracle text)", () => {
  it("sacrifices lands beyond the seventh and draws that many", () => {
    const bontu = real("God-Eternal Bontu", "gb", { power: "5", toughness: "6" });
    const lands = Array.from({ length: 9 }, (_, i) => real("Swamp", `sw${i}`));
    const mine = seat("a", [bontu, ...lands]);
    mine.library = Array.from({ length: 5 }, (_, i) => bear(`l${i}`, { zone: "library" as const }));
    mine.zones = { ...mine.zones, library: 5 };
    const s = session([mine]);
    const [trigger] = findCommonTriggersForPermanentEntered(s, "a", bontu);
    expect(trigger.effect.kind).toBe("sacrifice_surplus_then_draw");
    const after = resolveTriggerEffect(s, trigger).seats[0];
    expect(after.board.battlefield.filter((c) => /Swamp/.test(c.name))).toHaveLength(7);
    expect(after.board.hand).toHaveLength(2);
  });
});

describe("Mosswort Bridge hideaway (real Oracle text)", () => {
  it("hides the best of the top four, then plays it free when total power is 10+", () => {
    const bridge = real("Mosswort Bridge", "mb");
    const mine = seat("a", [bridge]);
    mine.library = [
      bear("n1", { zone: "library" as const, manaValue: 1 }),
      bear("big", { zone: "library" as const, manaValue: 7 }),
      bear("n2", { zone: "library" as const, manaValue: 2 }),
      bear("n3", { zone: "library" as const, manaValue: 3 }),
      bear("deep", { zone: "library" as const })
    ];
    mine.zones = { ...mine.zones, library: 5 };
    const s = session([mine]);
    const [etb] = findCommonTriggersForPermanentEntered(s, "a", bridge);
    expect(etb.effect.kind).toBe("hideaway");
    const hidden = resolveTriggerEffect(s, etb);
    expect(hidden.seats[0].board.exile!.map((c) => c.id)).toEqual(["big"]);
    expect(hidden.seats[0].library!.length).toBe(4);
    expect(hidden.seats[0].library![0].id).toBe("deep");

    const ability = parseGenericTapAbilities(bridge.oracleText).find((a) => a.effect.kind === "hideaway_play")!;
    expect(ability).toBeDefined();
    const withBigBoard = { ...hidden, seats: hidden.seats.map((x) => ({ ...x, board: { ...x.board, battlefield: [...x.board.battlefield, bear("fat", { power: "10" })] } })) };
    const played = applyGenericTapEffect(withBigBoard, "a", "mb", "Mosswort Bridge", ability.effect, ability.clause);
    const card = played.seats[0].board.exile!.find((c) => c.id === "big")!;
    expect(card.exiledPlayableFree).toBe(true);
    const denied = applyGenericTapEffect(hidden, "a", "mb", "Mosswort Bridge", ability.effect, ability.clause);
    expect(denied.seats[0].board.exile!.find((c) => c.id === "big")!.exiledPlayableFree).toBeUndefined();
  });
});

describe("Orb of Dragonkind's sacrifice ability (real Oracle text)", () => {
  it("finds a Dragon in the top seven for your hand and bottoms the rest", () => {
    const orb = real("Orb of Dragonkind", "orb");
    const [ability] = parseGenericSacrificeAbilities(orb.oracleText);
    expect(ability.effect).toEqual({ kind: "dig_type_to_hand", count: 7, typeWord: "dragon" });
    const mine = seat("a", [orb]);
    mine.library = [...Array.from({ length: 4 }, (_, i) => bear(`x${i}`, { zone: "library" as const })), bear("drag", { zone: "library" as const, typeLine: "Creature — Dragon" }), ...Array.from({ length: 5 }, (_, i) => bear(`y${i}`, { zone: "library" as const }))];
    mine.zones = { ...mine.zones, library: 10 };
    const after = applySacrificeEffect(session([mine]), "a", orb, ability.effect, ability.clause).seats[0];
    expect(after.board.hand.map((c) => c.id)).toEqual(["drag"]);
    expect(after.library!.length).toBe(9);
    expect(after.library![0].id).toBe("y2");
  });
});

describe("human choices for auto-picked effects (pure halves)", () => {
  it("Elder Gargaroth's modes carry their own wording as labels, and a forced mode index is honoured", () => {
    const garg = real("Elder Gargaroth", "garg", { power: "6", toughness: "6" });
    const s = session([seat("a", [garg]), seat("b", [])]);
    s.seats[0].library = Array.from({ length: 4 }, (_, i) => bear(`l${i}`, { zone: "library" as const }));
    s.seats[0].zones = { ...s.seats[0].zones, library: 4 };
    const [trigger] = findAttackTriggers(s, { seatId: "a", card: garg, defendingSeatId: "b" }).triggers;
    if (trigger.effect.kind !== "modal") throw new Error("expected modal");
    expect(trigger.effect.modal.modes.map((m) => m.text)).toEqual(["Create a 3/3 green Beast creature token.", "You gain 3 life.", "Draw a card."]);
    const gain = resolveTriggerEffect(s, { ...trigger, effect: { ...trigger.effect, chosenOption: "1" } });
    expect(gain.seats[0].life).toBe(43);
    expect(gain.seats[0].board.battlefield.some((c) => /Beast/.test(c.name))).toBe(false);
    const draw = resolveTriggerEffect(s, { ...trigger, effect: { ...trigger.effect, chosenOption: "2" } });
    expect(draw.seats[0].board.hand).toHaveLength(1);
  });
  it("Scavenging Ooze exiles the card the human picked, not the heuristic one", () => {
    const ooze = real("Scavenging Ooze", "ooze", { power: "2", toughness: "2" });
    const mine = seat("a", [ooze]);
    const theirs = seat("b", []);
    theirs.board.graveyard = [bear("good", { zone: "graveyard" as const, manaValue: 6 }), bear("pick", { zone: "graveyard" as const, typeLine: "Land" })];
    const effect = parseGenericAbilityEffect(parseGenericManaAbilities(ooze.oracleText)[0].effectText)!;
    const after = applyGenericAbilityEffect(session([mine, theirs]), "a", ooze, effect, "pick");
    expect(after.seats[1].board.graveyard!.map((c) => c.id)).toEqual(["good"]);
    expect(after.seats[0].life).toBe(40);
  });
  it("Bontu sacrifices exactly the number of lands the human chose", () => {
    const bontu = real("God-Eternal Bontu", "gb");
    const mine = seat("a", [bontu, ...Array.from({ length: 4 }, (_, i) => real("Swamp", `sw${i}`))]);
    mine.library = Array.from({ length: 5 }, (_, i) => bear(`l${i}`, { zone: "library" as const }));
    mine.zones = { ...mine.zones, library: 5 };
    const s = session([mine]);
    const [trigger] = findCommonTriggersForPermanentEntered(s, "a", bontu);
    const after = resolveTriggerEffect(s, { ...trigger, effect: { ...trigger.effect, chosenOption: "2" } }).seats[0];
    expect(after.board.battlefield.filter((c) => /Swamp/.test(c.name))).toHaveLength(2);
    expect(after.board.hand).toHaveLength(2);
  });
});

describe("human card picks on triggers (pure halves)", () => {
  const trig = (effect: unknown, controller = "a") => ({ id: "t", type: "trigger" as const, actorSeatId: controller, controllerSeatId: controller, sourceCardId: "src", sourceCardName: "Src", triggerKind: "common" as const, effect: effect as never, message: "" });
  it("Rishkar's counters go on the two creatures the human picked", () => {
    const s = session([seat("a", [bear("x1", { power: "9" }), bear("x2"), bear("x3")])]);
    const after = resolveTriggerEffect(s, trig({ kind: "counters_on_up_to_creatures", counterKind: "+1/+1", amount: 1, count: 2, chosenOption: "x2,x3" }));
    const counted = after.seats[0].board.battlefield.filter((c) => c.counters?.length).map((c) => c.id).sort();
    expect(counted).toEqual(["x2", "x3"]);
  });
  it("Thickest in the Thicket and Surrak use the picked creature", () => {
    const s = session([seat("a", [bear("big", { power: "9" }), bear("pick", { power: "2" })])]);
    const grown = resolveTriggerEffect(s, trig({ kind: "double_power_counters", chosenOption: "pick" }));
    expect(grown.seats[0].board.battlefield.find((c) => c.id === "pick")!.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(2);
    expect(grown.seats[0].board.battlefield.find((c) => c.id === "big")!.counters).toBeUndefined();
    const hasty = resolveTriggerEffect(s, trig({ kind: "target_creature_gains_keyword", keywords: ["haste"], chosenOption: "pick" }));
    expect(hasty.seats[0].board.battlefield.find((c) => c.id === "pick")!.temporaryGrantedKeywords).toContain("haste");
  });
  it("Undead Butler returns the graveyard creature the human picked", () => {
    const mine = seat("a", []);
    mine.board.graveyard = [real("Undead Butler", "src", { zone: "graveyard" }), bear("small", { zone: "graveyard" as const, manaValue: 1 }), bear("big", { zone: "graveyard" as const, manaValue: 6 })];
    const after = resolveTriggerEffect(session([mine]), trig({ kind: "exile_self_return_creature_to_hand", chosenOption: "small" })).seats[0];
    expect(after.board.hand.map((c) => c.id)).toEqual(["small"]);
  });
  it("Scrapshooter destroys the artifact the human picked", () => {
    const theirs = seat("b", [bear("a1", { typeLine: "Artifact", role: "permanent", manaValue: 5 }), bear("a2", { typeLine: "Artifact", role: "permanent", manaValue: 1 })]);
    theirs.library = Array.from({ length: 2 }, (_, i) => bear(`l${i}`, { zone: "library" as const }));
    theirs.zones = { ...theirs.zones, library: 2 };
    const after = resolveTriggerEffect(session([seat("a", [real("Scrapshooter", "src")]), theirs]), trig({ kind: "gift_destroy_artifact_or_enchantment", chosenOption: "a2" }));
    expect(after.seats[1].board.battlefield.map((c) => c.id)).toEqual(["a1"]);
    expect(after.seats[1].board.hand).toHaveLength(1);
  });
});

describe("grantKeywordsToCreature", () => {
  it("gives the picked creature the keywords until end of turn and nobody else", () => {
    const s = session([seat("a", [bear("mine"), bear("other")])]);
    const after = grantKeywordsToCreature(s, "a", "other", ["hexproof", "indestructible"], "Collective Resistance");
    expect(after.seats[0].board.battlefield.find((c) => c.id === "other")!.temporaryGrantedKeywords).toEqual(["hexproof", "indestructible"]);
    expect(after.seats[0].board.battlefield.find((c) => c.id === "mine")!.temporaryGrantedKeywords).toBeUndefined();
  });
});

describe("labeled target prompts for spells (pure halves)", () => {
  it("Ram Through: two slots, your creature then theirs; the picks decide who fights", () => {
    const ram = real("Ram Through", "spell");
    const s = session([seat("a", [bear("small", { power: "2" }), bear("huge", { power: "8", oracleText: "Trample" })]), seat("b", [bear("v1"), bear("v2", { toughness: "9" })])]);
    const prompt = spellTargetSlots(s, "a", ram)!;
    expect(prompt.slots).toHaveLength(2);
    expect(prompt.slots[0].options.map((o) => o.label).join("|")).toContain("small");
    const picks = [prompt.slots[0].options.find((o) => /small/.test(o.label))!.target, prompt.slots[1].options.find((o) => /v1/.test(o.label))!.target];
    const after = applyLabeledContinuation(s, "a", ram, prompt.continuation, picks);
    expect(after.seats[1].board.battlefield.map((c) => c.id)).toEqual(["v2"]);
  });
  it("Tamiyo's Safekeeping: you pick the permanent and still gain 2 life", () => {
    const tam = real("Tamiyo's Safekeeping", "spell");
    const s = session([seat("a", [bear("p1"), bear("p2")]), seat("b", [])]);
    const prompt = spellTargetSlots(s, "a", tam)!;
    const after = applyLabeledContinuation(s, "a", tam, prompt.continuation, [prompt.slots[0].options.find((o) => /Bear p2/.test(o.label))!.target]);
    expect(after.seats[0].board.battlefield.find((c) => c.id === "p2")!.temporaryGrantedKeywords).toEqual(expect.arrayContaining(["hexproof", "indestructible"]));
    expect(after.seats[0].board.battlefield.find((c) => c.id === "p1")!.temporaryGrantedKeywords).toBeUndefined();
    expect(after.seats[0].life).toBe(42);
  });
  it("Lightning Bolt: any target lists creatures and players; the pick takes the damage", () => {
    const bolt = real("Lightning Bolt", "spell");
    const s = session([seat("a", []), seat("b", [bear("v", { toughness: "3" })]), seat("c", [])]);
    const prompt = spellTargetSlots(s, "a", bolt)!;
    const labels = prompt.slots[0].options.map((o) => o.label);
    expect(labels.some((l) => /Bear v/.test(l))).toBe(true);
    expect(labels.some((l) => /^c \(40 life\)|c \(40 life\)/.test(l))).toBe(true);
    const playerC = prompt.slots[0].options.find((o) => o.target.kind === "player" && o.target.seatId === "c")!.target;
    expect(applyLabeledContinuation(s, "a", bolt, prompt.continuation, [playerC]).seats[2].life).toBe(37);
  });
  it("a target that vanished fizzles instead of resolving", () => {
    const bolt = real("Lightning Bolt", "spell");
    const s = session([seat("a", []), seat("b", [bear("v")])]);
    const prompt = spellTargetSlots(s, "a", bolt)!;
    const gone = { kind: "card" as const, seatId: "b", cardId: "nope" };
    expect(applyLabeledContinuation(s, "a", bolt, prompt.continuation, [gone]).seats[1].board.battlefield).toHaveLength(1);
  });
});

describe("Leyline Tyrant amount, hideaway pick, Orb pick (pure halves)", () => {
  const trig = (effect: unknown) => ({ id: "t", type: "trigger" as const, actorSeatId: "a", controllerSeatId: "a", sourceCardId: "src", sourceCardName: "Src", triggerKind: "common" as const, effect: effect as never, message: "" });
  it("Leyline Tyrant pays exactly the chosen amount of red", () => {
    const mine = seat("a", [real("Mountain", "m1"), real("Mountain", "m2"), real("Mountain", "m3")]);
    const s = session([mine, seat("b", [], { life: 40 })]);
    const after = resolveTriggerEffect(s, trig({ kind: "pay_red_for_damage", chosenOption: "2" }));
    expect(after.seats[0].board.battlefield.filter((m) => m.tapped)).toHaveLength(2);
    expect(after.seats[1].life).toBe(38);
  });
  it("Hideaway hides the card the human picked", () => {
    const mine = seat("a", [real("Mosswort Bridge", "src")]);
    mine.library = [bear("a", { zone: "library" as const }), bear("b", { zone: "library" as const }), bear("c", { zone: "library" as const })];
    mine.zones = { ...mine.zones, library: 3 };
    const after = resolveTriggerEffect(session([mine]), trig({ kind: "hideaway", count: 3, chosenOption: "0" })).seats[0];
    expect(after.board.exile!.map((c) => c.id)).toEqual(["a"]);
  });
  it("Orb of Dragonkind: the human takes the Dragon they pick, or nothing", () => {
    const mine = seat("a", []);
    mine.library = [bear("d1", { zone: "library" as const, typeLine: "Creature — Dragon" }), bear("d2", { zone: "library" as const, typeLine: "Creature — Dragon" }), bear("x", { zone: "library" as const })];
    mine.zones = { ...mine.zones, library: 3 };
    const second = applyDigPick(session([mine]), "a", "Orb of Dragonkind", 7, "dragon", "d2").seats[0];
    expect(second.board.hand.map((c) => c.id)).toEqual(["d2"]);
    expect(applyDigPick(session([mine]), "a", "Orb of Dragonkind", 7, "dragon", "none").seats[0].board.hand).toHaveLength(0);
  });
});

describe("Herald's Horn and Nogi", () => {
  it("Horn upkeep: takes the top card only when it is a creature of the chosen type", () => {
    const horn = real("Herald's Horn", "h", { chosenCreatureType: "Dragon" });
    const mine = seat("a", [horn]);
    mine.library = [bear("d", { zone: "library" as const, typeLine: "Creature — Dragon" }), bear("x", { zone: "library" as const })];
    mine.zones = { ...mine.zones, library: 2 };
    const hit = applyDeterministicPhaseTrigger(session([mine]), "a", horn, "upkeep step")!.seats[0];
    expect(hit.board.hand.map((c) => c.id)).toEqual(["d"]);
    expect(hit.library!.map((c) => c.id)).toEqual(["x"]);
    const mine2 = { ...mine, library: [mine.library[1], mine.library[0]] };
    expect(applyDeterministicPhaseTrigger(session([mine2]), "a", horn, "upkeep step")!.seats[0].board.hand).toHaveLength(0);
  });
  it("Horn and Nogi each take {1} off a Dragon spell", () => {
    const horn = real("Herald's Horn", "h", { chosenCreatureType: "Dragon" });
    const nogi = real("Nogi, Draco-Zealot", "n");
    const triad = real("Goldlust Triad", "g");
    expect(staticCostReduction(seat("a", [horn, nogi]), triad)).toBe(2);
    expect(staticCostReduction(seat("a", [nogi]), real("Spit Flame", "s"))).toBe(0);
  });
});

describe("combat keywords from the backlog (real Oracle text)", () => {
  const attackCard = (name: string, id: string) => real(name, id, { attacking: true });
  it("landwalk: unblockable only while the defender controls that land type", () => {
    const anaconda = real("Anaconda", "an");
    const swamp = seat("b", [bear("blk"), real("Swamp", "sw")]);
    const forest = seat("b", [bear("blk"), real("Forest", "fo")]);
    const blk = bear("blk");
    expect(canLegallyBlock(anaconda, blk, swamp.board.battlefield)).toBe(false);
    expect(canLegallyBlock(anaconda, blk, forest.board.battlefield)).toBe(true);
  });
  it("Ascending Aven can block only fliers", () => {
    const aven = real("Ascending Aven", "av");
    const ground = bear("g", { attacking: true });
    expect(assignBlockers(session([seat("a", [ground]), seat("b", [aven])]), { attackerSeatId: "a", defenderSeatId: "b", attackerCardId: "g" } as never, ["av"]).seats[1].board.battlefield.find((c) => c.id === "av")!.blocking).toBeFalsy();
  });
  it("bushido gives +N/+N when it blocks; battle cry pumps the other attackers", () => {
    const ronin = real("Battle-Mad Ronin", "ro");
    const attacker = bear("g", { attacking: true });
    const after = assignBlockers(session([seat("a", [attacker]), seat("b", [ronin])]), { attackerSeatId: "a", defenderSeatId: "b", attackerCardId: "g" } as never, ["ro"]);
    expect(after.seats[1].board.battlefield.find((c) => c.id === "ro")!.temporaryPowerBonus).toBeGreaterThan(0);
    const wardriver = real("Goblin Wardriver", "gw", { attacking: true });
    const mates = seat("a", [wardriver, bear("x", { attacking: true })]);
    const s = session([mates, seat("b", [])]);
    const t = findAttackTriggers(s, { seatId: "a", card: wardriver, defendingSeatId: "b" }).triggers.find((x) => x.effect.kind === "battle_cry")!;
    expect(resolveTriggerEffect(s, t).seats[0].board.battlefield.find((c) => c.id === "x")!.temporaryPowerBonus).toBe(1);
  });
  it("a creature that doesn't untap stays tapped; devoid makes a permanent colorless", () => {
    const golem = real("Altar Golem", "ag", { tapped: true });
    const after = untapForSeat(session([seat("a", [golem, bear("free", { tapped: true })])]), "a").seats[0].board.battlefield;
    expect(after.find((c) => c.id === "ag")!.tapped).toBe(true);
    expect(after.find((c) => c.id === "free")!.tapped).toBe(false);
    expect(runStateBasedActionsPass(session([seat("a", [real("Hellkite Whelp", "hw", { colors: ["R"], oracleText: "Devoid" })])])).session.seats[0].board.battlefield[0].colors).toEqual([]);
  });
});

describe("rules gaps: afflict, flanking, lure, phasing, echo, turn-limited first strike", () => {
  const blockWith = (attacker: VisibleCard, blockers: VisibleCard[], chosen: string[]) =>
    assignBlockers(session([seat("a", [{ ...attacker, attacking: true }]), seat("b", blockers)]), { attackerSeatId: "a", defenderSeatId: "b", attackerCardId: attacker.id } as never, chosen);
  it("afflict: the defender loses life when the creature is blocked", () => {
    const after = blockWith(real("Ammit Eternal", "am"), [bear("blk")], ["blk"]);
    expect(after.seats[1].life).toBeLessThan(40);
  });
  it("flanking shrinks a non-flanking blocker", () => {
    const after = blockWith(real("Benalish Cavalry", "bc"), [bear("blk")], ["blk"]);
    expect(after.seats[1].board.battlefield[0].temporaryPowerBonus).toBe(-1);
  });
  it("lure forces every able creature to block", () => {
    const after = blockWith(real("Breaker of Armies", "br"), [bear("b1"), bear("b2")], []);
    expect(after.seats[1].board.battlefield.every((c) => c.blocking)).toBe(true);
  });
  it("phasing creatures phase out at their untap step and back in at the next", () => {
    const keeper = real("Breezekeeper", "bk");
    const once = untapForSeat(session([seat("a", [keeper]), seat("b", [])]), "a");
    expect(once.seats[0].board.battlefield[0].phasedOut).toBe(true);
    expect(untapForSeat(once, "a").seats[0].board.battlefield[0].phasedOut).toBeFalsy();
  });
  it("echo is paid with available mana, else the permanent is sacrificed, and only once", () => {
    const troll = real("Albino Troll", "at");
    const paid = applyDeterministicPhaseTrigger(session([seat("a", [troll, real("Forest", "f1"), real("Forest", "f2"), real("Forest", "f3"), real("Forest", "f4")]), seat("b", [])]), "a", troll, "upkeep step")!;
    expect(paid.seats[0].board.battlefield.some((c) => c.id === "at")).toBe(true);
    expect(paid.seats[0].board.battlefield.filter((c) => c.tapped).length).toBeGreaterThan(0);
    const broke = applyDeterministicPhaseTrigger(session([seat("a", [troll]), seat("b", [])]), "a", troll, "upkeep step")!;
    expect(broke.seats[0].board.battlefield.some((c) => c.id === "at")).toBe(false);
  });
  it("Duelist of Deep Faith has first strike only during its controller's turn", () => {
    const duelist = real("Duelist of Deep Faith", "du");
    const mine = session([seat("a", [duelist]), seat("b", [])]);
    const onTurn = runStateBasedActionsPass({ ...mine, activePlayerId: "a" }).session.seats[0].board.battlefield[0];
    expect(onTurn.grantedKeywords ?? []).toContain("first strike");
    const offTurn = runStateBasedActionsPass({ ...mine, activePlayerId: "b" }).session.seats[0].board.battlefield[0];
    expect(offTurn.grantedKeywords ?? []).not.toContain("first strike");
  });
});

describe("one-verb targeted effects (real Oracle text)", () => {
  const trig = (effect: unknown, chosenOption?: string) => ({ id: "t", type: "trigger" as const, actorSeatId: "a", controllerSeatId: "a", sourceCardId: "src", sourceCardName: "Src", triggerKind: "common" as const, effect: { ...(effect as object), chosenOption } as never, message: "" });
  it("parses the common shapes", () => {
    expect(parseTargetedEffect("Put a +1/+1 counter on target creature or enchantment you control.")).toMatchObject({ verb: { kind: "add_counters", counterKind: "+1/+1", amount: 1 }, who: { permanentType: "creature_or_enchantment", controller: "you" } });
    expect(parseTargetedEffect("Target player loses 1 life and you gain 1 life.")).toMatchObject({ verb: { kind: "life", delta: -1 }, youGainLife: 1, who: { kind: "player", opponentOnly: false } });
    expect(parseTargetedEffect("Target creature gains haste until end of turn.")).toMatchObject({ verb: { kind: "gain_keywords", keywords: ["haste"] } });
    expect(parseTargetedEffect("Put a -1/-1 counter on up to one target creature and draw a card.")).toMatchObject({ upTo: true, youDraw: 1 });
    expect(parseTargetedEffect("Destroy target creature.")).toBeUndefined();
  });
  it("Blood Artist and Heliod parse as targeted effects; the chosen target is the one hit", () => {
    const artist = real("Blood Artist", "ba");
    const effect = commonTriggerEffect(artist.oracleText.split("\n")[0], "clause")!;
    expect(effect.kind).toBe("targeted_effect");
    const s = session([seat("a", [artist]), seat("b", []), seat("c", [])]);
    const aimed = resolveTriggerEffect(s, trig(effect, "p:c"));
    expect(aimed.seats[2].life).toBe(39);
    expect(aimed.seats[1].life).toBe(40);
    expect(aimed.seats[0].life).toBe(41);
    const heliod = real("Heliod, Sun-Crowned", "he");
    const heliodEffect = commonTriggerEffect(heliod.oracleText.split("\n").find((l) => /whenever you gain life/i.test(l))!, "clause")!;
    expect(heliodEffect.kind).toBe("targeted_effect");
    const withBears = session([seat("a", [heliod, bear("b1"), bear("b2")]), seat("b", [])]);
    const grown = resolveTriggerEffect(withBears, trig(heliodEffect, "b2")).seats[0].board.battlefield.find((c) => c.id === "b2")!;
    expect(grown.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(1);
  });
  it("Simic Ascendancy (ability), Yawgmoth (sacrifice ability) and Expedite (spell) all use the shared effect", () => {
    const ascendancy = real("Simic Ascendancy", "sa");
    expect(parseGenericAbilityEffect(parseGenericManaAbilities(ascendancy.oracleText)[0].effectText)).toBeTruthy();
    const yawgmoth = real("Yawgmoth, Thran Physician", "yw");
    expect(parseGenericSacrificeAbilities(yawgmoth.oracleText).some((a) => a.effect.kind === "targeted_effect")).toBe(true);
    expect(castStructure(real("Expedite", "ex"))).toMatchObject({ kind: "targeted" });
  });
  it("a target that became illegal fizzles; an agent with no chosen target picks its own best creature", () => {
    const effect = parseTargetedEffect("Put a +1/+1 counter on target creature you control.")!;
    const s = session([seat("a", [bear("small", { power: "1", toughness: "1" }), bear("big", { power: "4", toughness: "4" })]), seat("b", [bear("foe")])]);
    const source = real("Heliod, Sun-Crowned", "he");
    const auto = applyTargetedEffect(s, "a", source, effect);
    expect(auto.seats[0].board.battlefield.find((c) => c.id === "big")!.counters?.[0].count).toBe(1);
    const illegal = applyTargetedEffect(s, "a", source, effect, { kind: "card", seatId: "b", cardId: "foe" });
    expect(illegal.seats[1].board.battlefield[0].counters).toBeUndefined();
  });
});

describe("reanimation abilities let the human pick the card", () => {
  it("Whip of Erebos and Cauldron of Essence parse, and the chosen graveyard card is the one that returns", () => {
    const whip = real("Whip of Erebos", "wh");
    const ability = parseGenericTapAbilities(whip.oracleText).find((entry) => entry.effect.kind === "zone_effect")!;
    expect(ability).toBeTruthy();
    expect(parseGenericSacrificeAbilities(real("Cauldron of Essence", "ce").oracleText).some((entry) => entry.effect.kind === "zone_effect")).toBe(true);
    const mine = seat("a", [whip]);
    mine.board.graveyard = [bear("big", { zone: "graveyard" as const, manaValue: 7 }), bear("small", { zone: "graveyard" as const, manaValue: 1 })];
    const effect = (ability.effect as { effect: Parameters<typeof applyZoneEffect>[3] }).effect;
    const after = applyZoneEffect(session([mine, seat("b", [])]), "a", "Whip of Erebos", effect, undefined, { kind: "card", seatId: "a", cardId: "small" });
    expect(after.seats[0].board.battlefield.map((c) => c.id)).toContain("small");
    expect(after.seats[0].board.battlefield.map((c) => c.id)).not.toContain("big");
  });
});

describe("Dragon Tempest", () => {
  it("each clause fires for the right creatures: fliers gain haste, Dragons deal X damage you aim", () => {
    const tempest = real("Dragon Tempest", "dt");
    const dragon = real("Goldlust Triad", "dr", { summoningSick: true });
    const angel = real("Serra Angel", "an", { summoningSick: true });
    const bears = bear("gb", { summoningSick: true });
    const s = session([seat("a", [tempest, dragon, angel, bears], { kind: "human" }), seat("b", [bear("foe")])]);
    expect(findCommonTriggersForPermanentEntered(s, "a", dragon).map((t) => t.effect.kind).sort()).toEqual(["context_gains_keywords", "damage_effect"]);
    expect(findCommonTriggersForPermanentEntered(s, "a", angel).map((t) => t.effect.kind)).toEqual(["context_gains_keywords"]);
    expect(findCommonTriggersForPermanentEntered(s, "a", bears)).toHaveLength(0);
    const haste = findCommonTriggersForPermanentEntered(s, "a", angel)[0];
    const after = resolveTriggerEffect(s, haste).seats[0].board.battlefield.find((c) => c.id === "an")!;
    expect(after.grantedKeywords).toContain("haste");
    const damage = findCommonTriggersForPermanentEntered(s, "a", dragon).find((t) => t.effect.kind === "damage_effect")!;
    const aimed = resolveTriggerEffect(s, { ...damage, effect: { ...damage.effect, chosenOption: "p:b" } as never });
    expect(aimed.seats[1].life).toBe(39);
  });
});

describe("Orb of Dragonkind and Syphon Flesh arithmetic", () => {
  it("an Orb plus three lands cannot cast the six-mana Lathliss (the Orb is a one-mana discount, not two free mana on top of it)", () => {
    const lathliss = real("Lathliss, Dragon Queen", "lq", { zone: "command" as const });
    const lands = ["m1", "m2", "m3"].map((id) => real("Mountain", id));
    const mine = seat("a", [real("Orb of Dragonkind", "orb"), ...lands]);
    mine.board.commander = lathliss;
    const s = session([mine, seat("b", [])]);
    expect(adjustedCastingCost(mine, lathliss, 6, "command", "a", s.seats)).toBe(5);
    expect(legalMainPhaseActions(mine, true, "a", 1, new Set(), s).some((a) => a.id.startsWith("cast-commander"))).toBe(false);
    const five = seat("a", [real("Orb of Dragonkind", "orb"), ...["m1", "m2", "m3", "m4", "m5"].map((id) => real("Mountain", id))]);
    five.board.commander = lathliss;
    expect(legalMainPhaseActions(five, true, "a", 1, new Set(), session([five, seat("b", [])])).some((a) => a.id.startsWith("cast-commander"))).toBe(true);
  });
  it("Syphon Flesh makes one Zombie per creature actually sacrificed (three opponents, three Zombies)", () => {
    const flesh = real("Syphon Flesh", "sf");
    const s = session([seat("a", []), seat("b", [bear("b1")]), seat("c", [bear("c1")]), seat("d", [bear("d1")])]);
    const effects = parseSpellExtraEffects(etbEffectText(flesh.oracleText));
    const after = effects.reduce((acc, effect) => applySpellExtraEffect(acc, "a", flesh, effect), s);
    expect(after.seats[0].board.battlefield.filter((c) => c.token && c.name.includes("Zombie"))).toHaveLength(3);
  });
});

describe("tokens made by abilities still trigger 'whenever a Zombie enters'", () => {
  it("Ghoulcaller Gisa sacrificing a 5/5 Zombie makes five Zombies, each queued as an entry so Champion of the Perished triggers five times", () => {
    const gisa = real("Ghoulcaller Gisa", "gisa");
    const champ = real("Champion of the Perished", "ch", { power: "1", toughness: "1" });
    const zombie = bear("zt", { name: "Zombie Token", typeLine: "Token Creature — Zombie", power: "5", toughness: "5", token: true });
    const s = session([seat("a", [gisa, champ, zombie, real("Swamp", "sw")]), seat("b", [])]);
    const paid = payGenericSacrificeCost(s, "a", "gisa", 0, undefined)!;
    const after = applySacrificeEffect(paid.session, "a", paid.card, paid.ability.effect, paid.ability.clause, paid.sacrificed);
    expect(after.pendingEntries).toHaveLength(5);
    const triggers = after.pendingEntries!.flatMap((entry) => findCommonTriggersForPermanentEntered(after, entry.seatId, entry.card));
    expect(triggers.filter((t) => t.sourceCardId === "ch")).toHaveLength(5);
  });
});

describe("forced attacks and additional blockers", () => {
  it("a creature that attacks each combat is forced, and a goaded one avoids the goader when it can", () => {
    const firebird = real("Akoum Firebird", "fb", { power: "4", toughness: "3" });
    const mine = seat("a", [firebird, bear("calm")]);
    const s = session([mine, seat("b", []), seat("c", [])]);
    const forced = forcedAttackers(s, s.seats[0]);
    expect(forced.map((f) => f.cardId)).toEqual(["fb"]);
    expect(forced[0].targetIds.sort()).toEqual(["b", "c"]);
    const goadedMine = seat("a", [bear("g1", { goaded: { bySeatId: "b" } } as never)]);
    expect(forcedAttackers(session([goadedMine, seat("b", []), seat("c", [])]), goadedMine)[0].targetIds).toEqual(["c"]);
    expect(forcedAttackers(session([goadedMine, seat("b", [])]), goadedMine)[0].targetIds).toEqual(["b"]);
  });
  it("Foriysian Brigade blocks a second attacker, but only one extra", () => {
    const brigade = real("Foriysian Brigade", "fbr");
    const attackers = ["x1", "x2", "x3"].map((id) => bear(id, { attacking: true }));
    let s = session([seat("a", attackers), seat("b", [brigade])]);
    const choiceFor = (id: string) => ({ attackerSeatId: "a", defenderSeatId: "b", attackerCardId: id } as never);
    s = assignBlockers(s, choiceFor("x1"), ["fbr"]);
    s = assignBlockers(s, choiceFor("x2"), ["fbr"]);
    s = assignBlockers(s, choiceFor("x3"), ["fbr"]);
    const after = s.seats[1].board.battlefield[0];
    expect(after.blockingTargetId).toBe("x1");
    expect(after.extraBlockingTargetId).toBe("x2");
  });
});

describe("initiative and the Undercity", () => {
  const room = (s: GameSession, seatId: string, name: string, option?: string) => {
    const trigger = { id: "t", type: "trigger" as const, actorSeatId: seatId, controllerSeatId: seatId, sourceCardId: "undercity", sourceCardName: "Undercity", triggerKind: "common" as const, effect: { kind: "venture_room", room: name, chosenOption: option } as never, message: "" };
    return resolveTriggerEffect(s, trigger);
  };
  it("'you take the initiative' parses, takes it, and ventures into the Secret Entrance", () => {
    const sneak = real("Aarakocra Sneak", "sn");
    const s = session([seat("a", [sneak]), seat("b", [])]);
    const [trigger] = findCommonTriggersForPermanentEntered(s, "a", sneak);
    expect(trigger.effect.kind).toBe("take_initiative");
    const after = resolveTriggerEffect(s, trigger);
    expect(after.initiativeSeatId).toBe("a");
    expect(after.undercityRooms).toEqual({ a: "secret_entrance" });
    expect(after.pendingVentureRooms).toEqual([{ seatId: "a", room: "secret_entrance" }]);
  });
  it("walks the dungeon: agents pick a branch, humans are asked, and a finished dungeon starts over", () => {
    const agent = ventureIntoUndercity(session([seat("a", []), seat("b", [])]), "a");
    const second = ventureIntoUndercity({ ...agent, pendingVentureRooms: undefined }, "a");
    expect(second.undercityRooms!.a).toBe("forge");
    const human = ventureIntoUndercity({ ...agent, seats: agent.seats.map((x) => (x.id === "a" ? { ...x, kind: "human" as const } : x)), pendingVentureRooms: undefined }, "a");
    expect(human.pendingVentureChoices).toEqual([{ seatId: "a", options: ["forge", "lost_well"] }]);
    const done = ventureIntoUndercity({ ...agent, undercityRooms: { a: "throne" } }, "a");
    expect(done.undercityRooms!.a).toBe("secret_entrance");
  });
  it("room effects: land to hand, counters, treasure, skeleton, trap, goad, card draw, throne", () => {
    const mine = seat("a", [bear("b1", { power: "2", toughness: "2" })]);
    mine.library = [real("Forest", "fo", { zone: "library" as const }), bear("lib", { zone: "library" as const, manaValue: 3 })];
    mine.zones = { ...mine.zones, library: 2 };
    const theirs = seat("b", [bear("foe", { power: "5", toughness: "5" })]);
    const s = session([mine, theirs]);
    expect(room(s, "a", "secret_entrance").seats[0].board.hand.map((c) => c.id)).toEqual(["fo"]);
    expect(room(s, "a", "forge").seats[0].board.battlefield[0].counters?.find((c) => c.kind === "+1/+1")?.count).toBe(2);
    expect(room(s, "a", "stash").seats[0].board.battlefield.some((c) => c.name === "Treasure")).toBe(true);
    expect(room(s, "a", "catacombs").seats[0].board.battlefield.some((c) => c.name.includes("Skeleton"))).toBe(true);
    expect(room(s, "a", "trap").seats[1].life).toBe(35);
    expect(room(s, "a", "arena").seats[1].board.battlefield[0].goaded).toEqual({ bySeatId: "a" });
    expect(room(s, "a", "archives").seats[0].board.hand).toHaveLength(1);
    const throne = room(s, "a", "throne").seats[0].board.battlefield.find((c) => c.id === "lib")!;
    expect(throne.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(3);
    expect(throne.grantedKeywords).toContain("hexproof");
  });
});

describe("punisher effects with a human victim", () => {
  it("records the human's repetitions for the picker and still punishes agents automatically", () => {
    const after = applyPunisherChoiceEffect(session([seat("a", []), seat("h", [bear("keep")], { kind: "human" }), seat("o", [], { life: 30 })]), "a", "Torment of Hailfire", { lifeAmount: 3 }, 2);
    expect(after.pendingPunisherChoices).toEqual([{ seatId: "h", sourceName: "Torment of Hailfire", lifeAmount: 3, times: 2 }]);
    expect(after.seats.find((s) => s.id === "h")!.life).toBe(40);
    expect(after.seats.find((s) => s.id === "o")!.life).toBe(24);
  });
});

describe("Leylines begin on the battlefield", () => {
  it("finds the opening-hand cards and puts the chosen one onto the battlefield", () => {
    const leyline = real("Leyline of Abundance", "ley", { zone: "hand" as const });
    const mine = seat("a", []);
    mine.board.hand = [leyline, bear("other", { zone: "hand" as const })];
    mine.zones = { ...mine.zones, hand: 2 };
    expect(openingHandBattlefieldCards(mine).map((c) => c.id)).toEqual(["ley"]);
    const after = putOpeningHandCardOnBattlefield(session([mine]), "a", "ley").seats[0];
    expect(after.board.battlefield.map((c) => c.id)).toEqual(["ley"]);
    expect(after.board.hand.map((c) => c.id)).toEqual(["other"]);
  });
});

describe("renown (real Oracle text)", () => {
  it("grows once, then never again", () => {
    const knight = real("Citadel Castellan", "cc", { power: "2", toughness: "2" });
    const s = session([seat("a", [knight]), seat("b", [])]);
    const first = findCombatDamageToPlayerTriggers(s, "a", knight, "b").filter((t) => t.effect.kind === "renown");
    expect(first).toHaveLength(1);
    const after = resolveTriggerEffect(s, first[0]);
    const grown = after.seats[0].board.battlefield[0];
    expect(grown.renowned).toBe(true);
    expect(grown.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(2);
    expect(findCombatDamageToPlayerTriggers(after, "a", grown, "b").filter((t) => t.effect.kind === "renown")).toHaveLength(0);
  });
});

describe("vanishing and fading (real Oracle text)", () => {
  it("fading 3 survives three upkeeps and is sacrificed on the fourth; vanishing 4 is gone on its fourth upkeep", () => {
    const run = (name: string, upkeeps: number) => {
      let s = session([seat("a", [real(name, "x")]), seat("b", [])]);
      for (let i = 0; i < upkeeps; i += 1) {
        const card = s.seats[0].board.battlefield.find((c) => c.id === "x");
        if (!card) break;
        s = applyDeterministicPhaseTrigger(s, "a", card, "upkeep step") ?? s;
      }
      return s.seats[0].board.battlefield.some((c) => c.id === "x");
    };
    expect(run("Blastoderm", 3)).toBe(true);
    expect(run("Blastoderm", 4)).toBe(false);
    expect(run("Calciderm", 3)).toBe(true);
    expect(run("Calciderm", 4)).toBe(false);
  });
});

describe("human choices for Wretched Ranks cards (pure halves)", () => {
  it("Necrotic Hex defers the human's sacrifice (when they have a choice) and still makes the agent sacrifice", () => {
    const hex = real("Necrotic Hex", "hex");
    const eight = (prefix: string) => Array.from({ length: 8 }, (_, i) => bear(prefix + i));
    const s = session([seat("a", eight("h"), { kind: "human" }), seat("b", eight("o"))]);
    const after = parseSpellExtraEffects(etbEffectText(hex.oracleText)).reduce((acc, effect) => applySpellExtraEffect(acc, "a", hex, effect), s);
    expect(after.pendingSacrificeChoices).toEqual([{ seatId: "a", sourceCardId: "hex", sourceCardName: "Necrotic Hex", count: 6 }]);
    expect(after.seats[0].board.battlefield.filter((c) => !c.token)).toHaveLength(8);
    expect(after.seats[1].board.battlefield.filter((c) => !c.token)).toHaveLength(2);
  });
  it("Cemetery Reaper and Zul Ashur use the card the human chose", () => {
    const mine = seat("a", [], { kind: "human" });
    mine.board.graveyard = [bear("z1", { zone: "graveyard" as const, typeLine: "Creature — Zombie", manaValue: 1 }), bear("z2", { zone: "graveyard" as const, typeLine: "Creature — Zombie", manaValue: 6 })];
    const theirs = seat("b", []);
    theirs.board.graveyard = [bear("big", { zone: "graveyard" as const, manaValue: 7 }), bear("pick", { zone: "graveyard" as const, manaValue: 1 })];
    const reaper = real("Cemetery Reaper", "cr");
    const reaperAbility = parseGenericTapAbilities(reaper.oracleText).find((a) => a.effect.kind === "exile_graveyard_creature_then_tokens")!;
    const after = applyGenericTapEffect(session([mine, theirs]), "a", "cr", "Cemetery Reaper", reaperAbility.effect, reaperAbility.clause, "pick");
    expect(after.seats[1].board.graveyard!.map((c) => c.id)).toEqual(["big"]);
    const zul = real("Zul Ashur, Lich Lord", "zu");
    const zulAbility = parseGenericTapAbilities(zul.oracleText).find((a) => a.effect.kind === "grant_graveyard_cast")!;
    const granted = applyGenericTapEffect(session([mine, theirs]), "a", "zu", "Zul Ashur", zulAbility.effect, zulAbility.clause, "z1");
    expect(granted.seats[0].board.graveyard!.find((c) => c.id === "z1")!.graveyardCastGrant).toBeTruthy();
    expect(granted.seats[0].board.graveyard!.find((c) => c.id === "z2")!.graveyardCastGrant).toBeUndefined();
  });
  it("Geier Reach Sanitarium leaves the human's own discard to them", () => {
    const geier = real("Geier Reach Sanitarium", "gr");
    const ability = parseGenericTapAbilities(geier.oracleText).find((a) => a.effect.kind === "each_player_loots")!;
    const mine = seat("a", [], { kind: "human" });
    mine.board.hand = [bear("h1", { zone: "hand" as const })];
    mine.library = [bear("l0", { zone: "library" as const })];
    mine.zones = { ...mine.zones, hand: 1, library: 1 };
    const after = applyGenericTapEffect(session([mine, seat("b", [])]), "a", "gr", "Geier Reach Sanitarium", ability.effect, ability.clause, undefined, { skipDiscardSeatId: "a" });
    expect(after.seats[0].board.hand).toHaveLength(2);
    expect(after.seats[0].board.graveyard ?? []).toHaveLength(0);
  });
  it("God-Eternal Bontu sacrifices exactly the permanents the human picked (not just lands) and draws that many", () => {
    const bontu = real("God-Eternal Bontu", "gb");
    const mine = seat("a", [bontu, real("Swamp", "s1"), real("Sol Ring", "sr"), bear("keep")], { kind: "human" });
    mine.library = ["l0", "l1", "l2"].map((id) => bear(id, { zone: "library" as const }));
    mine.zones = { ...mine.zones, library: 3 };
    const s = session([mine]);
    const [trigger] = findCommonTriggersForPermanentEntered(s, "a", bontu);
    const after = resolveTriggerEffect(s, { ...trigger, effect: { ...trigger.effect, chosenOption: "sr,keep" } as never }).seats[0];
    expect(after.board.battlefield.map((c) => c.id).sort()).toEqual(["gb", "s1"]);
    expect(after.board.hand).toHaveLength(2);
  });
  it("Triggered damage goes where the human aimed it (a chosen player, not the heuristic's creature)", () => {
    const t = { id: "t", type: "trigger" as const, actorSeatId: "a", controllerSeatId: "a", sourceCardId: "src", sourceCardName: "Src", triggerKind: "common" as const, effect: { kind: "damage_effect", effect: { kind: "damage", amount: 3, targetType: "any" }, chosenOption: "p:b" } as never, message: "" };
    const s = session([seat("a", [], { kind: "human" }), seat("b", [bear("victim", { power: "2", toughness: "2" })])]);
    const after = resolveTriggerEffect(s, t);
    expect(after.seats[1].life).toBe(37);
    expect(after.seats[1].board.battlefield.map((c) => c.id)).toEqual(["victim"]);
  });
  it("Bojuka Bog exiles the graveyard of the player the human picked", () => {
    const bog = real("Bojuka Bog", "bog");
    const effect = parseZoneEffect(etbEffectText(bog.oracleText))!;
    expect(zoneEffectTargetSpec(effect)?.zone).toBe("player");
    const a = seat("a", []);
    a.board.graveyard = [bear("mine", { zone: "graveyard" as const })];
    const b = seat("b", []);
    b.board.graveyard = [bear("theirs1", { zone: "graveyard" as const }), bear("theirs2", { zone: "graveyard" as const })];
    const after = applyZoneEffect(session([a, b]), "a", "Bojuka Bog", effect, undefined, { kind: "player", seatId: "a" });
    expect(after.seats[0].board.graveyard ?? []).toHaveLength(0);
    expect(after.seats[1].board.graveyard).toHaveLength(2);
  });
  it("Oversold Cemetery asks a human (with the 'you may') only once the four-creature condition holds", () => {
    const cemetery = real("Oversold Cemetery", "oc");
    const mine = seat("a", [cemetery], { kind: "human" });
    mine.board.graveyard = [1, 2, 3].map((n) => bear("g" + n, { zone: "graveyard" as const }));
    expect(humanPhaseGraveyardChoice(session([mine]), "a", cemetery, "upkeep step")).toBe("skip");
    mine.board.graveyard.push(bear("g4", { zone: "graveyard" as const }));
    const choice = humanPhaseGraveyardChoice(session([mine]), "a", cemetery, "upkeep step");
    expect(choice).toMatchObject({ optional: true });
  });
});

describe("Metallic Mimic", () => {
  it("gives an additional +1/+1 counter to entering creatures of the chosen type only", () => {
    const mimic = real("Metallic Mimic", "mm", { chosenCreatureType: "Dragon" });
    const dragon = real("Goldlust Triad", "tri");
    const mine = seat("a", [mimic, dragon, bear("other")]);
    const s = session([mine, seat("b", [])]);
    const withCounter = applyEntersWithCounterReplacements(s, "a", "tri").seats[0].board.battlefield.find((c) => c.id === "tri")!;
    expect(withCounter.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(1);
    const plain = applyEntersWithCounterReplacements(s, "a", "other").seats[0].board.battlefield.find((c) => c.id === "other")!;
    expect(plain.counters?.find((c) => c.kind === "+1/+1")?.count ?? 0).toBe(0);
  });
});

describe("Cursed Mirror", () => {
  it("enters as a copy of the strongest creature with haste, and turns back into the artifact at end of turn", () => {
    const mirror = real("Cursed Mirror", "cm", { zone: "hand" as const });
    const mine = seat("a", [real("Mountain", "m1"), real("Mountain", "m2"), real("Mountain", "m3")]);
    mine.board.hand = [mirror];
    mine.zones = { ...mine.zones, hand: 1 };
    const theirs = seat("b", [bear("small", { power: "1", toughness: "1" }), real("Goldlust Triad", "tri", { power: "4", toughness: "4" })]);
    const s = session([mine, theirs]);
    const cast = playCardFromZone(s, "a", "cm", "cast", undefined, "battlefield", ["m1", "m2", "m3"], "hand");
    const copy = cast.seats[0].board.battlefield.find((c) => c.id === "cm")!;
    expect(copy.name).toBe("Goldlust Triad");
    expect(copy.grantedKeywords).toContain("haste");
    const pickedSmall = { ...mirror, chosenCopyTargetId: "small" };
    const mine2 = { ...mine, board: { ...mine.board, hand: [pickedSmall] } };
    const chosen = playCardFromZone(session([mine2, theirs]), "a", "cm", "cast", undefined, "battlefield", ["m1", "m2", "m3"], "hand").seats[0].board.battlefield.find((c) => c.id === "cm")!;
    expect(chosen.name).not.toBe("Goldlust Triad");
    const declined = playCardFromZone(session([{ ...mine, board: { ...mine.board, hand: [{ ...mirror, chosenCopyTargetId: "none" }] } }, theirs]), "a", "cm", "cast", undefined, "battlefield", ["m1", "m2", "m3"], "hand").seats[0].board.battlefield.find((c) => c.id === "cm")!;
    expect(declined.name).toBe("Cursed Mirror");
    const reverted = clearTemporaryBuffs(cast).seats[0].board.battlefield.find((c) => c.id === "cm")!;
    expect(reverted.name).toBe("Cursed Mirror");
    expect(reverted.typeLine).toContain("Artifact");
    expect(reverted.temporaryCopyOriginal).toBeUndefined();
    expect(reverted.grantedKeywords ?? []).not.toContain("haste");
  });
});

describe("Thundermane Dragon casts from the top of the library", () => {
  it("offers a power-4+ creature on top (not a small one), casts it onto the battlefield with haste and takes it off the library", () => {
    const dragon = real("Thundermane Dragon", "td");
    const mk = (topCard: VisibleCard) => {
      const mine = seat("a", [dragon, ...Array.from({ length: 5 }, (_, i) => real("Mountain", `m${i}`))]);
      mine.library = [topCard, bear("next", { zone: "library" as const })];
      mine.zones = { ...mine.zones, library: 2 };
      return session([mine, seat("b", [])]);
    };
    const big = mk(real("Goldlust Triad", "tri", { zone: "library" as const }));
    const offered = legalMainPhaseActions(big.seats[0], true, "a", 1, new Set(), big).find((a) => a.id === "cast-library:tri");
    expect(offered).toBeTruthy();
    const small = mk(bear("tiny", { zone: "library" as const, power: "2", toughness: "2" }));
    expect(legalMainPhaseActions(small.seats[0], true, "a", 1, new Set(), small).some((a) => a.id.startsWith("cast-library"))).toBe(false);
    const cast = playCardFromZone(big, "a", "tri", "cast", undefined, "battlefield", big.seats[0].board.battlefield.filter((c) => c.typeLine.includes("Land")).slice(0, 5).map((c) => c.id), "library");
    const after = cast.seats[0];
    const triad = after.board.battlefield.find((c) => c.id === "tri")!;
    expect(triad).toBeTruthy();
    expect(triad.grantedKeywords).toContain("haste");
    expect(after.library!.map((c) => c.id)).toEqual(["next"]);
    expect(after.zones.library).toBe(1);
  });
});

describe("The Elder Dragon War chapters", () => {
  it("chapter I hits every creature AND each opponent; chapter II discards what the human picked and draws that many; chapter III is a 4/4 Dragon", () => {
    const war = real("The Elder Dragon War", "edw");
    const chapters = parseSagaChapters(war.oracleText)!;
    expect(chapters.chapterCount).toBe(3);
    const one = parseRemovalEffect(chapters.effectByChapter.get(1)!)!;
    expect(one).toMatchObject({ kind: "mass_damage", amount: 2, includePlayers: "opponents" });
    const mine = seat("a", [war, bear("mine", { power: "2", toughness: "2" })]);
    const theirs = seat("b", [bear("theirs", { power: "2", toughness: "2" })]);
    const hit = applyRemovalEffect(session([mine, theirs]), "a", "The Elder Dragon War", war, one);
    expect(hit.seats[1].life).toBe(38);
    expect(hit.seats[0].life).toBe(40);
    const two = commonTriggerEffect(chapters.effectByChapter.get(2)!, "clause")!;
    expect(two.kind).toBe("discard_any_then_draw");
    const hand = seat("a", []);
    hand.board.hand = [bear("h1", { zone: "hand" as const }), bear("h2", { zone: "hand" as const }), bear("h3", { zone: "hand" as const })];
    hand.library = ["l0", "l1", "l2"].map((id) => bear(id, { zone: "library" as const }));
    hand.zones = { ...hand.zones, hand: 3, library: 3 };
    const t = { id: "t", type: "trigger" as const, actorSeatId: "a", controllerSeatId: "a", sourceCardId: "edw", sourceCardName: "The Elder Dragon War", triggerKind: "common" as const, effect: { ...two, chosenOption: "h1,h3" } as never, message: "" };
    const after = resolveTriggerEffect(session([hand]), t).seats[0];
    expect(after.board.graveyard!.map((c) => c.id).sort()).toEqual(["h1", "h3"]);
    expect(after.board.hand.map((c) => c.id).sort()).toEqual(["h2", "l0", "l1"]);
    expect(commonTriggerEffect(chapters.effectByChapter.get(3)!, "clause")!.kind).toBe("create_tokens");
  });
});

describe("Dragonhawk, Fate's Tempest", () => {
  it("on enter and on attack exiles one card per power-4 creature, and burns for the unplayed ones at end step", () => {
    const hawk = real("Dragonhawk, Fate's Tempest", "hw", { power: "5", toughness: "5", attacking: true });
    const mine = seat("a", [hawk, bear("big", { power: "4", toughness: "4" }), bear("small")]);
    mine.library = ["l0", "l1", "l2", "l3"].map((id) => bear(id, { zone: "library" as const }));
    mine.zones = { ...mine.zones, library: 4 };
    const s = session([mine, seat("b", [])]);
    const entered = findCommonTriggersForPermanentEntered(s, "a", hawk).find((t) => t.sourceCardId === "hw")!;
    expect(entered.effect.kind).toBe("exile_top_by_power_then_damage");
    const attacked = findAttackTriggers(s, { seatId: "a", card: hawk, defendingSeatId: "b" });
    expect(attacked.unparsed).toHaveLength(0);
    expect(attacked.triggers.some((t) => t.effect.kind === "exile_top_by_power_then_damage")).toBe(true);
    const after = resolveTriggerEffect(s, entered);
    expect(after.seats[0].board.exile!.map((c) => c.id)).toEqual(["l0", "l1"]);
    expect(after.seats[0].board.exile![0].exiledPlayableBySeatId).toBe("a");
    expect(after.seats[0].library).toHaveLength(2);
    const burned = resolveEndStepExileDamage(after, "a");
    expect(burned.seats[1].life).toBe(36);
    expect(resolveEndStepExileDamage(burned, "a").seats[1].life).toBe(36);
  });
});

describe("Goldlust Triad myriad", () => {
  it("copies itself tapped and attacking each other opponent, and the copies leave at end of combat", () => {
    const triad = real("Goldlust Triad", "tr", { attacking: true, attackTargetId: "b", power: "3", toughness: "3" });
    const s = session([seat("a", [triad]), seat("b", []), seat("c", []), seat("d", [])]);
    const found = findAttackTriggers(s, { seatId: "a", card: triad, defendingSeatId: "b" });
    expect(found.unparsed).toHaveLength(0);
    const myriad = found.triggers.find((t) => t.effect.kind === "myriad")!;
    expect(myriad).toBeTruthy();
    const after = resolveTriggerEffect(s, myriad).seats[0].board.battlefield;
    const copies = after.filter((c) => c.token);
    expect(copies.map((c) => c.attackTargetId).sort()).toEqual(["c", "d"]);
    expect(copies.every((c) => c.attacking && c.tapped)).toBe(true);
    const cleared = cleanupCombat(resolveTriggerEffect(s, myriad), "a").seats[0].board.battlefield;
    expect(cleared.map((c) => c.id)).toEqual(["tr"]);
  });
});

describe("Nogi and Minion of the Mighty attack triggers", () => {
  it("Nogi becomes a 5/5 flying Dragon only with three Dragons, and it ends with the turn", () => {
    const nogi = real("Nogi, Draco-Zealot", "no", { attacking: true, power: "3", toughness: "3" });
    const dragons = ["d1", "d2", "d3"].map((id) => real("Goldlust Triad", id));
    const withDragons = session([seat("a", [nogi, ...dragons]), seat("b", [])]);
    const t = findAttackTriggers(withDragons, { seatId: "a", card: nogi, defendingSeatId: "b" }).triggers.find((x) => x.sourceCardId === "no")!;
    expect(t.effect.kind).toBe("self_becomes_dragon");
    const after = resolveTriggerEffect(withDragons, t).seats[0].board.battlefield.find((c) => c.id === "no")!;
    expect(after.typeLine).toContain("Dragon");
    expect(after.temporaryBasePower).toBe(5);
    expect(after.grantedKeywords).toContain("flying");
    const few = session([seat("a", [nogi, dragons[0]]), seat("b", [])]);
    const t2 = findAttackTriggers(few, { seatId: "a", card: nogi, defendingSeatId: "b" }).triggers.find((x) => x.sourceCardId === "no")!;
    expect(resolveTriggerEffect(few, t2).seats[0].board.battlefield.find((c) => c.id === "no")!.typeLine).not.toContain("Dragon");
  });
  it("Minion of the Mighty puts a Dragon from hand in attacking only when attackers have 6+ power", () => {
    const minion = real("Minion of the Mighty", "mm", { attacking: true, attackTargetId: "b", power: "1", toughness: "1" });
    const big = bear("big", { attacking: true, power: "5", toughness: "5" });
    const mine = seat("a", [minion, big]);
    mine.board.hand = [real("Goldlust Triad", "tri", { zone: "hand" as const, power: "4", toughness: "4" })];
    mine.zones = { ...mine.zones, hand: 1 };
    const s = session([mine, seat("b", [])]);
    const t = findAttackTriggers(s, { seatId: "a", card: minion, defendingSeatId: "b" }).triggers.find((x) => x.sourceCardId === "mm")!;
    expect(t.effect.kind).toBe("dragon_from_hand_attacking");
    const after = resolveTriggerEffect(s, t).seats[0];
    const tri = after.board.battlefield.find((c) => c.id === "tri")!;
    expect(tri.attacking).toBe(true);
    expect(tri.tapped).toBe(true);
    expect(tri.attackTargetId).toBe("b");
    const weak = seat("a", [minion, bear("sm", { attacking: true, power: "2", toughness: "2" })]);
    weak.board.hand = mine.board.hand;
    const s2 = session([weak, seat("b", [])]);
    const t2 = findAttackTriggers(s2, { seatId: "a", card: minion, defendingSeatId: "b" }).triggers.find((x) => x.sourceCardId === "mm")!;
    expect(resolveTriggerEffect(s2, t2).seats[0].board.hand).toHaveLength(1);
  });
});

describe("Emeria Shepherd landfall", () => {
  it("returns a nonland permanent card to hand, or to the battlefield when the land is a Plains", () => {
    const emeria = real("Emeria Shepherd", "em");
    const mk = (landName: string) => {
      const land = real(landName, "ld");
      const mine = seat("a", [emeria, land]);
      mine.board.graveyard = [bear("gy1", { zone: "graveyard" as const, manaValue: 2 }), bear("gy2", { zone: "graveyard" as const, manaValue: 5 }), real("Forest", "gl", { zone: "graveyard" as const })];
      mine.zones = { ...mine.zones, graveyard: 3 };
      const s = session([mine, seat("b", [])]);
      const [t] = findCommonTriggersForPermanentEntered(s, "a", land);
      return { s, t };
    };
    const plains = mk("Plains");
    expect(plains.t.effect.kind).toBe("landfall_return_nonland_permanent");
    const onField = resolveTriggerEffect(plains.s, plains.t).seats[0];
    expect(onField.board.battlefield.map((c) => c.id)).toContain("gy2");
    const forest = mk("Forest");
    const toHand = resolveTriggerEffect(forest.s, { ...forest.t, effect: { ...forest.t.effect, chosenOption: "gy1" } as never }).seats[0];
    expect(toHand.board.hand.map((c) => c.id)).toEqual(["gy1"]);
  });
});

describe("Angelic Sleuth", () => {
  it("investigates only when another permanent that had counters leaves", () => {
    const sleuth = real("Angelic Sleuth", "sl");
    const s = session([seat("a", [sleuth]), seat("b", [])]);
    const counted = bear("c1", { counters: [{ kind: "+1/+1", count: 2 }] } as never);
    expect(findLeavesBattlefieldTriggers(s, "a", counted).map((t) => t.effect.kind)).toEqual(["create_tokens"]);
    expect(findLeavesBattlefieldTriggers(s, "a", bear("c2"))).toHaveLength(0);
    expect(findLeavesBattlefieldTriggers(s, "a", { ...sleuth, counters: [{ kind: "+1/+1", count: 1 }] } as never)).toHaveLength(0);
  });
});

describe("Angel of the Ruins and Grasp of Fate exile", () => {
  it("Angel exiles up to two artifacts/enchantments (the human's picks, never a land)", () => {
    const angel = real("Angel of the Ruins", "an");
    const theirs = seat("b", [real("Sol Ring", "sr"), real("Mind Stone", "ms"), real("Plains", "pl")]);
    const s = session([seat("a", [angel]), theirs]);
    const [t] = findCommonTriggersForPermanentEntered(s, "a", angel);
    expect(t.effect.kind).toBe("exile_up_to_artifacts_enchantments");
    const after = resolveTriggerEffect(s, { ...t, effect: { ...t.effect, chosenOption: "ms" } as never });
    expect(after.seats[1].board.battlefield.map((c) => c.id)).toEqual(["sr", "pl"]);
    const auto = resolveTriggerEffect(s, t);
    expect(auto.seats[1].board.battlefield.map((c) => c.id)).toEqual(["pl"]);
  });
  it("Grasp exiles one nonland permanent per opponent, and they return when it leaves", () => {
    const grasp = real("Grasp of Fate", "gr");
    const bigB = bear("bb", { manaValue: 5 });
    const s = session([seat("a", [grasp]), seat("b", [real("Plains", "pl"), bigB, bear("small")]), seat("c", [bear("cc", { manaValue: 2 })])]);
    const [t] = findCommonTriggersForPermanentEntered(s, "a", grasp);
    expect(t.effect.kind).toBe("exile_until_leaves_each_opponent");
    const after = resolveTriggerEffect(s, t);
    expect(after.seats[1].board.exile!.map((c) => c.id)).toEqual(["bb"]);
    expect(after.seats[2].board.exile!.map((c) => c.id)).toEqual(["cc"]);
    expect(runStateBasedActionsPass(after).session.seats[1].board.exile ?? []).toHaveLength(1);
    const gone = { ...after, seats: after.seats.map((x) => (x.id === "a" ? { ...x, board: { ...x.board, battlefield: [] } } : x)) };
    const back = runStateBasedActionsPass(gone).session;
    expect(back.seats[1].board.battlefield.map((c) => c.id)).toContain("bb");
    expect(back.seats[2].board.battlefield.map((c) => c.id)).toContain("cc");
    expect(back.seats[1].board.exile ?? []).toHaveLength(0);
  });
});

describe("Spit Flame returns from the graveyard", () => {
  it("a Dragon entering lets you pay {R} to return it to hand", () => {
    const spit = real("Spit Flame", "sf", { zone: "graveyard" as const });
    const dragon = real("Goldlust Triad", "dr");
    const mine = seat("a", [real("Mountain", "m"), dragon]);
    mine.board.graveyard = [spit];
    mine.zones = { ...mine.zones, graveyard: 1 };
    const s = session([mine, seat("b", [])]);
    const triggers = findCommonTriggersForPermanentEntered(s, "a", dragon);
    const t = triggers.find((x) => x.sourceCardId === "sf")!;
    expect(t).toBeTruthy();
    const after = resolveTriggerEffect(s, t).seats[0];
    expect(after.board.hand.map((c) => c.id)).toEqual(["sf"]);
    expect(after.board.graveyard).toHaveLength(0);
    expect(after.board.battlefield.find((c) => c.id === "m")!.tapped).toBe(true);
    expect(findCommonTriggersForPermanentEntered(s, "a", bear("zz")).find((x) => x.sourceCardId === "sf")).toBeUndefined();
  });
});

describe("Anger in the graveyard", () => {
  it("gives your creatures haste only while it is in the graveyard and you control a Mountain", () => {
    const anger = real("Anger", "ang", { zone: "graveyard" as const });
    const withMountain = seat("a", [real("Mountain", "m"), bear("b1")]);
    withMountain.board.graveyard = [anger];
    const on = runStateBasedActionsPass(session([withMountain, seat("b", [])])).session.seats[0].board.battlefield.find((c) => c.id === "b1")!;
    expect(on.grantedKeywords).toContain("haste");
    const noMountain = seat("a", [real("Forest", "f"), bear("b1")]);
    noMountain.board.graveyard = [anger];
    const off = runStateBasedActionsPass(session([noMountain, seat("b", [])])).session.seats[0].board.battlefield.find((c) => c.id === "b1")!;
    expect(off.grantedKeywords ?? []).not.toContain("haste");
  });
});

describe("Rhonas the Indomitable pump", () => {
  it("gives ANOTHER creature +2/+0 and trample, never itself", () => {
    const rhonas = real("Rhonas the Indomitable", "rh", { power: "5", toughness: "5" });
    const abilities = parseGenericManaAbilities(rhonas.oracleText);
    const effect = parseGenericAbilityEffect(abilities.find((a) => /another target creature/i.test(a.effectText))!.effectText)!;
    expect(effect.kind).toBe("pump");
    const mine = seat("a", [rhonas, bear("b1")]);
    const after = applyGenericAbilityEffect(session([mine, seat("b", [])]), "a", rhonas, effect).seats[0].board.battlefield;
    const bearAfter = after.find((c) => c.id === "b1")!;
    expect(bearAfter.temporaryPowerBonus).toBe(2);
    expect(bearAfter.grantedKeywords).toContain("trample");
    expect(after.find((c) => c.id === "rh")!.temporaryPowerBonus ?? 0).toBe(0);
  });
});

describe("Loot, Exuberant Explorer dig", () => {
  it("parses its tap ability and puts the picked creature (mana value within land count) onto the battlefield", () => {
    const loot = real("Loot, Exuberant Explorer", "loot");
    const abilities = parseGenericTapAbilities(loot.oracleText);
    expect(abilities.some((a) => a.effect.kind === "dig_creature_to_battlefield")).toBe(true);
    const mine = seat("a", [loot, real("Forest", "f1"), real("Forest", "f2"), real("Forest", "f3")]);
    mine.library = [bear("big", { zone: "library" as const, manaValue: 9 }), bear("ok", { zone: "library" as const, manaValue: 3 }), bear("z", { zone: "library" as const })];
    mine.zones = { ...mine.zones, library: 3 };
    const after = applyDigToBattlefield(session([mine]), "a", "Loot", 6, 4, "ok").seats[0];
    expect(after.board.battlefield.map((c) => c.id)).toContain("ok");
    expect(after.library!.map((c) => c.id)).not.toContain("ok");
    expect(applyDigToBattlefield(session([mine]), "a", "Loot", 6, 4, "big").seats[0].board.battlefield.map((c) => c.id)).not.toContain("big");
  });
});

describe("cast modal spells offer their modes to the human (pure half)", () => {
  it("Austere Command: two modes to choose, labelled; the chosen pair is what gets applied", () => {
    const spell = real("Austere Command", "spell");
    const art = (id: string) => bear(id, { typeLine: "Artifact", role: "permanent", manaValue: 2 });
    const s = session([seat("a", [art("mine")]), seat("b", [art("theirs"), bear("big", { manaValue: 6, power: "6", toughness: "6" })])]);
    const prompt = spellModePrompt(s, "a", spell)!;
    expect(prompt.chooseCount).toBe(2);
    expect(prompt.labels.length).toBeGreaterThanOrEqual(3);
    const creatureMode = prompt.removalModes!.findIndex((m) => m.kind === "destroy_all_conditional" && m.comparison === "or_greater");
    const artifactMode = prompt.removalModes!.findIndex((m) => m.kind === "destroy_all" && m.targetType === "artifact");
    const modes = [prompt.removalModes![creatureMode], prompt.removalModes![artifactMode]];
    const after = applyRemovalEffect(s, "a", "Austere Command", spell, { kind: "modal", chooseCount: 2, modes });
    expect(after.seats[1].board.battlefield).toHaveLength(0);
    expect(after.seats[0].board.battlefield).toHaveLength(0);
  });
  it("Valorous Stance with a legal destroy target offers both modes; with nothing to destroy there is nothing to choose", () => {
    const spell = real("Valorous Stance", "spell");
    const big = session([seat("a", [bear("mine")]), seat("b", [bear("big", { power: "5", toughness: "5" })])]);
    const prompt = spellModePrompt(big, "a", spell)!;
    expect(prompt.chooseCount).toBe(1);
    expect(prompt.labels).toHaveLength(2);
    expect(spellModePrompt(session([seat("a", [bear("mine")]), seat("b", [])]), "a", spell)).toBeUndefined();
  });
  it("a non-modal spell has no mode prompt", () => {
    expect(spellModePrompt(session([seat("a", []), seat("b", [bear("v")])]), "a", real("Lightning Bolt", "spell"))).toBeUndefined();
  });
});

describe("Outpost Siege modes (real Oracle text)", () => {
  const siege = (mode?: string) => real("Outpost Siege", "os", mode ? { chosenMode: mode } : {});
  it("choosing a mode as it enters is recorded on the permanent", () => {
    const card = siege();
    const s = session([seat("a", [card])]);
    const [trigger] = findCommonTriggersForPermanentEntered(s, "a", card);
    expect(trigger.effect).toMatchObject({ kind: "choose_named_mode", options: ["Khans", "Dragons"] });
    const picked = resolveTriggerEffect(s, { ...trigger, effect: { ...trigger.effect, chosenOption: "1" } });
    expect(picked.seats[0].board.battlefield[0].chosenMode).toBe("Dragons");
    expect(resolveTriggerEffect(s, trigger).seats[0].board.battlefield[0].chosenMode).toBe("Khans");
  });
  it("Dragons mode: a creature leaving pings any target; Khans mode: it doesn't", () => {
    const dead = bear("dead");
    const dragons = session([seat("a", [siege("Dragons")]), seat("b", [bear("v", { toughness: "1" })])]);
    const triggers = findCommonTriggersForPermanentDied(dragons, "a", dead);
    expect(triggers.map((t) => t.effect.kind)).toEqual(["damage_effect"]);
    const khans = session([seat("a", [siege("Khans")]), seat("b", [])]);
    expect(findCommonTriggersForPermanentDied(khans, "a", dead)).toHaveLength(0);
  });
  it("Dragons mode doesn't also exile cards at upkeep", () => {
    const mine = seat("a", [siege("Dragons")]);
    mine.library = [bear("top", { zone: "library" as const })];
    mine.zones = { ...mine.zones, library: 1 };
    const after = applyDeterministicPhaseTrigger(session([mine]), "a", siege("Dragons"), "upkeep step");
    expect(after?.seats[0].library?.length ?? 1).toBe(1);
  });
});

describe("cast-time modes and targets (pure halves)", () => {
  const walk = (s: GameSession, card: VisibleCard, picks: Array<(options: Array<{ label: string; mode?: number; target?: ChosenTarget }>) => number>) => {
    const answers: CastChoices = { targets: [] };
    const asked: string[] = [];
    let step = 0;
    for (let guard = 0; guard < 8; guard += 1) {
      const prompt = nextCastPrompt(s, "a", card, undefined, answers);
      if (!prompt) break;
      asked.push(prompt.kind);
      const options = prompt.options as Array<{ label: string; mode?: number; target?: ChosenTarget }>;
      const choice = options[picks[step](options)];
      step += 1;
      if (prompt.kind === "modes") answers.modes = [...(answers.modes ?? []), choice.mode!];
      else answers.targets.push(choice.target!);
    }
    return { answers, asked };
  };
  const label = (re: RegExp) => (options: Array<{ label: string }>) => options.findIndex((o) => re.test(o.label));

  it("Lightning Bolt asks for one target, listing creatures and players", () => {
    const bolt = real("Lightning Bolt", "spell");
    const s = session([seat("a", []), seat("b", [bear("v", { toughness: "3" })])]);
    const { answers, asked } = walk(s, bolt, [label(/Bear v/)]);
    expect(asked).toEqual(["target"]);
    expect(answers.targets).toEqual([{ kind: "card", seatId: "b", cardId: "v" }]);
    const after = applyCastRemoval(s, "a", bolt, parseRemovalEffect(bolt.oracleText)!, undefined, answers);
    expect(after.seats[1].board.battlefield).toHaveLength(0);
  });

  it("Valorous Stance: first the mode, then (for the destroy mode) its target", () => {
    const spell = real("Valorous Stance", "spell");
    const s = session([seat("a", [bear("mine")]), seat("b", [bear("big1", { power: "5", toughness: "5" }), bear("big2", { power: "6", toughness: "6" })])]);
    const { answers, asked } = walk(s, spell, [label(/destroy/i), label(/big2/)]);
    expect(asked).toEqual(["modes", "target"]);
    const after = applyCastRemoval(s, "a", spell, parseRemovalEffect(etbEffectText(spell.oracleText))!, undefined, answers);
    expect(after.seats[1].board.battlefield.map((c) => c.id)).toEqual(["big1"]);
  });

  it("Austere Command: two mode questions and no targets", () => {
    const spell = real("Austere Command", "spell");
    const s = session([seat("a", []), seat("b", [bear("v", { manaValue: 5 })])]);
    const { answers, asked } = walk(s, spell, [(o) => 0, (o) => 0]);
    expect(asked).toEqual(["modes", "modes"]);
    expect(answers.modes).toHaveLength(2);
    expect(answers.targets).toHaveLength(0);
  });

  it("Ram Through: two target questions in order", () => {
    const spell = real("Ram Through", "spell");
    const s = session([seat("a", [bear("small", { power: "2" }), bear("huge", { power: "8" })]), seat("b", [bear("v1"), bear("v2")])]);
    const { answers, asked } = walk(s, spell, [label(/huge/), label(/v2/)]);
    expect(asked).toEqual(["target", "target"]);
    expect(answers.targets.map((t) => (t.kind === "card" ? t.cardId : ""))).toEqual(["huge", "v2"]);
  });

  it("a target that became illegal by resolution fizzles, and a creature spell with no spell effect asks nothing", () => {
    const bolt = real("Lightning Bolt", "spell");
    const s = session([seat("a", []), seat("b", [bear("v")])]);
    const gone: CastChoices = { targets: [{ kind: "card", seatId: "b", cardId: "nope" }] };
    expect(applyCastRemoval(s, "a", bolt, parseRemovalEffect(bolt.oracleText)!, undefined, gone).seats[1].board.battlefield).toHaveLength(1);
    expect(nextCastPrompt(s, "a", real("Elder Gargaroth", "c"), undefined, { targets: [] })).toBeUndefined();
  });
});

describe("Sephara's alternative cost (real Oracle text)", () => {
  const flyer = (id: string, extra: Partial<VisibleCard> = {}) => bear(id, { oracleText: "Flying", ...extra });
  it("is available only with four untapped flyers, and taps the weakest ones", () => {
    const sephara = real("Sephara, Sky's Blade", "seph");
    const four = seat("a", [flyer("f1", { power: "1" }), flyer("f2", { power: "5" }), flyer("f3", { power: "2" }), flyer("f4", { power: "3" }), flyer("f5", { power: "9" })]);
    const alt = tapCreaturesAltCostFor(four, sephara)!;
    expect(alt).toMatchObject({ costManaText: "{W}", count: 4 });
    expect(alt.creatureIds.slice(0, 4).sort()).toEqual(["f1", "f3", "f4", "f2"].sort());
    const three = seat("a", [flyer("f1"), flyer("f2"), flyer("f3"), flyer("f4", { tapped: true })]);
    expect(tapCreaturesAltCostFor(three, sephara)).toBeUndefined();
  });
  it("lets an agent with one Plains and four flyers cast it, where the normal {4}{W}{W}{W} is out of reach", () => {
    const sephara = real("Sephara, Sky's Blade", "seph");
    const mine = seat("a", [real("Plains", "p1"), flyer("f1"), flyer("f2"), flyer("f3"), flyer("f4")]);
    mine.board.hand = [sephara];
    const s = session([mine, seat("b", [])]);
    const actions = legalMainPhaseActions(s.seats[0], true, "a", 1, new Set(), s);
    expect(actions.some((action) => action.id === "cast:seph")).toBe(true);
    const poor = seat("a", [real("Plains", "p1"), flyer("f1"), flyer("f2")]);
    poor.board.hand = [sephara];
    const s2 = session([poor, seat("b", [])]);
    expect(legalMainPhaseActions(s2.seats[0], true, "a", 1, new Set(), s2).some((action) => action.id === "cast:seph")).toBe(false);
  });
});

describe("Orb of Dragonkind's mana ability (real Oracle text)", () => {
  it("makes a Dragon spell one cheaper while the Orb is untapped, and does nothing for other spells or when tapped", () => {
    const dragon = bear("dr", { typeLine: "Creature — Dragon", manaCost: "{2}{R}{R}", manaValue: 4, zone: "hand" as const });
    const elf = bear("elf", { typeLine: "Creature — Elf", manaCost: "{2}{G}", manaValue: 3, zone: "hand" as const });
    const withOrb = seat("a", [real("Orb of Dragonkind", "orb")]);
    expect(adjustedCastingCost(withOrb, dragon, 4, "hand", "a", [withOrb])).toBe(3);
    expect(adjustedCastingCost(withOrb, elf, 3, "hand", "a", [withOrb])).toBe(3);
    const tappedOrb = seat("a", [real("Orb of Dragonkind", "orb", { tapped: true })]);
    expect(adjustedCastingCost(tappedOrb, dragon, 4, "hand", "a", [tappedOrb])).toBe(4);
  });
});

describe("Spinerock Knoll (real Oracle text)", () => {
  const setup = (damageToB: number) => {
    const knoll = real("Spinerock Knoll", "sk");
    const mine = seat("a", [knoll, real("Mountain", "m1")]);
    mine.board.exile = [bear("hidden", { zone: "exile" as const, hideawaySourceId: "sk", typeLine: "Sorcery", role: "spell" })];
    const s = session([mine, seat("b", []), seat("c", [])]);
    s.damageThisTurn = { turn: s.turn, bySeat: { b: damageToB } };
    return { s, knoll };
  };
  const ability = (knoll: VisibleCard) => parseGenericTapAbilities(knoll.oracleText).find((a) => a.effect.kind === "hideaway_play")!;

  it("counts damage dealt to any opponent from any source this turn", () => {
    expect(hideawayDamageConditionMet(setup(7).s, "a", "an opponent was dealt 7 or more damage this turn")).toBe(true);
    expect(hideawayDamageConditionMet(setup(6).s, "a", "an opponent was dealt 7 or more damage this turn")).toBe(false);
    const stale = setup(9).s;
    stale.turn += 1;
    expect(hideawayDamageConditionMet(stale, "a", "an opponent was dealt 7 or more damage this turn")).toBe(false);
  });
  it("damage to a player is recorded as it lands, per player, and resets next turn", () => {
    const s = session([seat("a", []), seat("b", []), seat("c", [])]);
    const burn = real("Lightning Bolt", "bolt");
    let next = applyRemovalEffect(s, "a", "Lightning Bolt", burn, { kind: "damage", amount: 3, targetType: "player" }, undefined, { kind: "player", seatId: "b" });
    next = applyRemovalEffect(next, "a", "Lightning Bolt", burn, { kind: "damage", amount: 3, targetType: "player" }, undefined, { kind: "player", seatId: "b" });
    expect(next.damageThisTurn?.bySeat.b).toBe(6);
  });
  it("activating it with enough damage makes the hidden spell castable at any time", () => {
    const { s, knoll } = setup(7);
    const after = applyGenericTapEffect(s, "a", "sk", "Spinerock Knoll", ability(knoll).effect, ability(knoll).clause);
    const hidden = after.seats[0].board.exile!.find((c) => c.id === "hidden")!;
    expect(hidden.exiledPlayableFree).toBe(true);
    expect(hidden.exiledPlayableAnyTime).toBe(true);
    const tooEarly = setup(3);
    expect(applyGenericTapEffect(tooEarly.s, "a", "sk", "Spinerock Knoll", ability(tooEarly.knoll).effect, ability(tooEarly.knoll).clause).seats[0].board.exile![0].exiledPlayableFree).toBeUndefined();
  });
  it("the AI is only offered the activation once the condition holds and a card is hidden", () => {
    const withDamage = setup(7);
    const offered = (state: { s: GameSession }) => legalMainPhaseActions(state.s.seats[0], true, "a", state.s.turn, new Set(), state.s).some((a) => a.id.startsWith("activate-generic-tap:sk"));
    expect(offered(withDamage)).toBe(true);
    expect(offered(setup(2))).toBe(false);
  });
});

describe("the AI cycles surplus lands (real Oracle text)", () => {
  const withLands = (count: number, hasPlayedLand: boolean) => {
    const mine = seat("a", Array.from({ length: count }, (_, i) => real("Swamp", `sw${i}`)));
    mine.board.hand = [real("Barren Moor", "bm")];
    const s = session([mine, seat("b", [])]);
    return legalMainPhaseActions(s.seats[0], hasPlayedLand, "a", 1, new Set(), s).some((action) => action.id === "cycle:bm");
  };
  it("offers cycling when flooded and not when short on lands", () => {
    expect(withLands(6, false)).toBe(true);
    expect(withLands(4, true)).toBe(true);
    expect(withLands(3, true)).toBe(false);
    expect(withLands(4, false)).toBe(false);
  });
});

describe("leaving the battlefield without dying (Outpost Siege, Dragons)", () => {
  const siege = () => real("Outpost Siege", "os", { chosenMode: "Dragons" });
  it("bounced and exiled creatures are recorded as leaving, and the Dragons mode reacts to both", () => {
    const s = session([seat("a", [siege(), bear("mine")]), seat("b", [bear("theirs")])]);
    const spell = real("Lightning Bolt", "spell");
    const bounced = applyRemovalEffect(s, "b", "Unsummon", spell, { kind: "bounce", targetType: "creature" }, undefined, { kind: "card", seatId: "a", cardId: "mine" });
    expect(bounced.pendingLeaves?.map((l) => l.card.id)).toEqual(["mine"]);
    const triggers = findLeavesBattlefieldTriggers(bounced, "a", bounced.pendingLeaves![0].card);
    expect(triggers.map((t) => t.effect.kind)).toEqual(["damage_effect"]);
    const exiled = applyRemovalEffect(s, "b", "Path", spell, { kind: "exile", targetType: "creature", lifeGainToControllerEqualToPower: false }, undefined, { kind: "card", seatId: "a", cardId: "mine" });
    expect(exiled.pendingLeaves?.map((l) => l.card.id)).toEqual(["mine"]);
  });
  it("only your own creatures, only in Dragons mode, and not for the Siege itself", () => {
    const s = session([seat("a", [siege()]), seat("b", [])]);
    expect(findLeavesBattlefieldTriggers(s, "a", bear("x"))).toHaveLength(1);
    expect(findLeavesBattlefieldTriggers(s, "b", bear("x"))).toHaveLength(0);
    const khans = session([seat("a", [real("Outpost Siege", "os", { chosenMode: "Khans" })]), seat("b", [])]);
    expect(findLeavesBattlefieldTriggers(khans, "a", bear("x"))).toHaveLength(0);
  });
});

describe("flash grants (real Oracle text)", () => {
  it("Yeva grants flash to green creature spells only, and a creature that merely has flash grants nothing", () => {
    const yeva = seat("a", [real("Yeva, Nature's Herald", "yeva")]);
    const green = bear("g", { colors: ["G"], typeLine: "Creature — Elf", zone: "hand" as const });
    const red = bear("r", { colors: ["R"], typeLine: "Creature — Goblin", zone: "hand" as const });
    expect(seatHasFlashGrant(yeva, green)).toBe(true);
    expect(seatHasFlashGrant(yeva, red)).toBe(false);
    expect(seatHasFlashGrant(yeva)).toBe(false);
    const justFlash = seat("a", [real("Herald of Eternal Dawn", "h")]);
    expect(seatHasFlashGrant(justFlash, red)).toBe(false);
  });
});

describe("cast triggers: Firespitter Whelp and Rhonas's Monument (real Oracle text)", () => {
  const resolveAll = (s: GameSession, triggers: ReturnType<typeof findCastTriggers>) => triggers.reduce((acc, t) => resolveTriggerEffect(acc, t), s);
  it("Whelp pings each opponent for a noncreature or Dragon spell, but not for another creature spell", () => {
    const s = session([seat("a", [real("Firespitter Whelp", "fw")]), seat("b", []), seat("c", [])]);
    const noncreature = findCastTriggers(s, "a", real("Lightning Bolt", "bolt"), 1);
    expect(noncreature).toHaveLength(1);
    const after = resolveAll(s, noncreature);
    expect(after.seats[1].life).toBe(39);
    expect(after.seats[2].life).toBe(39);
    expect(after.seats[0].life).toBe(40);
    expect(findCastTriggers(s, "a", bear("drag", { typeLine: "Creature — Dragon" }), 1)).toHaveLength(1);
    expect(findCastTriggers(s, "a", bear("elf", { typeLine: "Creature — Elf" }), 1)).toHaveLength(0);
    expect(findCastTriggers(s, "b", real("Lightning Bolt", "bolt"), 1)).toHaveLength(0);
  });
  it("Monument pumps the creature you choose when you cast a creature spell", () => {
    const s = session([seat("a", [real("Rhonas's Monument", "rm"), bear("x"), bear("y")]), seat("b", [])]);
    const [trigger] = findCastTriggers(s, "a", bear("c", { typeLine: "Creature — Elf" }), 1);
    expect(trigger.effect).toMatchObject({ kind: "targeted_effect", effect: { verb: { kind: "pump", power: 2, toughness: 2, keywords: ["trample"] } } });
    const after = resolveTriggerEffect(s, { ...trigger, effect: { ...trigger.effect, chosenOption: "y" } });
    expect(after.seats[0].board.battlefield.find((c) => c.id === "y")!.temporaryPowerBonus).toBe(2);
    expect(after.seats[0].board.battlefield.find((c) => c.id === "y")!.temporaryGrantedKeywords).toContain("trample");
    expect(after.seats[0].board.battlefield.find((c) => c.id === "x")!.temporaryPowerBonus).toBeUndefined();
    expect(findCastTriggers(s, "a", real("Lightning Bolt", "bolt"), 1)).toHaveLength(0);
  });
});

describe("extra land drops: Loot, Exuberant Explorer (real Oracle text)", () => {
  it("allows a second land only while Loot is in play", () => {
    expect(landDropsAllowed(seat("a", []))).toBe(1);
    expect(landDropsAllowed(seat("a", [real("Loot, Exuberant Explorer", "loot")]))).toBe(2);
    const plays = new Set<string>();
    expect(landPlaysMade(plays, "k")).toBe(0);
    recordLandPlay(plays, "k");
    recordLandPlay(plays, "k");
    expect(landPlaysMade(plays, "k")).toBe(2);
  });
});

describe("non-creature sacrifice costs", () => {
  it("Zuran Orb sacrifices a chosen land", () => {
    const orb = parseGenericSacrificeAbilities(real("Zuran Orb", "zo").oracleText)[0];
    expect(orb.sacrificeTarget).toBe("permanent");
    expect(orb.sacrificeTargetTypeFilter).toBe("land");
  });
});

describe("choose-several modal spells keep every mode", () => {
  it("Farewell offers all four modes and the chosen ones exile artifacts, creatures, enchantments and graveyards", async () => {
    const { applyGenericModalEffect, parseGenericModalEffect } = await import("./AppFlow");
    const farewell = real("Farewell", "fw", { zone: "hand" as const });
    const parsed = parseGenericModalEffect(farewell.oracleText, undefined)!;
    expect(parsed.chooseCount).toBe(4);
    expect(parsed.modes).toHaveLength(4);
    const mine = seat("a", [bear("mine"), real("Sol Ring", "ring")]);
    const theirs = seat("b", [bear("foe", { ownerSeatId: "b" })]);
    theirs.board.graveyard = [bear("dead", { zone: "graveyard" as const })];
    const after = applyGenericModalEffect(session([mine, theirs]), "a", farewell, parsed);
    expect(after.seats[0].board.battlefield).toHaveLength(0);
    expect(after.seats[1].board.battlefield).toHaveLength(0);
    expect(after.seats[1].board.graveyard).toHaveLength(0);
    expect(after.seats[1].board.exile?.map((c) => c.id)).toContain("dead");
  });

  it("Titan of Industry keeps the life, token and shield modes next to the destroy mode", async () => {
    const { parseGenericModalEffect } = await import("./AppFlow");
    const parsed = parseGenericModalEffect(real("Titan of Industry", "ti").oracleText, undefined)!;
    expect(parsed.modes.length).toBeGreaterThanOrEqual(3);
  });
});

describe("modal triggers: choose two / any number", () => {
  it("Titan of Industry's enters trigger is a modal with its four modes", () => {
    const titan = real("Titan of Industry", "ti");
    const s = session([seat("a", [titan], { kind: "human" }), seat("b", [])]);
    const triggers = findCommonTriggersForPermanentEntered(s, "a", titan);
    expect(triggers).toHaveLength(1);
    const effect = triggers[0].effect as { kind: string; modal: { chooseCount: number; modes: unknown[] } };
    expect(effect.kind).toBe("modal");
    expect(effect.modal.chooseCount).toBe(2);
    expect(effect.modal.modes.length).toBeGreaterThanOrEqual(3);
  });

  it("Rankle's combat-damage trigger offers all three modes, and the chosen ones hit every player", async () => {
    const { findCombatDamageToPlayerTriggers, resolveTriggerEffect } = await import("./AppFlow");
    const rankle = real("Rankle, Master of Pranks", "rk");
    const a = seat("a", [rankle]);
    a.board.hand = [bear("h1", { zone: "hand" as const })];
    const b = seat("b", []);
    b.board.hand = [bear("h2", { zone: "hand" as const })];
    const s = session([a, b]);
    const [trigger] = findCombatDamageToPlayerTriggers(s, "a", rankle, "b");
    const modal = (trigger.effect as { modal: { modes: unknown[]; atMost?: boolean } }).modal;
    expect(modal.modes).toHaveLength(3);
    expect(modal.atMost).toBe(true);
    const done = resolveTriggerEffect(s, { ...trigger, effect: { ...trigger.effect, chosenOption: "0,1" } } as typeof trigger);
    expect(done.seats[0].life).toBe(39);
    expect(done.seats[1].life).toBe(39);
    expect(done.seats[1].board.hand.map((c) => c.id)).not.toContain("h2");
  });

  it("Black Market Connections keeps both halves of every mode (token AND life loss)", async () => {
    const { parseGenericModalEffect } = await import("./AppFlow");
    const modal = parseGenericModalEffect(real("Black Market Connections", "bm").oracleText, undefined)!;
    expect(modal.modes).toHaveLength(3);
    expect(modal.modes.every((mode) => mode.kind === "all")).toBe(true);
  });
});

describe("draw, then you may put a land onto the battlefield", () => {
  it("Gretchen Titchwillow and Pendant of Prosperity parse as draw-then-land, and an agent draws and plays the land", () => {
    for (const name of ["Gretchen Titchwillow", "Pendant of Prosperity"]) {
      const card = real(name, "src");
      const ability = parseGenericAbilityEffect(card.oracleText.split("\n").find((line) => /Draw a card/.test(line))!.replace(/^[^:]*:\s*/, ""));
      expect(ability).toMatchObject({ kind: "trigger", effect: { kind: "draw_then_land" } });
    }
  });
});

describe("death watchers: edicts and life loss", () => {
  const deathSession = (watcher: string, humanFoe = false) => {
    const w = real(watcher, "w");
    const mine = bear("mine");
    const foe1 = bear("f1", { ownerSeatId: "b" });
    const foe2 = bear("f2", { ownerSeatId: "b", power: "5", toughness: "5" });
    const s = session([seat("a", [w, mine]), seat("b", [foe1, foe2], humanFoe ? { kind: "human" } : {})]);
    return { s, mine, foe1, foe2 };
  };

  it("Butcher of Malakir, Dictate of Erebos and Grave Pact: my creature dying makes each opponent sacrifice", () => {
    for (const name of ["Butcher of Malakir", "Dictate of Erebos", "Grave Pact"]) {
      const { s, mine } = deathSession(name);
      const triggers = findCommonTriggersForPermanentDied(s, "a", mine);
      const edict = triggers.find((t) => t.effect.kind === "each_opponent_sacrifices");
      expect(edict, name).toBeTruthy();
      const after = resolveTriggerEffect(s, edict!);
      expect(after.seats[1].board.battlefield.map((c) => c.id), name).toEqual(["f2"]);
    }
  });

  it("an opponent that is a human is asked which creature to sacrifice", () => {
    const { s, mine } = deathSession("Grave Pact", true);
    const edict = findCommonTriggersForPermanentDied(s, "a", mine).find((t) => t.effect.kind === "each_opponent_sacrifices")!;
    const after = resolveTriggerEffect(s, edict);
    expect(after.seats[1].board.battlefield).toHaveLength(2);
    expect(after.pendingSacrificeChoices).toEqual([expect.objectContaining({ seatId: "b", count: 1 })]);
  });

  it("Massacre Wurm: only an OPPONENT's creature dying costs that player 2 life", () => {
    const { s, mine, foe1 } = deathSession("Massacre Wurm");
    expect(findCommonTriggersForPermanentDied(s, "a", mine).filter((t) => t.effect.kind === "actor_loses_life")).toHaveLength(0);
    const trigger = findCommonTriggersForPermanentDied(s, "b", foe1).find((t) => t.effect.kind === "actor_loses_life")!;
    expect(trigger).toBeTruthy();
    expect(resolveTriggerEffect(s, trigger).seats[1].life).toBe(38);
  });
});

describe("edicts on entering", () => {
  it("Sheoldred's enters clause reads as an edict on opponents, and a human victim is asked", () => {
    const effect = commonTriggerEffect("When Sheoldred enters, each opponent sacrifices a nontoken creature or planeswalker of their choice.", "clause");
    expect(effect).toMatchObject({ kind: "each_opponent_sacrifices", filter: "nontoken creature or planeswalker" });
    const s = session([seat("a", [real("Sheoldred, Whispering One", "sh")]), seat("b", [bear("tok", { token: true }), bear("big", { power: "4", toughness: "4" }), bear("sm")], { kind: "human" })]);
    const after = resolveTriggerEffect(s, { id: "t", type: "trigger", actorSeatId: "a", controllerSeatId: "a", sourceCardId: "sh", sourceCardName: "Sheoldred", triggerKind: "common", effect: effect!, message: "" } as never);
    expect(after.pendingSacrificeChoices).toEqual([expect.objectContaining({ seatId: "b", typeFilter: "nontoken creature or planeswalker" })]);
  });

  it("Accursed Marauder: each player sacrifices a NONTOKEN creature (the filter used to match nothing)", async () => {
    const { applyEachPlayerSacrificeEffect, parseEachPlayerSacrificeEffect } = await import("./AppFlow");
    const marauder = real("Accursed Marauder", "am");
    const effect = parseEachPlayerSacrificeEffect(marauder.oracleText)!;
    const s = session([seat("a", [marauder, bear("tok", { token: true })]), seat("b", [bear("x1")])]);
    const after = applyEachPlayerSacrificeEffect(s, "Accursed Marauder", effect).session;
    expect(after.seats[1].board.battlefield).toHaveLength(0);
  });
});

describe("undying (Mikaeus, the Unhallowed)", () => {
  it("Mikaeus gives other non-Humans +1/+1 and undying, but not Humans or itself", () => {
    const human = bear("hu", { typeLine: "Creature — Human Soldier" });
    const seats = settle([seat("a", [real("Mikaeus, the Unhallowed", "mk"), bear("b1"), human])]);
    expect(find(seats, "a", "b1").attachmentPowerBonus).toBe(1);
    expect(find(seats, "a", "b1").grantedKeywords).toContain("undying");
    expect(find(seats, "a", "hu").attachmentPowerBonus).toBeUndefined();
    expect(find(seats, "a", "mk").attachmentPowerBonus).toBeUndefined();
  });

  it("a creature with undying returns once with a +1/+1 counter, and not again if it died with one", () => {
    const wolf = bear("w", { oracleText: "Undying", zone: "graveyard" as const });
    const a = seat("a", []);
    a.board.graveyard = [wolf];
    const s = session([a, seat("b", [])]);
    const [trigger] = findCommonTriggersForPermanentDied(s, "a", wolf).filter((t) => t.effect.kind === "undying_return");
    expect(trigger).toBeTruthy();
    const back = resolveTriggerEffect(s, trigger);
    const returned = back.seats[0].board.battlefield.find((c) => c.id === "w")!;
    expect(returned.counters).toEqual([{ kind: "+1/+1", count: 1 }]);
    expect(findCommonTriggersForPermanentDied(back, "a", returned).filter((t) => t.effect.kind === "undying_return")).toHaveLength(0);
  });
});

describe("Animate Dead", () => {
  it("returns a chosen creature card from a graveyard, attaches, shrinks it, and sacrifices it when the Aura leaves", () => {
    const aura = real("Animate Dead", "ad", { zone: "battlefield" as const });
    const a = seat("a", [aura]);
    const b = seat("b", []);
    b.board.graveyard = [bear("big", { zone: "graveyard" as const, power: "5", toughness: "5" }), bear("small", { zone: "graveyard" as const })];
    const s = session([a, b]);
    const [trigger] = findCommonTriggersForPermanentEntered(s, "a", aura).filter((t) => t.effect.kind === "aura_reanimate");
    expect(trigger).toBeTruthy();
    const after = resolveTriggerEffect(s, { ...trigger, effect: { ...trigger.effect, chosenOption: "small" } } as typeof trigger);
    const mine = after.seats[0].board.battlefield;
    expect(mine.map((c) => c.id).sort()).toEqual(["ad", "small"]);
    expect(mine.find((c) => c.id === "ad")!.attachedToId).toBe("small");
    const settled = runStateBasedActionsPass(after).session;
    expect(settled.seats[0].board.battlefield.find((c) => c.id === "small")!.attachmentPowerBonus).toBe(-1);
    // the Aura leaves: the creature is sacrificed
    const without = { ...settled, seats: settled.seats.map((x) => (x.id === "a" ? { ...x, board: { ...x.board, battlefield: x.board.battlefield.filter((c) => c.id !== "ad") } } : x)) };
    const gone = runStateBasedActionsPass(without).session;
    expect(gone.seats[0].board.battlefield.map((c) => c.id)).not.toContain("small");
  });
});

describe("Sheoldred, Whispering One's opponent-upkeep edict", () => {
  it("only the player whose upkeep it is sacrifices", () => {
    const sheoldred = real("Sheoldred, Whispering One", "sh");
    const s = session([seat("a", [sheoldred]), seat("b", [bear("b1"), bear("b2")]), seat("c", [bear("c1"), bear("c2")])]);
    const after = resolveTriggerEffect(s, { id: "t", type: "trigger", actorSeatId: "b", controllerSeatId: "a", sourceCardId: "sh", sourceCardName: "Sheoldred, Whispering One", triggerKind: "common", effect: { kind: "each_opponent_sacrifices", filter: "creature", onlySeatId: "b" }, message: "" } as never);
    expect(after.seats[1].board.battlefield).toHaveLength(1);
    expect(after.seats[2].board.battlefield).toHaveLength(2);
  });
});

describe("Syr Konrad, the Grim", () => {
  it("another creature dying deals 1 damage to each opponent", () => {
    const konrad = real("Syr Konrad, the Grim", "sk");
    const s = session([seat("a", [konrad, bear("mine")]), seat("b", [])]);
    const trigger = findCommonTriggersForPermanentDied(s, "a", bear("mine")).find((t) => t.effect.kind === "damage_each_opponent")!;
    expect(trigger).toBeTruthy();
    expect(resolveTriggerEffect(s, trigger).seats[1].life).toBe(39);
  });
});

describe("Braids, Arisen Nightmare", () => {
  it("does not hand out a free card at the end step", () => {
    const braids = real("Braids, Arisen Nightmare", "br");
    const a = seat("a", [braids]);
    a.library = [bear("l1", { zone: "library" as const })];
    a.zones.library = 1;
    const s = session([a, seat("b", [])]);
    const after = applyDeterministicPhaseTrigger(s, "a", braids, "end step");
    expect((after ?? s).seats[0].board.hand).toHaveLength(0);
  });
});

describe("Terror of the Peaks", () => {
  it("another creature entering makes it deal damage equal to that creature's power", () => {
    const terror = real("Terror of the Peaks", "tp");
    const entering = bear("e", { power: "4", toughness: "4" });
    const s = session([seat("a", [terror, entering], { kind: "human" }), seat("b", [])]);
    const trigger = findCommonTriggersForPermanentEntered(s, "a", entering).find((t) => t.effect.kind === "context_power_damage");
    expect(trigger).toBeTruthy();
    const aimed = resolveTriggerEffect(s, { ...trigger!, effect: { ...trigger!.effect, chosenOption: "p:b" } } as NonNullable<typeof trigger>);
    expect(aimed.seats[1].life).toBe(36);
  });
});

describe("Old Gnawbone", () => {
  it("a creature connecting for 3 makes 3 Treasures", () => {
    const gnaw = real("Old Gnawbone", "og");
    const attacker = bear("atk", { power: "3", toughness: "3" });
    const s = session([seat("a", [gnaw, attacker]), seat("b", [])]);
    const trigger = findCombatDamageToPlayerTriggers(s, "a", attacker, "b").find((t) => t.effect.kind === "create_tokens")!;
    expect(trigger).toBeTruthy();
    const after = resolveTriggerEffect(s, trigger);
    expect(after.seats[0].board.battlefield.filter((c) => c.name === "Treasure")).toHaveLength(3);
  });
});

describe("Extravagant Replication", () => {
  it("at upkeep an agent copies its best nonland permanent", () => {
    const rep = real("Extravagant Replication", "er");
    const big = bear("big", { power: "6", toughness: "6", manaValue: 6 });
    const s = session([seat("a", [rep, bear("small"), big, real("Sol Ring", "ring")]), seat("b", [])]);
    const after = applyDeterministicPhaseTrigger(s, "a", rep, "upkeep step");
    expect(after).toBeTruthy();
    const names = after!.seats[0].board.battlefield.map((c) => c.name);
    expect(names.filter((n) => n === "Bear big")).toHaveLength(2);
  });
});

describe("Miirym, Sentinel Wyrm", () => {
  it("another nontoken Dragon entering makes a non-legendary token copy", () => {
    const miirym = real("Miirym, Sentinel Wyrm", "mi");
    const dragon = real("The Ur-Dragon", "ud");
    const s = session([seat("a", [miirym, dragon]), seat("b", [])]);
    const trigger = findCommonTriggersForPermanentEntered(s, "a", dragon).find((t) => t.effect.kind === "copy_token")!;
    expect(trigger).toBeTruthy();
    const after = resolveTriggerEffect(s, trigger);
    const copy = after.seats[0].board.battlefield.find((c) => c.token && c.name === "The Ur-Dragon")!;
    expect(copy).toBeTruthy();
    expect(copy.typeLine).not.toContain("Legendary");
    expect(after.pendingEntries?.some((e) => e.card.id === copy.id)).toBe(true);
  });
});

describe("sacrifice-for-effect abilities (Meren's engine)", () => {
  it("Birthing Pod, Jarad and Altar of Dementia parse with the right sacrifice and effect", () => {
    const pod = parseGenericSacrificeAbilities(real("Birthing Pod", "bp").oracleText)[0];
    expect(pod).toMatchObject({ sacrificeTarget: "creature", effect: { kind: "search_creature_by_sacrificed_mv" } });
    const jarad = parseGenericSacrificeAbilities(real("Jarad, Golgari Lich Lord", "ja").oracleText).find((a) => a.effect.kind === "drain_by_sacrificed_power");
    expect(jarad).toMatchObject({ sacrificeExcludesSelf: true });
    expect(parseGenericSacrificeAbilities(real("Altar of Dementia", "ad").oracleText)[0]).toMatchObject({ effect: { kind: "mill_by_sacrificed_power" } });
  });

  it("Jarad drains each opponent by the sacrificed creature's power; Altar of Dementia mills that many", () => {
    const jarad = real("Jarad, Golgari Lich Lord", "ja");
    const fat = bear("fat", { power: "5", toughness: "5" });
    const b = seat("b", []);
    b.library = [bear("l1"), bear("l2"), bear("l3"), bear("l4"), bear("l5"), bear("l6")] as never;
    b.zones.library = 6;
    const s = session([seat("a", [jarad, fat]), b]);
    const drain = parseGenericSacrificeAbilities(jarad.oracleText).find((a) => a.effect.kind === "drain_by_sacrificed_power")!;
    expect(applySacrificeEffect(s, "a", jarad, drain.effect, drain.clause, [fat]).seats[1].life).toBe(35);
    const altar = real("Altar of Dementia", "al");
    const mill = parseGenericSacrificeAbilities(altar.oracleText)[0];
    const milled = applySacrificeEffect(s, "a", altar, mill.effect, mill.clause, [fat]);
    expect(milled.seats[1].board.graveyard).toHaveLength(5);
  });
});

describe("Cankerbloom with its real text", () => {
  it("parses despite the Proliferate reminder text", () => {
    expect(parseGenericSacrificeAbilities(real("Cankerbloom", "cb").oracleText).length).toBeGreaterThan(0);
  });
});

describe("the Ancient Dragons roll a d20", () => {
  it("Copper makes Treasures, Silver draws, Gold makes Faerie Dragons: a number equal to the roll", () => {
    for (const [name, check] of [
      ["Ancient Copper Dragon", (seat0: PlayerSeat) => seat0.board.battlefield.filter((c) => c.name === "Treasure").length],
      ["Ancient Silver Dragon", (seat0: PlayerSeat) => seat0.board.hand.length],
      ["Ancient Gold Dragon", (seat0: PlayerSeat) => seat0.board.battlefield.filter((c) => c.name === "Faerie Dragon Token").length]
    ] as const) {
      const dragon = real(name, "ad");
      const a = seat("a", [dragon]);
      a.library = Array.from({ length: 30 }, (_, i) => bear("l" + i, { zone: "library" as const })) as never;
      a.zones.library = 30;
      const s = session([a, seat("b", [])]);
      const trigger = findCombatDamageToPlayerTriggers(s, "a", dragon, "b").find((t) => t.effect.kind === "d20_roll")!;
      expect(trigger, name).toBeTruthy();
      const after = resolveTriggerEffect(s, trigger);
      const roll = Number(after.events.find((e) => /rolls a d20 and gets/.test(e.message))!.message.match(/gets (\d+)/)![1]);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(20);
      expect(check(after.seats[0]), name).toBe(roll);
    }
  });
});
