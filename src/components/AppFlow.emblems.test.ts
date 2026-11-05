// Emblems (rule 111.7-111.9): created by a planeswalker's ultimate, they last the rest of the game. Real catalog text for the three emblem cards in the
// shipped decks: Tezzeret, Artifice Master (end-step tutor), Saheeli, Filigree Master (static buff + cost reduction), Daretti, Scrap Savant (graveyard return).
import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { collectPhaseTriggers } from "@/lib/phaseTriggers";
import { parseEmblemGrant } from "@/lib/oracleClauses";
import { deterministicRuleWorkflow } from "@/lib/rulesAdvisor";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import {
  addEmblemToSeat,
  adjustedCastingCost,
  checkMoveLegal,
  chooseAgentLibraryCardForRuleChoice,
  emblemAsShimCard,
  findEmblemGraveyardReturns,
  hasPhaseTrigger,
  legalMainPhaseActions,
  makePhaseStackTrigger,
  planOffTurnPhaseTriggers,
  resolveTriggerEffect,
  runStateBasedActionsPass,
  scheduleDelayedPhaseTrigger,
  searchableLibraryCards,
  totalCastingCost
} from "./AppFlow";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const land = (id: string) => ({ id, name: `Plains ${id}`, typeLine: "Basic Land — Plains", colors: [], role: "land", zone: "battlefield", manaValue: 0, oracleText: "{T}: Add {W}.", producedMana: ["W"] }) as VisibleCard;
function seat(id: string, kind: "human" | "agent", battlefield: VisibleCard[] = [], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  const library = extra.library ?? [];
  const board = { hand: [], battlefield, graveyard: [], exile: [], ...(extra.board ?? {}) };
  return { id, name: id, kind, life: 40, commanderDamage: {}, zones: { library: library.length, hand: board.hand.length, battlefield: battlefield.length, graveyard: board.graveyard.length, exile: 0, command: 0 }, ...extra, library, board } as PlayerSeat;
}
function game(seats: PlayerSeat[], phase = "precombat main phase", extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase, turn: 5, activePlayerId: seats[0].id, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra } as GameSession;
}
const find = (s: GameSession, id: string) => s.seats.find((x) => x.id === id)!;

// The "−N: You get an emblem with ..." line of a real planeswalker's oracle text.
function ultimateLine(name: string): string {
  const card = lookupCard(catalog, name) as { oracleText: string };
  const line = card.oracleText.split("\n").find((entry) => /you get an emblem with/i.test(entry));
  if (!line) throw new Error(`${name} has no emblem line`);
  return line;
}
function withEmblem(playerSeat: PlayerSeat, planeswalker: string): PlayerSeat {
  const grant = parseEmblemGrant(ultimateLine(planeswalker))!;
  const next = addEmblemToSeat(game([playerSeat]), playerSeat.id, planeswalker, grant.clauses);
  return next.seats[0];
}

describe("granting an emblem from real catalog text", () => {
  it("Saheeli, Filigree Master -4 keeps BOTH quoted abilities, as one emblem", () => {
    const grant = parseEmblemGrant(ultimateLine("Saheeli, Filigree Master"))!;
    expect(grant.clauses).toEqual(["Artifact creatures you control get +1/+1", "Artifact spells you cast cost {1} less to cast."]);
    const s = addEmblemToSeat(game([seat("a", "agent")]), "a", "Saheeli, Filigree Master", grant.clauses);
    expect(find(s, "a").emblems).toHaveLength(1);
    expect(find(s, "a").emblems![0].oracleText).toBe("Artifact creatures you control get +1/+1\nArtifact spells you cast cost {1} less to cast.");
    expect(s.events[0].message).toBe('a gets an emblem from Saheeli, Filigree Master: "Artifact creatures you control get +1/+1" and "Artifact spells you cast cost {1} less to cast."');
  });
  it("every emblem-granting card in the catalog yields at least one quoted ability", () => {
    const cards = (catalog as unknown as { cards: Array<{ name: string; oracleText?: string }> }).cards ?? [];
    const granting = cards.filter((card) => /you get an emblem with\s+["']/i.test(card.oracleText ?? ""));
    expect(granting.length).toBeGreaterThan(40);
    // Cards that print the grant with single quotes (Teferi's Talent's chapter text) are a different wrapper; every double-quoted one must parse.
    const unparsed = granting.filter((card) => /you get an emblem with\s+"/i.test(card.oracleText ?? "") && !parseEmblemGrant(card.oracleText ?? "")?.clauses.length).map((card) => card.name);
    expect(unparsed).toEqual([]);
  });
  it("an emblem survives a save/load round trip, and so does a pending delayed return", () => {
    let s = game([seat("a", "agent")]);
    s = addEmblemToSeat(s, "a", "Daretti, Scrap Savant", parseEmblemGrant(ultimateLine("Daretti, Scrap Savant"))!.clauses);
    s = scheduleDelayedPhaseTrigger(s, { controllerSeatId: "a", sourceCardId: "e", sourceCardName: "Daretti's emblem", phase: "end step", scope: "any", effectText: "Return Sol Ring to the battlefield.", returnCard: { cardId: "x", cardName: "Sol Ring", ownerSeatId: "a", controlSeatId: "a" } });
    // A save is JSON.stringify(GameSnapshot) (saveStore.ts), so a JSON round trip of the session is exactly what loading gives back.
    const loaded = JSON.parse(JSON.stringify(s)) as GameSession;
    expect(find(loaded, "a").emblems).toEqual(find(s, "a").emblems);
    expect(loaded.delayedPhaseTriggers).toEqual(s.delayedPhaseTriggers);
  });
});

describe("agents see the ultimates as loyalty actions carrying the whole emblem text", () => {
  it("-4 Saheeli / -9 Tezzeret / -10 Daretti are offered only with enough loyalty, and their detail parses back into emblem clauses", () => {
    for (const [name, cost, clauseCount] of [["Saheeli, Filigree Master", -4, 2], ["Tezzeret, Artifice Master", -9, 1], ["Daretti, Scrap Savant", -10, 1]] as const) {
      const walker = (loyalty: number) => real(name, "pw", { counters: [{ kind: "loyalty", count: loyalty }] });
      const offered = (loyalty: number) => {
        const s = game([seat("a", "agent", [walker(loyalty)]), seat("b", "agent")]);
        return legalMainPhaseActions(s.seats[0], false, "a", s.turn, new Set(), s).filter((action) => action.abilityKind === "loyalty_ability" && action.loyaltyCost === cost);
      };
      expect(offered(Math.abs(cost) - 1)).toHaveLength(0);
      const [ultimate] = offered(Math.abs(cost));
      expect(ultimate, `${name} ultimate`).toBeDefined();
      expect(parseEmblemGrant(ultimate.detail ?? "")?.clauses).toHaveLength(clauseCount);
    }
  });
});

describe("Saheeli, Filigree Master's emblem: static effects for humans and agents", () => {
  const board = (kind: "human" | "agent") => [
    seat("me", kind, [real("Myr Retriever", "myr"), real("Llanowar Elves", "elf"), real("Sol Ring", "ring")]),
    seat("opp", "agent", [real("Myr Retriever", "omyr")])
  ];
  it("artifact creatures you control get +1/+1: mine only, not other creatures, not the opponent's", () => {
    const seats = board("agent");
    seats[0] = withEmblem(seats[0], "Saheeli, Filigree Master");
    const { session } = runStateBasedActionsPass(game(seats));
    const mine = find(session, "me").board.battlefield;
    expect(mine.find((c) => c.id === "myr")!.attachmentPowerBonus).toBe(1);
    expect(mine.find((c) => c.id === "myr")!.attachmentToughnessBonus).toBe(1);
    expect(mine.find((c) => c.id === "elf")!.attachmentPowerBonus).toBeUndefined();
    expect(find(session, "opp").board.battlefield[0].attachmentPowerBonus).toBeUndefined();
  });
  it("artifact spells cost {1} less (generic only); other spells and the opponent's are unchanged", () => {
    const me = withEmblem(seat("me", "human"), "Saheeli, Filigree Master");
    const opp = seat("opp", "agent");
    const mindStone = real("Mind Stone", "ms", { zone: "hand" });
    const bears = real("Llanowar Elves", "le", { zone: "hand" });
    const allSeats = [me, opp];
    expect(adjustedCastingCost(me, mindStone, mindStone.manaValue, "hand", "me", allSeats)).toBe(mindStone.manaValue - 1);
    expect(totalCastingCost(me, mindStone, mindStone.manaValue, 0, allSeats)).toBe(mindStone.manaValue - 1);
    expect(adjustedCastingCost(me, bears, bears.manaValue, "hand", "me", allSeats)).toBe(bears.manaValue);
    expect(adjustedCastingCost(opp, mindStone, mindStone.manaValue, "hand", "opp", allSeats)).toBe(mindStone.manaValue);
  });
  it("the discount never removes a colored requirement (rule 601.2f)", () => {
    const me = withEmblem(seat("me", "agent"), "Saheeli, Filigree Master");
    const colored = { ...real("Mind Stone", "c", { zone: "hand" }), typeLine: "Artifact", manaCost: "{W}", manaValue: 1 } as VisibleCard;
    expect(adjustedCastingCost(me, colored, 1, "hand", "me", [me])).toBe(1);
  });
  it("legal actions and the move-legality gate use the reduced cost: a 2-drop artifact is castable with one land", () => {
    for (const kind of ["agent", "human"] as const) {
      const mindStone = real("Mind Stone", "ms", { zone: "hand" });
      const plain = game([seat("me", kind, [land("l1")], { board: { hand: [mindStone], battlefield: [land("l1")], graveyard: [], exile: [] } }), seat("opp", "agent")]);
      const without = legalMainPhaseActions(plain.seats[0], false, "me", plain.turn, new Set(), plain);
      expect(without.some((action) => action.actionType === "cast_spell" && action.cardId === "ms")).toBe(false);
      const emblemSeat = withEmblem(plain.seats[0], "Saheeli, Filigree Master");
      const withE = game([emblemSeat, plain.seats[1]]);
      const fresh = legalMainPhaseActions(withE.seats[0], false, "me", withE.turn, new Set(), withE);
      const cast = fresh.find((action) => action.actionType === "cast_spell" && action.cardId === "ms");
      expect(cast, `${kind} can see the cast`).toBeDefined();
      const verdict = checkMoveLegal(withE, "me", cast!, { mode: kind === "agent" ? "agent" : "human", hasPlayedLand: false, activeSeatId: "me", stackEmpty: true, fresh });
      expect(verdict.legal).toBe(true);
    }
  });
});

describe("Tezzeret, Artifice Master's emblem: end-step search", () => {
  const library = () =>
    [
      real("Island", "lib-island", { zone: "library", typeLine: "Basic Land — Island" }),
      real("Lightning Bolt", "lib-bolt", { zone: "library" }),
      real("Llanowar Elves", "lib-elf", { zone: "library" }),
      real("Craterhoof Behemoth", "lib-hoof", { zone: "library" }),
      real("Sol Ring", "lib-ring", { zone: "library" })
    ] as VisibleCard[];
  const setup = (kind: "human" | "agent", lib = library()) => {
    const a = withEmblem(seat("a", kind, [], { library: lib }), "Tezzeret, Artifice Master");
    return game([a, seat("b", "agent")], "end step");
  };
  it("triggers only at its controller's own end step, every turn", () => {
    const s = setup("agent");
    const groups = (turnSeat: string) => collectPhaseTriggers(s.seats, "end step", turnSeat);
    expect(groups("a")).toHaveLength(1);
    expect(groups("b")).toHaveLength(0);
    expect(collectPhaseTriggers(s.seats, "upkeep step", "a")).toHaveLength(0);
    // The registry leaves the active seat's own emblem to the sweep's per-card flow, which finds it through the legacy matcher.
    expect(hasPhaseTrigger(emblemAsShimCard(find(s, "a").emblems![0]), "end step")).toBe(true);
    expect(planOffTurnPhaseTriggers(s, "end step", "b").triggers).toEqual([]);
  });
  it("goes on the stack as \"Tezzeret's emblem\" with a real search effect", () => {
    const s = setup("agent");
    const shim = emblemAsShimCard(find(s, "a").emblems![0]);
    const trigger = makePhaseStackTrigger(s, "a", shim, "end step");
    expect(trigger).toMatchObject({ type: "trigger", controllerSeatId: "a", sourceCardName: "Tezzeret's emblem", effect: { kind: "search_library_put", filter: "permanent", fromPhaseStep: true } });
    expect((trigger as { message: string }).message).toMatch(/Tezzeret's emblem triggers at the beginning of a end step/);
  });
  it("an agent finds the best permanent (not an instant), puts it onto the battlefield with entry stamps, then shuffles", () => {
    const s = setup("agent");
    const trigger = makePhaseStackTrigger(s, "a", emblemAsShimCard(find(s, "a").emblems![0]), "end step") as Extract<ReturnType<typeof makePhaseStackTrigger>, { type: "trigger" }>;
    const out = resolveTriggerEffect(s, trigger);
    const a = find(out, "a");
    expect(a.board.battlefield.map((c) => c.name)).toEqual(["Craterhoof Behemoth"]);
    expect(a.board.battlefield[0]).toMatchObject({ enteredFrom: "library", enteredTurn: 5, zone: "battlefield" });
    expect(a.library!.map((c) => c.id).sort()).toEqual(["lib-bolt", "lib-elf", "lib-island", "lib-ring"]);
    expect(out.pendingEntries).toEqual([expect.objectContaining({ seatId: "a" })]);
    expect(out.pendingEntries![0].card.name).toBe("Craterhoof Behemoth");
  });
  it("a human's picker lists every permanent card and no instant or sorcery", () => {
    const lib = library();
    const names = searchableLibraryCards(lib, { allowedCardFilter: "permanent" }).map((c) => c.name);
    expect(names).toEqual(["Island", "Llanowar Elves", "Craterhoof Behemoth", "Sol Ring"]);
  });
  it("the agent chooser agrees: any permanent, most expensive first, lands only as a last resort", () => {
    const a = seat("a", "agent", [], { library: library() });
    const choice = { id: "c", kind: "choose_card_from_library" as const, controllerSeatId: "a", sourceCardId: "e", sourceCardName: "Tezzeret's emblem", prompt: "", destination: "battlefield" as const, maxChoices: 1, allowedCardFilter: "permanent" };
    expect(chooseAgentLibraryCardForRuleChoice(a, choice)?.name).toBe("Craterhoof Behemoth");
    const lands = seat("a", "agent", [], { library: [real("Island", "i1", { zone: "library", typeLine: "Basic Land — Island" }), real("Lightning Bolt", "b", { zone: "library" })] });
    expect(chooseAgentLibraryCardForRuleChoice(lands, choice)?.name).toBe("Island");
  });
  it("the rules advisor (fallback path for non-stack consults) classifies the same clause the same way, with the same 'permanent' filter", () => {
    const shim = emblemAsShimCard(find(setup("agent"), "a").emblems![0]);
    const workflow = deterministicRuleWorkflow({ event: "end_step", actorName: "a", sourceCard: shim, battlefield: [], hand: [], graveyard: [], exile: [], libraryPreview: [] });
    expect(workflow).toMatchObject({ workflow: "search_library_to_battlefield", allowedCardFilter: "permanent", destination: "battlefield", maxChoices: 1 });
  });
  it("an empty library, or one with only instants, does nothing and does not crash", () => {
    for (const lib of [[], [real("Lightning Bolt", "b", { zone: "library" })]] as VisibleCard[][]) {
      const s = setup("agent", lib);
      const trigger = makePhaseStackTrigger(s, "a", emblemAsShimCard(find(s, "a").emblems![0]), "end step") as Extract<ReturnType<typeof makePhaseStackTrigger>, { type: "trigger" }>;
      const out = resolveTriggerEffect(s, trigger);
      expect(find(out, "a").board.battlefield).toEqual([]);
      expect(find(out, "a").library).toHaveLength(lib.length);
      expect(out.events[0].message).toMatch(/finds nothing/);
    }
  });
});

describe("Daretti, Scrap Savant's emblem: artifacts that die come back at the next end step", () => {
  const withDaretti = (battlefield: VisibleCard[], graveyard: VisibleCard[] = []) => {
    const me = withEmblem(seat("a", "agent", battlefield, { board: { hand: [], battlefield, graveyard, exile: [] } }), "Daretti, Scrap Savant");
    return game([me, seat("b", "agent")], "precombat main phase");
  };
  // What a destroy effect does to the board, path-independent: the card leaves the battlefield and lands in the owner's graveyard.
  const kill = (s: GameSession, seatId: string, cardId: string): GameSession => ({
    ...s,
    seats: s.seats.map((x) => {
      if (x.id !== seatId) return x;
      const card = x.board.battlefield.find((c) => c.id === cardId)!;
      return { ...x, board: { ...x.board, battlefield: x.board.battlefield.filter((c) => c.id !== cardId), graveyard: [...(x.board.graveyard ?? []), { ...card, zone: "graveyard" as const }] } };
    })
  });
  const schedule = (before: GameSession, after: GameSession) => findEmblemGraveyardReturns(before, after).reduce((next, trigger) => scheduleDelayedPhaseTrigger(next, trigger), after);

  it("records the artifact that died and returns it at the next end step under its owner's control", () => {
    const before = withDaretti([real("Sol Ring", "ring")]);
    const after = schedule(before, kill(before, "a", "ring"));
    expect(after.delayedPhaseTriggers).toHaveLength(1);
    expect(after.delayedPhaseTriggers![0]).toMatchObject({ phase: "end step", scope: "any", sourceCardName: "Daretti's emblem", returnCard: { cardId: "ring", ownerSeatId: "a", controlSeatId: "a" } });
    // Nothing before the end step; at the end step it goes on the stack and resolves.
    expect(planOffTurnPhaseTriggers(after, "upkeep step", "a").triggers).toEqual([]);
    const plan = planOffTurnPhaseTriggers(after, "end step", "a");
    expect(plan.consumedDelayedIds).toHaveLength(1);
    expect(plan.triggers[0]).toMatchObject({ controllerSeatId: "a", sourceCardName: "Daretti's emblem" });
    const out = resolveTriggerEffect(after, plan.triggers[0]);
    expect(find(out, "a").board.battlefield.map((c) => c.name)).toEqual(["Sol Ring"]);
    expect(find(out, "a").board.graveyard).toEqual([]);
    expect(out.pendingEntries?.some((entry) => entry.card.id === "ring")).toBe(true);
  });
  it("every artifact that died the same turn returns, including artifact creatures", () => {
    const before = withDaretti([real("Sol Ring", "ring"), real("Myr Retriever", "myr"), real("Llanowar Elves", "elf")]);
    let s = kill(before, "a", "ring");
    s = kill(s, "a", "myr");
    s = kill(s, "a", "elf");
    const after = schedule(before, s);
    expect(after.delayedPhaseTriggers!.map((d) => d.returnCard!.cardId).sort()).toEqual(["myr", "ring"]);
    let out = after;
    for (const trigger of planOffTurnPhaseTriggers(after, "end step", "a").triggers) out = resolveTriggerEffect(out, trigger);
    expect(find(out, "a").board.battlefield.map((c) => c.name).sort()).toEqual(["Myr Retriever", "Sol Ring"]);
    expect(find(out, "a").board.graveyard!.map((c) => c.name)).toEqual(["Llanowar Elves"]);
  });
  it("tokens do not return, and an artifact that was already in the graveyard does not trigger", () => {
    const token = { ...real("Sol Ring", "tok"), token: true } as VisibleCard;
    const before = withDaretti([token], [real("Mind Stone", "old", { zone: "graveyard" })]);
    expect(findEmblemGraveyardReturns(before, kill(before, "a", "tok"))).toEqual([]);
    const after = withDaretti([], [real("Mind Stone", "old", { zone: "graveyard" })]);
    expect(findEmblemGraveyardReturns(after, { ...after, turn: 6 })).toEqual([]);
  });
  it("only YOUR graveyard counts: an opponent's artifact dying does not trigger", () => {
    const before = game([withEmblem(seat("a", "agent"), "Daretti, Scrap Savant"), seat("b", "agent", [real("Sol Ring", "oring")])]);
    expect(findEmblemGraveyardReturns(before, kill(before, "b", "oring"))).toEqual([]);
  });
  it("a card that left the graveyard in the meantime does not return (and nothing crashes)", () => {
    const before = withDaretti([real("Sol Ring", "ring")]);
    const after = schedule(before, kill(before, "a", "ring"));
    const exiled: GameSession = { ...after, seats: after.seats.map((x) => (x.id === "a" ? { ...x, board: { ...x.board, graveyard: [] } } : x)) };
    const [trigger] = planOffTurnPhaseTriggers(exiled, "end step", "a").triggers;
    const out = resolveTriggerEffect(exiled, trigger);
    expect(find(out, "a").board.battlefield).toEqual([]);
    expect(out.events[0].message).toMatch(/no longer in a graveyard/);
  });
  it("a death during the end step itself waits for the NEXT end step (the delayed trigger is one-shot, first matching step after creation)", () => {
    const before = { ...withDaretti([real("Sol Ring", "ring")]), phase: "end step" };
    const after = schedule(before, kill(before, "a", "ring"));
    expect(planOffTurnPhaseTriggers(after, "end step", "a").triggers).toEqual([]);
    expect(planOffTurnPhaseTriggers({ ...after, turn: after.turn + 1 }, "end step", "b").triggers).toHaveLength(1);
  });
});
