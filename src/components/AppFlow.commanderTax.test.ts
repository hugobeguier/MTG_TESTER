// Commander tax (rule 903.8): +{2} for each time the commander was CAST from the command zone, whether or not the spell
// resolved. Previously the +2 was applied only on resolution, so a countered/fizzled cast cost nothing extra.
import { describe, expect, it } from "vitest";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { moveCardBetweenVisibleZones, playCardFromZone, recordCommanderCast } from "./AppFlow";

function card(id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  return { id, name: id, manaValue: 3, colors: [], role: "permanent", zone: "command", typeLine: "Legendary Creature", oracleText: "", summoningSick: false, ...extra } as VisibleCard;
}

function game(commander?: VisibleCard, hand: VisibleCard[] = []): GameSession {
  const board = { hand, battlefield: [], graveyard: [], exile: [], commander };
  const seat = { id: "h", name: "h", kind: "human", life: 40, commanderDamage: {}, zones: { library: 0, hand: hand.length, battlefield: 0, graveyard: 0, exile: 0, command: commander ? 1 : 0 }, board } as PlayerSeat;
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats: [seat], events: [] };
}

describe("commander tax counts casts, not resolutions", () => {
  it("a countered cast still raises the tax by 2 and the commander stays in the command zone", () => {
    const cast = recordCommanderCast(game(card("cmdr", { commander: true, commanderTax: 0 })), "h", "cmdr");
    // Countered: the engine's counter path tries to move the (still command-zone) card to the graveyard.
    const countered = moveCardBetweenVisibleZones(cast, "h", "cmdr", "graveyard");
    expect(countered.seats[0].board.commander?.commanderTax).toBe(2);
    expect(countered.seats[0].board.graveyard).toHaveLength(0);
  });

  it("two casts (one countered, one resolved) raise it to 4 exactly once each", () => {
    let s = recordCommanderCast(game(card("cmdr", { commander: true, commanderTax: 0 })), "h", "cmdr");
    s = recordCommanderCast(s, "h", "cmdr");
    expect(s.seats[0].board.commander?.commanderTax).toBe(4);
    const resolved = playCardFromZone(s, "h", "cmdr", undefined, undefined, "battlefield", [], "command");
    expect(resolved.seats[0].board.battlefield[0].commanderTax).toBe(4); // resolving does not add a second time
  });

  it("a commander that sits in hand is cast with no tax recorded", () => {
    const inHand = card("cmdr", { commander: true, commanderTax: 2, zone: "hand" });
    const s = recordCommanderCast(game(undefined, [inHand]), "h", "cmdr");
    expect(s.seats[0].board.hand[0].commanderTax).toBe(2);
  });
});
