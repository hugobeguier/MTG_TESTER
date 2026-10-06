// Tests built from the REAL Oracle text in the card catalog (data/commander-cards.json), never from wording typed into
// the test: two earlier tests passed on invented text while the real cards stayed broken (Court of Grace, the
// "with power N or greater" watchers). Skipped per card when the catalog doesn't have it.
import { describe, expect, it } from "vitest";
import { findMultiAttackTriggers, adjustedCastingCost, findCommonTriggersForPermanentDied, resolveCombatDamage, payGenericTapCost, applySpellExtraEffect, parseSimpleDrawEffect, parseSimpleLifeChange, applyGenericAbilityEffect, parseGenericAbilityEffect, applyRemovalEffect, findLifeGainTriggers, lifeGainReplacementBonus, runStateBasedActionsPass } from "./AppFlow";
import { parseRemovalEffect } from "@/lib/removalSpells";
import { permanentMatchesQualifier } from "@/lib/characteristics";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
import { etbEffectText } from "@/lib/oracleClauses";
import { parseGenericManaAbilities, parseGenericTapAbilities } from "@/lib/activatedAbilities";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

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
