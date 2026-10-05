// Fixes from the rules-coverage audit of Reign of Dragons, Tramplesaurus Rex and Calling All Angels.
import { describe, expect, it } from "vitest";
import { adjustedCastingCost } from "./AppFlow";
import { etbEffectText, etbTriggerEffectText } from "@/lib/oracleClauses";
import { parseRemovalEffect } from "@/lib/removalSpells";
import { hasKeyword } from "@/lib/keywords";
import type { PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...overrides };
}
function seat(overrides: Partial<PlayerSeat> & Pick<PlayerSeat, "id" | "name" | "kind">): PlayerSeat {
  return { life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield: [], graveyard: [] }, ...overrides };
}
const creature = (id: string, power: string, extra: Partial<VisibleCard> = {}) => card({ id, name: `C${id}`, typeLine: "Creature — Bear", power, toughness: "2", role: "creature", ...extra });

describe("cast-time text no longer includes things that aren't cast-time effects", () => {
  it("Lathliss: the Dragon-enters watcher isn't a cast-time effect, but is still a trigger", () => {
    const text = "Flying\nWhenever another nontoken Dragon you control enters, create a 5/5 red Dragon creature token with flying. This ability triggers only once each turn.\n{1}{R}: Dragons you control get +1/+0 until end of turn.";
    expect(etbEffectText(text)).toBe("Flying");
    expect(etbTriggerEffectText(text)).toContain("create a 5/5 red Dragon");
  });

  it("Atsushi: the death modal's bullets aren't cast-time text", () => {
    const text = "Flying, trample\nWhen this creature dies, choose one —\n• Exile the top two cards of your library. Until the end of your next turn, you may play those cards.\n• Create three Treasure tokens.";
    expect(etbEffectText(text)).toBe("Flying, trample");
  });

  it("The Elder Dragon War: saga chapters aren't cast-time text", () => {
    const text = "Read ahead (Choose a chapter and start with that many lore counters. Add one after your draw step. Skip chapters before the chosen one.)\nI — This Saga deals 2 damage to each creature and each opponent.\nII — Discard any number of cards, then draw that many cards.\nIII — Create a 4/4 red Dragon creature token with flying.";
    expect(etbEffectText(text)).toBe("");
  });

  it("Scourge of Valkas: 'this creature or another Dragon' is a trigger, not a cast-time effect", () => {
    expect(etbEffectText("Flying\nWhenever this creature or another Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.")).toBe("Flying");
  });
});

describe("keywords come from keyword lines", () => {
  it("Nogi, Sarkhan, Rhonas and the Surraks don't pick keywords out of ability sentences", () => {
    expect(hasKeyword("{3}{R}: Create a 4/4 red Dragon creature token with flying. Put a +1/+1 counter on it.", "flying")).toBe(false);
    expect(hasKeyword("Deathtouch, indestructible\n{2}{G}: Another target creature gets +2/+0 and gains trample until end of turn.", "trample")).toBe(false);
    expect(hasKeyword("Deathtouch, indestructible\n{2}{G}: Another target creature gets +2/+0 and gains trample until end of turn.", "deathtouch")).toBe(true);
    expect(hasKeyword("Flying, vigilance", "flying")).toBe(true);
    expect(hasKeyword("Ward {2}", "ward")).toBe(true);
  });
});

describe("conditional board wipes", () => {
  it("Sunblast Angel destroys only tapped creatures; Whiptongue Hydra only fliers", () => {
    expect(parseRemovalEffect("destroy all tapped creatures.")).toMatchObject({ kind: "destroy_all", requireTapped: true });
    expect(parseRemovalEffect("destroy all creatures with flying.")).toMatchObject({ kind: "destroy_all", requireKeyword: "flying" });
  });
});

describe("scaling cost reductions", () => {
  const ghalta = card({ id: "g", name: "Ghalta, Primal Hunger", typeLine: "Legendary Creature — Elemental Dinosaur", manaValue: 12, oracleText: "This spell costs {X} less to cast, where X is the total power of creatures you control.\nTrample" });
  const act = card({ id: "a", name: "Blasphemous Act", typeLine: "Sorcery", manaValue: 9, oracleText: "This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature." });
  it("Ghalta costs less by the total power you control", () => {
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [creature("1", "5"), creature("2", "4")], graveyard: [] } });
    expect(adjustedCastingCost(me, ghalta, 12, "hand", "a", [me])).toBe(3);
  });
  it("Blasphemous Act costs {1} less per creature on the battlefield, across every player", () => {
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [creature("1", "2")], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [creature("2", "2"), creature("3", "2")], graveyard: [] } });
    expect(adjustedCastingCost(me, act, 9, "hand", "a", [me, them])).toBe(6);
  });
  it("Goreclaw discounts only creature spells with power 4 or greater", () => {
    const goreclaw = card({ id: "gc", name: "Goreclaw, Terror of Qal Sisma", typeLine: "Legendary Creature — Beast Warrior", oracleText: "Creature spells you cast with power 4 or greater cost {2} less to cast.\nWhenever Goreclaw attacks, each creature you control with power 4 or greater gets +1/+1 and gains trample until end of turn." });
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [goreclaw], graveyard: [] } });
    const big = card({ id: "b", name: "Big", typeLine: "Creature — Dinosaur", power: "6", toughness: "6", manaValue: 6 });
    const small = card({ id: "s", name: "Small", typeLine: "Creature — Elf", power: "1", toughness: "1", manaValue: 6 });
    expect(adjustedCastingCost(me, big, 6, "hand", "a", [me])).toBe(4);
    expect(adjustedCastingCost(me, small, 6, "hand", "a", [me])).toBe(6);
  });
});

import { commonTriggerEffect, resolveTriggerEffect } from "./AppFlow";
import type { GameSession } from "@/lib/types";

describe("monarch", () => {
  const sess = (seats: PlayerSeat[]): GameSession => ({
    id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1,
    xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: []
  });

  it("'you become the monarch' (Court of Grace, Skyline Despot) is a trigger effect that sets the monarch", () => {
    expect(commonTriggerEffect("When this enchantment enters, you become the monarch.", "entered")).toMatchObject({ kind: "become_monarch" });
    const me = seat({ id: "a", name: "Me", kind: "human" });
    const them = seat({ id: "b", name: "Opp", kind: "agent" });
    const after = resolveTriggerEffect(sess([me, them]), {
      id: "t", type: "trigger", actorSeatId: "a", controllerSeatId: "a", sourceCardId: "c", sourceCardName: "Court of Grace", triggerKind: "common",
      effect: { kind: "become_monarch" }, message: ""
    } as never);
    expect(after.monarchSeatId).toBe("a");
  });
});

import { applyDeterministicPhaseTrigger } from "./AppFlow";

describe("Court of Grace", () => {
  const court = card({
    id: "cg", name: "Court of Grace", typeLine: "Enchantment",
    oracleText: "When this enchantment enters, you become the monarch.\nAt the beginning of your upkeep, create a 1/1 white Spirit creature token with flying. If you're the monarch, instead create a 4/4 white Angel creature token with flying and vigilance."
  });
  const run = (monarch: boolean) => {
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [court], graveyard: [] } });
    const s: GameSession = { id: "t", createdAt: "", status: "playing", phase: "upkeep step", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats: [me], events: [], monarchSeatId: monarch ? "a" : undefined };
    return applyDeterministicPhaseTrigger(s, "a", court, "upkeep step")!.seats[0].board.battlefield.filter((c) => c.token);
  };
  it("makes a 1/1 Spirit normally, and a 4/4 Angel INSTEAD when you're the monarch", () => {
    const normal = run(false);
    expect(normal).toHaveLength(1);
    expect(normal[0]).toMatchObject({ power: "1", toughness: "1" });
    const monarch = run(true);
    expect(monarch).toHaveLength(1);
    expect(monarch[0]).toMatchObject({ power: "4", toughness: "4" });
  });
});

import { legalAttackActions } from "./AppFlow";

describe("attack/block restrictions", () => {
  const rhonas = card({
    id: "rh", name: "Rhonas the Indomitable", typeLine: "Legendary Creature — God", power: "5", toughness: "5", role: "creature",
    oracleText: "Deathtouch, indestructible\nRhonas can't attack or block unless you control another creature with power 4 or greater.\n{2}{G}: Another target creature gets +2/+0 and gains trample until end of turn."
  });
  it("Rhonas can't attack alone, and can once you control another creature with power 4+", () => {
    const opp = seat({ id: "b", name: "Opp", kind: "agent" });
    const attackersOf = (battlefield: VisibleCard[]) => legalAttackActions(seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield, graveyard: [] } }), [opp]).filter((a) => a.actionType === "attack").map((a) => a.cardId);
    const settled = (c: VisibleCard) => ({ ...c, summoningSick: false });
    expect(attackersOf([settled(rhonas)])).toEqual([]);
    expect(attackersOf([settled(rhonas), settled(creature("2", "2"))])).not.toContain("rh");
    expect(attackersOf([settled(rhonas), settled(creature("3", "4"))])).toContain("rh");
  });
});

describe("Inspiring Overseer", () => {
  it("gains 1 life AND draws a card", () => {
    expect(commonTriggerEffect("When this creature enters, you gain 1 life and draw a card.", "clause")).toMatchObject({
      kind: "draw_cards", amount: 1, then: { kind: "gain_life", amount: 1 }
    });
  });
});

import { manaChoicesForCard, manaProducedBy } from "./AppFlow";

describe("Whisperer of the Wilds", () => {
  const whisperer = card({
    id: "w", name: "Whisperer of the Wilds", typeLine: "Creature — Elf Shaman", power: "0", toughness: "1", role: "creature", summoningSick: false,
    oracleText: "{T}: Add {G}.\nFerocious — {T}: Add {G}{G}. Activate only if you control a creature with power 4 or greater."
  });
  it("taps for {G} normally and is not blocked by the unrecognized condition", () => {
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [whisperer], graveyard: [] } });
    expect(manaChoicesForCard(whisperer, me)).toContain("G");
    expect(manaProducedBy(whisperer, me)).toBe(1);
  });
  it("taps for {G}{G} once you control a creature with power 4 or greater", () => {
    const me = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [whisperer, creature("big", "5")], graveyard: [] } });
    expect(manaProducedBy(whisperer, me)).toBe(2);
  });
});

import { applySpellExtraEffect, applyRemovalEffect, parseSimpleDrawEffect } from "./AppFlow";
import { parseSpellExtraEffects } from "@/lib/spellExtras";

describe("Calling All Angels spells", () => {
  const withLib = (n: number) => ({ library: Array.from({ length: n }, (_, i) => card({ id: `l${i}`, name: `L${i}`, typeLine: "Creature", zone: "library" })), zones: { library: n, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 } });
  const sess = (seats: PlayerSeat[]): GameSession => ({ id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] });
  const src = card({ id: "s", name: "Spell", typeLine: "Instant" });

  it("Secret Rendezvous: you AND the opponent draw three", () => {
    const text = "You and target opponent each draw three cards.";
    expect(parseSimpleDrawEffect(text)).toBeUndefined();
    const me = seat({ id: "a", name: "Me", kind: "human", ...withLib(5) });
    const opp = seat({ id: "b", name: "Opp", kind: "agent", ...withLib(5) });
    const after = applySpellExtraEffect(sess([me, opp]), "a", src, parseSpellExtraEffects(text)[0]);
    expect(after.seats[0].board.hand).toHaveLength(3);
    expect(after.seats[1].board.hand).toHaveLength(3);
  });

  it("Cut a Deal: each opponent draws one, you draw one per opponent who drew", () => {
    const text = "Each opponent draws a card, then you draw a card for each opponent who drew a card this way.";
    const me = seat({ id: "a", name: "Me", kind: "human", ...withLib(5) });
    const b = seat({ id: "b", name: "B", kind: "agent", ...withLib(5) });
    const c = seat({ id: "c", name: "C", kind: "agent", ...withLib(5) });
    const after = applySpellExtraEffect(sess([me, b, c]), "a", src, parseSpellExtraEffects(text)[0]);
    expect(after.seats[0].board.hand).toHaveLength(2);
    expect(after.seats[1].board.hand).toHaveLength(1);
    expect(after.seats[2].board.hand).toHaveLength(1);
  });

  it("Destroy Evil only has legal targets with toughness 4 or greater", () => {
    const effect = parseRemovalEffect("destroy target creature with toughness 4 or greater.")!;
    expect(effect).toMatchObject({ kind: "destroy", minToughness: 4 });
    const me = seat({ id: "a", name: "Me", kind: "human" });
    const small = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [creature("s", "2")], graveyard: [] } });
    const unchanged = applyRemovalEffect(sess([me, small]), "a", "Destroy Evil", src, effect);
    expect(unchanged.seats[1].board.battlefield).toHaveLength(1); // 2/2 is not a legal target
    const big = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [creature("s", "2"), card({ id: "big", name: "Big", typeLine: "Creature — Giant", power: "5", toughness: "5", role: "creature" })], graveyard: [] } });
    const after = applyRemovalEffect(sess([me, big]), "a", "Destroy Evil", src, effect);
    expect(after.seats[1].board.battlefield.map((c) => c.id)).toEqual(["s"]);
  });
});
