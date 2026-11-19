// Batch 3 leftovers that turned out to work (or are guarded by existing machinery): proven here with REAL Oracle text so they stay that way.
import { describe, expect, it } from "vitest";
import { legalMainPhaseActions } from "./AppFlow";
import { findAttackTriggers } from "@/engine/triggerFinders";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const bear = (id: string) => ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false }) as VisibleCard;
function seat(id: string, battlefield: VisibleCard[], kind: "human" | "agent" = "human"): PlayerSeat {
  return { id, name: id, kind, life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield, graveyard: [] } };
}
const session = (seats: PlayerSeat[]): GameSession => ({ id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 6, activePlayerId: seats[0].id, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] }) as GameSession;
const offered = (me: PlayerSeat, s: GameSession, cardId: string) => legalMainPhaseActions(me, true, me.id, 6, new Set(), s).filter((action) => action.cardId === cardId && action.actionType === "activate_ability").length;

describe("Utter Insignificance: {2}{C} needs real colourless mana", () => {
  it("is not offered when only coloured lands can pay, and is offered with a colourless source", () => {
    const aura = real("Utter Insignificance", "ut", { attachedToId: "b1" });
    const coloured = seat("a", [aura, bear("b1"), real("Island", "l0"), real("Swamp", "l1"), real("Forest", "l2")]);
    expect(offered(coloured, session([coloured, seat("b", [])]), "ut")).toBe(0);
    const withRing = seat("a", [aura, bear("b1"), real("Island", "l0"), real("Swamp", "l1"), real("Sol Ring", "l2")]);
    expect(offered(withRing, session([withRing, seat("b", [])]), "ut")).toBe(1);
  });
});

describe("Hellkite Igniter: {1}{R}: +X/+0 where X is the number of artifacts you control", () => {
  it("is offered as an activated ability with {1}{R} available", () => {
    const igniter = real("Hellkite Igniter", "hi");
    const me = seat("a", [igniter, real("Mountain", "m1"), real("Mountain", "m2"), real("Sol Ring", "sr")]);
    expect(offered(me, session([me, seat("b", [])]), "hi")).toBe(1);
  });
});

describe("Hellkite Charger: whenever it attacks, you may pay {5}{R}{R} for an extra combat", () => {
  it("the attack trigger carries the {5}{R}{R} payment (it is asked, not free)", () => {
    const charger = real("Hellkite Charger", "hc");
    const s = session([seat("a", [charger]), seat("b", [])]);
    const found = findAttackTriggers(s, { seatId: "a", card: charger, defendingSeatId: "b" });
    const effect = found.triggers.map((t) => t.effect).find((e) => e.kind === "additional_combat") as { payCostText?: string } | undefined;
    expect(effect).toBeDefined();
    expect(effect!.payCostText).toMatch(/\{5\}\{R\}\{R\}/i);
  });
});
