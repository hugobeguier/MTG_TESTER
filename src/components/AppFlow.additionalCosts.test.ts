// "As an additional cost to cast this spell, sacrifice a land." (Harrow, real catalog text) and the other additional-cost cards in the shipped decks.
// Rule 601.2b/601.2h: the cost is chosen and paid while casting (before the spell can be responded to), so it stays paid if the spell is countered.
// The cast flow itself (playCard / the sacrifice picker) lives in the React component; these drive the exported pieces it is built from: the cost
// parser, the legal-sacrifice list the picker shows, the cast-legality gate, the agent's deterministic pick, the cast-time payment, and the fetch workflow.
import { describe, expect, it } from "vitest";
import {
  additionalSacrificeCandidates,
  checkMoveLegal,
  chooseAdditionalCostSacrifice,
  chooseAgentLibraryCardForRuleChoice,
  hasResolvableTarget,
  legalMainPhaseActions,
  moveLibraryCardToDestination,
  sacrificeForAdditionalCost,
  type LegalAgentAction
} from "./AppFlow";
import { parseAdditionalDiscardCost, parseAdditionalSacrificeCost } from "@/lib/oracleClauses";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
import { deterministicRuleWorkflow } from "@/lib/rulesAdvisor";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const basic = (name: string, id: string, extra: Partial<VisibleCard> = {}) =>
  ({ id, name, typeLine: `Basic Land — ${name}`, oracleText: "", manaValue: 0, colors: [], role: "land", zone: "battlefield", producedMana: [{ Forest: "G", Plains: "W", Island: "U", Swamp: "B", Mountain: "R" }[name] as string], ...extra }) as VisibleCard;
const bear = (id: string, extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;

function seat(id: string, kind: "human" | "agent", battlefield: VisibleCard[], extra: Partial<PlayerSeat> = {}, hand: VisibleCard[] = []): PlayerSeat {
  return {
    id, name: id, kind, life: 40, commanderDamage: {},
    zones: { library: (extra.library ?? []).length, hand: hand.length, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 },
    board: { hand, battlefield, graveyard: [] }, ...extra
  };
}
function session(seats: PlayerSeat[], extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 3, activePlayerId: seats[0].id, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra } as GameSession;
}
const castAction = (cardId: string): LegalAgentAction => ({ id: `cast:${cardId}`, actionType: "cast_spell", cardId, targetIds: [], label: "cast" });
const harrowIn = (zone: "hand" | "library" = "hand") => real("Harrow", "harrow", { zone });

describe("Harrow: the sacrifice is a cast-time additional cost", () => {
  it("the real catalog text is parsed as a land sacrifice (this was missing: Harrow was cast for free, with no sacrifice at all)", () => {
    const harrow = harrowIn();
    expect(harrow.oracleText).toMatch(/^As an additional cost to cast this spell, sacrifice a land\./);
    expect(parseAdditionalSacrificeCost(harrow.oracleText)).toEqual({ count: 1, permanentType: "land" });
  });

  it("the picker offers only lands (tapped ones included, creatures excluded)", () => {
    const me = seat("me", "human", [basic("Forest", "f1", { tapped: true }), basic("Forest", "f2"), basic("Plains", "p1"), bear("b1")]);
    const cost = parseAdditionalSacrificeCost(harrowIn().oracleText)!;
    expect(additionalSacrificeCandidates(me, cost, "harrow").map((c) => c.id).sort()).toEqual(["f1", "f2", "p1"]);
  });

  it("cannot be cast with no land to sacrifice: the legality gate refuses it with a reason, for a human and an agent alike", () => {
    const harrow = harrowIn();
    for (const kind of ["human", "agent"] as const) {
      const s = session([seat("me", kind, [bear("b1")], {}, [harrow]), seat("opp", "agent", [])]);
      expect(hasResolvableTarget(s, "me", harrow)).toBe(false);
      const verdict = checkMoveLegal(s, "me", castAction("harrow"), kind === "human" ? { mode: "human", hasPlayedLand: true, activeSeatId: "me", stackEmpty: true } : { mode: "agent", hasPlayedLand: true, activeSeatId: "me", stackEmpty: true, fresh: legalMainPhaseActions(s.seats[0], true, "me", s.turn, new Set(), s) });
      expect(verdict.legal).toBe(false);
      if (!verdict.legal) expect(verdict.reason).toMatch(/additional cost.*no land to sacrifice/i);
    }
  });

  it("a human holding only floating mana can still sacrifice the (already tapped) land that made it, and the cast stays legal", () => {
    // Three Forests, all already tapped for the {2}{G} that is floating: Harrow is still castable, sacrificing a tapped one.
    const harrow = harrowIn();
    const s = session([seat("me", "human", [basic("Forest", "f1", { tapped: true }), basic("Forest", "f2", { tapped: true }), basic("Forest", "f3", { tapped: true })], {}, [harrow]), seat("opp", "agent", [])]);
    expect(checkMoveLegal(s, "me", castAction("harrow"), { mode: "human", hasPlayedLand: true, activeSeatId: "me", stackEmpty: true }).legal).toBe(true);
    expect(additionalSacrificeCandidates(s.seats[0], { permanentType: "land" }, "harrow")).toHaveLength(3);
  });

  it("an agent is offered Harrow with a land to spare and not without one", () => {
    const harrow = harrowIn();
    const withLands = session([seat("me", "agent", [basic("Forest", "f1"), basic("Forest", "f2"), basic("Forest", "f3")], {}, [harrow]), seat("opp", "agent", [])]);
    expect(legalMainPhaseActions(withLands.seats[0], true, "me", withLands.turn, new Set(), withLands).some((a) => a.cardId === "harrow")).toBe(true);
    const noLands = session([seat("me", "agent", [bear("b1")], {}, [harrow]), seat("opp", "agent", [])]);
    expect(legalMainPhaseActions(noLands.seats[0], true, "me", noLands.turn, new Set(), noLands).some((a) => a.cardId === "harrow")).toBe(false);
  });
});

describe("the agent's deterministic land sacrifice", () => {
  const cost = { count: 1, permanentType: "land" as const };
  it("prefers a land already tapped to pay for this cast over an untapped one", () => {
    const me = seat("me", "agent", [basic("Forest", "f1"), basic("Forest", "f2"), basic("Forest", "f3")]);
    expect(chooseAdditionalCostSacrifice(me, cost, ["f2"], "harrow")?.[0].id).toBe("f2");
    const withTapped = seat("me", "agent", [basic("Forest", "f1"), basic("Forest", "f2", { tapped: true }), basic("Forest", "f3")]);
    expect(chooseAdditionalCostSacrifice(withTapped, cost, [], "harrow")?.[0].id).toBe("f2");
  });

  it("never gives up the only source of a commander colour while another land will do", () => {
    const commander = real("Meren of Clan Nel Toth", "meren", { zone: "command" });
    const me = seat("me", "agent", [basic("Swamp", "sole-b"), basic("Forest", "f1"), basic("Forest", "f2"), basic("Forest", "f3")], { board: { hand: [], battlefield: [basic("Swamp", "sole-b"), basic("Forest", "f1"), basic("Forest", "f2"), basic("Forest", "f3")], commander } });
    for (const paidWith of [[], ["sole-b"]]) {
      expect(chooseAdditionalCostSacrifice(me, cost, paidWith, "harrow")?.[0].id).not.toBe("sole-b");
    }
  });

  it("falls back to the sole colour source only when it is the only land", () => {
    const me = seat("me", "agent", [basic("Swamp", "b1")]);
    expect(chooseAdditionalCostSacrifice(me, cost, [], "harrow")?.map((c) => c.id)).toEqual(["b1"]);
    expect(chooseAdditionalCostSacrifice(seat("me", "agent", [bear("x")]), cost, [], "harrow")).toBeUndefined();
  });

  it("a creature cost still uses the creature fodder order (a token before a real card)", () => {
    const me = seat("me", "agent", [bear("real"), bear("tok", { token: true }), basic("Forest", "f1")]);
    expect(chooseAdditionalCostSacrifice(me, { count: 1, permanentType: "creature" }, [], "x")?.[0].id).toBe("tok");
  });
});

describe("cast-time payment: the cost stays paid when the spell is countered", () => {
  it("sacrificing the land moves it to the graveyard at cast time, and a later counter does not return it", () => {
    const harrow = harrowIn();
    const s = session([seat("me", "human", [basic("Forest", "f1", { tapped: true }), basic("Forest", "f2")], {}, [harrow]), seat("opp", "agent", [])]);
    const chosen = s.seats[0].board.battlefield[0];
    const paid = sacrificeForAdditionalCost(s, "me", [chosen], "Harrow");
    const me = paid.seats[0];
    expect(me.board.battlefield.map((c) => c.id)).toEqual(["f2"]);
    expect(me.board.graveyard?.map((c) => c.id)).toEqual(["f1"]);
    expect(paid.events[0].message).toMatch(/sacrifices Forest as an additional cost to cast Harrow/);
    // The spell is then countered: it goes to the graveyard without resolving. Nothing about the sacrificed land is touched.
    const countered: GameSession = { ...paid, seats: paid.seats.map((x) => (x.id === "me" ? { ...x, board: { ...x.board, hand: [], graveyard: [...(x.board.graveyard ?? []), harrow] } } : x)) };
    expect(countered.seats[0].board.battlefield.map((c) => c.id)).toEqual(["f2"]);
    expect(countered.seats[0].board.graveyard?.map((c) => c.id).sort()).toEqual(["f1", "harrow"]);
  });
});

describe("Harrow's resolution: up to two basic lands, untapped, then shuffle", () => {
  const workflow = () => deterministicRuleWorkflow({ event: "spell_resolved_to_graveyard", actorName: "a", sourceCard: harrowIn(), battlefield: [], hand: [], graveyard: [], exile: [], libraryPreview: [] });

  it("searches for UP TO TWO basic lands onto the battlefield untapped (it used to fetch one: maxChoices was hardcoded to 1)", () => {
    const w = workflow()!;
    expect(w.workflow).toBe("search_library_to_battlefield");
    expect(w.maxChoices).toBe(2);
    expect(w.allowedCardFilter).toBe("basic land");
    expect(w.destination).toBe("battlefield");
    expect(w.tapped).toBe(false);
  });

  it("an agent fetches two basics of different missing colours, they enter untapped", () => {
    const commander = real("Meren of Clan Nel Toth", "meren", { zone: "command" }); // B G
    const library = [basic("Forest", "lf", { zone: "library" }), basic("Forest", "lf2", { zone: "library" }), basic("Swamp", "ls", { zone: "library" }), basic("Plains", "lp", { zone: "library" }), bear("lib-bear", { zone: "library" })];
    const me = seat("me", "agent", [basic("Forest", "f1")], { library, board: { hand: [], battlefield: [basic("Forest", "f1")], commander } });
    const s = session([me, seat("opp", "agent", [])]);
    const choice = { id: "c", kind: "choose_card_from_library" as const, controllerSeatId: "me", sourceCardId: "harrow", sourceCardName: "Harrow", prompt: "", destination: "battlefield" as const, tapped: false, maxChoices: 2, allowedCardFilter: "basic land" };
    const first = chooseAgentLibraryCardForRuleChoice(me, choice, new Set(), [], s.seats)!;
    const second = chooseAgentLibraryCardForRuleChoice(me, choice, new Set([first.id]), [first], s.seats)!;
    expect(first.name).toBe("Swamp"); // the missing commander colour first
    expect(second.id).not.toBe(first.id);
    expect(second.typeLine).toContain("Basic Land");
    let after = moveLibraryCardToDestination(s, "me", first.id, "battlefield", false);
    after = moveLibraryCardToDestination(after, "me", second.id, "battlefield", false);
    const board = after.seats[0].board.battlefield;
    expect(board).toHaveLength(3);
    expect(board.filter((c) => c.id === first.id || c.id === second.id).every((c) => !c.tapped)).toBe(true);
  });
});

describe("other additional-cost cards in the shipped decks", () => {
  it("Village Rites, Eldritch Evolution and Diabolic Intent are creature sacrifices; a human with several creatures is offered exactly the creatures", () => {
    for (const name of ["Village Rites", "Eldritch Evolution", "Diabolic Intent"]) {
      const c = real(name, "x", { zone: "hand" });
      expect(parseAdditionalSacrificeCost(c.oracleText)).toEqual({ count: 1, permanentType: "creature" });
    }
    const me = seat("me", "human", [bear("b1"), bear("b2"), basic("Forest", "f1")]);
    expect(additionalSacrificeCandidates(me, { permanentType: "creature" }, "x").map((c) => c.id)).toEqual(["b1", "b2"]);
  });

  it("Unexpected Windfall's discard cost makes it uncastable from a hand with nothing else", () => {
    const windfall = real("Unexpected Windfall", "uw", { zone: "hand" });
    expect(parseAdditionalDiscardCost(windfall.oracleText)).toEqual({ count: 1 });
    const alone = session([seat("me", "agent", [basic("Forest", "f1"), basic("Forest", "f2")], {}, [windfall]), seat("opp", "agent", [])]);
    expect(hasResolvableTarget(alone, "me", windfall)).toBe(false);
  });

  it("Toxic Deluge's pay-X-life cost is handled as a spell effect; Immoral Bargain (sacrifice X creatures) is refused rather than cast for free", () => {
    expect(parseSpellExtraEffects(real("Toxic Deluge", "td").oracleText).map((e) => e.kind)).toContain("pay_x_life_mass_shrink");
    const bargain = real("Immoral Bargain", "ib", { zone: "hand" });
    const s = session([seat("me", "human", [bear("b1"), bear("b2")], {}, [bargain]), seat("opp", "agent", [bear("o1")])]);
    expect(hasResolvableTarget(s, "me", bargain)).toBe(false);
  });
});
