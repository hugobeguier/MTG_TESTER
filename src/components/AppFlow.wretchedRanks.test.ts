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
