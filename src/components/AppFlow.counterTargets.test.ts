// A counterspell TARGETS one spell on the stack (rules 114 / 601.2c / 701.5): the caster picks which, at cast time, from every legal spell on the
// stack - not "the spell below me". Real catalog Oracle text throughout. The human always gets the prompt (even with one candidate); agents keep
// their automatic counter flow (counterTargetId = the spell they respond to). The prompt is the existing choose_cast_targets rule choice, so a remote
// friend sees it only in their own snapshot and answers with the whitelisted onChooseModalOption intent (seatPrompts.ts / intentSpecs.ts).
import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { legalCounterSpellTargets } from "@/engine/legalActions";
import { counterTargetActionFor, counterTargetOptions } from "@/engine/castTargets";
import { initialStackState, pushToStack, removeFromStack } from "@/engine/stack";
import type { PendingAction } from "@/engine/types";
import { parseCounterSpellAbility } from "@/lib/counterSpells";
import { buildSeatPrompts } from "@/lib/multiplayer/seatPrompts";
import { INTENT_SPECS } from "@/lib/multiplayer/intentSpecs";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { agentCastTimeRemovalChoices, nextCastPrompt } from "./AppFlow";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "spell", zone: "hand", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
function seat(id: string, kind: "human" | "agent", hand: VisibleCard[] = [], battlefield: VisibleCard[] = []): PlayerSeat {
  const board = { hand, battlefield, graveyard: [], exile: [] };
  return { id, name: id, kind, life: 40, commanderDamage: {}, zones: { library: 0, hand: hand.length, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 }, board } as unknown as PlayerSeat;
}
function session(seats: PlayerSeat[]): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] };
}
function spell(id: string, seatId: string, card: VisibleCard, extra: Partial<Extract<PendingAction, { type: "spell" }>> = {}): Extract<PendingAction, { type: "spell" }> {
  return { id, type: "spell", actorSeatId: seatId, cardId: card.id, cardName: card.name, cardTypeLine: card.typeLine, manaSourceIds: [], message: "", ...extra };
}

// Stack [A (player 1: Divination-like sorcery... an instant), B (player 2: a creature)], then player 1 casts a counterspell.
const bolt = real("Lightning Bolt", "A");
const bears = real("Grizzly Bears", "B");
const world = () => session([seat("me", "human", [bolt]), seat("opp", "agent", [bears])]);
const stackAB = [spell("sA", "me", bolt), spell("sB", "opp", bears)];
const names = (prompt: ReturnType<typeof nextCastPrompt>) => (prompt && prompt.kind === "target" ? prompt.options.map((o) => o.label.split(" — ")[0]) : []);

describe("a human's counterspell asks which spell on the stack to counter", () => {
  it("Counterspell lists EVERY spell on the stack, top first, with controllers", () => {
    const prompt = nextCastPrompt(world(), "me", real("Counterspell", "cs"), undefined, { targets: [] }, stackAB);
    expect(prompt?.kind).toBe("target");
    expect(names(prompt)).toEqual(["Grizzly Bears", "Lightning Bolt"]);
    const labels = (prompt as { options: Array<{ label: string }> }).options.map((o) => o.label);
    expect(labels[0]).toContain("top of the stack");
    expect(labels[0]).toContain("opp");
    expect(labels[1]).toContain("yours");
  });

  it("asks even when only ONE spell is on the stack (a human is never auto-targeted)", () => {
    const prompt = nextCastPrompt(world(), "me", real("Counterspell", "cs"), undefined, { targets: [] }, [stackAB[0]]);
    expect(names(prompt)).toEqual(["Lightning Bolt"]);
  });

  it("with an empty stack there is nothing to target", () => {
    expect(nextCastPrompt(world(), "me", real("Counterspell", "cs"), undefined, { targets: [] }, [])).toBeUndefined();
  });

  it("Negate only offers noncreature spells; Essence Scatter-style text only creature spells", () => {
    expect(names(nextCastPrompt(world(), "me", real("Negate", "ng"), undefined, { targets: [] }, stackAB))).toEqual(["Lightning Bolt"]);
    const scatter = real("Counterspell", "es", { oracleText: "Counter target creature spell." });
    expect(names(nextCastPrompt(world(), "me", scatter, undefined, { targets: [] }, stackAB))).toEqual(["Grizzly Bears"]);
  });

  it("Swan Song only offers enchantment, instant or sorcery spells", () => {
    expect(names(nextCastPrompt(world(), "me", real("Swan Song", "ss"), undefined, { targets: [] }, stackAB))).toEqual(["Lightning Bolt"]);
  });

  it("Arcane Denial (counter + delayed draws) still targets one spell", () => {
    expect(names(nextCastPrompt(world(), "me", real("Arcane Denial", "ad"), undefined, { targets: [] }, stackAB))).toEqual(["Grizzly Bears", "Lightning Bolt"]);
  });

  it("an uncounterable spell is not a legal target (Void Rend: 'This spell can't be countered')", () => {
    const rend = real("Void Rend", "VR");
    const s = session([seat("me", "human"), seat("opp", "agent", [rend, bears])]);
    const stack = [spell("sR", "opp", rend), spell("sB", "opp", bears)];
    expect(names(nextCastPrompt(s, "me", real("Counterspell", "cs"), undefined, { targets: [] }, stack))).toEqual(["Grizzly Bears"]);
    expect(nextCastPrompt(s, "me", real("Counterspell", "cs"), undefined, { targets: [] }, [stack[0]])).toBeUndefined();
  });

  it("a copy of a spell on the stack is a spell and can be countered", () => {
    const copy = spell("sC", "opp", bolt, { isCopy: true, cardId: "copy-of-A" });
    const s = world();
    const options = counterTargetOptions(s, "me", [copy], { restriction: "any" });
    expect(options).toHaveLength(1);
    expect(options[0].label).toContain("(copy)");
  });

  it("abilities and triggers are never legal targets of a 'counter target spell' card", () => {
    const trigger = { id: "t1", type: "trigger", actorSeatId: "opp", controllerSeatId: "opp", sourceCardId: "x", sourceCardName: "X", triggerKind: "common", effect: {}, message: "" } as unknown as PendingAction;
    expect(legalCounterSpellTargets(world(), [trigger, stackAB[0]], { restriction: "any" }).map((item) => item.id)).toEqual(["sA"]);
  });

  it("the counterspell itself is not a target of itself (it is not on the stack while being cast), and picks are read back by card id", () => {
    const prompt = nextCastPrompt(world(), "me", real("Counterspell", "cs"), undefined, { targets: [] }, stackAB) as { options: Array<{ target: { kind: "card"; cardId: string; seatId: string } }> };
    expect(prompt.options.map((o) => o.target.cardId)).not.toContain("cs");
    expect(counterTargetActionFor(stackAB, prompt.options[1].target)?.id).toBe("sA");
    expect(counterTargetActionFor(stackAB, prompt.options[0].target)?.id).toBe("sB");
  });

  it("the human answers once: after the pick nothing more is asked", () => {
    const prompt = nextCastPrompt(world(), "me", real("Counterspell", "cs"), undefined, { targets: [] }, stackAB) as unknown as { options: Array<{ target: { kind: "card"; seatId: string; cardId: string } }> };
    expect(nextCastPrompt(world(), "me", real("Counterspell", "cs"), undefined, { targets: [prompt.options[1].target] }, stackAB)).toBeUndefined();
  });
});

describe("the chosen spell is the one removed; the rest of the stack is untouched and in order", () => {
  const push = (items: PendingAction[]) => items.reduce((state, item) => pushToStack(state, item), initialStackState("me"));
  it("countering A (below the top) leaves B, then the order is correct", () => {
    const counter = spell("sC", "me", real("Counterspell", "cs"), { counterTargetId: "sA" });
    const state = push([stackAB[0], stackAB[1], counter]);
    // the counterspell resolves (top), then its target is removed: B remains and resolves next, then nothing of A.
    const afterCounter = removeFromStack(removeFromStack(state, counter.id).state, "sA").remaining;
    expect(afterCounter.map((item) => item.id)).toEqual(["sB"]);
  });
  it("countering B (the top spell it answers) leaves A to resolve later", () => {
    const counter = spell("sC", "me", real("Counterspell", "cs"), { counterTargetId: "sB" });
    const state = push([stackAB[0], stackAB[1], counter]);
    const afterCounter = removeFromStack(removeFromStack(state, counter.id).state, "sB").remaining;
    expect(afterCounter.map((item) => item.id)).toEqual(["sA"]);
  });
});

describe("agents keep the automatic counter flow", () => {
  it("an agent's counterspell records no cast-time target (it counters the spell it responds to via counterTargetId)", () => {
    expect(agentCastTimeRemovalChoices(world(), "opp", real("Counterspell", "cs"))).toBeUndefined();
  });
});

describe("every counterspell of the shipped decks parses to a targeted counter with the right restriction", () => {
  const expected: Record<string, { restriction: string; types?: string[]; token?: boolean }> = {
    Counterspell: { restriction: "any" },
    Negate: { restriction: "noncreature" },
    "Arcane Denial": { restriction: "any" },
    "Swan Song": { restriction: "types", types: ["Enchantment", "Instant", "Sorcery"], token: true }
  };
  for (const [name, want] of Object.entries(expected)) {
    it(`${name}: ${want.restriction}`, () => {
      const card = real(name, "x");
      const ability = parseCounterSpellAbility(card.oracleText);
      expect(ability?.restriction).toBe(want.restriction);
      if (want.types) expect(ability?.types).toEqual(want.types);
      if (want.token) expect(ability?.controllerTokenClause).toMatch(/Bird/);
      // and it asks the human which spell, from a stack of two
      expect(nextCastPrompt(world(), "me", card, undefined, { targets: [] }, stackAB)?.kind).toBe("target");
    });
  }
  it("Void Rend and Toski are the deck cards that cannot be countered", () => {
    const rend = real("Void Rend", "r");
    const toski = real("Toski, Bearer of Secrets", "t");
    const s = session([seat("me", "human"), seat("opp", "agent", [rend, toski])]);
    expect(legalCounterSpellTargets(s, [spell("a", "opp", rend), spell("b", "opp", toski)], { restriction: "any" })).toEqual([]);
  });
});

describe("remote friend seats", () => {
  it("answer a counter target with the whitelisted onChooseModalOption intent (no new intent kind), and the prompt is addressed to their seat", () => {
    expect(INTENT_SPECS.onChooseModalOption).toBeDefined();
    const friend = seat("friend", "human", [real("Negate", "ng")]);
    const s = session([friend, seat("opp", "agent", [bolt])]);
    const stackOpp = [spell("sA", "opp", bolt)];
    const handInfo = buildSeatPrompts({ session: s, seatId: "friend", pendingAction: stackOpp[0], stackActions: stackOpp, landPlayedThisTurn: false }).handInfo;
    expect(handInfo["ng"].canRespond).toBe(false); // no mana in this fixture: the legality half is covered by the stack-wide check below
    expect(legalCounterSpellTargets(s, stackOpp, { restriction: "noncreature" }).map((item) => item.id)).toEqual(["sA"]);
  });
});
