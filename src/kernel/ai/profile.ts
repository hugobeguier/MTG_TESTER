// DECK PROFILE for the kernel AI (pure, deterministic): "before a match it reads through the deck and gets an understanding". deckProfile() scans the structured
// card JSON of the seat's OWN deck (never card names) through shape.ts and summarises what the deck does: sacrifice outlets, recursion, death / enters / leave
// payoffs, which counters it cares about, token makers, draw engines, cast payoffs, end-step effects, and what the commander's triggers produce.
// The profile adjusts evaluate.ts (counter weights, graveyard credit) and the planner's priorities (plan.ts: outlets first when a payoff is live; horizon.ts:
// look past the stack to the end step when the deck has end-step payoffs).
import type { EngineContext, GameState, PlayerId } from "../engine/types";
import { shapeOf, type CardShape } from "./shape";

export interface CommanderProfile {
  name: string;
  events: string[];
  produces: string[];
  playerCounterKinds: string[];
  recursion: boolean;
  endStepEffect: boolean;
  deathPayoff: boolean;
}

export interface DeckProfile {
  /** distinct nonland card names analysed */
  size: number;
  sacOutlets: string[];
  recursion: string[];
  recursionEngines: string[];
  deathPayoffs: string[];
  /** cards with their own dies / leaves trigger (cheap to sacrifice) */
  selfLeavePayoffs: string[];
  etbPayoffs: string[];
  tokenMakers: string[];
  drawEngines: string[];
  castPayoffs: string[];
  endStepPayoffs: string[];
  /** counter kind -> number of cards of the deck that mention it (+1/+1, experience, loyalty, ...) */
  counterKinds: Record<string, number>;
  /** the same for counters kept on PLAYERS */
  playerCounterKinds: Record<string, number>;
  commander?: CommanderProfile;
  /** cards that are pieces of an engine: outlets, recursion engines, death payoffs, end-step payoffs, draw engines, and anything the commander's triggers lean on */
  engines: string[];
  /** extra weight per player counter kind (added on top of the base weight in evaluate.ts) */
  playerCounterBoost: Record<string, number>;
  /** share of a creature card in the graveyard that counts as a resource although no recursion engine is out yet (0..0.3) */
  graveyardCredit: number;
  /** true when some card of the deck acts at the beginning of an end step / creates delayed triggers (the planner then looks past the stack) */
  hasEndStepPayoff: boolean;
}

function push(list: string[], name: string): void { if (!list.includes(name)) list.push(name); }
const bump = (m: Record<string, number>, k: string): void => { m[k] = (m[k] ?? 0) + 1; };

/**
 * Profile of a deck: `deckCards` are the card names (duplicates allowed, the commander may be inside or given separately). `ctx.cards` supplies the structured JSON.
 * Unknown cards are skipped. Deterministic: names are processed in sorted order.
 */
export function deckProfile(deckCards: readonly string[], commander: string | undefined, ctx: EngineContext): DeckProfile {
  const names = [...new Set([...deckCards, ...(commander ? [commander] : [])])].sort();
  const p: DeckProfile = {
    size: 0, sacOutlets: [], recursion: [], recursionEngines: [], deathPayoffs: [], selfLeavePayoffs: [], etbPayoffs: [], tokenMakers: [], drawEngines: [], castPayoffs: [], endStepPayoffs: [],
    counterKinds: {}, playerCounterKinds: {}, engines: [], playerCounterBoost: {}, graveyardCredit: 0, hasEndStepPayoff: false
  };
  const shapes = new Map<string, CardShape>();
  for (const n of names) {
    const def = ctx.cards(n);
    if (!def || def.types.includes("land")) continue;
    p.size++;
    const sh = shapeOf(def);
    shapes.set(n, sh);
    if (sh.sacOther) push(p.sacOutlets, n);
    else if (sh.sacOutlet && n === commander) push(p.sacOutlets, n);
    if (sh.recursionEngine || sh.recursionOneShot) push(p.recursion, n);
    if (sh.recursionEngine) push(p.recursionEngines, n);
    if (sh.deathPayoff) push(p.deathPayoffs, n);
    if (sh.selfLeaveTrigger) push(p.selfLeavePayoffs, n);
    if (sh.etbTrigger) push(p.etbPayoffs, n);
    if (sh.tokenMaker) push(p.tokenMakers, n);
    if (sh.drawEngine) push(p.drawEngines, n);
    if (sh.castPayoff) push(p.castPayoffs, n);
    if (sh.endStepEffect) push(p.endStepPayoffs, n);
    for (const k of sh.counterKinds) bump(p.counterKinds, k);
    for (const k of sh.playerCounterKinds) bump(p.playerCounterKinds, k);
  }
  const csh = commander ? shapes.get(commander) : undefined;
  if (commander && csh) {
    p.commander = {
      name: commander, events: [...csh.triggerEvents].sort(), produces: [...csh.triggerProduces].sort(), playerCounterKinds: [...csh.playerCounterKinds].sort(),
      recursion: csh.recursionEngine || csh.recursionOneShot, endStepEffect: csh.endStepEffect, deathPayoff: csh.deathPayoff
    };
  }
  const eng = new Set<string>([...p.sacOutlets, ...p.recursionEngines, ...p.deathPayoffs, ...p.endStepPayoffs, ...p.drawEngines]);
  if (commander && csh && (csh.triggerEvents.size || csh.recursionEngine)) eng.add(commander);
  p.engines = [...eng].sort();
  // player counters the deck cares about: base boost for any mention; more when the commander is the one that uses them
  for (const k of Object.keys(p.playerCounterKinds)) p.playerCounterBoost[k] = 0.3 + (p.commander?.playerCounterKinds.includes(k) ? 0.3 : 0) + 0.1 * Math.min(3, p.playerCounterKinds[k] - 1);
  p.graveyardCredit = Math.min(0.3, 0.1 + 0.05 * Math.min(4, p.recursion.length)) * (p.recursion.length ? 1 : 0);
  p.hasEndStepPayoff = p.endStepPayoffs.length > 0;
  return p;
}

/** The seat's own deck list as the seat itself knows it: every non-token card it owns (all zones). Used when the caller did not keep the deck list. */
export function deckOf(state: GameState, seat: PlayerId): { cards: string[]; commander?: string } {
  const cards: string[] = [];
  let commander: string | undefined;
  for (const id of Object.keys(state.objects).sort()) {
    const o = state.objects[id];
    if (o.owner !== seat || o.token || o.isCopy) continue;
    if (o.isCommander) commander = o.cardName;
    cards.push(o.cardName);
  }
  return { cards, commander };
}

/** the profile of `seat`'s deck, read from the game state (own cards only) */
export function profileFromState(state: GameState, ctx: EngineContext, seat: PlayerId): DeckProfile {
  const d = deckOf(state, seat);
  return deckProfile(d.cards, d.commander, ctx);
}
