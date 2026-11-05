// Two real-game bugs, driven with the REAL catalog text:
//  1. Enhanced Surveillance: an agent cast it and at once exiled it ("Exile this enchantment: Shuffle your graveyard into your library.") with an
//     empty graveyard. Agents may now use it only against graveyard hate on the stack, with a nearly-empty library, or with a big graveyard that
//     is not a resource. Humans are untouched (the ability list is theirs to choose from).
//  2. Beledros Witherbloom: "Pay 10 life: Untap all lands you control. Activate only once each turn." had no parser at all (the generic activated-
//     ability parser skipped every "Untap ..." effect), so no button and no legal action existed. Without {T} in its cost summoning sickness
//     never applies (rule 302.6), so it must work the turn Beledros enters.
import { describe, expect, it } from "vitest";
import {
  applyGenericAbilityEffect,
  legalMainPhaseActions,
  legalPriorityActions,
  parseGenericAbilityEffect,
  payGenericManaCost,
  untapAllLandsIsWorthIt
} from "./AppFlow";
import { parseGenericManaAbilities, parseGenericSacrificeAbilities } from "@/lib/activatedAbilities";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();

function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const filler = (id: string, extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Card ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "graveyard", manaValue: 2, oracleText: "", ...extra }) as VisibleCard;
const forest = (id: string, extra: Partial<VisibleCard> = {}) =>
  ({ id, name: "Forest", typeLine: "Basic Land — Forest", colors: [], role: "land", zone: "battlefield", manaValue: 0, oracleText: "({T}: Add {G}.)", producedMana: ["G"], ...extra }) as VisibleCard;

function seat(id: string, battlefield: VisibleCard[], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return {
    id, name: id, kind: "agent", life: 40, commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield, graveyard: [] }, ...extra
  };
}
function session(seats: PlayerSeat[], extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra };
}
const library = (n: number) => Array.from({ length: n }, (_, i) => filler(`lib${i}`, { zone: "library" as const }));
const graveyard = (n: number) => Array.from({ length: n }, (_, i) => filler(`g${i}`));

function surveillanceActions(kind: "agent" | "human", opts: { graveyard: number; library: number; battlefieldExtra?: VisibleCard[]; stackSession?: GameSession }) {
  const es = real("Enhanced Surveillance", "es");
  const me = seat("a", [es, ...(opts.battlefieldExtra ?? [])], { kind, library: library(opts.library), board: { hand: [], battlefield: [es, ...(opts.battlefieldExtra ?? [])], graveyard: graveyard(opts.graveyard) } });
  const s = session([me, seat("o", [])]);
  return { s, me, actions: legalMainPhaseActions(me, true, "a", 1, new Set(), s).filter((x) => x.cardId === "es" && x.actionType === "activate_ability") };
}

describe("Enhanced Surveillance: exile-to-shuffle only when it helps an agent", () => {
  it("parses from real text as an exile-self zone effect", () => {
    expect(parseGenericSacrificeAbilities(real("Enhanced Surveillance", "x").oracleText)[0]).toMatchObject({ exileSelf: true, effect: { kind: "zone_effect", effect: { kind: "graveyard_to_library", scope: "you" } } });
  });

  it("an agent with an EMPTY graveyard is not offered the ability (the reported wasted card)", () => {
    expect(surveillanceActions("agent", { graveyard: 0, library: 60 }).actions).toHaveLength(0);
  });

  it("an agent with a small graveyard and a deep library keeps it too", () => {
    expect(surveillanceActions("agent", { graveyard: 4, library: 60 }).actions).toHaveLength(0);
  });

  it("an agent with a nearly empty library and cards in the graveyard may shuffle (about to deck)", () => {
    expect(surveillanceActions("agent", { graveyard: 5, library: 3 }).actions).toHaveLength(1);
  });

  it("a very small library but an empty graveyard is still pointless", () => {
    expect(surveillanceActions("agent", { graveyard: 0, library: 2 }).actions).toHaveLength(0);
  });

  it("a big graveyard with a thinning library is shuffled back when no recursion plan needs it", () => {
    expect(surveillanceActions("agent", { graveyard: 12, library: 15 }).actions).toHaveLength(1);
  });

  it("but a Meren-style reanimator keeps its big graveyard (it is the engine)", () => {
    const meren = real("Meren of Clan Nel Toth", "meren");
    expect(surveillanceActions("agent", { graveyard: 12, library: 15, battlefieldExtra: [meren] }).actions).toHaveLength(0);
  });

  it("graveyard hate on the stack (Bojuka Bog's exile trigger) makes it a legal response", () => {
    const bog = real("Bojuka Bog", "bog");
    const { s, me } = surveillanceActions("agent", { graveyard: 3, library: 60 });
    const opp = seat("o", [bog]);
    const withBog = { ...s, seats: [me, opp] };
    const trigger = { id: "p1", type: "trigger" as const, actorSeatId: "o", controllerSeatId: "o", sourceCardId: "bog", sourceCardName: "Bojuka Bog", triggerKind: "common" as const, effect: { kind: "exile_graveyard" } as never, message: "" };
    const respond = legalPriorityActions(me, trigger as never, "o", withBog).filter((x) => x.cardId === "es");
    expect(respond).toHaveLength(1);
    // The same response with an EMPTY graveyard has nothing to save.
    const emptied = { ...me, board: { ...me.board, graveyard: [] } };
    expect(legalPriorityActions(emptied, trigger as never, "o", { ...s, seats: [emptied, opp] }).filter((x) => x.cardId === "es")).toHaveLength(0);
  });

  it("a harmless opposing spell on the stack does not justify the shuffle", () => {
    const { s, me } = surveillanceActions("agent", { graveyard: 3, library: 60 });
    const bolt = real("Lightning Bolt", "bolt", { zone: "hand" as const });
    const opp = seat("o", [], { board: { hand: [bolt], battlefield: [], graveyard: [] } });
    const spell = { id: "p2", type: "spell" as const, actorSeatId: "o", cardId: "bolt", cardName: "Lightning Bolt", manaSourceIds: [], message: "" };
    expect(legalPriorityActions(me, spell as never, "o", { ...s, seats: [me, opp] }).filter((x) => x.cardId === "es")).toHaveLength(0);
  });

  it("a HUMAN is unaffected: the ability is still on offer with an empty graveyard", () => {
    expect(surveillanceActions("human", { graveyard: 0, library: 60 }).actions).toHaveLength(1);
  });
});

describe("other self-sacrifice abilities that would be wasted", () => {
  it("Memorial to Folly is not offered with no creature card in the graveyard (the land would be sacrificed for nothing)", () => {
    const memorial = real("Memorial to Folly", "mtf");
    const lands = [forest("f1"), forest("f2"), forest("f3")];
    const me = seat("a", [memorial, ...lands], { library: library(10) });
    const s = session([me, seat("o", [])]);
    expect(legalMainPhaseActions(me, true, "a", 1, new Set(), s).filter((x) => x.cardId === "mtf" && x.abilityKind === "generic_sacrifice")).toHaveLength(0);
  });

  it("Nihil Spellbomb's graveyard exile has no sacrifice parser, so it is never auto-offered (nothing to waste)", () => {
    expect(parseGenericSacrificeAbilities(real("Nihil Spellbomb", "nb").oracleText)).toHaveLength(0);
  });
});

describe("Beledros Witherbloom: Pay 10 life: Untap all lands you control. Activate only once each turn.", () => {
  const beledrosText = real("Beledros Witherbloom", "x").oracleText;
  const mkBoard = (kind: "agent" | "human", life = 40, tappedLands = 5) => {
    const beledros = real("Beledros Witherbloom", "bw", { summoningSick: true });
    const lands = Array.from({ length: 6 }, (_, i) => forest(`f${i}`, { tapped: i < tappedLands }));
    const hand = [real("Craterhoof Behemoth", "hoof", { zone: "hand" as const, manaValue: 6, manaCost: "{4}{G}{G}", typeLine: "Creature — Beast" })];
    const me = seat("a", [beledros, ...lands], { kind, life, board: { hand, battlefield: [beledros, ...lands], graveyard: [] } });
    return { me, s: session([me, seat("o", [])]) };
  };

  it("real text has the life cost, the once-each-turn limiter and no {T}", () => {
    expect(beledrosText).toContain("Pay 10 life: Untap all lands you control. Activate only once each turn.");
    const [ability] = parseGenericManaAbilities(beledrosText);
    expect(ability).toMatchObject({ costLife: 10, costManaText: "" });
    expect(ability.clause).not.toMatch(/\{t\}/i);
    expect(parseGenericAbilityEffect(ability.effectText)).toEqual({ kind: "untap_all_lands" });
  });

  it("a human can activate it the turn Beledros enters (summoning sick), pays 10 life and untaps every land", () => {
    const { me, s } = mkBoard("human");
    const paid = payGenericManaCost(s, "a", "bw", 0)!;
    expect(paid).toBeDefined();
    expect(paid.session.seats[0].life).toBe(30);
    const after = applyGenericAbilityEffect(paid.session, "a", paid.card, paid.effect);
    expect(after.seats[0].board.battlefield.filter((c) => c.typeLine.includes("Land") && c.tapped)).toHaveLength(0);
    expect(me.board.battlefield.find((c) => c.id === "bw")!.summoningSick).toBe(true);
  });

  it("only once each turn; available again next turn", () => {
    const { s } = mkBoard("human");
    const first = payGenericManaCost(s, "a", "bw", 0)!;
    expect(payGenericManaCost(first.session, "a", "bw", 0)).toBeUndefined();
    expect(payGenericManaCost({ ...first.session, turn: 2 }, "a", "bw", 0)).toBeDefined();
  });

  it("cannot pay more life than you have, but may pay exactly your life total", () => {
    expect(payGenericManaCost(mkBoard("human", 9).s, "a", "bw", 0)).toBeUndefined();
    const exact = payGenericManaCost(mkBoard("human", 10).s, "a", "bw", 0)!;
    expect(exact.session.seats[0].life).toBe(0);
  });

  it("an agent is offered it (despite summoning sickness) when the untap unlocks a big spell it could not cast otherwise", () => {
    const { me, s } = mkBoard("agent");
    const found = legalMainPhaseActions(me, true, "a", 1, new Set(), s).filter((x) => x.cardId === "bw" && x.abilityKind === "generic_mana");
    expect(found).toHaveLength(1);
  });

  it("an agent is NOT offered it when it unlocks nothing (lands already untapped / nothing to cast)", () => {
    const { me, s } = mkBoard("agent", 40, 0);
    expect(legalMainPhaseActions(me, true, "a", 1, new Set(), s).filter((x) => x.cardId === "bw" && x.abilityKind === "generic_mana")).toHaveLength(0);
    const idle = { ...me, board: { ...me.board, hand: [] } };
    expect(legalMainPhaseActions(idle, true, "a", 1, new Set(), { ...s, seats: [idle, s.seats[1]] }).filter((x) => x.cardId === "bw" && x.abilityKind === "generic_mana")).toHaveLength(0);
  });

  it("an agent never pays life down to an unsafe total, even for value", () => {
    const { me, s } = mkBoard("agent", 25);
    expect(untapAllLandsIsWorthIt(me, 10, s.seats)).toBe(false);
    expect(untapAllLandsIsWorthIt(mkBoard("agent", 30).me, 10, s.seats)).toBe(true);
  });

  it("the once-each-turn mark keeps a second activation off the agent's list in the same turn", () => {
    const { s } = mkBoard("agent");
    const first = payGenericManaCost(s, "a", "bw", 0)!;
    const me2 = first.session.seats[0];
    expect(legalMainPhaseActions(me2, true, "a", 1, new Set(), first.session).filter((x) => x.cardId === "bw" && x.abilityKind === "generic_mana")).toHaveLength(0);
  });
});
