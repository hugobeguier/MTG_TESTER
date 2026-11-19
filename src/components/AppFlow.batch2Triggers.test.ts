// Batch 2: commanders and key triggers of the shipped decks, tested with the REAL Oracle text from the card catalog (never wording typed into a test).
// Engine/unit tests only: nothing here drives the browser UI.
import { describe, expect, it } from "vitest";
import { applyRemovalEffect, resolveDeferredChoice, substituteX } from "@/engine/effects";
import { parseMassPump } from "@/engine/oneShotEffects";
import { parseGenericSacrificeAbilities } from "@/lib/activatedAbilities";
import { parseRemovalEffect } from "@/lib/removalSpells";
import { etbEffectText } from "@/lib/oracleClauses";
import { findAttackTriggers, findCastTriggers, findCombatDamageToPlayerTriggers, findCommonTriggersForPermanentDied } from "@/engine/triggerFinders";
import { applyDeterministicPhaseTrigger, commonTriggerEffect, findCommonTriggersForPermanentEntered, makeCommonTrigger, resolveTriggerEffect } from "@/engine/triggers";
import { triggerCardPrompt } from "@/engine/triggerPrompts";
import { dealDamageToCreature } from "@/engine/damage";
import { applyTargetingLifeTax, findSpellTargetTriggers, targetingLifeTax } from "@/engine/cardScripts";
import { labeledTargetOptions } from "@/engine/castTargets";
import { hasHexproof } from "@/engine/damage";
import { runStateBasedActionsPass } from "@/engine/stateBased";
import { canBlock } from "@/engine/combat";
import { applyEndStepEffects } from "@/engine/turnFlow";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { effectivePower, effectiveToughness } from "@/lib/counters";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();

function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
function seat(id: string, battlefield: VisibleCard[], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  const library = extra.library ?? [];
  return {
    id, name: id, kind: "agent", life: 40, commanderDamage: {},
    zones: { library: library.length, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield, graveyard: [] }, ...extra
  } as PlayerSeat;
}
function session(seats: PlayerSeat[], extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 5, activePlayerId: seats[0].id, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra } as GameSession;
}
const filler = (id: string, extra: Partial<VisibleCard> = {}) => ({ id, name: `Card ${id}`, typeLine: "Instant", colors: [], role: "spell", zone: "library", manaValue: 1, oracleText: "", ...extra }) as VisibleCard;
const dragon = (id: string, colors: string[], extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Dragon ${id}`, typeLine: "Creature — Dragon", power: "3", toughness: "3", colors, role: "creature", zone: "battlefield", manaValue: 5, oracleText: "Flying", summoningSick: false, ...extra }) as VisibleCard;
const bear = (id: string, power = "2", extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power, toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;
const settle = (s: GameSession) => runStateBasedActionsPass(s).session;
const by = (s: GameSession, id: string) => s.seats.find((item) => item.id === id)!;
const onBoard = (s: GameSession, id: string) => s.seats.flatMap((item) => item.board.battlefield).find((card) => card.id === id);
const resolveAll = (s: GameSession, triggers: Parameters<typeof resolveTriggerEffect>[1][]) => triggers.reduce((acc, trigger) => resolveTriggerEffect(acc, trigger), s);
const answer = (s: GameSession, value: string) => {
  const [entry, ...rest] = s.pendingPlayerChoices ?? [];
  if (!entry) throw new Error("no pending choice");
  return resolveDeferredChoice({ ...s, pendingPlayerChoices: rest }, entry.seatId, entry.sourceCardId, entry.sourceCardName, entry.resolver, entry.data, value);
};

describe("1. Kokusho, the Evening Star (real Oracle text)", () => {
  it("each opponent loses 5 life and the controller gains life equal to the total life lost", () => {
    const kokusho = real("Kokusho, the Evening Star", "k");
    const s = session([seat("a", [], { kind: "human" }), seat("b", []), seat("c", [])]);
    const dead = { ...kokusho, zone: "graveyard" as const };
    const triggers = findCommonTriggersForPermanentDied(s, "a", dead);
    expect(triggers.length).toBe(1);
    const after = resolveAll(s, triggers);
    expect(by(after, "b").life).toBe(35);
    expect(by(after, "c").life).toBe(35);
    expect(by(after, "a").life).toBe(50);
  });
});

describe("2. Atarka, Thrakkus, Silumgar attack triggers (real Oracle text)", () => {
  it("Atarka: an attacking Dragon gains double strike until end of turn (and a non-Dragon does not trigger it)", () => {
    const atarka = real("Atarka, World Render", "at");
    const wing = dragon("d1", ["R"]);
    const s = session([seat("a", [atarka, wing, bear("b1")]), seat("b", [])]);
    const t = findAttackTriggers(s, { seatId: "a", card: wing, defendingSeatId: "b" });
    expect(t.unparsed).toEqual([]);
    expect(t.triggers.some((trigger) => trigger.effect.kind === "scripted")).toBe(true);
    const after = resolveAll(s, t.triggers);
    expect(onBoard(after, "d1")!.grantedKeywords).toContain("double strike");
    const bearAttack = findAttackTriggers(s, { seatId: "a", card: bear("b1"), defendingSeatId: "b" });
    expect(bearAttack.triggers).toEqual([]);
  });
  it("Thrakkus: when it attacks, the power of each Dragon you control is doubled (itself included, non-Dragons untouched)", () => {
    const thrakkus = real("Thrakkus the Butcher", "th");
    const s = session([seat("a", [thrakkus, dragon("d1", ["R"], { power: "4" }), bear("b1", "3")]), seat("b", [])]);
    const t = findAttackTriggers(s, { seatId: "a", card: thrakkus, defendingSeatId: "b" });
    expect(t.unparsed).toEqual([]);
    const after = settle(resolveAll(s, t.triggers));
    expect(effectivePower(onBoard(after, "d1")!)).toBe(8);
    expect(effectivePower(onBoard(after, "th")!)).toBe(effectivePower(thrakkus) * 2);
    expect(effectivePower(onBoard(after, "b1")!)).toBe(3);
  });
  it("Silumgar: when a Dragon attacks, only the DEFENDING player's creatures get -1/-1 (a 1-toughness one dies)", () => {
    const silumgar = real("Silumgar, the Drifting Death", "si");
    const wing = dragon("d1", ["B"]);
    const s = session([seat("a", [silumgar, wing, bear("mine")]), seat("b", [bear("x", "2", { toughness: "3" } as Partial<VisibleCard>), bear("tiny", "1", { toughness: "1" } as Partial<VisibleCard>)]), seat("c", [bear("other")])]);
    const t = findAttackTriggers(s, { seatId: "a", card: wing, defendingSeatId: "b" });
    expect(t.unparsed).toEqual([]);
    const after = settle(resolveAll(s, t.triggers));
    expect(effectiveToughness(onBoard(after, "x")!)).toBe(2);
    expect(onBoard(after, "tiny")).toBeUndefined();
    expect(effectiveToughness(onBoard(after, "mine")!)).toBe(2);
    expect(effectiveToughness(onBoard(after, "other")!)).toBe(2);
  });
});

describe("3. Ramos, Dragon Engine: counters per colour of each spell cast", () => {
  it("a two-colour spell gives two +1/+1 counters, a colourless spell none", () => {
    const ramos = real("Ramos, Dragon Engine", "ra");
    const s = session([seat("a", [ramos]), seat("b", [])]);
    const gold = filler("g", { typeLine: "Instant", colors: ["W", "U"], zone: "hand" });
    const t = findCastTriggers(s, "a", gold, 1);
    expect(t.length).toBe(1);
    const after = resolveAll(s, t);
    expect(onBoard(after, "ra")!.counters?.find((counter) => counter.kind === "+1/+1")?.count).toBe(2);
    expect(findCastTriggers(s, "a", filler("c", { colors: [], zone: "hand" }), 1)).toEqual([]);
  });
});

describe("3. Padeem, Consul of Innovation: your artifacts have hexproof", () => {
  it("the opponent cannot target Sol Ring but can target an artifact Padeem does not cover", () => {
    const padeem = real("Padeem, Consul of Innovation", "pa");
    const ring = real("Sol Ring", "sr");
    const theirs = real("Sol Ring", "sr2");
    const s = settle(session([seat("a", [padeem, ring]), seat("b", [theirs])]));
    expect(hasHexproof(onBoard(s, "sr")!)).toBe(true);
    expect(hasHexproof(onBoard(s, "sr2")!)).toBe(false);
    const source = filler("spell", { zone: "hand" });
    const opts = labeledTargetOptions(s, "b", "any_permanent", source);
    expect(opts.some((option) => option.target.kind === "card" && option.target.cardId === "sr")).toBe(false);
    expect(opts.some((option) => option.target.kind === "card" && option.target.cardId === "sr2")).toBe(true);
    // and the effect ends when Padeem leaves
    const gone = settle({ ...s, seats: s.seats.map((item) => (item.id === "a" ? { ...item, board: { ...item.board, battlefield: item.board.battlefield.filter((card) => card.id !== "pa") } } : item)) });
    expect(hasHexproof(onBoard(gone, "sr")!)).toBe(false);
  });
});

describe("3. Hellkite Tyrant and Balefire Dragon combat damage triggers", () => {
  it("Hellkite Tyrant steals every artifact the damaged player controls", () => {
    const tyrant = real("Hellkite Tyrant", "ty");
    const s = session([seat("a", [tyrant]), seat("b", [real("Sol Ring", "r1"), real("Sol Ring", "r2"), bear("bb")]), seat("c", [real("Sol Ring", "r3")])]);
    const t = findCombatDamageToPlayerTriggers(s, "a", tyrant, "b", 6);
    expect(t.length).toBe(1);
    const after = resolveAll(s, t);
    expect(by(after, "a").board.battlefield.map((card) => card.id).sort()).toEqual(["r1", "r2", "ty"]);
    expect(by(after, "b").board.battlefield.map((card) => card.id)).toEqual(["bb"]);
    expect(onBoard(after, "r3") && by(after, "c").board.battlefield.length).toBe(1);
  });
  it("Balefire Dragon deals that much damage to each creature the damaged player controls (and nobody else's)", () => {
    const balefire = real("Balefire Dragon", "bf");
    const s = session([seat("a", [balefire, bear("mine")]), seat("b", [bear("x", "2", { toughness: "5" } as Partial<VisibleCard>), bear("y")]), seat("c", [bear("z")])]);
    const t = findCombatDamageToPlayerTriggers(s, "a", balefire, "b", 4);
    expect(t.length).toBe(1);
    const after = settle(resolveAll(s, t));
    expect(onBoard(after, "y")).toBeUndefined();
    expect(onBoard(after, "x")!.damage).toBe(4);
    expect(onBoard(after, "z")).toBeDefined();
    expect(onBoard(after, "mine")).toBeDefined();
  });
});


// A planeswalker's loyalty ability is resolved by the hook as commonTriggerEffect(abilityText) -> a trigger; these tests do the same with the real text.
const loyaltyTrigger = (s: GameSession, seatId: string, cardId: string, abilityIndex: number) => {
  const card = onBoard(s, cardId)!;
  const abilities = card.oracleText.split("\n").filter((line) => /^[+−\-–]\d+:|^0:/.test(line));
  const text = abilities[abilityIndex];
  const effect = commonTriggerEffect(text, "clause");
  expect(effect, text).toBeDefined();
  return makeCommonTrigger(seatId, seatId, card, effect!, `${card.name} ability`);
};

describe("3. Sarkhan Unbroken (real Oracle text)", () => {
  const lib = () => [filler("l1"), filler("l2"), dragon("lib-d1", ["R"], { zone: "library" }), dragon("lib-d2", ["G"], { zone: "library" })];
  it("+1 draws a card and then adds one mana of any colour (a human is asked which colour)", () => {
    const sarkhan = real("Sarkhan Unbroken", "sk");
    const s = session([seat("a", [sarkhan], { kind: "human", library: lib() }), seat("b", [])]);
    const t = loyaltyTrigger(s, "a", "sk", 0);
    expect(t.effect.kind).toBe("scripted");
    const afterDraw = resolveTriggerEffect(s, t);
    expect(by(afterDraw, "a").board.hand.length).toBe(1);
    expect(afterDraw.pendingPlayerChoices?.[0]?.options.map((option) => option.value)).toEqual(["W", "U", "B", "R", "G"]);
    const done = answer(afterDraw, "U");
    expect(done.pendingManaGrants).toEqual([{ seatId: "a", colors: ["U"], sourceName: "Sarkhan Unbroken" }]);
  });
  it("+1 for an agent draws and adds a colour without a prompt", () => {
    const sarkhan = real("Sarkhan Unbroken", "sk");
    const s = session([seat("a", [sarkhan], { library: lib() }), seat("b", [])]);
    const after = resolveTriggerEffect(s, loyaltyTrigger(s, "a", "sk", 0));
    expect(after.pendingPlayerChoices ?? []).toEqual([]);
    expect(after.pendingManaGrants?.[0]?.colors.length).toBe(1);
  });
  it("-2 creates a 4/4 red Dragon with flying", () => {
    const sarkhan = real("Sarkhan Unbroken", "sk");
    const s = session([seat("a", [sarkhan]), seat("b", [])]);
    const after = resolveTriggerEffect(s, loyaltyTrigger(s, "a", "sk", 1));
    const token = by(after, "a").board.battlefield.find((card) => card.token);
    expect(token?.typeLine).toContain("Dragon");
    expect(token?.power).toBe("4");
  });
  it("-8 searches the library for every Dragon creature card and puts them onto the battlefield", () => {
    const sarkhan = real("Sarkhan Unbroken", "sk");
    const s = session([seat("a", [sarkhan], { kind: "human", library: lib() }), seat("b", [])]);
    const after = resolveTriggerEffect(s, loyaltyTrigger(s, "a", "sk", 2));
    expect(by(after, "a").board.battlefield.filter((card) => card.typeLine.includes("Dragon")).map((card) => card.id).sort()).toEqual(["lib-d1", "lib-d2"]);
    expect(by(after, "a").library?.length).toBe(2);
  });
});

describe("3. Daretti, Scrap Savant -2 (real Oracle text)", () => {
  const artifact = (id: string, mv: number, zone: "battlefield" | "graveyard" = "battlefield") => ({ id, name: `Rock ${id}`, typeLine: "Artifact", colors: [], role: "permanent", zone, manaValue: mv, oracleText: "" }) as VisibleCard;
  it("a human picks the graveyard artifact as the trigger goes on the stack, then the sacrifice; the artifact returns", () => {
    const daretti = real("Daretti, Scrap Savant", "da");
    const s = session([seat("a", [daretti, artifact("fodder", 1)], { kind: "human", board: { hand: [], battlefield: [daretti, artifact("fodder", 1)], graveyard: [artifact("g1", 3, "graveyard"), artifact("g2", 5, "graveyard")] } }), seat("b", [])]);
    const t = loyaltyTrigger(s, "a", "da", 1);
    expect(t.effect.kind).toBe("scripted");
    const prompt = triggerCardPrompt(s, t, by(s, "a"));
    expect(prompt?.zone).toBe("graveyard");
    expect(prompt?.cards.map((entry) => entry.cardId).sort()).toEqual(["g1", "g2"]);
    const chosen = { ...t, effect: { ...t.effect, chosenOption: "g1" } };
    const asked = resolveTriggerEffect(s, chosen);
    expect(asked.pendingPlayerChoices?.[0]?.prompt).toMatch(/sacrifice an artifact/i);
    const done = answer(asked, "fodder");
    expect(by(done, "a").board.battlefield.map((card) => card.id).sort()).toEqual(["da", "g1"]);
    expect(by(done, "a").board.graveyard!.map((card) => card.id).sort()).toEqual(["fodder", "g2"]);
  });
  it("without an artifact to sacrifice nothing returns", () => {
    const daretti = real("Daretti, Scrap Savant", "da");
    const s = session([seat("a", [daretti], { board: { hand: [], battlefield: [daretti], graveyard: [artifact("g1", 3, "graveyard")] } }), seat("b", [])]);
    const after = resolveTriggerEffect(s, loyaltyTrigger(s, "a", "da", 1));
    expect(by(after, "a").board.battlefield.map((card) => card.id)).toEqual(["da"]);
  });
  it("an agent sacrifices its cheapest artifact and returns its best graveyard artifact", () => {
    const daretti = real("Daretti, Scrap Savant", "da");
    const s = session([seat("a", [daretti, artifact("f1", 4), artifact("f2", 1)], { board: { hand: [], battlefield: [daretti, artifact("f1", 4), artifact("f2", 1)], graveyard: [artifact("g1", 3, "graveyard"), artifact("g2", 6, "graveyard")] } }), seat("b", [])]);
    const after = resolveTriggerEffect(s, loyaltyTrigger(s, "a", "da", 1));
    expect(by(after, "a").board.battlefield.map((card) => card.id).sort()).toEqual(["da", "f1", "g2"]);
  });
});

describe("3. Terror of the Peaks: spells that target it cost 3 more life", () => {
  it("an opponent's spell pays 3 life for targeting it, targeting a different creature is free, and a caster at <= 3 life can't target it", () => {
    const terror = real("Terror of the Peaks", "tp");
    const s = session([seat("a", [terror, bear("mine")]), seat("b", [], { life: 20 })]);
    expect(targetingLifeTax(s, "b", [{ kind: "card", seatId: "a", cardId: "tp" }])).toBe(3);
    expect(targetingLifeTax(s, "b", [{ kind: "card", seatId: "a", cardId: "mine" }])).toBe(0);
    expect(targetingLifeTax(s, "a", [{ kind: "card", seatId: "a", cardId: "tp" }])).toBe(0);
    expect(by(applyTargetingLifeTax(s, "b", [{ kind: "card", seatId: "a", cardId: "tp" }]), "b").life).toBe(17);
    const spell = filler("bolt", { zone: "hand" });
    const ids = (session2: GameSession) => labeledTargetOptions(session2, "b", "any_creature", spell).map((option) => (option.target.kind === "card" ? option.target.cardId : ""));
    expect(ids(s)).toContain("tp");
    const lowLife = session([seat("a", [terror]), seat("b", [], { life: 3 })]);
    expect(ids(lowLife)).not.toContain("tp");
  });
});

describe("3. Scalelord Reckoner: a Dragon targeted by an opponent's spell destroys one of that player's nonland permanents", () => {
  it("the trigger is created for the targeted Dragon, a human picks the target on the stack, the chosen permanent is destroyed", () => {
    const scalelord = real("Scalelord Reckoner", "sr");
    const wing = dragon("d1", ["R"]);
    const mountain = { id: "mt", name: "Mountain", typeLine: "Basic Land — Mountain", colors: [], role: "land", zone: "battlefield", manaValue: 0, oracleText: "" } as VisibleCard;
    const s = session([seat("a", [scalelord, wing], { kind: "human" }), seat("b", [bear("x"), real("Sol Ring", "ring"), mountain])]);
    const triggers = findSpellTargetTriggers(s, "b", [{ kind: "card", seatId: "a", cardId: "d1" }]);
    expect(triggers.length).toBe(1);
    expect(findSpellTargetTriggers(s, "b", [{ kind: "card", seatId: "a", cardId: "sr" }])).toHaveLength(1);
    expect(findSpellTargetTriggers(s, "a", [{ kind: "card", seatId: "a", cardId: "d1" }])).toEqual([]);
    const prompt = triggerCardPrompt(s, triggers[0], by(s, "a"));
    expect(prompt?.cards.map((entry) => entry.cardId).sort()).toEqual(["ring", "x"]);
    const after = resolveTriggerEffect(s, { ...triggers[0], effect: { ...triggers[0].effect, chosenOption: "x" } });
    expect(onBoard(after, "x")).toBeUndefined();
    expect(onBoard(after, "ring")).toBeDefined();
  });
});

describe("3. Wrathful Red Dragon and Rith's excess-damage record", () => {
  it("a Dragon you control being dealt damage makes the controller aim that much damage at a non-Dragon (human: prompted)", () => {
    const wrathful = real("Wrathful Red Dragon", "wr");
    const s = session([seat("a", [wrathful, dragon("d2", ["R"], { toughness: "9" } as Partial<VisibleCard>)], { kind: "human" }), seat("b", [bear("victim")], { life: 30 })]);
    const hit = dealDamageToCreature(s, "Bolt", "a", "d2", 4);
    const prompt = hit.pendingPlayerChoices?.[0];
    expect(prompt?.options.map((option) => option.value)).toContain("c:b:victim");
    expect(prompt?.options.map((option) => option.value)).not.toContain("c:a:d2");
    const done = settle(answer(hit, "p:b"));
    expect(by(done, "b").life).toBe(26);
  });
  it("excess damage to an opponent's creature is recorded for the turn (and plain lethal damage is not excess)", () => {
    const s = session([seat("a", []), seat("b", [bear("x")])]);
    expect(dealDamageToCreature(s, "Bolt", "b", "x", 2).excessDamageTurn).toBeUndefined();
    expect(dealDamageToCreature(s, "Bolt", "b", "x", 5).excessDamageTurn).toEqual({ turn: 5, seatIds: ["b"] });
  });
});

describe("3. Rith, Liberated Primeval end step (real Oracle text)", () => {
  it("creates a 4/4 flying Dragon only if an opponent's creature was dealt excess damage this turn", () => {
    const rith = real("Rith, Liberated Primeval", "ri");
    const quiet = session([seat("a", [rith]), seat("b", [])]);
    const none = applyDeterministicPhaseTrigger(quiet, "a", rith, "end step");
    expect(none).toBeDefined();
    expect(by(none!, "a").board.battlefield.length).toBe(1);
    const hit = dealDamageToCreature(session([seat("a", [rith]), seat("b", [bear("x")])]), "Bolt", "b", "x", 6);
    const made = applyDeterministicPhaseTrigger(hit, "a", rith, "end step");
    expect(by(made!, "a").board.battlefield.filter((card) => card.token && card.typeLine.includes("Dragon")).length).toBe(1);
  });
});

describe("3. Call the Spirit Dragons upkeep (real Oracle text)", () => {
  const call = () => real("Call the Spirit Dragons", "cs");
  it("puts a +1/+1 counter on a Dragon of each colour; five different Dragons win the game", () => {
    const dragons = [dragon("w", ["W"]), dragon("u", ["U"]), dragon("b", ["B"]), dragon("r", ["R"]), dragon("g", ["G"])];
    const s = session([seat("a", [call(), ...dragons]), seat("b", [])]);
    const after = applyDeterministicPhaseTrigger(s, "a", call(), "upkeep step")!;
    for (const id of ["w", "u", "b", "r", "g"]) expect(onBoard(after, id)!.counters?.find((counter) => counter.kind === "+1/+1")?.count).toBe(1);
    expect(by(after, "b").hasLost).toBe(true);
  });
  it("one five-colour Dragon gets all five counters but no win; a missing colour just gets no counter", () => {
    const all = dragon("all", ["W", "U", "B", "R", "G"]);
    const s = session([seat("a", [call(), all]), seat("b", [])]);
    const after = applyDeterministicPhaseTrigger(s, "a", call(), "upkeep step")!;
    expect(onBoard(after, "all")!.counters?.find((counter) => counter.kind === "+1/+1")?.count).toBe(5);
    expect(by(after, "b").hasLost).toBeFalsy();
  });
});

describe("4. Gyome, Master Chef end step (real Oracle text)", () => {
  it("creates a Food for each nontoken creature that entered under your control this turn", () => {
    const gyome = real("Gyome, Master Chef", "gy", { enteredTurn: 3 });
    const s = session([seat("a", [gyome, bear("n1", "2", { enteredTurn: 5 }), bear("n2", "2", { enteredTurn: 5 }), bear("old", "2", { enteredTurn: 2 }), bear("tok", "1", { enteredTurn: 5, token: true })]), seat("b", [])]);
    const after = applyDeterministicPhaseTrigger(s, "a", gyome, "end step")!;
    expect(by(after, "a").board.battlefield.filter((card) => card.typeLine.includes("Food")).length).toBe(2);
  });
});

describe("3. Zurgo and Ojutai combat damage (real Oracle text)", () => {
  it("a Dragon dealing combat damage: look at the top three, take one, the rest go to the bottom, may bounce the Dragon (human prompts; non-Dragons don't trigger it)", () => {
    const zurgo = real("Zurgo and Ojutai", "zo");
    const library = [filler("t1", { name: "Top1" }), filler("t2", { name: "Top2" }), filler("t3", { name: "Top3" }), filler("t4", { name: "Deep" })];
    const s = session([seat("a", [zurgo, bear("b1")], { kind: "human", library }), seat("b", [])]);
    expect(findCombatDamageToPlayerTriggers(s, "a", onBoard(s, "b1")!, "b", 2)).toEqual([]);
    const triggers = findCombatDamageToPlayerTriggers(s, "a", zurgo, "b", 2);
    expect(triggers.length).toBe(1);
    const asked = resolveTriggerEffect(s, triggers[0]);
    expect(asked.pendingPlayerChoices?.[0]?.options.map((option) => option.value)).toEqual(["t1", "t2", "t3"]);
    const picked = answer(asked, "t2");
    expect(by(picked, "a").board.hand.map((card) => card.id)).toEqual(["t2"]);
    expect(by(picked, "a").library?.map((card) => card.id).slice(0, 1)).toEqual(["t4"]);
    expect(by(picked, "a").library?.length).toBe(3);
    const bounce = picked.pendingPlayerChoices?.[0];
    expect(bounce?.options.map((option) => option.value)).toEqual(["zo", "none"]);
    const done = answer(picked, "zo");
    expect(onBoard(done, "zo")).toBeUndefined();
    expect(by(done, "a").board.hand.map((card) => card.id).sort()).toEqual(["t2", "zo"]);
  });
});

describe("3. Ancient Brass Dragon (real Oracle text)", () => {
  it("roll a d20, then put creature cards with total mana value X or less from graveyards onto the battlefield (human: one at a time, within the budget)", () => {
    const brass = real("Ancient Brass Dragon", "ab");
    const gy = (id: string, mv: number) => bear(id, "2", { zone: "graveyard", manaValue: mv });
    const s = session([seat("a", [brass], { kind: "human", board: { hand: [], battlefield: [brass], graveyard: [gy("g3", 3)] } }), seat("b", [], { board: { hand: [], battlefield: [], graveyard: [gy("g5", 5), gy("g30", 30)] } })]);
    const triggers = findCombatDamageToPlayerTriggers(s, "a", brass, "b", 7);
    expect(triggers.length).toBe(1);
    expect(triggers[0].effect).toEqual({ kind: "d20_roll", payoff: "reanimate_mv" });
    const rolled = resolveTriggerEffect(s, triggers[0]);
    const prompt = rolled.pendingPlayerChoices?.[0];
    expect(prompt?.options.map((option) => option.value)).not.toContain("b:g30");
    expect(prompt?.options.map((option) => option.value)).toContain("a:g3");
    const budget = Number(prompt!.data.remaining);
    expect(budget).toBeGreaterThanOrEqual(1);
    expect(budget).toBeLessThanOrEqual(20);
    const taken = answer(rolled, "a:g3");
    expect(onBoard(taken, "g3")).toBeDefined();
    expect(by(taken, "a").board.graveyard?.some((card) => card.id === "g3")).toBe(false);
  });
});

describe("3. Ureni of the Unwritten (real Oracle text)", () => {
  it("enters or attacks: look at the top eight, may put a Dragon creature card onto the battlefield, the rest go to the bottom", () => {
    const ureni = real("Ureni of the Unwritten", "ur");
    const library = [filler("c1"), dragon("lib-dragon", ["R"], { zone: "library" }), filler("c3"), filler("c4"), filler("c5"), filler("c6"), filler("c7"), filler("c8"), filler("deep")];
    const s = session([seat("a", [ureni], { kind: "human", library }), seat("b", [])]);
    const atk = findAttackTriggers(s, { seatId: "a", card: ureni, defendingSeatId: "b" });
    expect(atk.unparsed).toEqual([]);
    expect(atk.triggers.length).toBeGreaterThan(0);
    const etb = findCommonTriggersForPermanentEntered(s, "a", ureni);
    expect(etb.some((trigger) => trigger.effect.kind === "scripted")).toBe(true);
    const asked = resolveTriggerEffect(s, atk.triggers.find((trigger) => trigger.effect.kind === "scripted")!);
    expect(asked.pendingPlayerChoices?.[0]?.options.map((option) => option.value)).toEqual(["lib-dragon", "none"]);
    const done = answer(asked, "lib-dragon");
    expect(onBoard(done, "lib-dragon")).toBeDefined();
    expect(by(done, "a").library?.[0].id).toBe("deep");
    expect(by(done, "a").library?.length).toBe(8);
  });
  it("an agent takes the best Dragon without a prompt; with none in the top eight everything goes to the bottom", () => {
    const ureni = real("Ureni of the Unwritten", "ur");
    const s = session([seat("a", [ureni], { library: [dragon("d-small", ["R"], { zone: "library", manaValue: 3 }), dragon("d-big", ["G"], { zone: "library", manaValue: 7 }), filler("x")] }), seat("b", [])]);
    const trigger = findAttackTriggers(s, { seatId: "a", card: ureni, defendingSeatId: "b" }).triggers.find((t) => t.effect.kind === "scripted")!;
    const done = resolveTriggerEffect(s, trigger);
    expect(done.pendingPlayerChoices ?? []).toEqual([]);
    expect(onBoard(done, "d-big")).toBeDefined();
    const none = session([seat("a", [ureni], { library: [filler("x"), filler("y")] }), seat("b", [])]);
    expect(by(resolveTriggerEffect(none, trigger), "a").library?.length).toBe(2);
  });
});

describe("3. Tiamat (real Oracle text)", () => {
  const library = () => [dragon("d1", ["R"], { zone: "library", name: "Dragon One", manaValue: 3 }), dragon("d2", ["U"], { zone: "library", name: "Dragon Two", manaValue: 6 }), filler("x")];
  it("when cast from hand: search for up to five Dragons with different names (agent takes them, human is sent to the library picker)", () => {
    const tiamat = real("Tiamat", "ti", { enteredFrom: "hand" });
    const agent = session([seat("a", [tiamat], { library: library() }), seat("b", [])]);
    const t = findCommonTriggersForPermanentEntered(agent, "a", tiamat);
    expect(t.some((trigger) => trigger.effect.kind === "scripted")).toBe(true);
    const done = resolveAll(agent, t);
    expect(by(done, "a").board.hand.map((card) => card.id).sort()).toEqual(["d1", "d2"]);
    expect(by(done, "a").library?.map((card) => card.id)).toEqual(["x"]);
    const human = session([seat("a", [tiamat], { kind: "human", library: library() }), seat("b", [])]);
    const asked = resolveAll(human, findCommonTriggersForPermanentEntered(human, "a", tiamat));
    expect(asked.pendingScriptedSearch?.[0]).toMatchObject({ seatId: "a", script: "tiamat_tutor" });
  });
  it("does nothing when it was not cast (reanimated)", () => {
    const tiamat = real("Tiamat", "ti", { enteredFrom: "graveyard" });
    const s = session([seat("a", [tiamat], { library: library() }), seat("b", [])]);
    expect(findCommonTriggersForPermanentEntered(s, "a", tiamat).some((trigger) => trigger.effect.kind === "scripted")).toBe(false);
  });
});

describe("3. Hellkite Courser (real Oracle text)", () => {
  it("puts your commander from the command zone onto the battlefield with haste and returns it at the next end step", () => {
    const courser = real("Hellkite Courser", "hc");
    const commander = dragon("cmd", ["R"], { zone: "command", commander: true, name: "My Commander" });
    const s = session([seat("a", [courser], { board: { hand: [], battlefield: [courser], graveyard: [], commander } }), seat("b", [])]);
    const triggers = findCommonTriggersForPermanentEntered(s, "a", courser);
    const t = triggers.find((trigger) => trigger.effect.kind === "scripted");
    expect(t?.effect.optional).toBe(true);
    const out = resolveTriggerEffect(s, t!);
    expect(onBoard(out, "cmd")?.summoningSick).toBe(false);
    expect(by(out, "a").board.commander).toBeUndefined();
    expect(out.pendingEntries?.some((entry) => entry.card.id === "cmd")).toBe(true);
    const ended = applyEndStepEffects(out, "a");
    expect(onBoard(ended, "cmd")).toBeUndefined();
    expect(by(ended, "a").board.commander?.id).toBe("cmd");
  });
});

describe("4. Disciple of Freyalise (real Oracle text)", () => {
  it("a human may sacrifice another creature: gain X life and draw X cards; declining does nothing", () => {
    const disciple = real("Disciple of Freyalise", "df");
    const library = [filler("c1"), filler("c2"), filler("c3"), filler("c4")];
    const s = session([seat("a", [disciple, bear("big", "3"), bear("small", "1")], { kind: "human", library, life: 20 }), seat("b", [])]);
    const triggers = findCommonTriggersForPermanentEntered(s, "a", disciple);
    expect(triggers.some((trigger) => trigger.effect.kind === "scripted")).toBe(true);
    const asked = resolveAll(s, triggers);
    expect(asked.pendingPlayerChoices?.[0]?.options.map((option) => option.value)).toEqual(["big", "small", "none"]);
    const done = answer(asked, "big");
    expect(by(done, "a").life).toBe(23);
    expect(by(done, "a").board.hand.length).toBe(3);
    expect(onBoard(done, "big")).toBeUndefined();
    const declined = answer(asked, "none");
    expect(by(declined, "a").life).toBe(20);
    expect(onBoard(declined, "big")).toBeDefined();
  });
});

describe("4. Sidisi, Undead Vizier: exploit (real Oracle text)", () => {
  it("exploit is a general mechanic: a human chooses a creature to sacrifice (itself allowed) and then searches the library; declining skips the tutor", () => {
    const sidisi = real("Sidisi, Undead Vizier", "sv");
    const library = [filler("l1", { name: "Tutor Target", typeLine: "Creature — Elf", manaValue: 7 })];
    const s = session([seat("a", [sidisi, bear("fodder")], { kind: "human", library }), seat("b", [])]);
    const triggers = findCommonTriggersForPermanentEntered(s, "a", sidisi);
    expect(triggers.some((trigger) => trigger.effect.kind === "scripted" && trigger.effect.script === "exploit")).toBe(true);
    const asked = resolveAll(s, triggers);
    expect(asked.pendingPlayerChoices?.[0]?.options.map((option) => option.value)).toEqual(["sv", "fodder", "none"]);
    const exploited = answer(asked, "fodder");
    expect(onBoard(exploited, "fodder")).toBeUndefined();
    expect(exploited.pendingScriptedSearch?.[0]).toMatchObject({ seatId: "a", script: "exploit_tutor" });
    const declined = answer(asked, "none");
    expect(onBoard(declined, "fodder")).toBeDefined();
    expect(declined.pendingScriptedSearch).toBeUndefined();
  });
  it("an agent exploits only cheap fodder, and tutors for its best card", () => {
    const sidisi = real("Sidisi, Undead Vizier", "sv");
    const library = [filler("l1", { name: "Land", typeLine: "Land", manaValue: 0 }), filler("l2", { name: "Bomb", typeLine: "Creature — Elf", manaValue: 7 })];
    const s = session([seat("a", [sidisi, bear("fodder", "1", { token: true })], { library }), seat("b", [])]);
    const done = resolveAll(s, findCommonTriggersForPermanentEntered(s, "a", sidisi));
    expect(onBoard(done, "fodder")).toBeUndefined();
    expect(by(done, "a").board.hand.map((card) => card.id)).toEqual(["l2"]);
    const noFodder = session([seat("a", [sidisi, bear("keeper", "5", { manaValue: 5 })], { library }), seat("b", [])]);
    expect(onBoard(resolveAll(noFodder, findCommonTriggersForPermanentEntered(noFodder, "a", sidisi)), "keeper")).toBeDefined();
  });
});

describe("4. Insidious Fungus: all three modes (real Oracle text)", () => {
  it("is a 'choose one' sacrifice ability with destroy-artifact, destroy-enchantment and draw-then-land modes", () => {
    const fungus = real("Insidious Fungus", "if");
    const ability = parseGenericSacrificeAbilities(fungus.oracleText)[0];
    expect(ability.effect.kind).toBe("removal");
    const modal = ability.effect.kind === "removal" ? ability.effect.effect : undefined;
    expect(modal?.kind).toBe("modal");
    const kinds = modal?.kind === "modal" ? modal.modes.map((mode) => (mode.kind === "destroy" ? `destroy:${mode.targetType}` : mode.kind)) : [];
    expect(kinds).toEqual(["destroy:artifact", "destroy:enchantment", "draw_then_land"]);
  });
  it("the draw mode draws and a human is asked which land (or none) to put onto the battlefield tapped", () => {
    const land = { id: "forest", name: "Forest", typeLine: "Basic Land — Forest", colors: [], role: "land", zone: "hand", manaValue: 0, oracleText: "" } as VisibleCard;
    const s = session([seat("a", [], { kind: "human", library: [land, filler("x")] }), seat("b", [])]);
    const asked = applyRemovalEffect(s, "a", "Insidious Fungus", real("Insidious Fungus", "if"), { kind: "draw_then_land" } as never);
    expect(by(asked, "a").board.hand.map((card) => card.id)).toEqual(["forest"]);
    expect(asked.pendingPlayerChoices?.[0]?.options.map((option) => option.value)).toEqual(["forest", "none"]);
    const done = answer(asked, "forest");
    expect(onBoard(done, "forest")?.tapped).toBe(true);
    expect(by(done, "a").board.hand).toEqual([]);
  });
});

describe("3. Crux of Fate and Exude Toxin (real Oracle text)", () => {
  it("Crux's two modes are 'destroy all Dragon creatures' and 'destroy all non-Dragon creatures'", () => {
    const effect = parseRemovalEffect(real("Crux of Fate", "cx").oracleText);
    expect(effect?.kind).toBe("modal");
    const modes = effect?.kind === "modal" ? effect.modes : [];
    expect(modes.map((mode) => (mode.kind === "destroy_all" ? [mode.onlyType, mode.excludeType] : []))).toEqual([["dragon", undefined], [undefined, "dragon"]]);
  });
  it("Crux's Dragon mode destroys only Dragons (of every player), the other mode destroys everything else", () => {
    const crux = real("Crux of Fate", "cx");
    const s = session([seat("a", [dragon("d1", ["R"]), bear("b1")]), seat("b", [dragon("d2", ["B"]), bear("b2")])]);
    const effect = parseRemovalEffect(crux.oracleText);
    const modes = effect?.kind === "modal" ? effect.modes : [];
    const dragonsGone = applyRemovalEffect(s, "a", "Crux of Fate", crux, modes[0]);
    expect(dragonsGone.seats.flatMap((item) => item.board.battlefield.map((card) => card.id)).sort()).toEqual(["b1", "b2"]);
    const othersGone = applyRemovalEffect(s, "a", "Crux of Fate", crux, modes[1]);
    expect(othersGone.seats.flatMap((item) => item.board.battlefield.map((card) => card.id)).sort()).toEqual(["d1", "d2"]);
  });
  it("Scavenger Regent's Exude Toxin face: -X/-X to each non-Dragon creature parses with X substituted", () => {
    const faces = (lookupCard(catalog, "Scavenger Regent") as { faces?: Array<{ name: string; oracleText: string }> }).faces!;
    const exude = faces.find((face) => face.name === "Exude Toxin")!;
    expect(parseMassPump(substituteX(etbEffectText(exude.oracleText), 3))).toEqual({ power: -3, toughness: -3, excludeType: "dragon", scope: "all" });
  });
});

describe("4. Journey to Eternity (real Oracle text)", () => {
  it("when the enchanted creature dies it returns under your control and the Aura returns transformed (Atzal, Cave of Eternity)", () => {
    const journey = real("Journey to Eternity", "je", { zone: "graveyard" });
    const dead = bear("victim", "2", { zone: "graveyard" });
    const s = session([seat("a", [], { board: { hand: [], battlefield: [], graveyard: [journey, dead] } }), seat("b", [])]);
    const triggers = findCommonTriggersForPermanentDied(s, "a", dead, ["je"], [{ seatId: "a", card: dead }]);
    const t = triggers.find((trigger) => trigger.effect.kind === "scripted");
    expect(t).toBeDefined();
    const after = resolveTriggerEffect(s, t!);
    expect(onBoard(after, "victim")).toBeDefined();
    const atzal = onBoard(after, "je");
    expect(atzal?.name).toBe("Atzal, Cave of Eternity");
    expect(atzal?.typeLine).toContain("Land");
    expect(by(after, "a").board.graveyard).toEqual([]);
  });
});

describe("4. Dauthi Voidwalker: shadow (real Oracle text)", () => {
  it("a shadow creature can't be blocked by creatures without shadow, and can't block them", () => {
    const dauthi = real("Dauthi Voidwalker", "dv");
    expect(canBlock(bear("b1"), dauthi)).toBe(false);
    expect(canBlock(dauthi, bear("att"))).toBe(false);
    expect(canBlock(real("Dauthi Voidwalker", "dv2"), dauthi)).toBe(true);
    expect(canBlock(bear("b1"), bear("att"))).toBe(true);
  });
});

describe("3. Rhythm of the Wild: nontoken creatures you control have riot (real Oracle text)", () => {
  it("a human chooses +1/+1 counter or haste for an entering nontoken creature; tokens and opponents' creatures don't get riot", () => {
    const rhythm = real("Rhythm of the Wild", "rw");
    const entering = bear("e1", "2", { summoningSick: true });
    const s = session([seat("a", [rhythm, entering], { kind: "human" }), seat("b", [bear("theirs")])]);
    const triggers = findCommonTriggersForPermanentEntered(s, "a", entering).filter((t) => t.effect.kind === "scripted");
    expect(triggers.length).toBe(1);
    const asked = resolveAll(s, triggers);
    expect(asked.pendingPlayerChoices?.[0]?.options.map((option) => option.value)).toEqual(["counter", "haste"]);
    expect(onBoard(answer(asked, "counter"), "e1")!.counters?.find((counter) => counter.kind === "+1/+1")?.count).toBe(1);
    const hasty = onBoard(answer(asked, "haste"), "e1")!;
    expect(hasty.summoningSick).toBe(false);
    expect(hasty.grantedKeywords).toContain("haste");
    const token = bear("tok", "1", { token: true });
    const withToken = session([seat("a", [rhythm, token]), seat("b", [])]);
    expect(findCommonTriggersForPermanentEntered(withToken, "a", token).some((t) => t.effect.kind === "scripted")).toBe(false);
    const theirs = bear("theirs");
    const opp = session([seat("a", [rhythm]), seat("b", [theirs])]);
    expect(findCommonTriggersForPermanentEntered(opp, "b", theirs).some((t) => t.effect.kind === "scripted")).toBe(false);
  });
});
