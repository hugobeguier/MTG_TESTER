// Old Stickfingers ({X}{B}{G}, "power and toughness are each equal to the number of creature cards in your graveyard"; X only sets how many creature
// cards the cast trigger reveals into the graveyard) and Obscura Storefront ("When this land enters, sacrifice it. When you do, search ... basic Plains,
// Island, or Swamp ... tapped, then shuffle and you gain 1 life"), driven with REAL catalog text.
import { describe, expect, it } from "vitest";
import { applyCastRevealUntilCreatures, findCommonTriggersForPermanentEntered, resolveTriggerEffect, runStateBasedActionsPass, maxAffordableX } from "./AppFlow";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const creature = (id: string, extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "library", manaValue: 2, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;
const forest = (id: string) => ({ id, name: "Swamp", typeLine: "Basic Land — Swamp", colors: [], role: "land", zone: "library", manaValue: 0, oracleText: "" }) as VisibleCard;
function seat(id: string, kind: "human" | "agent", battlefield: VisibleCard[], library: VisibleCard[] = [], graveyard: VisibleCard[] = []): PlayerSeat {
  return { id, name: id, kind, life: 40, commanderDamage: {}, zones: { library: library.length, hand: 0, battlefield: battlefield.length, graveyard: graveyard.length, exile: 0, command: 0 }, board: { hand: [], battlefield, graveyard }, library } as PlayerSeat;
}
const session = (seats: PlayerSeat[]): GameSession => ({ id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] }) as GameSession;

describe.each(["human", "agent"] as const)("Old Stickfingers (%s)", (kind) => {
  it("cast with X=0 reveals nothing; with creature cards already in the graveyard it survives as a creature-card-count P/T", () => {
    const sticks = real("Old Stickfingers", "os");
    const grave = [creature("g1", { zone: "graveyard" }), creature("g2", { zone: "graveyard" })];
    const s0 = applyCastRevealUntilCreatures(session([seat("a", kind, [], [creature("l1"), forest("l2")], grave)]), "a", sticks, undefined);
    expect(s0.seats[0].board.graveyard).toHaveLength(2);
    expect(s0.seats[0].library).toHaveLength(2);
    const entered = { ...s0, seats: [{ ...s0.seats[0], board: { ...s0.seats[0].board, battlefield: [sticks] } }] };
    const after = runStateBasedActionsPass(entered).session;
    const onBf = after.seats[0].board.battlefield.find((c) => c.id === "os")!;
    expect(onBf).toBeTruthy();
    expect(onBf.cdaToughness).toBe(2);
  });

  it("X=0 with an empty graveyard: it is a 0/0 and legitimately dies (its P/T is the graveyard count, not X)", () => {
    const sticks = real("Old Stickfingers", "os");
    const s0 = applyCastRevealUntilCreatures(session([seat("a", kind, [], [creature("l1")])]), "a", sticks, undefined);
    const after = runStateBasedActionsPass({ ...s0, seats: [{ ...s0.seats[0], board: { ...s0.seats[0].board, battlefield: [sticks] } }] }).session;
    expect(after.seats[0].board.battlefield.find((c) => c.id === "os")).toBeUndefined();
  });

  it("X=2 reveals until two creature cards, milling them and bottoming the rest; it then lives as a 2/2", () => {
    const sticks = real("Old Stickfingers", "os");
    const lib = [forest("f1"), creature("c1"), forest("f2"), creature("c2"), creature("c3")];
    const s0 = applyCastRevealUntilCreatures(session([seat("a", kind, [], lib)]), "a", sticks, 2);
    const gy = s0.seats[0].board.graveyard!.map((c) => c.id);
    expect(gy.sort()).toEqual(["c1", "c2"]);
    const libIds = s0.seats[0].library!.map((c) => c.id);
    expect(libIds[0]).toBe("c3");
    expect(libIds.slice(1).sort()).toEqual(["f1", "f2"]);
    const after = runStateBasedActionsPass({ ...s0, seats: [{ ...s0.seats[0], board: { ...s0.seats[0].board, battlefield: [sticks] } }] }).session;
    const onBf = after.seats[0].board.battlefield.find((c) => c.id === "os")!;
    expect(onBf.cdaToughness).toBe(2);
  });
});

describe("Old Stickfingers X policy", () => {
  it("X is an {X} spell so agents may pay X; it is not an enters-with-counters X card", () => {
    const sticks = real("Old Stickfingers", "os");
    expect(sticks.oracleText).not.toMatch(/counters? on/i);
    const rich = seat("a", "agent", Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, name: "Swamp", typeLine: "Basic Land — Swamp", colors: [], role: "land", zone: "battlefield", manaValue: 0, oracleText: "{T}: Add {B}." }) as VisibleCard));
    expect(maxAffordableX(rich, sticks, 2)).toBeGreaterThanOrEqual(0);
  });
});

describe.each(["human", "agent"] as const)("Obscura Storefront (%s)", (kind) => {
  it("its enters trigger sacrifices the land, fetches a tapped basic and gains 1 life", () => {
    const store = real("Obscura Storefront", "st");
    const s = session([seat("a", kind, [store], [creature("x1"), forest("sw")])]);
    const trigger = findCommonTriggersForPermanentEntered(s, "a", store).find((t) => t.effect.kind === "sacrifice_self_then_search")!;
    expect(trigger).toBeTruthy();
    const out = resolveTriggerEffect(s, trigger);
    const a = out.seats[0];
    expect(a.board.battlefield.map((c) => c.id)).toEqual(["sw"]);
    expect(a.board.battlefield[0].tapped).toBe(true);
    expect(a.board.graveyard!.map((c) => c.id)).toContain("st");
    expect(a.life).toBe(41);
  });

  it("with no matching basic it is still sacrificed", () => {
    const store = real("Obscura Storefront", "st");
    const s = session([seat("a", kind, [store], [creature("x1")])]);
    const trigger = findCommonTriggersForPermanentEntered(s, "a", store).find((t) => t.effect.kind === "sacrifice_self_then_search")!;
    const out = resolveTriggerEffect(s, trigger);
    expect(out.seats[0].board.battlefield).toHaveLength(0);
  });
});

describe.each(["Orzhov Basilica", "Golgari Rot Farm", "Izzet Boilerworks"])("%s (bounce land in the shipped decks)", (name) => {
  it.each(["human", "agent"] as const)("its enters trigger asks to return a land (%s)", (kind) => {
    const land = real(name, "bl");
    const s = session([seat("a", kind, [land])]);
    const trigger = findCommonTriggersForPermanentEntered(s, "a", land).find((t) => t.effect.kind === "return_land_to_hand");
    expect(trigger).toBeTruthy();
  });
});
