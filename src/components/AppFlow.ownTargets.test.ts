// Self-play mistake detector findings: the agent's choosers must not pick options that only hurt the caster (real Oracle text).
import { describe, expect, it } from "vitest";
import { applyRemovalEffect, findEnterAsCopyTarget, parseEnterAsCopyEffect } from "@/components/AppFlow";
import { parseRemovalEffect } from "@/lib/removalSpells";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
function seat(id: string, battlefield: VisibleCard[]): PlayerSeat {
  return { id, name: id, kind: "agent", life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield, graveyard: [] } };
}
function session(seats: PlayerSeat[]): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] };
}

describe("Cursed Mirror does not copy my own legendary creature", () => {
  const effect = parseEnterAsCopyEffect(real("Cursed Mirror", "cm").oracleText);
  it("parses", () => expect(effect).toBeDefined());
  it("prefers another creature over my own commander even if the commander is bigger", () => {
    const giada = real("Giada, Font of Hope", "giada", { power: "9", toughness: "9" });
    const bears = real("Grizzly Bears", "bears", { power: "2", toughness: "2", typeLine: "Creature — Bear" });
    const s = session([seat("a", [giada]), seat("b", [bears])]);
    expect(findEnterAsCopyTarget(s, "a", effect!)?.id).toBe("bears");
  });
  it("may still copy an opponent's legendary creature, and declines when only my legend exists", () => {
    const giada = real("Giada, Font of Hope", "giada");
    expect(findEnterAsCopyTarget(session([seat("a", []), seat("b", [giada])]), "a", effect!)?.id).toBe("giada");
    expect(findEnterAsCopyTarget(session([seat("a", [giada]), seat("b", [])]), "a", effect!)).toBeUndefined();
  });
});

describe("modal removal does not destroy the caster's own permanent", () => {
  it("Collective Resistance with only my own artifact on the table does not destroy it", () => {
    const spell = real("Collective Resistance", "spell");
    const effect = parseRemovalEffect(spell.oracleText)!;
    const sphere = real("Commander's Sphere", "sphere");
    const after = applyRemovalEffect(session([seat("a", [sphere]), seat("b", [])]), "a", "Collective Resistance", spell, effect);
    expect(after.seats[0].board.battlefield.map((c) => c.id)).toContain("sphere");
  });
});

describe("single-target removal never falls back to the caster's own permanent", () => {
  const seatWith = (id: string, cards: VisibleCard[]) => seat(id, cards);
  it("Exorcise with only my own artifact on the table exiles nothing", () => {
    const spell = real("Exorcise", "spell");
    const effect = parseRemovalEffect(spell.oracleText);
    expect(effect).toBeDefined();
    const banner = real("Patchwork Banner", "banner");
    const after = applyRemovalEffect(session([seatWith("a", [banner]), seatWith("b", [])]), "a", "Exorcise", spell, effect!);
    expect(after.seats[0].board.battlefield.map((c) => c.id)).toContain("banner");
  });
  it("Exorcise prefers the opponent's artifact when both sides have one", () => {
    const spell = real("Exorcise", "spell");
    const effect = parseRemovalEffect(spell.oracleText)!;
    const mine = real("Patchwork Banner", "mine");
    const theirs = real("Sol Ring", "theirs");
    const after = applyRemovalEffect(session([seatWith("a", [mine]), seatWith("b", [theirs])]), "a", "Exorcise", spell, effect);
    expect(after.seats[0].board.battlefield.map((c) => c.id)).toContain("mine");
    expect(after.seats[1].board.battlefield.map((c) => c.id)).not.toContain("theirs");
  });
  it("Putrefy (destroy target artifact or creature) does not destroy my own creature when the opponent has none", () => {
    const spell = real("Putrefy", "spell");
    const effect = parseRemovalEffect(spell.oracleText);
    expect(effect).toBeDefined();
    const bears = real("Grizzly Bears", "bears", { power: "2", toughness: "2", typeLine: "Creature — Bear" });
    const after = applyRemovalEffect(session([seatWith("a", [bears]), seatWith("b", [])]), "a", "Putrefy", spell, effect!);
    expect(after.seats[0].board.battlefield.map((c) => c.id)).toContain("bears");
  });
});
