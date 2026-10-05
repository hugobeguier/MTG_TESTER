// Wretched Ranks cards the rules-coverage audit found wrong or missing. Real oracle text throughout.
import { describe, expect, it } from "vitest";
import {
  applyDeterministicPhaseTrigger,
  commonTriggerEffect,
  parseSimpleDrawEffect,
  parseSimpleLifeChange,
  resolveTriggerEffect,
  runStateBasedActionsPass
} from "./AppFlow";
import { etbEffectText } from "@/lib/oracleClauses";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...overrides };
}

const zombie = (id: string, extra: Partial<VisibleCard> = {}) =>
  card({ id, name: `Zombie ${id}`, typeLine: "Creature — Zombie", power: "2", toughness: "2", colors: ["B"], role: "creature", ...extra });

function seat(overrides: Partial<PlayerSeat> & Pick<PlayerSeat, "id" | "name" | "kind">): PlayerSeat {
  return {
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield: [], graveyard: [] },
    ...overrides
  };
}

function session(seats: PlayerSeat[]): GameSession {
  return {
    id: "t",
    createdAt: "",
    status: "playing",
    phase: "upkeep",
    turn: 1,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

const withLibrary = (library: VisibleCard[]) => ({ library, zones: { library: library.length, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 } });
const libCards = (n: number) => Array.from({ length: n }, (_, i) => card({ id: `l${i}`, name: `Lib ${i}`, typeLine: "Creature", zone: "library" }));
const bf = (s: GameSession, seatId: string) => s.seats.find((x) => x.id === seatId)!.board.battlefield;

describe("Bad Moon — color matching", () => {
  it("gives black creatures +1/+1 (including tokens), not other colors, and not itself", () => {
    const badMoon = card({ id: "bm", name: "Bad Moon", typeLine: "Enchantment", oracleText: "Black creatures get +1/+1.", colors: ["B"] });
    const green = card({ id: "g", name: "Elf", typeLine: "Creature — Elf", power: "1", toughness: "1", colors: ["G"], role: "creature" });
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [badMoon, zombie("z1"), green], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [zombie("z2", { token: true })], graveyard: [] } });
    const { session: after } = runStateBasedActionsPass(session([me, them]));
    expect(bf(after, "a").find((c) => c.id === "z1")!.attachmentPowerBonus).toBe(1);
    expect(bf(after, "b").find((c) => c.id === "z2")!.attachmentPowerBonus).toBe(1);
    expect(bf(after, "a").find((c) => c.id === "g")!.attachmentPowerBonus).toBeUndefined();
  });
});

describe("Soulless One / Wight of Precinct Six — counts across zones", () => {
  const soulless = card({
    id: "so",
    name: "Soulless One",
    typeLine: "Creature — Zombie Avatar",
    power: "*",
    toughness: "*",
    role: "creature",
    colors: ["B"],
    oracleText: "Soulless One's power and toughness are each equal to the number of Zombies on the battlefield plus the number of Zombie cards in all graveyards."
  });

  it("is sized by Zombies on every battlefield plus Zombie cards in every graveyard, and survives entering", () => {
    const grave = [zombie("gz1", { zone: "graveyard" }), card({ id: "gx", name: "Not a zombie", typeLine: "Creature — Human", zone: "graveyard" })];
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [soulless, zombie("z1")], graveyard: grave } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [zombie("z2")], graveyard: [zombie("gz2", { zone: "graveyard" })] } });
    const { session: after } = runStateBasedActionsPass(session([me, them]));
    const so = bf(after, "a").find((c) => c.id === "so");
    expect(so).toBeDefined(); // not destroyed for 0 toughness
    // Zombies on battlefields: Soulless One, z1, z2 = 3; Zombie cards in graveyards: gz1, gz2 = 2.
    expect(so!.cdaPower).toBe(5);
    expect(so!.cdaToughness).toBe(5);
  });

  it("Wight of Precinct Six grows for each creature card in your opponents' graveyards", () => {
    const wight = card({
      id: "w",
      name: "Wight of Precinct Six",
      typeLine: "Creature — Zombie",
      power: "1",
      toughness: "1",
      role: "creature",
      oracleText: "This creature gets +1/+1 for each creature card in your opponents' graveyards."
    });
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [wight], graveyard: [zombie("mine", { zone: "graveyard" })] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [], graveyard: [zombie("t1", { zone: "graveyard" }), zombie("t2", { zone: "graveyard" })] } });
    const { session: after } = runStateBasedActionsPass(session([me, them]));
    expect(bf(after, "a")[0].attachmentPowerBonus).toBe(2);
  });
});

describe("compound triggers — draw AND lose life", () => {
  it("Undead Augur: a draw with a chained life loss", () => {
    const effect = commonTriggerEffect("Whenever this creature or another Zombie you control dies, you draw a card and lose 1 life.", "died");
    expect(effect).toMatchObject({ kind: "draw_cards", amount: 1, then: { kind: "lose_life", amount: 1 } });
  });

  it("Midnight Reaper: 1 damage to you and a draw", () => {
    const effect = commonTriggerEffect("Whenever a nontoken creature you control dies, this creature deals 1 damage to you and you draw a card.", "died");
    expect(effect).toMatchObject({ kind: "draw_cards", amount: 1, then: { kind: "lose_life", amount: 1 } });
  });

  it("Night's Whisper / Ambition's Cost: the spell now reads its life loss too", () => {
    expect(parseSimpleLifeChange("You draw two cards and lose 2 life.")).toEqual({ kind: "lose_life", amount: 2 });
    expect(parseSimpleDrawEffect("You draw two cards and lose 2 life.")).toEqual({ amount: 2 });
  });

  it("Phyrexian Arena: upkeep draws a card AND loses 1 life", () => {
    const arena = card({ id: "arena", name: "Phyrexian Arena", typeLine: "Enchantment", oracleText: "At the beginning of your upkeep, you draw a card and lose 1 life." });
    const me = seat({ id: "a", name: "Me", kind: "human", ...withLibrary(libCards(3)), board: { hand: [], battlefield: [arena], graveyard: [] } });
    const after = applyDeterministicPhaseTrigger(session([me]), "a", arena, "upkeep step")!;
    const mine = after.seats[0];
    expect(mine.board.hand).toHaveLength(1);
    expect(mine.life).toBe(39);
  });

  it("Graveborn Muse: draws X and loses X, X = Zombies you control", () => {
    const muse = zombie("muse", {
      name: "Graveborn Muse",
      oracleText: "At the beginning of your upkeep, you draw X cards and lose X life, where X is the number of Zombies you control."
    });
    const me = seat({ id: "a", name: "Me", kind: "human", ...withLibrary(libCards(6)), board: { hand: [], battlefield: [muse, zombie("z1"), zombie("z2")], graveyard: [] } });
    const after = applyDeterministicPhaseTrigger(session([me]), "a", muse, "upkeep step")!;
    expect(after.seats[0].board.hand).toHaveLength(3);
    expect(after.seats[0].life).toBe(37);
  });
});

describe("Endless Ranks of the Dead — X = half the Zombies, rounded down", () => {
  it("makes floor(Zombies / 2) tokens", () => {
    const ranks = card({
      id: "ranks",
      name: "Endless Ranks of the Dead",
      typeLine: "Enchantment",
      oracleText: "At the beginning of your upkeep, create X 2/2 black Zombie creature tokens, where X is half the number of Zombies you control, rounded down."
    });
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [ranks, ...[1, 2, 3, 4, 5].map((i) => zombie(`z${i}`))], graveyard: [] } });
    const after = applyDeterministicPhaseTrigger(session([me]), "a", ranks, "upkeep step")!;
    // 5 Zombies => 2 new tokens.
    expect(bf(after, "a").filter((c) => c.token)).toHaveLength(2);
  });
});

describe("Gray Merchant / Vengeful Dead", () => {
  it("Gray Merchant's real wording is a devotion drain", () => {
    const effect = commonTriggerEffect(
      etbEffectText("When this creature enters, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way. (Each {B} in the mana costs of permanents you control counts toward your devotion to black.)"),
      "clause"
    );
    expect(effect).toMatchObject({ kind: "drain", scope: "each_opponent", devotionColor: "B" });
  });

  it("Vengeful Dead: each opponent loses 1 life with no life gained", () => {
    const effect = commonTriggerEffect("Whenever this creature or another Zombie dies, each opponent loses 1 life.", "died");
    expect(effect).toMatchObject({ kind: "drain", amount: 1, scope: "each_opponent", noGain: true });
    const me = seat({ id: "a", name: "Me", kind: "human" });
    const them = seat({ id: "b", name: "Opp", kind: "agent" });
    const resolved = resolveTriggerEffect(session([me, them]), {
      id: "t",
      type: "trigger",
      actorSeatId: "a",
      controllerSeatId: "a",
      sourceCardId: "v",
      sourceCardName: "Vengeful Dead",
      triggerKind: "common",
      effect: effect!,
      message: ""
    } as never);
    expect(resolved.seats.find((s) => s.id === "a")!.life).toBe(40);
    expect(resolved.seats.find((s) => s.id === "b")!.life).toBe(39);
  });
});

import { applySacrificeEffect } from "./AppFlow";
import { parseGenericSacrificeAbilities } from "@/lib/activatedAbilities";

describe("'Sacrifice another …' abilities", () => {
  it("Ghoulcaller Gisa: another creature, tokens equal to its power", () => {
    const [ability] = parseGenericSacrificeAbilities(
      "{B}, {T}, Sacrifice another creature: Create X 2/2 black Zombie creature tokens, where X is the sacrificed creature's power."
    );
    expect(ability).toMatchObject({ sacrificeTarget: "creature", sacrificeExcludesSelf: true, effect: { kind: "create_tokens_by_sacrificed_power" } });
    expect(ability.sacrificeTargetTypeFilter).toBeUndefined();
  });

  it("Gisa's activation makes as many Zombies as the sacrificed creature's power", () => {
    const [ability] = parseGenericSacrificeAbilities(
      "{B}, {T}, Sacrifice another creature: Create X 2/2 black Zombie creature tokens, where X is the sacrificed creature's power."
    );
    const gisa = card({ id: "gisa", name: "Ghoulcaller Gisa", typeLine: "Legendary Creature — Human Wizard", power: "3", toughness: "4", role: "creature" });
    const victim = zombie("v", { power: "4", toughness: "4" });
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [gisa], graveyard: [] } });
    const after = applySacrificeEffect(session([me]), "a", gisa, ability.effect, ability.clause, [victim]);
    const tokens = bf(after, "a").filter((c) => c.token);
    expect(tokens).toHaveLength(4);
    expect(tokens.every((t) => t.power === "2" && t.toughness === "2")).toBe(true);
  });

  it("Ayara: another BLACK creature", () => {
    const [ability] = parseGenericSacrificeAbilities("{T}, Sacrifice another black creature: Draw a card.");
    expect(ability).toMatchObject({ sacrificeExcludesSelf: true, sacrificeTargetTypeFilter: "black creature", effect: { kind: "draw_cards", amount: 1 } });
  });

  it("Kalitas: another Vampire or Zombie, two +1/+1 counters on himself", () => {
    const [ability] = parseGenericSacrificeAbilities("{2}{B}, Sacrifice another Vampire or Zombie: Put two +1/+1 counters on Kalitas.");
    expect(ability).toMatchObject({
      sacrificeExcludesSelf: true,
      sacrificeTargetTypeFilter: "Vampire or Zombie",
      effect: { kind: "add_counter", counterKind: "+1/+1", amount: 2 }
    });
  });

  it("Infernal Idol: draw two AND lose 2 life", () => {
    const abilities = parseGenericSacrificeAbilities("{T}: Add {B}.\n{1}{B}{B}, {T}, Sacrifice this artifact: You draw two cards and lose 2 life.");
    expect(abilities[0].effect).toMatchObject({ kind: "draw_cards", amount: 2, alsoLoseLife: 2 });
  });
});

import { destroyCreatures } from "./AppFlow";

describe("Kalitas, Traitor of Ghet — exile instead of dying", () => {
  const kalitasText =
    "Lifelink\nIf a nontoken creature an opponent controls would die, instead exile that card and create a 2/2 black Zombie creature token.\n{2}{B}, Sacrifice another Vampire or Zombie: Put two +1/+1 counters on Kalitas.";
  const kalitas = card({ id: "kal", name: "Kalitas, Traitor of Ghet", typeLine: "Legendary Creature — Vampire Warrior", power: "3", toughness: "4", role: "creature", oracleText: kalitasText });

  it("casting Kalitas no longer reads the replacement as a free Zombie", () => {
    expect(etbEffectText(kalitasText)).not.toMatch(/create a 2\/2/i);
  });

  it("an opponent's nontoken creature is exiled, and Kalitas's controller gets a Zombie", () => {
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [kalitas], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [card({ id: "bear", name: "Bear", typeLine: "Creature — Bear", power: "2", toughness: "2", role: "creature" })], graveyard: [] } });
    const after = destroyCreatures(session([me, them]), [{ seatId: "b", cardId: "bear", message: "Bear dies" }], "Rules action");
    const theirs = after.seats.find((s) => s.id === "b")!;
    expect(theirs.board.battlefield).toHaveLength(0);
    expect(theirs.board.graveyard ?? []).toHaveLength(0);
    expect(theirs.board.exile?.map((c) => c.id)).toEqual(["bear"]);
    expect(bf(after, "a").filter((c) => c.token && c.name.includes("Zombie"))).toHaveLength(1);
    expect(after.pendingDeaths ?? []).toHaveLength(0); // it never died
  });

  it("your own creatures and opposing TOKENS die normally", () => {
    const mine = zombie("mine");
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [kalitas, mine], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [zombie("tok", { token: true })], graveyard: [] } });
    const after = destroyCreatures(session([me, them]), [{ seatId: "a", cardId: "mine", message: "x" }, { seatId: "b", cardId: "tok", message: "y" }], "Rules action");
    expect(after.seats.find((s) => s.id === "a")!.board.graveyard?.map((c) => c.id)).toEqual(["mine"]);
    expect(bf(after, "b")).toHaveLength(0);
    expect(bf(after, "a").filter((c) => c.token)).toHaveLength(0);
  });
});

import { creatureCantBlock } from "./AppFlow";

describe("'can't block' creatures", () => {
  it("Gravecrawler, Razorlash Transmogrant and Carrion Feeder can't block; ordinary creatures can", () => {
    expect(creatureCantBlock(zombie("g", { name: "Gravecrawler", oracleText: "This creature can't block.\nYou may cast this card from your graveyard as long as you control a Zombie." }))).toBe(true);
    expect(creatureCantBlock(zombie("r", { name: "Razorlash Transmogrant", oracleText: "Razorlash Transmogrant can't block." }))).toBe(true);
    expect(creatureCantBlock(zombie("c", { name: "Carrion Feeder", oracleText: "This creature can't block.\nSacrifice a creature: Put a +1/+1 counter on this creature." }))).toBe(true);
    expect(creatureCantBlock(zombie("n", { name: "Plain Zombie", oracleText: "Deathtouch" }))).toBe(false);
    // A group restriction isn't this creature's own.
    expect(creatureCantBlock(zombie("x", { name: "Elsewhere", oracleText: "Creatures you control can't block." }))).toBe(false);
  });
});

import { findAttackTriggers } from "./AppFlow";

describe("attack triggers fire per declared attacker", () => {
  const titan = card({
    id: "titan",
    name: "Grave Titan",
    typeLine: "Creature — Giant",
    power: "6",
    toughness: "6",
    role: "creature",
    oracleText: "Deathtouch\nWhenever this creature enters or attacks, create two 2/2 black Zombie creature tokens."
  });
  const decree = card({
    id: "decree",
    name: "Marchesa's Decree",
    typeLine: "Enchantment",
    oracleText: "When this enchantment enters, you become the monarch.\nWhenever a creature attacks you or a planeswalker you control, that creature's controller loses 1 life."
  });

  it("Grave Titan triggers when IT attacks, not when another creature does", () => {
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [titan, zombie("z1")], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent" });
    const s = session([me, them]);
    const titanAttack = findAttackTriggers(s, { seatId: "a", card: titan, defendingSeatId: "b" });
    expect(titanAttack.triggers).toHaveLength(1);
    expect(titanAttack.triggers[0].effect).toMatchObject({ kind: "create_tokens" });
    const otherAttack = findAttackTriggers(s, { seatId: "a", card: zombie("z1"), defendingSeatId: "b" });
    expect(otherAttack.triggers).toHaveLength(0);
  });

  it("Marchesa's Decree makes the attacker's controller lose 1 life, only when attacking the Decree's controller", () => {
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [zombie("z1")], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [decree], graveyard: [] } });
    const third = seat({ id: "c", name: "Third", kind: "agent" });
    const s = session([me, them, third]);
    const hit = findAttackTriggers(s, { seatId: "a", card: zombie("z1"), defendingSeatId: "b" });
    expect(hit.triggers).toHaveLength(1);
    expect(hit.triggers[0].effect).toMatchObject({ kind: "actor_loses_life", amount: 1 });
    expect(hit.triggers[0].controllerSeatId).toBe("b");
    const resolved = resolveTriggerEffect(s, hit.triggers[0]);
    expect(resolved.seats.find((x) => x.id === "a")!.life).toBe(39);
    expect(findAttackTriggers(s, { seatId: "a", card: zombie("z1"), defendingSeatId: "c" }).triggers).toHaveLength(0);
  });
});

import { findCombatDamageToPlayerTriggers } from "./AppFlow";

describe("Eternal Taskmaster / Liliana's Reaver", () => {
  it("Taskmaster's attack trigger is an optional pay-then-return, not a free return", () => {
    const effect = commonTriggerEffect(
      "Whenever this creature attacks, you may pay {2}{B}. If you do, return target creature card from your graveyard to your hand.",
      "clause"
    );
    expect(effect).toMatchObject({ kind: "pay_then_zone", costText: "{2}{B}", optional: true });
  });

  it("Taskmaster can't return a card without the mana", () => {
    const trigger = {
      id: "t", type: "trigger", actorSeatId: "a", controllerSeatId: "a", sourceCardId: "tm", sourceCardName: "Eternal Taskmaster", triggerKind: "common",
      effect: { kind: "pay_then_zone", costText: "{2}{B}", zoneEffect: { kind: "regrow", targetType: "creature" } }, message: ""
    } as never;
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [], graveyard: [zombie("dead", { zone: "graveyard" })] } });
    const after = resolveTriggerEffect(session([me]), trigger);
    expect(after.seats[0].board.hand).toHaveLength(0);
  });

  it("Liliana's Reaver triggers only for itself, and makes the damaged player discard", () => {
    const reaver = card({
      id: "rv", name: "Liliana's Reaver", typeLine: "Creature — Zombie", power: "4", toughness: "3", role: "creature",
      oracleText: "Deathtouch\nWhenever this creature deals combat damage to a player, that player discards a card and you create a tapped 2/2 black Zombie creature token."
    });
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [reaver, zombie("other")], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [card({ id: "h1", name: "Spell", typeLine: "Sorcery", zone: "hand" })], battlefield: [], graveyard: [] } });
    const s = session([me, them]);
    expect(findCombatDamageToPlayerTriggers(s, "a", zombie("other"), "b")).toHaveLength(0);
    const triggers = findCombatDamageToPlayerTriggers(s, "a", reaver, "b");
    expect(triggers).toHaveLength(1);
    expect(triggers[0].effect).toMatchObject({ kind: "create_tokens", then: { kind: "seat_discards", seatId: "b" } });
    const after = resolveTriggerEffect(s, triggers[0]);
    expect(after.seats.find((x) => x.id === "b")!.board.hand).toHaveLength(0);
    expect(bf(after, "a").filter((c) => c.token && c.tapped)).toHaveLength(1);
  });
});

import { applySpellExtraEffect, applyZoneEffect, applyRemovalEffect } from "./AppFlow";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
import { parseZoneEffect } from "@/lib/zoneEffects";
import { parseRemovalEffect } from "@/lib/removalSpells";

describe("Cemetery Recruitment / Withering Torment / edicts", () => {
  const recruitText = "Return target creature card from your graveyard to your hand. If it's a Zombie card, draw a card.";

  it("Cemetery Recruitment draws only when the returned card is a Zombie", () => {
    expect(parseSimpleDrawEffect(recruitText)).toBeUndefined();
    const effect = parseZoneEffect(recruitText)!;
    expect(effect).toMatchObject({ kind: "regrow", drawIfType: "zombie" });
    const lib = libCards(2);
    const withZombie = seat({ id: "a", name: "Me", kind: "human", ...withLibrary(lib), board: { hand: [], battlefield: [], graveyard: [zombie("zc", { zone: "graveyard" })] } });
    const a = applyZoneEffect(session([withZombie]), "a", "Cemetery Recruitment", effect);
    expect(a.seats[0].board.hand.map((c) => c.id)).toContain("zc");
    expect(a.seats[0].board.hand).toHaveLength(2); // the Zombie plus the drawn card
    const human = card({ id: "hc", name: "Human", typeLine: "Creature — Human", zone: "graveyard", role: "creature" });
    const withHuman = seat({ id: "a", name: "Me", kind: "human", ...withLibrary(libCards(2)), board: { hand: [], battlefield: [], graveyard: [human] } });
    expect(applyZoneEffect(session([withHuman]), "a", "Cemetery Recruitment", effect).seats[0].board.hand).toHaveLength(1);
  });

  it("Withering Torment can destroy an enchantment", () => {
    const effect = parseRemovalEffect("Destroy target creature or enchantment. You lose 2 life.")!;
    expect(effect).toMatchObject({ kind: "destroy", targetType: "creature_or_enchantment" });
    const me = seat({ id: "a", name: "Me", kind: "human" });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [card({ id: "ench", name: "Pacifism", typeLine: "Enchantment — Aura" })], graveyard: [] } });
    const after = applyRemovalEffect(session([me, them]), "a", "Withering Torment", card({ id: "wt", name: "Withering Torment", typeLine: "Instant" }), effect);
    expect(bf(after, "b")).toHaveLength(0);
  });

  it("Syphon Flesh: each other player sacrifices a creature, you get a Zombie per sacrifice", () => {
    const text = "Each other player sacrifices a creature of their choice. You create a 2/2 black Zombie creature token for each creature sacrificed this way.";
    const extra = parseSpellExtraEffects(text)[0];
    expect(extra.kind).toBe("each_other_player_sacrifices");
    const me = seat({ id: "a", name: "Me", kind: "human" });
    const b = seat({ id: "b", name: "B", kind: "agent", board: { hand: [], battlefield: [zombie("b1")], graveyard: [] } });
    const c = seat({ id: "c", name: "C", kind: "agent", board: { hand: [], battlefield: [zombie("c1"), zombie("c2")], graveyard: [] } });
    const d = seat({ id: "d", name: "D", kind: "agent" });
    const after = applySpellExtraEffect(session([me, b, c, d]), "a", card({ id: "sf", name: "Syphon Flesh", typeLine: "Sorcery" }), extra);
    expect(bf(after, "b")).toHaveLength(0);
    expect(bf(after, "c")).toHaveLength(1);
    expect(bf(after, "a").filter((x) => x.token)).toHaveLength(2); // B and C each sacrificed one; D had none
  });

  it("Consumed by Greed: the opponent sacrifices their greatest-power creature; the gift-gated regrow does nothing", () => {
    const text =
      "Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)\nTarget opponent sacrifices a creature with the greatest power among creatures they control. If the gift was promised, return target creature card from your graveyard to your hand.";
    const body = etbEffectText(text);
    const extra = parseSpellExtraEffects(body)[0];
    expect(extra.kind).toBe("opponent_sacrifices_greatest_power");
    expect(parseZoneEffect(body)).toBeUndefined();
    expect(parseSimpleDrawEffect(body)).toBeUndefined();
    const me = seat({ id: "a", name: "Me", kind: "human" });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [zombie("small", { power: "1", toughness: "1" }), zombie("big", { power: "7", toughness: "7" })], graveyard: [] } });
    const after = applySpellExtraEffect(session([me, them]), "a", card({ id: "cg", name: "Consumed by Greed", typeLine: "Instant" }), extra);
    expect(bf(after, "b").map((x) => x.id)).toEqual(["small"]);
  });
});

import { parseGenericTapAbilities } from "@/lib/activatedAbilities";

describe("tap abilities that weren't offered at all", () => {
  it("Lord of the Undead: return target Zombie card from your graveyard (Zombies only)", () => {
    const [ability] = parseGenericTapAbilities("{1}{B}, {T}: Return target Zombie card from your graveyard to your hand.");
    expect(ability.effect).toMatchObject({ kind: "zone_effect", effect: { kind: "regrow", subtype: "zombie" } });
    if (ability.effect.kind !== "zone_effect") throw new Error("wrong kind");
    const lord = card({ id: "lord", name: "Lord of the Undead", typeLine: "Creature — Zombie", role: "creature" });
    const grave = [card({ id: "h", name: "Human", typeLine: "Creature — Human", zone: "graveyard" }), zombie("zg", { zone: "graveyard", manaValue: 1 })];
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [lord], graveyard: grave } });
    const after = applyZoneEffect(session([me]), "a", "Lord of the Undead", ability.effect.effect);
    expect(after.seats[0].board.hand.map((c) => c.id)).toEqual(["zg"]);
  });

  it("Cemetery Reaper, Castle Locthwain, Geier Reach and Lord of the Accursed parse", () => {
    expect(parseGenericTapAbilities("{2}{B}, {T}: Exile target creature card from a graveyard. Create a 2/2 black Zombie creature token.")[0].effect.kind).toBe("exile_graveyard_creature_then_tokens");
    expect(parseGenericTapAbilities("{1}{B}{B}, {T}: Draw a card, then you lose life equal to the number of cards in your hand.")[0].effect.kind).toBe("draw_then_lose_life_equal_hand");
    expect(parseGenericTapAbilities("{2}, {T}: Each player draws a card, then discards a card.")[0].effect.kind).toBe("each_player_loots");
    expect(parseGenericTapAbilities("{1}{B}, {T}: All Zombies gain menace until end of turn.")[0].effect).toMatchObject({ kind: "grant_keyword_to_all_until_eot", typeMatcher: "zombie", keyword: "menace" });
  });

  it("Memorial to Folly's sacrifice ability returns a creature card", () => {
    const [ability] = parseGenericSacrificeAbilities("{2}{B}, {T}, Sacrifice this land: Return target creature card from your graveyard to your hand.");
    expect(ability.effect).toMatchObject({ kind: "zone_effect", effect: { kind: "regrow", targetType: "creature" } });
  });
});

import { applyEntersWithCounterReplacements } from "./AppFlow";

describe("Diregraf Colossus", () => {
  const colossusText =
    "This creature enters with a +1/+1 counter on it for each Zombie card in your graveyard.\nWhenever you cast a Zombie spell, create a tapped 2/2 black Zombie creature token.";

  it("enters with a counter per Zombie card in your graveyard", () => {
    const colossus = card({ id: "dc", name: "Diregraf Colossus", typeLine: "Creature — Zombie Giant", power: "0", toughness: "0", role: "creature", oracleText: colossusText });
    const grave = [zombie("g1", { zone: "graveyard" }), zombie("g2", { zone: "graveyard" }), card({ id: "g3", name: "Human", typeLine: "Creature — Human", zone: "graveyard" })];
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [colossus], graveyard: grave } });
    const after = applyEntersWithCounterReplacements(session([me]), "a", "dc");
    expect(after.seats[0].board.battlefield[0].counters?.find((c) => c.kind === "+1/+1")?.count).toBe(2);
  });

  it("its cast trigger watches Zombie spells only", () => {
    const parsed = commonTriggerEffect("create a tapped 2/2 black Zombie creature token.", "clause");
    expect(parsed).toMatchObject({ kind: "create_tokens" });
  });
});

import { findCastTriggers } from "./AppFlow";

describe("Diregraf Colossus — Zombie spell cast trigger", () => {
  it("fires for a Zombie spell and not for other spells", () => {
    const colossus = card({
      id: "dc", name: "Diregraf Colossus", typeLine: "Creature — Zombie Giant", power: "2", toughness: "2", role: "creature",
      oracleText: "This creature enters with a +1/+1 counter on it for each Zombie card in your graveyard.\nWhenever you cast a Zombie spell, create a tapped 2/2 black Zombie creature token."
    });
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [colossus], graveyard: [] } });
    const s = session([me]);
    const zombieSpell = card({ id: "zs", name: "Cryptbreaker", typeLine: "Creature — Zombie Rogue", colors: ["B"] });
    const humanSpell = card({ id: "hs", name: "Human", typeLine: "Creature — Human Soldier", colors: ["W"] });
    expect(findCastTriggers(s, "a", zombieSpell, 1)).toHaveLength(1);
    expect(findCastTriggers(s, "a", humanSpell, 1)).toHaveLength(0);
  });
});

describe("Oversold Cemetery", () => {
  const cemetery = card({
    id: "oc", name: "Oversold Cemetery", typeLine: "Enchantment",
    oracleText: "At the beginning of your upkeep, if you have four or more creature cards in your graveyard, you may return target creature card from your graveyard to your hand."
  });
  it("returns a creature only with four or more creature cards in the graveyard", () => {
    const four = [1, 2, 3, 4].map((i) => zombie(`g${i}`, { zone: "graveyard", manaValue: i }));
    const withFour = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [cemetery], graveyard: four } });
    expect(applyDeterministicPhaseTrigger(session([withFour]), "a", cemetery, "upkeep step")!.seats[0].board.hand).toHaveLength(1);
    const withThree = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [cemetery], graveyard: four.slice(0, 3) } });
    expect(applyDeterministicPhaseTrigger(session([withThree]), "a", cemetery, "upkeep step")!.seats[0].board.hand).toHaveLength(0);
  });
});

import { findCommonTriggersForPermanentEntered } from "./AppFlow";

describe("Josu Vess, Lich Knight — kicker", () => {
  const josuText =
    "Kicker {5}{B} (You may pay an additional {5}{B} as you cast this spell.)\nMenace\nWhen Josu Vess enters, if he was kicked, create eight 2/2 black Zombie Knight creature tokens with menace.";
  const josu = (kicked: boolean) => card({ id: "josu", name: "Josu Vess, Lich Knight", typeLine: "Legendary Creature — Zombie Knight", power: "4", toughness: "5", role: "creature", oracleText: josuText, kicked });

  it("makes the eight Knights only when it was kicked", () => {
    const build = (kicked: boolean) => {
      const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [josu(kicked)], graveyard: [] } });
      return findCommonTriggersForPermanentEntered(session([me]), "a", josu(kicked));
    };
    expect(build(false)).toHaveLength(0);
    const kickedTriggers = build(true);
    expect(kickedTriggers).toHaveLength(1);
    expect(kickedTriggers[0].effect).toMatchObject({ kind: "create_tokens" });
  });
});
