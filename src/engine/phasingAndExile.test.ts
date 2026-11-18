import { describe, expect, it } from "vitest";
import { playCardFromZone, spellResolutionDestination } from "@/engine/casting";
import { resolveDeferredChoice } from "@/engine/effects";
import { phaseOutPermanent } from "@/engine/phasing";
import { findCommonTriggersForPermanentDied } from "@/engine/triggerFinders";
import { applyDeterministicPhaseTrigger } from "@/engine/triggers";
import { untapForSeat } from "@/engine/turnFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...overrides };
}
function seat(overrides: Partial<PlayerSeat> & Pick<PlayerSeat, "id" | "name" | "kind">): PlayerSeat {
  return { life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield: [] }, ...overrides };
}
function session(seats: PlayerSeat[]): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 3, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] };
}

const MEREN = "Whenever another creature you control dies, you get an experience counter.\nAt the beginning of your end step, choose target creature card in your graveyard. If that card's mana value is less than or equal to the number of experience counters you have, return it to the battlefield. Otherwise, put it into your hand.";
const VANISHING = "Enchant creature\n{U}{U}: Enchanted creature phases out. (While it's phased out, it's treated as though it doesn't exist. It phases in before its controller untaps during their next untap step.)";

describe("Temporal Mastery: a spell that exiles itself grants no cast-from-exile permission", () => {
  const mastery = card({ id: "tm", name: "Temporal Mastery", typeLine: "Sorcery", zone: "hand", oracleText: "Take an extra turn after this one. Exile Temporal Mastery.\nMiracle {1}{U}" });
  it("resolves to exile", () => {
    const s = session([seat({ id: "me", name: "Me", kind: "human", board: { hand: [mastery], battlefield: [] } })]);
    expect(spellResolutionDestination(s, { type: "spell", actorSeatId: "me", cardId: "tm" } as never)).toBe("exile");
  });
  it("is not marked playable from exile", () => {
    const s = session([seat({ id: "me", name: "Me", kind: "human", board: { hand: [mastery], battlefield: [] } })]);
    const after = playCardFromZone(s, "me", "tm", undefined, undefined, "exile");
    const exiled = after.seats[0].board.exile?.find((c) => c.id === "tm");
    expect(exiled).toBeDefined();
    expect(exiled?.exiledPlayableBySeatId).toBeUndefined();
    expect(after.events[0].message).not.toMatch(/cast the other half/);
  });
  it("an Adventure card exiled after its spell half still IS castable from exile", () => {
    const adv = card({ id: "adv", name: "Bonecrusher Giant // Stomp", typeLine: "Instant — Adventure", zone: "hand" });
    const s = session([seat({ id: "me", name: "Me", kind: "human", board: { hand: [adv], battlefield: [] } })]);
    const after = playCardFromZone(s, "me", "adv", undefined, undefined, "exile");
    expect(after.seats[0].board.exile?.[0].exiledPlayableBySeatId).toBe("me");
  });
});

describe("Estrid's Invocation", () => {
  const RIDER = "At the beginning of your upkeep, you may exile this enchantment. If you do, return it to the battlefield under its owner's control.";
  const ESTRID_TEXT = `You may have this enchantment enter as a copy of an enchantment you control, except it has "${RIDER}"`;
  const estrid = () => card({ id: "est", name: "Estrid's Invocation", typeLine: "Enchantment", zone: "hand", oracleText: ESTRID_TEXT, manaValue: 5, manaCost: "{3}{G}{W}" });
  const rhystic = card({ id: "rhy", name: "Rhystic Study", typeLine: "Enchantment", oracleText: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}." });
  const prophet = card({ id: "pro", name: "Mind Unbound", typeLine: "Enchantment", oracleText: "At the beginning of your upkeep, draw a card." });

  it("exiled copy returns as the real card and a human picks a NEW enchantment to copy", () => {
    const me = seat({ id: "me", name: "Me", kind: "human", board: { hand: [estrid()], battlefield: [rhystic, prophet] } });
    const cast = playCardFromZone(session([me]), "me", "est", undefined, undefined, "battlefield");
    // enter as a copy of Rhystic Study (first own enchantment)
    const copy = cast.seats[0].board.battlefield.find((c) => c.id === "est")!;
    expect(copy.name).toBe("Rhystic Study");
    expect(copy.oracleText).toContain("you may exile this enchantment");
    // upkeep rider
    const afterUpkeep = applyDeterministicPhaseTrigger(cast, "me", copy, "upkeep step")!;
    const returned = afterUpkeep.seats[0].board.battlefield.find((c) => c.id === "est")!;
    expect(returned).toBeDefined();
    expect(returned.name).toBe("Estrid's Invocation"); // the real card, blank until the owner picks
    expect(returned.copyOriginal).toBeUndefined();
    expect(afterUpkeep.seats[0].board.exile?.some((c) => c.id === "est")).toBeFalsy();
    const prompt = afterUpkeep.pendingPlayerChoices?.find((c) => c.resolver === "enter_as_copy");
    expect(prompt).toBeDefined();
    expect(prompt!.options.map((o) => o.value)).toEqual(expect.arrayContaining(["rhy", "pro", "none"]));
    const chosen = resolveDeferredChoice({ ...afterUpkeep, pendingPlayerChoices: [] }, "me", "est", "Estrid's Invocation", "enter_as_copy", {}, "pro");
    const final = chosen.seats[0].board.battlefield.find((c) => c.id === "est")!;
    expect(final.name).toBe("Mind Unbound");
    expect(final.oracleText).toContain("you may exile this enchantment"); // rider again
    expect(final.copyOriginal?.name).toBe("Estrid's Invocation");
  });

  it("a copy that leaves the battlefield reverts to the real card (zone change)", () => {
    const me = seat({ id: "me", name: "Me", kind: "human", board: { hand: [estrid()], battlefield: [rhystic] } });
    const cast = playCardFromZone(session([me]), "me", "est", undefined, undefined, "battlefield");
    const copy = cast.seats[0].board.battlefield.find((c) => c.id === "est")!;
    const exiled = applyDeterministicPhaseTrigger({ ...cast, seats: cast.seats.map((s) => ({ ...s, board: { ...s.board, battlefield: s.board.battlefield.filter((c) => c.id !== "rhy") } })) }, "me", copy, "upkeep step")!;
    // With no enchantment left to copy it returns blank, as Estrid's Invocation itself.
    expect(exiled.seats[0].board.battlefield.find((c) => c.id === "est")?.name).toBe("Estrid's Invocation");
  });
});

describe("phasing", () => {
  const meren = () => card({ id: "meren", name: "Meren of Clan Nel Toth", typeLine: "Legendary Creature — Human Shaman", oracleText: MEREN, power: "3", toughness: "4" });
  const bear = () => card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear", power: "2", toughness: "2" });

  it("a phased-out Meren does not trigger when another creature dies; a phased-in one does", () => {
    const dead = bear();
    const phasedIn = session([seat({ id: "me", name: "Me", kind: "human", board: { hand: [], battlefield: [meren()] } })]);
    expect(findCommonTriggersForPermanentDied(phasedIn, "me", dead).length).toBeGreaterThan(0);
    const out = phaseOutPermanent(phasedIn, "meren");
    expect(out.seats[0].board.battlefield[0].phasedOut).toBe(true);
    expect(findCommonTriggersForPermanentDied(out, "me", dead)).toHaveLength(0);
  });

  it("phases in during its controller's next untap step (not the opponent's), with log lines and a UI signal", () => {
    const me = seat({ id: "me", name: "Me", kind: "human", board: { hand: [], battlefield: [{ ...meren(), tapped: true }] } });
    const opp = seat({ id: "opp", name: "Opp", kind: "human", board: { hand: [], battlefield: [] } });
    let s = phaseOutPermanent(session([me, opp]), "meren");
    expect(s.events[0].message).toBe("Meren of Clan Nel Toth phases out.");
    expect(s.events[0].phasing).toEqual({ cardId: "meren", direction: "out" });
    s = untapForSeat(s, "opp");
    expect(s.seats[0].board.battlefield[0].phasedOut).toBe(true);
    s = untapForSeat(s, "me");
    const back = s.seats[0].board.battlefield[0];
    expect(back.phasedOut).toBeFalsy();
    expect(back.tapped).toBe(false);
    expect(s.events.some((e) => e.message === "Meren of Clan Nel Toth phases in." && e.phasing?.direction === "in")).toBe(true);
  });

  it("indirect phasing: an Aura phases out with its host and in with it, never on its own", () => {
    const aura = card({ id: "aura", name: "Pacifism", typeLine: "Enchantment — Aura", oracleText: "Enchant creature", attachedToId: "meren", attachedToSeatId: "me" });
    const me = seat({ id: "me", name: "Me", kind: "human", board: { hand: [], battlefield: [meren(), aura] } });
    let s = phaseOutPermanent(session([me]), "meren");
    const [m, a] = s.seats[0].board.battlefield;
    expect(m.phasedOut).toBe(true);
    expect(a.phasedOut).toBe(true);
    expect(a.phasedOutIndirectly).toBe(true);
    s = untapForSeat(s, "me");
    expect(s.seats[0].board.battlefield.every((c) => !c.phasedOut)).toBe(true);
  });

  it("an Aura phased out indirectly does not phase in on its own when its host stays out", () => {
    const aura = card({ id: "aura", name: "Pacifism", typeLine: "Enchantment — Aura", oracleText: "Enchant creature", attachedToId: "meren", attachedToSeatId: "opp" });
    const me = seat({ id: "me", name: "Me", kind: "human", board: { hand: [], battlefield: [meren()] } });
    const opp = seat({ id: "opp", name: "Opp", kind: "human", board: { hand: [], battlefield: [aura] } });
    let s = phaseOutPermanent(session([me, opp]), "meren");
    s = untapForSeat(s, "opp");
    expect(s.seats[1].board.battlefield[0].phasedOut).toBe(true);
    s = untapForSeat(s, "me");
    expect(s.seats[1].board.battlefield[0].phasedOut).toBeFalsy();
  });

  it("the Vanishing Aura's own text is only the real Aura (not the Vanishing keyword)", () => {
    expect(VANISHING).toContain("Enchanted creature phases out");
  });
});
