// Regression tests for the human-prompt audit (docs/agents/prompt-audit.md): effects that used to auto-pick for a human controller.
// Built from the REAL Oracle text in the card catalog.
import { describe, expect, it } from "vitest";
import { applyLabeledContinuation, commonTriggerEffect, phaseClauseConditionMet, phaseEffectText, playCardFromZone, resolveTriggerEffect, spellTargetSlots } from "./AppFlow";
import { parseSearchLibraryEffectText } from "@/lib/activatedAbilities";
import { etbEffectText } from "@/lib/oracleClauses";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();

function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}

function seat(id: string, kind: "human" | "agent", battlefield: VisibleCard[], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return {
    id, name: id, kind, life: 40, commanderDamage: {},
    zones: { library: ((extra.library as unknown[] | undefined)?.length ?? 0), hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield, graveyard: [] }, ...extra
  };
}

function session(seats: PlayerSeat[]): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] };
}

const bear = (id: string, extra: Partial<VisibleCard> = {}) => ({
  id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra
}) as VisibleCard;

describe("spell targets the human now chooses (real Oracle text)", () => {
  it("Chandra's Ignition: the human picks which creature deals the damage", () => {
    const ignition = real("Chandra's Ignition", "ci", { zone: "hand" });
    const s = session([seat("me", "human", [bear("small", { power: "1", toughness: "1" }), bear("big", { power: "5", toughness: "5" })]), seat("opp", "agent", [bear("o1")])]);
    const labeled = spellTargetSlots(s, "me", ignition);
    expect(labeled?.slots).toHaveLength(1);
    expect(labeled!.slots[0].options.map((o) => o.target.kind === "card" && o.target.cardId).sort()).toEqual(["big", "small"]);
    // Picking the small creature deals 1, not the strongest creature's 5.
    const after = applyLabeledContinuation(s, "me", ignition, labeled!.continuation, [{ kind: "card", seatId: "me", cardId: "small" }]);
    expect(after.seats[0].board.battlefield.find((c) => c.id === "big")?.damage ?? 0).toBe(1);
    expect(after.seats[1].life).toBe(39);
  });

  it("Secret Rendezvous: the human picks the opponent who draws", () => {
    const rendezvous = real("Secret Rendezvous", "sr", { zone: "hand" });
    const withLib = (id: string) => seat(id, "agent", [], { library: [bear("l1"), bear("l2"), bear("l3"), bear("l4")] as VisibleCard[] });
    const s = session([seat("me", "human", [], { library: [bear("m1"), bear("m2"), bear("m3"), bear("m4")] as VisibleCard[] }), withLib("rich"), { ...withLib("poor"), life: 5 }]);
    const labeled = spellTargetSlots(s, "me", rendezvous);
    expect(labeled?.slots[0].options).toHaveLength(2);
    const after = applyLabeledContinuation(s, "me", rendezvous, labeled!.continuation, [{ kind: "player", seatId: "rich" }]);
    expect(after.seats.find((x) => x.id === "rich")!.board.hand).toHaveLength(3);
    expect(after.seats.find((x) => x.id === "poor")!.board.hand).toHaveLength(0);
  });

  it("Consumed by Greed: the human picks the opponent who sacrifices", () => {
    const greed = real("Consumed by Greed", "cg", { zone: "hand" });
    const s = session([seat("me", "human", []), seat("a", "agent", [bear("a1", { power: "6", toughness: "6" })]), seat("b", "agent", [bear("b1", { power: "1", toughness: "1" })])]);
    const labeled = spellTargetSlots(s, "me", greed);
    expect(labeled?.slots[0].options).toHaveLength(2);
    const after = applyLabeledContinuation(s, "me", greed, labeled!.continuation, [{ kind: "player", seatId: "b" }]);
    expect(after.seats.find((x) => x.id === "b")!.board.battlefield).toHaveLength(0);
    expect(after.seats.find((x) => x.id === "a")!.board.battlefield).toHaveLength(1);
  });
});

describe("effect shapes the prompts hang off (real Oracle text)", () => {
  it("Daretti's +2 parses as 'discard up to two, draw that many' and caps the discards", () => {
    const effect = commonTriggerEffect("Discard up to two cards, then draw that many cards.", "clause");
    expect(effect).toMatchObject({ kind: "discard_any_then_draw", max: 2 });
    const hand = [bear("h1"), bear("h2"), bear("h3")];
    const owner = seat("me", "human", [], { board: { hand, battlefield: [], graveyard: [] }, library: [bear("l1"), bear("l2"), bear("l3")] as VisibleCard[] });
    const trigger = { id: "t", type: "trigger", actorSeatId: "me", controllerSeatId: "me", sourceCardId: "d", sourceCardName: "Daretti", triggerKind: "common", effect: { ...effect!, chosenOption: "h1,h2,h3" }, message: "" } as never;
    const after = resolveTriggerEffect(session([owner]), trigger);
    expect(after.seats[0].board.graveyard).toHaveLength(2);
    expect(after.seats[0].board.hand).toHaveLength(3);
  });

  it("Tiamat's 'up to five Dragon cards not named Tiamat that each have different names' is a five-card hand search", () => {
    const tiamat = real("Tiamat", "t");
    expect(parseSearchLibraryEffectText(etbEffectText(tiamat.oracleText))).toMatchObject({ kind: "search_library", destination: "hand", count: 5, cardTypeFilter: "Dragon" });
  });

  it("Surrak, the Hunt Caller: a target-a-creature phase trigger, gated on its formidable condition", () => {
    const surrak = real("Surrak, the Hunt Caller", "sk");
    const clause = phaseEffectText(surrak.oracleText, "beginning of combat step");
    expect(commonTriggerEffect(clause, "clause")?.kind).toBe("target_creature_gains_keyword");
    const weak = session([seat("me", "human", [surrak, bear("b1")])]);
    const strong = session([seat("me", "human", [surrak, bear("b1", { power: "9", toughness: "9" })])]);
    expect(phaseClauseConditionMet(weak, "me", clause)).toBe(false);
    expect(phaseClauseConditionMet(strong, "me", clause)).toBe(true);
  });
});

describe("shockland-style lands (real Oracle text)", () => {
  it("a human's Godless Shrine enters tapped and queues the pay-2-life question; an agent's resolves as before", () => {
    const human = session([seat("me", "human", [], { board: { hand: [real("Godless Shrine", "gs", { zone: "hand" })], battlefield: [], graveyard: [] } })]);
    const played = playCardFromZone(human, "me", "gs", "me plays Godless Shrine.");
    expect(played.seats[0].board.battlefield[0].tapped).toBe(true);
    expect(played.pendingShockChoices).toEqual([{ seatId: "me", cardId: "gs", cardName: "Godless Shrine", life: 2 }]);
    expect(played.seats[0].life).toBe(40);

    const agent = session([seat("bot", "agent", [], { board: { hand: [real("Godless Shrine", "gs", { zone: "hand" })], battlefield: [], graveyard: [] } })]);
    const agentPlayed = playCardFromZone(agent, "bot", "gs", "bot plays Godless Shrine.");
    expect(agentPlayed.pendingShockChoices).toBeUndefined();
    expect(agentPlayed.seats[0].board.battlefield[0].tapped).toBeFalsy();
    expect(agentPlayed.seats[0].life).toBe(38);
  });

  it("paying untaps the land and costs the life; declining leaves it tapped", () => {
    const human = session([seat("me", "human", [], { board: { hand: [real("Godless Shrine", "gs", { zone: "hand" })], battlefield: [], graveyard: [] } })]);
    const played = playCardFromZone(human, "me", "gs", "me plays Godless Shrine.");
    const trigger = (chosenOption: string) => ({ id: "t", type: "trigger", actorSeatId: "me", controllerSeatId: "me", sourceCardId: "gs", sourceCardName: "Godless Shrine", triggerKind: "common", effect: { kind: "shock_pay", life: 2, chosenOption }, message: "" }) as never;
    const paid = resolveTriggerEffect(played, trigger("0"));
    expect(paid.seats[0].board.battlefield[0].tapped).toBe(false);
    expect(paid.seats[0].life).toBe(38);
    const declined = resolveTriggerEffect(played, trigger("1"));
    expect(declined.seats[0].board.battlefield[0].tapped).toBe(true);
    expect(declined.seats[0].life).toBe(40);
  });
});
