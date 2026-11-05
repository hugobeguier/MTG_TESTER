// Meren of Clan Nel Toth (decks/custom/Meren of Clan Nel Toth Built on my Own.txt) audit: every card with a trigger, activated ability, replacement,
// choice or target that no earlier deck audit covered, driven with its REAL catalog text through the same entry points the live game uses.
// Cards covered by earlier audits (Meren.txt, the sacrifice decks, Saheeli, Breena, per-card AppFlow.*.test.ts) are not repeated here.
import { describe, expect, it } from "vitest";
import {
  applyDeterministicPhaseTrigger,
  applyEntersWithCounterReplacements,
  applySpellExtraEffect,
  destroyCreatures,
  findCommonTriggersForPermanentDied,
  findCommonTriggersForPermanentEntered,
  findSacrificeWatcherTriggers,
  lifeGainedThisTurn,
  resolveDeferredChoice,
  resolveTriggerEffect,
  applyGenericTapEffect,
  applySacrificeEffect,
  payGenericSacrificeCost,
  forcedAttackers,
  legalMainPhaseActions,
  spellResolutionDestination,
  hasResolvableTarget
} from "./AppFlow";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
import { deterministicRuleWorkflow } from "@/lib/rulesAdvisor";
import { etbEffectText } from "@/lib/oracleClauses";
import { parseGenericSacrificeAbilities, parseGenericTapAbilities } from "@/lib/activatedAbilities";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();

function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const bear = (id: string, extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;
const lib = (n: number, prefix = "l") => Array.from({ length: n }, (_, i) => bear(`${prefix}${i}`, { zone: "library" as const }));
function seat(id: string, battlefield: VisibleCard[], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return {
    id, name: id, kind: "agent", life: 40, commanderDamage: {},
    zones: { library: (extra.library ?? []).length, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield, graveyard: [] }, ...extra
  };
}
function session(seats: PlayerSeat[], extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra };
}
const mine = (s: GameSession) => s.seats.find((x) => x.id === "a")!;

// The live game drains session.pendingDeaths in a useEffect; this is the same query (see AppFlow's pendingDeaths effect and drainDeathTriggers).
function triggersAfterDeaths(s: GameSession) {
  const deaths = s.pendingDeaths ?? [];
  return [...deaths.flatMap((d) => findCommonTriggersForPermanentDied(s, d.seatId, d.card, d.attachedSourceIds, deaths)), ...findSacrificeWatcherTriggers(s, deaths)];
}
const sacrifice = (s: GameSession, ids: string[]) => destroyCreatures(s, ids.map((id) => ({ seatId: "a", cardId: id, message: `a sacrifices ${id}.` })), "test");
const destroy = (s: GameSession, ids: string[]) => destroyCreatures(s, ids.map((id) => ({ seatId: "a", cardId: id, message: `${id} is destroyed.` })), "test");

describe("a token's granted text is not the card's own death/phase trigger (Beledros, Ribtruss Roaster, Moseo)", () => {
  it("Beledros dying makes no Pest and Ribtruss Roaster dying gains no life", () => {
    for (const name of ["Beledros Witherbloom", "Ribtruss Roaster", "Eccentric Pestfinder / Turn Stones"]) {
      const card = real(name, "src");
      const s = session([seat("a", [card]), seat("o", [])]);
      const after = destroy(s, ["src"]);
      expect(triggersAfterDeaths(after).filter((t) => t.sourceCardId === "src"), name).toEqual([]);
    }
  });
});

describe("Dina, Essence Brewer: draws when you sacrifice a creature, once each turn", () => {
  it("two sacrifices in one turn draw one card; a destroyed creature draws none", () => {
    const dina = real("Dina, Essence Brewer", "dina");
    const base = session([seat("a", [dina, bear("b1"), bear("b2"), bear("b3")], { library: lib(5) }), seat("o", [])], { turn: 3 });
    let s = sacrifice(base, ["b1", "b2"]);
    const triggers = triggersAfterDeaths(s).filter((t) => t.sourceCardId === "dina");
    expect(triggers.length).toBeGreaterThan(0);
    for (const t of triggers) s = resolveTriggerEffect(s, t);
    expect(mine(s).board.hand.length).toBe(1);
    // a later sacrifice the same turn does nothing more
    const later = sacrifice({ ...s, pendingDeaths: undefined }, ["b3"]);
    let after = later;
    for (const t of triggersAfterDeaths(later).filter((x) => x.sourceCardId === "dina")) after = resolveTriggerEffect(after, t);
    expect(mine(after).board.hand.length).toBe(1);
    // destroyed (not sacrificed) creature: no Dina trigger
    expect(triggersAfterDeaths(destroy(base, ["b1"])).filter((t) => t.sourceCardId === "dina")).toEqual([]);
  });
});

describe("Savra, Queen of the Golgari", () => {
  it("sacrificing a black creature offers the pay-2-life edict; a green one offers 2 life", () => {
    const savra = real("Savra, Queen of the Golgari", "savra");
    const s0 = session([seat("a", [savra, bear("blk", { colors: ["B"] }), bear("grn", { colors: ["G"] })]), seat("o", [bear("victim")])]);
    const black = triggersAfterDeaths(sacrifice(s0, ["blk"])).filter((t) => t.sourceCardId === "savra");
    expect(black).toHaveLength(1);
    expect(black[0].effect).toMatchObject({ kind: "lose_life", amount: 2, optional: true, then: { kind: "each_opponent_sacrifices" } });
    const resolved = resolveTriggerEffect(sacrifice(s0, ["blk"]), black[0]);
    expect(mine(resolved).life).toBe(38);
    expect(resolved.seats.find((x) => x.id === "o")!.board.battlefield.some((c) => c.id === "victim")).toBe(false);

    const green = triggersAfterDeaths(sacrifice(s0, ["grn"])).filter((t) => t.sourceCardId === "savra");
    expect(green).toHaveLength(1);
    expect(green[0].effect).toMatchObject({ kind: "gain_life", amount: 2, optional: true });
    // a creature that is both black and green sees both halves
    const both = session([seat("a", [savra, bear("bg", { colors: ["B", "G"] })]), seat("o", [])]);
    expect(triggersAfterDeaths(sacrifice(both, ["bg"])).filter((t) => t.sourceCardId === "savra")).toHaveLength(2);
  });
});

describe("Morbid Opportunist: one or more other creatures die, draw once each turn", () => {
  it("a wipe killing three creatures draws a single card; its own death does not count", () => {
    const opp = real("Morbid Opportunist", "mo");
    const base = session([seat("a", [opp, bear("b1"), bear("b2"), bear("b3")], { library: lib(4) }), seat("o", [bear("o1")])]);
    let s = destroyCreatures(base, [{ seatId: "a", cardId: "b1", message: "x destroyed" }, { seatId: "a", cardId: "b2", message: "x destroyed" }, { seatId: "o", cardId: "o1", message: "x destroyed" }], "test");
    const triggers = triggersAfterDeaths(s).filter((t) => t.sourceCardId === "mo");
    expect(triggers).toHaveLength(1);
    for (const t of triggers) s = resolveTriggerEffect(s, t);
    expect(mine(s).board.hand.length).toBe(1);
    // the same turn again: nothing
    const again = destroy({ ...s, pendingDeaths: undefined }, ["b3"]);
    let after = again;
    for (const t of triggersAfterDeaths(again).filter((x) => x.sourceCardId === "mo")) after = resolveTriggerEffect(after, t);
    expect(mine(after).board.hand.length).toBe(1);
    // only itself dying: no trigger
    expect(triggersAfterDeaths(destroy(base, ["mo"])).filter((t) => t.sourceCardId === "mo")).toEqual([]);
  });
});

describe("Gorma, the Gullet", () => {
  it("grows when another creature you control dies, and later nontoken creatures enter with counters for each death this turn", () => {
    const gorma = real("Gorma, the Gullet", "gorma", { power: "3", toughness: "3" });
    const base = session([seat("a", [gorma, bear("b1"), bear("b2")]), seat("o", [])]);
    let s = destroy(base, ["b1", "b2"]);
    for (const t of triggersAfterDeaths(s).filter((x) => x.sourceCardId === "gorma")) s = resolveTriggerEffect(s, t);
    expect(mine(s).board.battlefield.find((c) => c.id === "gorma")!.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(2);
    expect(s.creaturesDiedThisTurn).toEqual({ turn: 1, bySeat: { a: 2 } });
    // a nontoken creature entering now gets two counters; a token gets none; another turn resets it
    const entering = bear("n1");
    const withEntering = { ...s, seats: s.seats.map((x) => (x.id === "a" ? { ...x, board: { ...x.board, battlefield: [...x.board.battlefield, entering, bear("tok", { token: true })] } } : x)) };
    expect(mine(applyEntersWithCounterReplacements(withEntering, "a", "n1")).board.battlefield.find((c) => c.id === "n1")!.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(2);
    expect(mine(applyEntersWithCounterReplacements(withEntering, "a", "tok")).board.battlefield.find((c) => c.id === "tok")!.counters).toBeUndefined();
    expect(mine(applyEntersWithCounterReplacements({ ...withEntering, turn: 2 }, "a", "n1")).board.battlefield.find((c) => c.id === "n1")!.counters).toBeUndefined();
  });
});

describe("Gorma, the Gullet: real oracle wording and who gets the counters", () => {
  const counters = (s: GameSession, seatId: string, id: string) => s.seats.find((x) => x.id === seatId)!.board.battlefield.find((c) => c.id === id)!.counters?.find((c) => c.kind === "+1/+1")?.count;
  const place = (s: GameSession, seatId: string, cards: VisibleCard[]) => ({ ...s, seats: s.seats.map((x) => (x.id === seatId ? { ...x, board: { ...x.board, battlefield: [...x.board.battlefield, ...cards] } } : x)) });
  it("uses the real text: nontoken creatures you control, deaths under your control this turn", () => {
    const text = real("Gorma, the Gullet", "g").oracleText;
    expect(text).toMatch(/Nontoken creatures you control enter with an additional \+1\/\+1 counter on them for each creature that died under your control this turn/);
  });
  it("Gorma entering after deaths gets no counters from its own ability", () => {
    const dead = destroy(session([seat("a", [bear("d1"), bear("d2")]), seat("o", [])]), ["d1", "d2"]);
    const withGorma = place(dead, "a", [real("Gorma, the Gullet", "gorma", { power: "3", toughness: "3" })]);
    expect(counters(applyEntersWithCounterReplacements(withGorma, "a", "gorma"), "a", "gorma")).toBeUndefined();
  });
  it("another creature entering gets one counter per creature that died under its controller this turn, tokens included in the count", () => {
    const base = session([seat("a", [real("Gorma, the Gullet", "gorma"), bear("d1"), bear("tok", { token: true }), bear("d3")], { kind: "human" }), seat("o", [bear("od")])]);
    let s = destroy(base, ["d1", "tok"]);
    s = destroyCreatures(s, [{ seatId: "o", cardId: "od", message: "od dies." }], "test");
    expect(s.creaturesDiedThisTurn).toEqual({ turn: 1, bySeat: { a: 2, o: 1 } });
    s = place(s, "a", [bear("n1")]);
    expect(counters(applyEntersWithCounterReplacements(s, "a", "n1"), "a", "n1")).toBe(2);
  });
  it("only counts the Gorma controller's own deaths, and resets on a new turn", () => {
    const base = session([seat("a", [real("Gorma, the Gullet", "gorma")]), seat("o", [bear("od")])]);
    let s = destroyCreatures(base, [{ seatId: "o", cardId: "od", message: "od dies." }], "test");
    s = place(s, "a", [bear("n1")]);
    expect(counters(applyEntersWithCounterReplacements(s, "a", "n1"), "a", "n1")).toBeUndefined();
    const died = destroy(place(base, "a", [bear("d1")]), ["d1"]);
    const entered = place(died, "a", [bear("n2")]);
    expect(counters(applyEntersWithCounterReplacements(entered, "a", "n2"), "a", "n2")).toBe(1);
    expect(counters(applyEntersWithCounterReplacements({ ...entered, turn: 2 }, "a", "n2"), "a", "n2")).toBeUndefined();
  });
});

describe("Willow Geist: gains life equal to its power when it dies", () => {
  it("counts its +1/+1 counters", () => {
    const geist = real("Willow Geist", "wg", { power: "2", toughness: "2", counters: [{ kind: "+1/+1", count: 2 }] });
    const base = session([seat("a", [geist]), seat("o", [])]);
    let s = destroy(base, ["wg"]);
    const triggers = triggersAfterDeaths(s).filter((t) => t.sourceCardId === "wg");
    expect(triggers).toHaveLength(1);
    s = resolveTriggerEffect(s, triggers[0]);
    expect(mine(s).life).toBe(44);
  });
});

describe("end step: if you gained life this turn (Witch of the Moors, Moseo)", () => {
  const endStep = (s: GameSession, card: VisibleCard) => applyDeterministicPhaseTrigger(s, "a", card, "end step" as never)!;
  it("Witch of the Moors: each opponent sacrifices and you regrow a creature, only after gaining life", () => {
    const witch = real("Witch of the Moors", "witch");
    const dead = bear("dead", { zone: "graveyard" as const, manaValue: 4 });
    const s = session([seat("a", [witch], { life: 40, lifeAtTurnStart: 40, board: { hand: [], battlefield: [witch], graveyard: [dead] } }), seat("o", [bear("o1")])]);
    const none = endStep(s, witch);
    expect(none.seats.find((x) => x.id === "o")!.board.battlefield).toHaveLength(1);
    const gained = { ...s, seats: s.seats.map((x) => (x.id === "a" ? { ...x, life: 43 } : x)) };
    const after = endStep(gained, witch);
    expect(after.seats.find((x) => x.id === "o")!.board.battlefield).toHaveLength(0);
    expect(mine(after).board.hand.map((c) => c.id)).toEqual(["dead"]);
  });
  it("Moseo: returns a creature with mana value up to the life gained", () => {
    const moseo = real("Moseo, Vein's New Dean", "moseo");
    const cheap = bear("cheap", { zone: "graveyard" as const, manaValue: 2 });
    const pricey = bear("pricey", { zone: "graveyard" as const, manaValue: 6 });
    const s = session([seat("a", [moseo], { life: 43, lifeAtTurnStart: 40, board: { hand: [], battlefield: [moseo], graveyard: [pricey, cheap] } }), seat("o", [])]);
    expect(lifeGainedThisTurn(mine(s))).toBe(3);
    const after = endStep(s, moseo);
    expect(mine(after).board.battlefield.map((c) => c.id)).toContain("cheap");
    expect(mine(after).board.battlefield.map((c) => c.id)).not.toContain("pricey");
    expect(endStep({ ...s, seats: s.seats.map((x) => (x.id === "a" ? { ...x, life: 40 } : x)) }, moseo).seats[0].board.battlefield.map((c) => c.id)).toEqual(["moseo"]);
  });
  it("a human is asked which creature to return (deferred choice), with a 'none' option", () => {
    const witch = real("Witch of the Moors", "witch");
    const a = bear("a1", { zone: "graveyard" as const, manaValue: 2 });
    const b = bear("b1", { zone: "graveyard" as const, manaValue: 5 });
    const s = session([seat("a", [witch], { kind: "human", life: 42, lifeAtTurnStart: 40, board: { hand: [], battlefield: [witch], graveyard: [a, b] } }), seat("o", [])]);
    const after = endStep(s, witch);
    const prompt = after.pendingPlayerChoices?.[0];
    expect(prompt?.options.map((o) => o.value)).toEqual(["b1", "a1", "none"]);
    const picked = resolveDeferredChoice(after, "a", "witch", "Witch of the Moors", prompt!.resolver, prompt!.data, "a1");
    expect(mine(picked).board.hand.map((c) => c.id)).toEqual(["a1"]);
  });
});

describe("Ribtruss Roaster: devour and the end step Pests", () => {
  it("an agent devours its tokens, then makes a Pest per +1/+1 counter at the end step (and none while it has no counters)", () => {
    const roaster = real("Ribtruss Roaster", "rr", { power: "5", toughness: "4" });
    const s = session([seat("a", [roaster, bear("t1", { token: true }), bear("t2", { token: true }), bear("keep")]), seat("o", [])]);
    const entered = applyEntersWithCounterReplacements(s, "a", "rr");
    const live = mine(entered).board.battlefield;
    expect(live.map((c) => c.id).sort()).toEqual(["keep", "rr"]);
    expect(live.find((c) => c.id === "rr")!.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(2);
    const end = applyDeterministicPhaseTrigger(entered, "a", live.find((c) => c.id === "rr")!, "end step" as never)!;
    const pests = mine(end).board.battlefield.filter((c) => c.token);
    expect(pests).toHaveLength(2);
    expect(pests[0].colors.sort()).toEqual(["B", "G"]);
    expect(pests[0].oracleText).toMatch(/gain 1 life/i);
    expect(mine(end).life).toBe(40);
    const bare = applyDeterministicPhaseTrigger(session([seat("a", [roaster]), seat("o", [])]), "a", roaster, "end step" as never)!;
    expect(mine(bare).board.battlefield.filter((c) => c.token)).toHaveLength(0);
  });
  it("a human is asked which creatures to devour, one at a time, with a Done option", () => {
    const roaster = real("Ribtruss Roaster", "rr", { power: "5", toughness: "4" });
    const s = session([seat("a", [roaster, bear("x1"), bear("x2")], { kind: "human" }), seat("o", [])]);
    const asked = applyEntersWithCounterReplacements(s, "a", "rr");
    const prompt = asked.pendingPlayerChoices![0];
    expect(prompt.options.map((o) => o.value)).toEqual(["x1", "x2", "done"]);
    const next = resolveDeferredChoice(asked, "a", "rr", "Ribtruss Roaster", prompt.resolver, prompt.data, "x1");
    const second = next.pendingPlayerChoices!.at(-1)!;
    expect(second.options.map((o) => o.value)).toEqual(["x2", "done"]);
    const done = resolveDeferredChoice(next, "a", "rr", "Ribtruss Roaster", second.resolver, second.data, "done");
    expect(mine(done).board.battlefield.map((c) => c.id).sort()).toEqual(["rr", "x2"]);
    expect(mine(done).board.battlefield.find((c) => c.id === "rr")!.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(1);
  });
});

describe("Old Rutstein: mill a card and get the matching token (enters and each upkeep)", () => {
  const withTop = (top: VisibleCard, extra: Partial<PlayerSeat> = {}) => {
    const rutstein = real("Old Rutstein", "ru");
    return { rutstein, s: session([seat("a", [rutstein], { library: [top, ...lib(3)], ...extra }), seat("o", [])]) };
  };
  it("fires on entering and at upkeep; land -> Treasure, creature -> Insect, other -> Blood", () => {
    const land = bear("land", { typeLine: "Basic Land — Forest", role: "land", zone: "library" as const });
    const { rutstein, s } = withTop(land);
    const entering = findCommonTriggersForPermanentEntered(s, "a", rutstein).filter((t) => t.sourceCardId === "ru");
    expect(entering.map((t) => t.effect.kind)).toEqual(["mill_with_rewards"]);
    const afterEnter = resolveTriggerEffect(s, entering[0]);
    expect(mine(afterEnter).board.graveyard!.map((c) => c.id)).toEqual(["land"]);
    expect(mine(afterEnter).board.battlefield.some((c) => c.token && /Treasure/.test(c.name))).toBe(true);

    const creature = bear("cr", { zone: "library" as const });
    const up = applyDeterministicPhaseTrigger(withTop(creature).s, "a", rutstein, "upkeep step" as never)!;
    expect(mine(up).board.battlefield.some((c) => c.token && /Insect/i.test(c.typeLine + c.name))).toBe(true);

    const spell = bear("sp", { typeLine: "Sorcery", role: "spell", zone: "library" as const });
    const blood = applyDeterministicPhaseTrigger(withTop(spell).s, "a", rutstein, "upkeep step" as never)!;
    expect(mine(blood).board.battlefield.some((c) => c.token && /Blood/.test(c.name))).toBe(true);
  });
});

describe("Deathbonnet Sprout / Hulk (upkeep, double-faced)", () => {
  it("Sprout mills a card and only transforms once three creature cards are in the graveyard", () => {
    const sprout = real("Deathbonnet Sprout / Deathbonnet Hulk", "ds");
    const grave = (n: number) => Array.from({ length: n }, (_, i) => bear(`g${i}`, { zone: "graveyard" as const }));
    const two = session([seat("a", [sprout], { library: lib(4), board: { hand: [], battlefield: [sprout], graveyard: grave(1) } }), seat("o", [])]);
    const stay = applyDeterministicPhaseTrigger(two, "a", sprout, "upkeep step" as never)!;
    expect(mine(stay).board.graveyard).toHaveLength(2);
    expect(mine(stay).board.battlefield[0].name).toBe(sprout.name);
    const three = session([seat("a", [sprout], { library: lib(4), board: { hand: [], battlefield: [sprout], graveyard: grave(2) } }), seat("o", [])]);
    const flipped = applyDeterministicPhaseTrigger(three, "a", sprout, "upkeep step" as never)!;
    expect(mine(flipped).board.graveyard).toHaveLength(3);
    expect(flipped.events[0].message).toMatch(/transforms/);
  });
  it("Hulk exiles an opponent's creature card from a graveyard for a counter; a human is asked", () => {
    const sprout = real("Deathbonnet Sprout / Deathbonnet Hulk", "ds", { unlockedFaceIndices: [1] });
    const theirs = bear("theirs", { zone: "graveyard" as const });
    const base = (kind: "agent" | "human") => session([seat("a", [sprout], { kind }), seat("o", [], { board: { hand: [], battlefield: [], graveyard: [theirs] } })]);
    const done = applyDeterministicPhaseTrigger(base("agent"), "a", sprout, "upkeep step" as never)!;
    expect(done.seats.find((x) => x.id === "o")!.board.graveyard).toHaveLength(0);
    expect(mine(done).board.battlefield[0].counters?.find((c) => c.kind === "+1/+1")?.count).toBe(1);
    const asked = applyDeterministicPhaseTrigger(base("human"), "a", sprout, "upkeep step" as never)!;
    expect(asked.pendingPlayerChoices![0].options.map((o) => o.value)).toEqual(["o:theirs", "none"]);
  });
});

describe("Beledros Witherbloom: a Pest at every upkeep", () => {
  it("creates one 1/1 Pest", () => {
    const beledros = real("Beledros Witherbloom", "bw");
    const after = applyDeterministicPhaseTrigger(session([seat("a", [beledros]), seat("o", [])]), "a", beledros, "upkeep step" as never)!;
    expect(mine(after).board.battlefield.filter((c) => c.token)).toHaveLength(1);
  });
});

// Spells: parsed from the card's real text with the same call the live resolver and the headless simulator use, then applied.
function cast(s: GameSession, name: string, id: string, chosenX?: number, face?: number): { session: GameSession; kinds: string[] } {
  const found = real(name, id, { zone: "hand" as const });
  const text = face === undefined ? found.oracleText : found.faces![face].oracleText;
  const effects = parseSpellExtraEffects(etbEffectText(text));
  let next = s;
  for (const effect of effects) next = applySpellExtraEffect(next, "a", { ...found, name: face === undefined ? found.name : found.faces![face].name, oracleText: text }, effect, chosenX);
  return { session: next, kinds: effects.map((e) => e.kind) };
}

describe("Dark Ritual and Culling Ritual", () => {
  it("Dark Ritual parses to a fixed BBB (the mana is added to a human's pool by the resolver)", () => {
    expect(cast(session([seat("a", [])]), "Dark Ritual", "dr").kinds).toEqual(["add_fixed_mana"]);
    expect(parseSpellExtraEffects(etbEffectText(real("Dark Ritual", "x").oracleText))[0]).toMatchObject({ kind: "add_fixed_mana", color: "B", amount: 3 });
  });
  it("Culling Ritual destroys every nonland permanent with mana value 2 or less (tokens too), keeps lands and bigger permanents", () => {
    const cheap = bear("cheap", { manaValue: 1 });
    const token = bear("tok", { token: true, manaValue: 0 });
    const big = bear("big", { manaValue: 4 });
    const land = bear("land", { typeLine: "Land", role: "land", manaValue: 0 });
    const artifact = bear("rock", { typeLine: "Artifact", role: "permanent", manaValue: 2 });
    const s = session([seat("a", [cheap, big, land, artifact]), seat("o", [token, bear("theirs", { manaValue: 2 })])]);
    const result = cast(s, "Culling Ritual", "cr");
    expect(result.kinds).toEqual(["destroy_each_nonland_at_most"]);
    expect(mine(result.session).board.battlefield.map((c) => c.id).sort()).toEqual(["big", "land"]);
    expect(result.session.seats.find((x) => x.id === "o")!.board.battlefield).toHaveLength(0);
    expect(mine(result.session).board.graveyard!.map((c) => c.id)).toContain("rock");
  });
});

describe("Mulch", () => {
  it("lands among the top four go to hand, the rest to the graveyard", () => {
    const top = [bear("c1", { zone: "library" as const }), bear("f1", { typeLine: "Basic Land — Forest", role: "land", zone: "library" as const }), bear("c2", { zone: "library" as const }), bear("f2", { typeLine: "Basic Land — Forest", role: "land", zone: "library" as const })];
    const s = session([seat("a", [], { library: [...top, ...lib(3)] }), seat("o", [])]);
    const result = cast(s, "Mulch", "mu");
    expect(result.kinds).toEqual(["mulch"]);
    expect(mine(result.session).board.hand.map((c) => c.id).sort()).toEqual(["f1", "f2"]);
    expect(mine(result.session).board.graveyard!.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(mine(result.session).library).toHaveLength(3);
  });
});

describe("Deadly Brew", () => {
  it("every player sacrifices a creature; the caster then returns ANOTHER permanent card from the graveyard", () => {
    const old = bear("old", { zone: "graveyard" as const, manaValue: 5 });
    const s = session([seat("a", [bear("mine1", { manaValue: 1 })], { board: { hand: [], battlefield: [bear("mine1", { manaValue: 1 })], graveyard: [old] } }), seat("o", [bear("t1"), bear("t2", { power: "5" })])]);
    const result = cast(s, "Deadly Brew", "db");
    expect(result.kinds).toEqual(["each_player_sacrifices_then_regrow"]);
    expect(mine(result.session).board.battlefield).toHaveLength(0);
    expect(mine(result.session).board.hand.map((c) => c.id)).toEqual(["old"]);
    expect(result.session.seats.find((x) => x.id === "o")!.board.battlefield.map((c) => c.id)).toEqual(["t2"]);
  });
  it("no creature of the caster's own: nothing returns", () => {
    const old = bear("old", { zone: "graveyard" as const });
    const s = session([seat("a", [], { board: { hand: [], battlefield: [], graveyard: [old] } }), seat("o", [bear("t1")])]);
    const result = cast(s, "Deadly Brew", "db");
    expect(mine(result.session).board.hand).toHaveLength(0);
  });
  it("a human caster with several creatures is asked what to sacrifice and what to return", () => {
    const old = bear("old", { zone: "graveyard" as const });
    const board = [bear("m1"), bear("m2")];
    const s = session([seat("a", board, { kind: "human", board: { hand: [], battlefield: board, graveyard: [old] } }), seat("o", [])]);
    const result = cast(s, "Deadly Brew", "db");
    expect(result.session.pendingSacrificeChoices?.[0]).toMatchObject({ seatId: "a", typeFilter: "creature or planeswalker" });
    expect(result.session.pendingPlayerChoices?.[0].options.map((o) => o.value)).toEqual(["old", "none"]);
  });
});

describe("Exsanguinate (Stensian Sanguinist's back half)", () => {
  it("each opponent loses X and the caster gains the total", () => {
    const result = cast(session([seat("a", []), seat("o", []), seat("p", [])]), "Stensian Sanguinist / Exsanguinate", "ex", 5, 1);
    expect(result.kinds).toEqual(["drain_x_each_opponent"]);
    expect(result.session.seats.map((x) => x.life)).toEqual([50, 35, 35]);
  });
});

describe("Find // Finality", () => {
  it("Find returns up to two creature cards from the graveyard (agent: the two best)", () => {
    const g = [bear("g1", { zone: "graveyard" as const, manaValue: 1 }), bear("g2", { zone: "graveyard" as const, manaValue: 6 }), bear("g3", { zone: "graveyard" as const, manaValue: 3 })];
    const s = session([seat("a", [], { board: { hand: [], battlefield: [], graveyard: g } }), seat("o", [])]);
    const result = cast(s, "Find / Finality", "ff", undefined, 0);
    expect(result.kinds).toEqual(["return_creatures_from_graveyard"]);
    expect(mine(result.session).board.hand.map((c) => c.id).sort()).toEqual(["g2", "g3"]);
  });
  it("Finality puts the counters on the best creature that survives, then shrinks everything by 4", () => {
    const s = session([seat("a", [bear("small", { power: "2", toughness: "2" }), bear("tank", { power: "3", toughness: "3" })]), seat("o", [bear("o1", { toughness: "4", power: "4" })])]);
    const result = cast(s, "Find / Finality", "ff", undefined, 1);
    expect(result.kinds).toEqual(["counters_then_mass_shrink"]);
    const tank = mine(result.session).board.battlefield.find((c) => c.id === "tank")!;
    expect(tank.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(2);
    expect(mine(result.session).board.battlefield.find((c) => c.id === "small")!.counters).toBeUndefined();
    expect(effectiveToughnessOf(tank, result.session)).toBeGreaterThan(0);
  });
  it("Finality asks a human which creature gets the counters", () => {
    const s = session([seat("a", [bear("x1"), bear("x2")], { kind: "human" }), seat("o", [])]);
    const result = cast(s, "Find / Finality", "ff", undefined, 1);
    expect(result.session.pendingPlayerChoices?.[0].options.map((o) => o.value)).toEqual(["x1", "x2", "none"]);
  });
});

function effectiveToughnessOf(card: VisibleCard, s: GameSession): number {
  const live = s.seats.flatMap((x) => x.board.battlefield).find((c) => c.id === card.id)!;
  return Number(live.toughness) + (live.counters?.find((c) => c.kind === "+1/+1")?.count ?? 0) + (live.temporaryToughnessBonus ?? 0);
}

describe("Eldritch Evolution", () => {
  const text = () => real("Eldritch Evolution", "ee", { zone: "hand" as const });
  it("searches for a creature with mana value 2 + the sacrificed creature's, and is exiled instead of going to the graveyard", () => {
    const stamped = { ...text(), sacrificedManaValue: 3 };
    const workflow = deterministicRuleWorkflow({ event: "spell_resolved", actorName: "a", sourceCard: stamped, battlefield: [], hand: [], graveyard: [], exile: [], libraryPreview: [] } as never);
    expect(workflow).toMatchObject({ workflow: "search_library_to_battlefield", manaValueRestriction: { op: "lte", value: 5 } });
    const spell = text();
    const s = session([seat("a", [], { board: { hand: [spell], battlefield: [], graveyard: [] } }), seat("o", [])]);
    expect(spellResolutionDestination(s, { id: "x", type: "spell", actorSeatId: "a", cardId: "ee", cardName: "Eldritch Evolution", cardTypeLine: spell.typeLine, manaSourceIds: [], message: "" } as never)).toBe("exile");
  });
});

describe("Immoral Bargain and other X-sacrifice costs", () => {
  it("is not offered as castable (an 'sacrifice X creatures' cost is not implemented), so nothing is paid for no effect", () => {
    const bargain = real("Immoral Bargain", "ib", { zone: "hand" as const });
    const s = session([seat("a", [bear("m1"), bear("m2")], { board: { hand: [bargain], battlefield: [bear("m1"), bear("m2")], graveyard: [] } }), seat("o", [bear("t")])]);
    expect(hasResolvableTarget(s, "a", bargain)).toBe(false);
  });
});

describe("Skull Prophet: {T}: mill two cards", () => {
  it("parses as a self-mill tap ability and mills two; an agent is only offered it while the library is deep", () => {
    const prophet = real("Skull Prophet", "sp");
    const ability = parseGenericTapAbilities(prophet.oracleText).find((a) => a.effect.kind === "zone_effect");
    expect(ability?.effect).toMatchObject({ kind: "zone_effect", effect: { kind: "mill", amount: 2, scope: "you" } });
    const deep = session([seat("a", [prophet], { library: lib(30) }), seat("o", [])]);
    const milled = applyGenericTapEffect(deep, "a", "sp", "Skull Prophet", ability!.effect, ability!.clause);
    expect(mine(milled).board.graveyard).toHaveLength(2);
    expect(mine(milled).library).toHaveLength(28);
    const offered = (s: GameSession) => legalMainPhaseActions(mine(s), true, "a", 1, new Set(), s).some((a) => a.abilityKind === "generic_tap" && a.cardId === "sp");
    expect(offered(deep)).toBe(true);
    expect(offered(session([seat("a", [prophet], { library: lib(8) }), seat("o", [])]))).toBe(false);
  });
});

describe("Izoni, Thousand-Eyed: {B}{G}, sacrifice another creature: gain 1 life and draw a card", () => {
  it("gains the life as well as drawing", () => {
    const izoni = real("Izoni, Thousand-Eyed", "iz");
    const [ability] = parseGenericSacrificeAbilities(izoni.oracleText);
    expect(ability.effect).toMatchObject({ kind: "draw_cards", amount: 1, alsoGainLife: 1 });
    const swamp = real("Swamp", "sw", { typeLine: "Basic Land — Swamp", oracleText: "({T}: Add {B}.)", producedMana: ["B"] } as Partial<VisibleCard>);
    const forest = real("Forest", "fo", { typeLine: "Basic Land — Forest", oracleText: "({T}: Add {G}.)", producedMana: ["G"] } as Partial<VisibleCard>);
    const s = session([seat("a", [izoni, bear("fodder"), swamp, forest], { library: lib(3) }), seat("o", [])]);
    const paid = payGenericSacrificeCost(s, "a", "iz", 0);
    expect(paid).toBeDefined();
    const after = applySacrificeEffect(paid!.session, "a", izoni, ability.effect, ability.clause, paid!.sacrificed);
    expect(mine(after).board.hand).toHaveLength(1);
    expect(mine(after).life).toBe(41);
  });
});

describe("Toski, Bearer of Secrets attacks each combat if able", () => {
  it("is forced to attack", () => {
    const toski = real("Toski, Bearer of Secrets", "tk");
    const s = session([seat("a", [toski]), seat("o", [bear("blocker")])]);
    expect(forcedAttackers(s, mine(s)).map((f) => f.cardId)).toEqual(["tk"]);
  });
});

describe("Dina, Essence Brewer's activated ability", () => {
  it("sacrifices another creature, gains X life and puts X counters on a creature (agent: the strongest; human: asked)", () => {
    const dina = real("Dina, Essence Brewer", "dina", { power: "2", toughness: "2" });
    const lands = ["l1", "l2"].map((id) => real("Swamp", id, { typeLine: "Basic Land — Swamp", oracleText: "({T}: Add {B}.)", producedMana: ["B"] } as Partial<VisibleCard>));
    const [ability] = parseGenericSacrificeAbilities(dina.oracleText);
    expect(ability.effect.kind).toBe("gain_life_counters_by_sacrificed_power");
    const run = (kind: "agent" | "human") => {
      const s = session([seat("a", [dina, bear("fodder", { power: "3" }), bear("big", { power: "4" }), ...lands], { kind }), seat("o", [])]);
      const paid = payGenericSacrificeCost(s, "a", "dina", 0);
      expect(paid).toBeDefined();
      return { paid: paid!, after: applySacrificeEffect(paid!.session, "a", dina, ability.effect, ability.clause, paid!.sacrificed) };
    };
    const agent = run("agent");
    const toughest = agent.paid.sacrificed[0];
    expect(mine(agent.after).life).toBe(40 + Number(toughest.power));
    const counters = mine(agent.after).board.battlefield.flatMap((c) => c.counters ?? []).filter((c) => c.kind === "+1/+1").reduce((n, c) => n + c.count, 0);
    expect(counters).toBe(Number(toughest.power));
    const human = run("human");
    expect(human.after.pendingPlayerChoices?.[0].resolver).toBe("counters_on_creature");
  });
});

// keep the imports used by later describe blocks
void [applySpellExtraEffect, findCommonTriggersForPermanentEntered, parseSpellExtraEffects, etbEffectText];
