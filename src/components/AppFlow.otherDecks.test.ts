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
