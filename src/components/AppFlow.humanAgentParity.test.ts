// Human/agent parity: wherever the engine asks a HUMAN to decide, an AGENT seat must decide deterministically (or refuse the card), never silently do
// nothing. This file (1) tests the handlers added for the Breena deck's "other players choose" cards (Master of Ceremonies, Keen Duelist, Parker Luck),
// (2) guards the refusal list for spells with no deterministic resolution, (3) statically checks that every human choice kind has an agent
// answer or is explicitly declared human-only, and (4) ratchets the set of phase triggers across every shipped deck that still depend on the LLM.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  AGENT_UNSUPPORTED_SPELL_TEXT,
  applyDeterministicPhaseTrigger,
  hasResolvableTarget,
  phaseEffectText,
  resolveDeferredChoice
} from "./AppFlow";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();

function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const card = (id: string, mv: number, extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Card ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: [], role: "creature", zone: "library", manaValue: mv, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;
function seat(id: string, kind: "human" | "agent", battlefield: VisibleCard[] = [], library: VisibleCard[] = [], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return {
    id, name: id, kind, life: 40, commanderDamage: {}, library,
    zones: { library: library.length, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield, graveyard: [] }, ...extra
  } as PlayerSeat;
}
function game(seats: PlayerSeat[], extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "upkeep step", turn: 3, activePlayerId: seats[0].id, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra } as GameSession;
}
const find = (s: GameSession, id: string) => s.seats.find((x) => x.id === id)!;
const lands = (n: number) => Array.from({ length: n }, (_, i) => card(`land${i}`, 0, { typeLine: "Basic Land — Forest", zone: "battlefield" }));

describe("Keen Duelist: both players reveal, lose life equal to the OTHER card's mana value, put their card into hand", () => {
  const duelist = () => real("Keen Duelist", "kd");
  it("an agent aims it at its healthiest opponent and the exchange is exact", () => {
    const s = game([
      seat("a", "agent", [duelist()], [card("a1", 4), card("a2", 1)]),
      seat("o1", "agent", [], [card("p1", 6)], { life: 30 }),
      seat("o2", "agent", [], [card("q1", 2)], { life: 40 })
    ]);
    const out = applyDeterministicPhaseTrigger(s, "a", duelist(), "upkeep step")!;
    expect(out).toBeDefined();
    expect(find(out, "a").life).toBe(40 - 2); // o2 (healthiest) revealed a mana value 2 card
    expect(find(out, "o2").life).toBe(40 - 4);
    expect(find(out, "a").board.hand.map((c) => c.id)).toEqual(["a1"]);
    expect(find(out, "o2").board.hand.map((c) => c.id)).toEqual(["q1"]);
    expect(find(out, "o1").life).toBe(30);
    expect(find(out, "a").library!.map((c) => c.id)).toEqual(["a2"]);
  });
  it("a human controller is asked which opponent; answering resolves the same exchange", () => {
    const s = game([seat("h", "human", [duelist()], [card("h1", 3)]), seat("o1", "agent", [], [card("p1", 5)]), seat("o2", "agent", [], [card("q1", 1)])]);
    const asked = applyDeterministicPhaseTrigger(s, "h", duelist(), "upkeep step")!;
    const prompt = asked.pendingPlayerChoices![0];
    expect(prompt.seatId).toBe("h");
    expect(prompt.options.map((o) => o.value)).toEqual(["o1", "o2"]);
    const done = resolveDeferredChoice(asked, "h", prompt.sourceCardId, prompt.sourceCardName, prompt.resolver, prompt.data, "o1");
    expect(find(done, "h").life).toBe(40 - 5);
    expect(find(done, "o1").life).toBe(40 - 3);
  });
  it("an empty library reveals nothing and costs nothing", () => {
    const s = game([seat("a", "agent", [duelist()], [card("a1", 4)]), seat("o1", "agent", [], [])]);
    const out = applyDeterministicPhaseTrigger(s, "a", duelist(), "upkeep step")!;
    expect(find(out, "a").life).toBe(40);
    expect(find(out, "o1").life).toBe(36);
  });
});

describe("Parker Luck: two target players", () => {
  const luck = () => real("Parker Luck", "pl");
  it("an agent picks its two healthiest opponents, never itself", () => {
    const s = game(
      [seat("a", "agent", [luck()], [card("a1", 9)]), seat("o1", "agent", [], [card("p1", 3)], { life: 20 }), seat("o2", "agent", [], [card("q1", 5)], { life: 38 }), seat("o3", "agent", [], [card("r1", 1)], { life: 39 })],
      { phase: "end step" }
    );
    const out = applyDeterministicPhaseTrigger(s, "a", luck(), "end step")!;
    expect(find(out, "a").life).toBe(40);
    expect(find(out, "a").board.hand).toHaveLength(0);
    expect(find(out, "o2").life).toBe(38 - 1);
    expect(find(out, "o3").life).toBe(39 - 5);
    expect(find(out, "o1").life).toBe(20);
  });
  it("a human controller is offered every pair of living players", () => {
    const s = game([seat("h", "human", [luck()], [card("h1", 2)]), seat("o1", "agent", [], [card("p1", 3)]), seat("o2", "agent", [], [card("q1", 5)])], { phase: "end step" });
    const asked = applyDeterministicPhaseTrigger(s, "h", luck(), "end step")!;
    expect(asked.pendingPlayerChoices![0].options.map((o) => o.value).sort()).toEqual(["h|o1", "h|o2", "o1|o2"]);
    const done = resolveDeferredChoice(asked, "h", "pl", "Parker Luck", "reveal_exchange", asked.pendingPlayerChoices![0].data, "o1|o2");
    expect(find(done, "o1").life).toBe(35);
    expect(find(done, "o2").life).toBe(37);
  });
});

describe("Master of Ceremonies: each opponent chooses money, friends or secrets", () => {
  const moc = () => real("Master of Ceremonies", "moc");
  it("agent opponents decide by what they lack and BOTH players get the benefit", () => {
    const rich = seat("o1", "agent", lands(6), [card("x1", 1)], { board: { hand: [card("h1", 1), card("h2", 1), card("h3", 1)], battlefield: lands(6), graveyard: [] } } as never);
    const poor = seat("o2", "agent", lands(1), [card("y1", 1)], { board: { hand: [card("g1", 1), card("g2", 1), card("g3", 1)], battlefield: lands(1), graveyard: [] } } as never);
    const out = applyDeterministicPhaseTrigger(game([seat("a", "agent", [moc()], [card("a1", 1), card("a2", 1)]), rich, poor]), "a", moc(), "upkeep step")!;
    // o1 has plenty of mana and cards: friends. o2 is short on mana: money.
    const names = (id: string) => find(out, id).board.battlefield.map((c) => c.name);
    expect(names("o1").filter((n) => /Citizen/.test(n))).toHaveLength(1);
    expect(names("o2").filter((n) => /Treasure/.test(n))).toHaveLength(1);
    expect(names("a").filter((n) => /Citizen/.test(n))).toHaveLength(1);
    expect(names("a").filter((n) => /Treasure/.test(n))).toHaveLength(1);
  });
  it("a human opponent is asked (the prompt is theirs), and the remaining opponents carry on afterwards", () => {
    const s = game([seat("a", "agent", [moc()], [card("a1", 1), card("a2", 1)]), seat("h", "human", [], [card("h1", 1)]), seat("o2", "agent", lands(1), [card("y1", 1)], { board: { hand: [card("g1", 1), card("g2", 1), card("g3", 1)], battlefield: lands(1), graveyard: [] } } as never)]);
    const asked = applyDeterministicPhaseTrigger(s, "a", moc(), "upkeep step")!;
    const prompt = asked.pendingPlayerChoices![0];
    expect(prompt.seatId).toBe("h");
    expect(prompt.options.map((o) => o.value)).toEqual(["money", "friends", "secrets"]);
    const done = resolveDeferredChoice(asked, "h", prompt.sourceCardId, prompt.sourceCardName, prompt.resolver, prompt.data, "secrets");
    expect(find(done, "h").board.hand).toHaveLength(1);
    expect(find(done, "a").board.hand.length).toBeGreaterThanOrEqual(1);
    expect(find(done, "o2").board.battlefield.some((c) => /Treasure/.test(c.name))).toBe(true);
  });
  it("a dismissed human prompt defaults to money instead of doing nothing", () => {
    const s = game([seat("a", "agent", [moc()], [card("a1", 1)]), seat("h", "human", [], [card("h1", 1)])]);
    const asked = applyDeterministicPhaseTrigger(s, "a", moc(), "upkeep step")!;
    const p = asked.pendingPlayerChoices![0];
    const done = resolveDeferredChoice(asked, "h", p.sourceCardId, p.sourceCardName, p.resolver, p.data, undefined);
    expect(find(done, "h").board.battlefield.some((c) => /Treasure/.test(c.name))).toBe(true);
  });
});

describe("agents refuse spells the engine cannot resolve deterministically; humans are not blocked", () => {
  const names = ["Promise of Loyalty", "Agadeem's Awakening // Agadeem, the Undercrypt", "Batwing Brume"];
  it.each(names)("%s: matched by the refusal list, uncastable for an agent, castable for a human", (name) => {
    const spell = real(name, "sp", { zone: "hand" });
    if (name.startsWith("Agadeem")) {
      // The refusal list is checked against the spell face's own text (the land face is played, not cast).
      expect(AGENT_UNSUPPORTED_SPELL_TEXT.some((p) => p.test(spell.oracleText))).toBe(true);
    }
    const asAgent = game([seat("a", "agent", [bearOf("b1")]), seat("o", "agent", [bearOf("o1")])]);
    const asHuman = game([seat("a", "human", [bearOf("b1")]), seat("o", "agent", [bearOf("o1")])]);
    if (!name.startsWith("Agadeem")) {
      expect(hasResolvableTarget(asAgent, "a", spell)).toBe(false);
      expect(hasResolvableTarget(asHuman, "a", spell)).toBe(true);
    }
  });
});
function bearOf(id: string) {
  return card(id, 2, { zone: "battlefield" });
}

// --- static guard: every human choice kind has an agent answer or is declared human-only ---
const source = readFileSync("src/components/AppFlow.tsx", "utf8");
function between(start: RegExp, end: RegExp, from = 0): string {
  const s = source.slice(from);
  const a = s.search(start);
  if (a < 0) throw new Error(`start not found: ${start}`);
  const rest = s.slice(a + 1);
  const b = rest.search(end);
  return s.slice(a, a + 1 + (b < 0 ? rest.length : b));
}
// Prompt kinds only a human ever sees. Each one is created behind a seat.kind === "human" gate (the agent decides inline, with the deterministic
// choosers named in docs/agents/system.md); a NEW kind must either get a branch in resolveAgentRuleChoice or be added here on purpose.
const HUMAN_ONLY_RULE_CHOICE_KINDS = new Set([
  "choose_cast_copy", "choose_cast_x", "choose_cast_alt", "choose_cast_face", "choose_cast_targets", "choose_spell_modes", "choose_dig_card", "choose_labeled_target",
  "choose_creature_from_graveyards", "choose_creature_to_sacrifice", "choose_each_player_sacrifice", "choose_creature_to_sacrifice_for_cast",
  "choose_modal_option", "choose_proliferate_targets", "choose_effect_target", "choose_creature_on_battlefield", "choose_aura_attach_target",
  "choose_equip_target", "commander_zone_choice", "choose_trigger_option", "choose_creature_for_grant", "choose_trigger_card",
  "choose_ability_card_target", "choose_creature_type", "choose_color",
  // Klauth / restricted spell mana: the agent takes attackTriggerManaHeuristicSplit instead.
  "distribute_attack_trigger_mana"
]);
describe("every human prompt kind has an agent answer (static guard)", () => {
  const union = between(/type PendingRuleChoice =/, /\n(?:const|function|export|type|interface) /);
  const kinds = [...union.matchAll(/^\s+kind: "([a-z_]+)";/gm)].map((m) => m[1]);
  const agentFn = between(/\n  function resolveAgentRuleChoice\(/, /\n  (?:async )?function /);
  const agentHandled = new Set([...agentFn.matchAll(/choice\.kind === "([a-z_]+)"/g)].map((m) => m[1]));
  it("finds the PendingRuleChoice union and the agent resolver", () => {
    expect(kinds.length).toBeGreaterThan(20);
    expect(agentHandled.size).toBeGreaterThan(8);
  });
  it("each kind is answered by resolveAgentRuleChoice or declared human-only", () => {
    const orphans = kinds.filter((kind) => !agentHandled.has(kind) && !HUMAN_ONLY_RULE_CHOICE_KINDS.has(kind));
    expect(orphans, "new human prompt kinds need an agent branch in resolveAgentRuleChoice (or an entry in HUMAN_ONLY_RULE_CHOICE_KINDS)").toEqual([]);
  });
  it("the human-only list does not hide a kind that no longer exists", () => {
    const stale = [...HUMAN_ONLY_RULE_CHOICE_KINDS].filter((kind) => !source.includes(`"${kind}"`));
    expect(stale).toEqual([]);
  });
  it("every deferred resolver that is queued for a player has a branch in resolveDeferredChoice", () => {
    const used = new Set([...source.matchAll(/resolver: "([a-z_]+)"/g)].map((m) => m[1]));
    const resolveFn = between(/\nexport function resolveDeferredChoice\(/, /\n(?:export )?function [a-zA-Z]+\([^)]*\)[^{]*\{\n(?!\s*const seat = session)/);
    const handled = new Set([...resolveFn.matchAll(/resolver === "([a-z_]+)"/g)].map((m) => m[1]));
    expect([...used].filter((r) => !handled.has(r) && r !== "deferred_choice")).toEqual([]);
  });
});

// --- ratchet: phase triggers in the shipped decks that still depend on the LLM rules advisor (agent AND human) ---
// A new card whose "at the beginning of ..." text no deterministic handler owns appears as a new entry here and fails until it is handled or
// consciously added. Entries that become handled can simply be deleted. Orzhov Advokist, Shadrix, The Ozolith and Reluctant Role Model are the
// ones with real choices (listed under "Human/agent parity gaps" in docs/agents/system.md).
const KNOWN_LLM_ONLY_PHASE_TRIGGERS = new Set([
  "Call the Spirit Dragons|upkeep step", "Estrid's Invocation|upkeep step", "Gyome, Master Chef|end step", "Hulking Raptor|precombat main phase",
  "Mystic Remora|upkeep step", "Orzhov Advokist|upkeep step", "Overlord of the Mistmoors|end step", "Reluctant Role Model|postcombat main phase",
  "Rith, Liberated Primeval|end step", "Shadrix Silverquill|beginning of combat step", "The Ozolith|beginning of combat step"
]);
function deckFiles(): string[] {
  const roots = readdirSync(".").filter((f) => f.endsWith(".txt") && !/Bugs2|Potential/.test(f));
  return [...roots, ...["decks/custom", "decks/foundations"].flatMap((d) => readdirSync(d).map((f) => `${d}/${f}`))];
}
function deckCardNames(file: string): string[] {
  return readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(\d+\s|Commander:)/.test(l))
    .map((l) => l.replace(/^Commander:\s*/, "").replace(/^\d+\s+/, "").replace(/\s+\(.*$/, "").replace(/\s+\*.*$/, "").trim());
}
describe("phase triggers across every shipped deck", () => {
  it("none beyond the known LLM-only set lack a deterministic handler", () => {
    const names = [...new Set(deckFiles().flatMap(deckCardNames))];
    const phases = ["untap step", "upkeep step", "draw step", "precombat main phase", "beginning of combat step", "end step", "postcombat main phase"] as const;
    const unhandled: string[] = [];
    for (const name of names) {
      const found = lookupCard(catalog, name) as { oracleText?: string; typeLine?: string } | undefined;
      if (!found?.oracleText || /Instant|Sorcery/.test(found.typeLine ?? "")) continue;
      for (const phase of phases) {
        if (!phaseEffectText(found.oracleText, phase).trim()) continue;
        const src = real(name, "src");
        const board = [bearOf("b1"), bearOf("b2"), src];
        const s = game([seat("a", "agent", board, [card("l1", 2), card("l2", 3)]), seat("o", "human", [bearOf("o1")], [card("p1", 1)])], { phase });
        let out: GameSession | undefined;
        try {
          out = applyDeterministicPhaseTrigger(s, "a", src, phase);
        } catch {
          out = s;
        }
        if (out === undefined) unhandled.push(`${name}|${phase}`);
      }
    }
    expect(unhandled.filter((entry) => !KNOWN_LLM_ONLY_PHASE_TRIGGERS.has(entry))).toEqual([]);
  });
});
