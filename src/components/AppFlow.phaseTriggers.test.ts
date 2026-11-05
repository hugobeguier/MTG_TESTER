// "At the beginning of <step>" triggers go on the stack as real trigger items (src/lib/phaseTriggers.ts is the registry; AppFlow's phase sweep queues the items).
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { counterCount } from "@/lib/counters";
import { DEFAULT_STOP_SETTINGS } from "@/lib/priorityStops";
import { describeStackItem } from "@/lib/stackDescription";
import { parsePhaseTriggersDetailed } from "@/lib/phaseTriggers";
import type { GameSession, ManaPool, PlayerSeat, VisibleCard } from "@/lib/types";
import { applyDeterministicPhaseTrigger, hasPhaseTrigger, makePhaseStackTrigger, pendingActionRequiredPasses, planOffTurnPhaseTriggers, resolveTriggerEffect, scheduleDelayedPhaseTrigger } from "./AppFlow";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const custom = (id: string, name: string, oracleText: string, extra: Partial<VisibleCard> = {}) => ({ id, name, typeLine: "Enchantment", oracleText, colors: [], role: "permanent", zone: "battlefield", manaValue: 0, ...extra }) as VisibleCard;
const bear = (id: string, extra: Partial<VisibleCard> = {}) => ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;
const land = (id: string) => ({ id, name: `Forest ${id}`, typeLine: "Basic Land — Forest", colors: [], role: "land", zone: "battlefield", manaValue: 0, oracleText: "{T}: Add {G}." }) as VisibleCard;
const libCard = (id: string) => ({ id, name: `Lib ${id}`, typeLine: "Creature — Bear", power: "1", toughness: "1", colors: [], role: "creature", zone: "library", manaValue: 1, oracleText: "" }) as VisibleCard;
function seat(id: string, kind: "human" | "agent", battlefield: VisibleCard[] = [], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  const library = Array.from({ length: 6 }, (_, i) => libCard(`${id}-l${i}`));
  return { id, name: id, kind, life: 40, commanderDamage: {}, library, zones: { library: library.length, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield, graveyard: [] }, ...extra } as PlayerSeat;
}
function game(seats: PlayerSeat[], phase: string, extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase, turn: 3, activePlayerId: seats[0].id, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra } as GameSession;
}
const find = (s: GameSession, id: string) => s.seats.find((x) => x.id === id)!;
const emptyPool = (): ManaPool => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });

describe("planOffTurnPhaseTriggers: other seats' watchers fire on the right turns, as stack items", () => {
  it("an opponent's 'each upkeep' permanent triggers on my upkeep (Beledros), controlled by its owner, aimed at nobody", () => {
    const s = game([seat("h", "human"), seat("a", "agent", [real("Beledros Witherbloom", "bel")])], "upkeep step");
    const { triggers } = planOffTurnPhaseTriggers(s, "upkeep step", "h");
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({ type: "trigger", controllerSeatId: "a", actorSeatId: "h", sourceCardId: "bel", effect: { kind: "create_tokens", fromPhaseStep: true } });
  });
  it("'your upkeep' permanents of other seats do NOT fire on my turn", () => {
    const s = game([seat("h", "human"), seat("a", "agent", [real("Phyrexian Arena", "arena")])], "upkeep step");
    expect(planOffTurnPhaseTriggers(s, "upkeep step", "h").triggers).toEqual([]);
  });
  it("the active player's own permanents are left to the sweep's per-card flow (human prompts live there)", () => {
    const s = game([seat("h", "human", [real("Phyrexian Arena", "arena")]), seat("a", "agent")], "upkeep step");
    expect(planOffTurnPhaseTriggers(s, "upkeep step", "h").triggers).toEqual([]);
  });
  it("Sheoldred's 'each opponent's upkeep' edict fires on opponents' turns only, targeting the active player", () => {
    const s = game([seat("h", "human"), seat("a", "agent", [real("Sheoldred, Whispering One", "sheo")])], "upkeep step");
    const { triggers } = planOffTurnPhaseTriggers(s, "upkeep step", "h");
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({ controllerSeatId: "a", effect: { kind: "each_opponent_sacrifices", filter: "creature", onlySeatId: "h" } });
    expect(planOffTurnPhaseTriggers(game([seat("h", "human"), seat("a", "agent", [real("Sheoldred, Whispering One", "sheo")])], "upkeep step", { activePlayerId: "a" }), "upkeep step", "a").triggers).toEqual([]);
  });
  it("'at the beginning of each combat' fires on another player's combat (Unnatural Growth) and not on other steps", () => {
    const s = game([seat("h", "human"), seat("a", "agent", [real("Unnatural Growth", "ug")])], "beginning of combat step");
    expect(planOffTurnPhaseTriggers(s, "beginning of combat step", "h").triggers).toHaveLength(1);
    expect(planOffTurnPhaseTriggers(s, "end step", "h").triggers).toEqual([]);
  });
  it("an effect that is about 'that player' (each player's upkeep) is not resolved with the wrong player", () => {
    const howling = custom("hm", "Howling Mine-like", "At the beginning of each player's draw step, that player draws an additional card.");
    const s = game([seat("h", "human"), seat("a", "agent", [howling])], "draw step");
    expect(planOffTurnPhaseTriggers(s, "draw step", "h").triggers).toEqual([]);
  });
  it("APNAP: two seats' triggers come out with the non-active seats first (they resolve first), in reverse turn order", () => {
    const s = game([seat("h", "human"), seat("a", "agent", [real("Beledros Witherbloom", "bel-a")]), seat("b", "agent", [real("Beledros Witherbloom", "bel-b")])], "upkeep step");
    expect(planOffTurnPhaseTriggers(s, "upkeep step", "h").triggers.map((t) => t.sourceCardId)).toEqual(["bel-b", "bel-a"]);
  });
  it("an intervening 'if' that is false when the step begins puts nothing on the stack", () => {
    const grace = custom("g", "Grace", "At the beginning of each upkeep, if you control six or more lands, you gain 3 life.");
    const few = game([seat("h", "human"), seat("a", "agent", [grace, land("l1")])], "upkeep step");
    expect(planOffTurnPhaseTriggers(few, "upkeep step", "h").triggers).toEqual([]);
    const many = game([seat("h", "human"), seat("a", "agent", [grace, ...[1, 2, 3, 4, 5, 6].map((n) => land(`l${n}`))])], "upkeep step");
    expect(planOffTurnPhaseTriggers(many, "upkeep step", "h").triggers).toHaveLength(1);
  });
  it("...and it is checked AGAIN on resolution (rule 603.4): the lands are gone by then, so nothing happens", () => {
    const grace = custom("g", "Grace", "At the beginning of each upkeep, if you control six or more lands, you gain 3 life.");
    const lands = [1, 2, 3, 4, 5, 6].map((n) => land(`l${n}`));
    const s = game([seat("h", "human"), seat("a", "agent", [grace, ...lands])], "upkeep step");
    const [trigger] = planOffTurnPhaseTriggers(s, "upkeep step", "h").triggers;
    const stillTrue = resolveTriggerEffect(s, trigger);
    expect(find(stillTrue, "a").life).toBe(43);
    const afterResponse = game([seat("h", "human"), seat("a", "agent", [grace])], "upkeep step");
    const fizzled = resolveTriggerEffect(afterResponse, trigger);
    expect(find(fizzled, "a").life).toBe(40);
    expect(fizzled.events[0].message).toMatch(/no longer true/);
  });
  it("a batch of many watchers builds and plans quickly and without prompts", () => {
    const board = () => Array.from({ length: 12 }, (_, i) => real("Beledros Witherbloom", `bel${i}`));
    const s = game([seat("h", "human"), seat("a", "agent", board()), seat("b", "agent", board()), seat("c", "agent", board())], "upkeep step");
    const started = Date.now();
    const { triggers } = planOffTurnPhaseTriggers(s, "upkeep step", "h");
    expect(Date.now() - started).toBeLessThan(500);
    expect(triggers).toHaveLength(36);
    // No response for anybody: nobody is required to pass any of them, so the whole batch resolves by the engine's zero-delay fast path.
    const pools: Record<string, ManaPool> = { h: emptyPool(), a: emptyPool(), b: emptyPool(), c: emptyPool() };
    for (const trigger of triggers) expect(pendingActionRequiredPasses(s.seats, trigger, "h", s, pools, DEFAULT_STOP_SETTINGS, undefined)).toEqual([]);
  });
});

describe("delayed one-shot triggers", () => {
  it("fires once at the next end step, then is consumed; created during an end step it waits for the following one", () => {
    const base = game([seat("h", "human"), seat("a", "agent")], "precombat main phase");
    const scheduled = scheduleDelayedPhaseTrigger(base, { controllerSeatId: "a", sourceCardId: "src", sourceCardName: "Gain Life", phase: "end step", scope: "any", effectText: "You gain 3 life." });
    expect(planOffTurnPhaseTriggers(scheduled, "upkeep step", "h").triggers).toEqual([]);
    const plan = planOffTurnPhaseTriggers(scheduled, "end step", "h");
    expect(plan.consumedDelayedIds).toHaveLength(1);
    expect(plan.triggers[0]).toMatchObject({ controllerSeatId: "a", effect: { kind: "phase_trigger", delayedEffectText: "You gain 3 life." } });
    expect(find(resolveTriggerEffect(scheduled, plan.triggers[0]), "a").life).toBe(43);
    const duringEnd = scheduleDelayedPhaseTrigger({ ...base, phase: "end step" }, { controllerSeatId: "a", sourceCardId: "src", sourceCardName: "Gain Life", phase: "end step", scope: "any", effectText: "You gain 3 life." });
    expect(planOffTurnPhaseTriggers(duringEnd, "end step", "h").triggers).toEqual([]);
    expect(planOffTurnPhaseTriggers({ ...duringEnd, turn: duringEnd.turn + 1 }, "end step", "a").triggers).toHaveLength(1);
  });
});

describe("makePhaseStackTrigger: the active player's own deterministic triggers", () => {
  it("Phyrexian Arena (agent) becomes a stack item that draws and drains when it resolves, naming source, controller and step", () => {
    const s = game([seat("a", "agent", [real("Phyrexian Arena", "arena")]), seat("h", "human")], "upkeep step");
    const trigger = makePhaseStackTrigger(s, "a", real("Phyrexian Arena", "arena"), "upkeep step");
    expect(trigger).not.toBe("blocked");
    expect(trigger).toBeDefined();
    const item = trigger as Exclude<typeof trigger, "blocked" | undefined>;
    expect(item).toMatchObject({ controllerSeatId: "a", sourceCardName: "Phyrexian Arena", effect: { kind: "phase_trigger", phase: "upkeep step", fromPhaseStep: true } });
    expect(item.message).toMatch(/Phyrexian Arena triggers at the beginning of a upkeep/);
    const out = resolveTriggerEffect(s, item);
    expect(find(out, "a").board.hand).toHaveLength(1);
    expect(find(out, "a").life).toBe(39);
    const desc = describeStackItem(s, { ...item, sourceCard: real("Phyrexian Arena", "arena") });
    expect(desc.controllerSeatId).toBe("a");
  });
  it("the source leaving the battlefield in response does not stop an ability that does not need it (last-known information)", () => {
    const arena = real("Phyrexian Arena", "arena");
    const s = game([seat("a", "agent", [arena]), seat("h", "human")], "upkeep step");
    const item = makePhaseStackTrigger(s, "a", arena, "upkeep step") as Exclude<ReturnType<typeof makePhaseStackTrigger>, "blocked" | undefined>;
    const withoutArena = game([seat("a", "agent", []), seat("h", "human")], "upkeep step");
    const out = resolveTriggerEffect(withoutArena, item);
    expect(find(out, "a").board.hand).toHaveLength(1);
    expect(find(out, "a").life).toBe(39);
  });
  it("a false intervening 'if' is 'blocked': it never goes on the stack (Dragonmaster Outcast with few lands)", () => {
    const outcast = real("Dragonmaster Outcast", "dm");
    const few = game([seat("a", "agent", [outcast, land("l1")]), seat("h", "human")], "upkeep step");
    expect(makePhaseStackTrigger(few, "a", outcast, "upkeep step")).toBe("blocked");
    const many = game([seat("a", "agent", [outcast, ...[1, 2, 3, 4, 5, 6].map((n) => land(`l${n}`))]), seat("h", "human")], "upkeep step");
    const item = makePhaseStackTrigger(many, "a", outcast, "upkeep step") as Exclude<ReturnType<typeof makePhaseStackTrigger>, "blocked" | undefined>;
    expect(item.effect.recheckClause).toMatch(/six or more lands/i);
    // ...and rechecked on resolution: one land destroyed in response, so the Dragon is not made.
    const after = game([seat("a", "agent", [outcast, ...[1, 2, 3, 4, 5].map((n) => land(`l${n}`))]), seat("h", "human")], "upkeep step");
    expect(find(resolveTriggerEffect(after, item), "a").board.battlefield.filter((c) => c.token)).toHaveLength(0);
    expect(find(resolveTriggerEffect(many, item), "a").board.battlefield.filter((c) => c.token)).toHaveLength(1);
  });
  it("an agent's aimed trigger records its target as it goes on the stack, shows it, and fizzles if the target is gone (Athreos)", () => {
    const athreos = real("Athreos, Shroud-Veiled", "ath");
    const s = game([seat("a", "agent", [athreos, bear("mine")]), seat("h", "human", [bear("theirs", { power: "5", toughness: "5" })])], "end step");
    const item = makePhaseStackTrigger(s, "a", athreos, "end step") as Exclude<ReturnType<typeof makePhaseStackTrigger>, "blocked" | undefined>;
    expect(item.effect.chosenOption).toBeTruthy();
    expect(item.effect).toMatchObject({ kind: "phase_trigger", viaEffect: { kind: "add_counter" } });
    const desc = describeStackItem(s, { ...item, sourceCard: athreos });
    expect(desc.targets).toHaveLength(1);
    const out = resolveTriggerEffect(s, item);
    const countersOn = out.seats.flatMap((x) => x.board.battlefield).filter((c) => counterCount(c, "coin") > 0);
    expect(countersOn).toHaveLength(1);
    expect(countersOn[0].id).toBe(item.effect.chosenOption);
    // target removed in response: the ability does nothing rather than picking a new one
    const gone = game([seat("a", "agent", [athreos]), seat("h", "human", [])], "end step");
    const fizzled = resolveTriggerEffect(gone, item);
    expect(fizzled.seats.flatMap((x) => x.board.battlefield).filter((c) => counterCount(c, "coin") > 0)).toHaveLength(0);
    expect(fizzled.events[0].message).toMatch(/no longer legal/);
  });
  it("Mind Unbound / Meren (agent) resolve through the stack exactly as the old direct call did", () => {
    for (const [name, phase] of [["Mind Unbound", "upkeep step"], ["Phyrexian Arena", "upkeep step"]] as const) {
      const src = real(name, "src");
      const s = game([seat("a", "agent", [src]), seat("h", "human")], phase);
      const direct = applyDeterministicPhaseTrigger(s, "a", src, phase)!;
      const item = makePhaseStackTrigger(s, "a", src, phase) as Exclude<ReturnType<typeof makePhaseStackTrigger>, "blocked" | undefined>;
      const viaStack = resolveTriggerEffect(s, item);
      expect(find(viaStack, "a").board.hand.length).toBe(find(direct, "a").board.hand.length);
      expect(find(viaStack, "a").life).toBe(find(direct, "a").life);
    }
  });
});

describe("response windows for phase triggers (rule 603.3)", () => {
  const bolt = () => ({ id: "bolt", name: "Lightning Bolt", typeLine: "Instant", oracleText: "Lightning Bolt deals 3 damage to any target.", manaCost: "{R}", manaValue: 1, colors: ["R"], role: "instant", zone: "hand" }) as VisibleCard;
  const mountain = () => ({ id: "m1", name: "Mountain", typeLine: "Basic Land — Mountain", oracleText: "{T}: Add {R}.", colors: [], manaValue: 0, role: "land", zone: "battlefield" }) as VisibleCard;
  const pools = (): Record<string, ManaPool> => ({ h: emptyPool(), a: emptyPool() });
  const agentUpkeepTrigger = (s: GameSession) => makePhaseStackTrigger(s, "a", real("Phyrexian Arena", "arena"), "upkeep step") as Exclude<ReturnType<typeof makePhaseStackTrigger>, "blocked" | undefined>;

  it("the human holding an affordable instant is asked about an agent's upkeep trigger; the agent controller takes no pass of its own", () => {
    const h = seat("h", "human", [mountain()], { board: { hand: [bolt()], battlefield: [mountain()], graveyard: [] } });
    const s = game([seat("a", "agent", [real("Phyrexian Arena", "arena")]), h], "upkeep step", { activePlayerId: "a" });
    expect(pendingActionRequiredPasses(s.seats, agentUpkeepTrigger(s), "a", s, pools(), DEFAULT_STOP_SETTINGS, undefined)).toEqual(["h"]);
  });
  it("no legal response (no mana): nobody is asked, the trigger resolves at once", () => {
    const h = seat("h", "human", [], { board: { hand: [bolt()], battlefield: [], graveyard: [] } });
    const s = game([seat("a", "agent", [real("Phyrexian Arena", "arena")]), h], "upkeep step", { activePlayerId: "a" });
    expect(pendingActionRequiredPasses(s.seats, agentUpkeepTrigger(s), "a", s, pools(), DEFAULT_STOP_SETTINGS, undefined)).toEqual([]);
  });
  it("an ordinary agent trigger (not from a step) still takes its controller's pass", () => {
    const h = seat("h", "human");
    const s = game([seat("a", "agent"), h], "precombat main phase");
    const ordinary = { id: "x", type: "trigger" as const, actorSeatId: "a", controllerSeatId: "a", sourceCardId: "c", sourceCardName: "T", triggerKind: "common" as const, effect: { kind: "gain_life", amount: 1 }, message: "" } as never;
    expect(pendingActionRequiredPasses(s.seats, ordinary, "a", s, pools(), DEFAULT_STOP_SETTINGS, undefined)).toEqual(["a"]);
  });
});

// --- shipped decks: the registry covers exactly what the old sweep matched, and every handled card behaves the same through the stack ---
function deckFiles(): string[] {
  const roots = readdirSync(".").filter((f) => f.endsWith(".txt") && !/Bugs2|Potential/.test(f));
  return [...roots, ...["decks/custom", "decks/foundations"].flatMap((d) => readdirSync(d).map((f) => `${d}/${f}`))];
}
function deckCardNames(file: string): string[] {
  return readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(\d+\s|Commander:)/.test(l))
    .map((l) => l.replace(/^Commander:\s*/, "").replace(/^\d+\s+/, "").replace(/\s+\(.*$/, "").replace(/\s+\*.*$/, "").trim());
}
const PHASES = ["untap step", "upkeep step", "draw step", "precombat main phase", "beginning of combat step", "end of combat step", "end step", "postcombat main phase", "cleanup step"] as const;
// Deliberate differences between the registry and the old substring matcher (the old matcher fired on quoted/reminder/"at end of combat" text of other abilities):
//  Estrid's Invocation (quoted ability of a copy), Overlord of the Mistmoors (reminder text), Goldlust Triad (myriad's "exile the tokens at end of combat"),
//  Shadow of the Second Sun (enchanted player's postcombat main: the Aura's own extra-phase mechanism, not a registry watcher).
const KNOWN_REGISTRY_DIFFERENCES = new Set([
  "Estrid's Invocation|upkeep step|legacy", "Overlord of the Mistmoors|end step|legacy", "Goldlust Triad|end of combat step|legacy", "Shadow of the Second Sun|postcombat main phase|registry"
]);

describe("shipped-deck phase triggers", () => {
  const names = [...new Set(deckFiles().flatMap(deckCardNames))];
  it("every 'at the beginning of' wording in the shipped decks is classified by the registry, and matches the legacy matcher except for the known differences", () => {
    const differences: string[] = [];
    for (const name of names) {
      const found = lookupCard(catalog, name) as { oracleText?: string; typeLine?: string } | undefined;
      if (!found?.oracleText || /Instant|Sorcery/.test(found.typeLine ?? "")) continue;
      const parsed = parsePhaseTriggersDetailed(found.oracleText);
      expect(parsed.unrecognized, `${name} has an unclassified phase wording`).toEqual([]);
      const probe = { id: "x", name, oracleText: found.oracleText } as VisibleCard;
      for (const phase of PHASES) {
        const legacy = hasPhaseTrigger(probe, phase);
        const registry = parsed.specs.some((spec) => spec.phase === phase);
        if (legacy && !registry) differences.push(`${name}|${phase}|legacy`);
        if (registry && !legacy) differences.push(`${name}|${phase}|registry`);
      }
    }
    expect(differences.filter((entry) => !KNOWN_REGISTRY_DIFFERENCES.has(entry))).toEqual([]);
  });

  it("each handled shipped-deck trigger gives the same result through the stack as the old direct application (agent controller)", () => {
    const signature = (s: GameSession) => s.seats.map((x) => ({
      id: x.id, life: x.life, hand: x.board.hand.map((c) => c.name).sort(), graveyard: (x.board.graveyard ?? []).map((c) => c.name).sort(),
      battlefield: x.board.battlefield.map((c) => `${c.token ? "token:" : ""}${c.name}:${JSON.stringify(c.counters ?? {})}`).sort(), library: x.library?.length
    }));
    let compared = 0;
    for (const name of names) {
      const found = lookupCard(catalog, name) as { oracleText?: string; typeLine?: string } | undefined;
      if (!found?.oracleText || /Instant|Sorcery/.test(found.typeLine ?? "")) continue;
      for (const spec of parsePhaseTriggersDetailed(found.oracleText).specs) {
        if (spec.scope !== "controller" && spec.scope !== "each") continue;
        const phase = spec.phase;
        if (phase === "untap step" || phase === "cleanup step" || phase === "end of combat step") continue;
        const src = real(name, "src");
        const mk = () => game([seat("a", "agent", [bear("b1"), bear("b2"), src]), seat("h", "human", [bear("o1")])], phase);
        let direct: GameSession | undefined;
        try { direct = applyDeterministicPhaseTrigger(mk(), "a", src, phase); } catch { continue; }
        const item = makePhaseStackTrigger(mk(), "a", src, phase);
        if (direct === undefined) { expect(item, `${name} ${phase}`).toBeUndefined(); continue; }
        expect(item, `${name} ${phase} should be stackable`).toBeDefined();
        if (item === "blocked") continue;
        const viaStack = resolveTriggerEffect(mk(), item as Exclude<typeof item, undefined | "blocked">);
        // An agent's aimed trigger carries a recorded target and resolves with it (the old path picked at resolution); compare only the unaimed ones exactly.
        if ((item as { effect: { viaEffect?: unknown } }).effect.viaEffect) continue;
        expect(signature(viaStack), `${name} ${phase}`).toEqual(signature(direct));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(15);
  });
});
