// Ability-shape analysis for the kernel AI (pure, deterministic, cached). It reads the STRUCTURED kernel JSON of a card (CardDef.kernel: abilities, costs, triggers,
// step kinds) and says what the card is FOR, never by card name: "this has a sacrifice outlet", "this returns creatures from the graveyard every turn",
// "this fires at the beginning of my end step", "this refers to experience counters". evaluate.ts and profile.ts build on it.
import type { Ability, Card } from "../schema";
import type { CardDef } from "../engine/types";

export interface CardShape {
  /** an activated ability whose cost sacrifices something (itself or other permanents) */
  sacOutlet: boolean;
  /** ... that can sacrifice OTHER permanents (a real outlet, not just a self-sacrifice) */
  sacOther: boolean;
  /** a repeatable recursion ability (triggered / activated / static) that returns cards from the graveyard to the hand or battlefield */
  recursionEngine: boolean;
  /** a one-shot recursion (a spell, or an enters trigger) */
  recursionOneShot: boolean;
  /** the recursion can return creature cards */
  recursesCreatures: boolean;
  /** triggers on a creature of yours dying / being sacrificed / leaving (a payoff for outlets) */
  deathPayoff: boolean;
  /** triggers when THIS card dies / leaves (its own payoff when sacrificed) */
  selfLeaveTrigger: boolean;
  /** triggers when this card enters */
  etbTrigger: boolean;
  /** has an ability that fires at the beginning of an end step, or creates a delayed trigger */
  endStepEffect: boolean;
  /** counter kinds this card mentions anywhere (on objects or on players) */
  counterKinds: Set<string>;
  /** counter kinds put on PLAYERS (experience, energy ...) */
  playerCounterKinds: Set<string>;
  tokenMaker: boolean;
  /** a triggered ability that draws or makes mana / cards for you */
  drawEngine: boolean;
  /** triggers on casting spells */
  castPayoff: boolean;
  /** can be cast / activated from the graveyard (flashback, escape, unearth ...) */
  graveyardPlay: boolean;
  /** step kinds the triggered abilities run (what this card's triggers produce) */
  triggerProduces: Set<string>;
  /** trigger events of the triggered abilities */
  triggerEvents: Set<string>;
}

const cache = new WeakMap<Card, CardShape>();

function walk(node: unknown, fn: (o: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) { for (const x of node) walk(x, fn); return; }
  if (node && typeof node === "object") { const o = node as Record<string, unknown>; fn(o); for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === "object") walk(v, fn); } }
}

const PLAYER_ON = new Set(["you", "opponent", "each_opponent", "each_player", "that_player"]);
const ENTERS = new Set(["etb"]);

function empty(): CardShape {
  return {
    sacOutlet: false, sacOther: false, recursionEngine: false, recursionOneShot: false, recursesCreatures: false, deathPayoff: false, selfLeaveTrigger: false, etbTrigger: false, endStepEffect: false,
    counterKinds: new Set(), playerCounterKinds: new Set(), tokenMaker: false, drawEngine: false, castPayoff: false, graveyardPlay: false, triggerProduces: new Set(), triggerEvents: new Set()
  };
}

const isSelfSubject = (s: unknown): boolean => s === "self" || (!!s && typeof s === "object" && (s as { ref?: string }).ref === "self");

function analyseAbility(a: Ability, sh: CardShape, permanentCard: boolean): void {
  const inGraveyardZone = a.zone === "graveyard";
  if (inGraveyardZone && (a.kind === "activated" || a.kind === "spell_effect" || a.kind === "cast_option")) sh.graveyardPlay = true;
  walk(a, (o) => {
    if (typeof o.counterKind === "string") { sh.counterKinds.add(o.counterKind); if (typeof o.on === "string" && PLAYER_ON.has(o.on)) sh.playerCounterKinds.add(o.counterKind); }
    if (o.ref === "counters" && typeof o.kind === "string") { sh.counterKinds.add(o.kind); if (typeof o.on === "string" && PLAYER_ON.has(o.on)) sh.playerCounterKinds.add(o.kind); }
    const c = o.counters as { kind?: unknown } | undefined;
    if (c && typeof c === "object" && typeof c.kind === "string") sh.counterKinds.add(c.kind);
    if (o.kind === "create_tokens") sh.tokenMaker = true;
    if (o.kind === "create_delayed_trigger") sh.endStepEffect = true;
  });
  // recursion: reanimate, or move_card_zone out of the graveyard to somewhere that is not exile / graveyard
  let rec = false, recCreatures = false;
  walk(a.steps ?? a.modes, (o) => {
    const k = o.kind;
    if (k === "reanimate") { rec = true; recCreatures = true; }
    else if (k === "move_card_zone" && o.from === "graveyard" && (o.moveTo === "hand" || o.moveTo === "battlefield" || o.moveTo === "library")) rec = true;  });
  if (rec) {
    walk(a.targets, (o) => { const t = o.types; if (Array.isArray(t) && t.includes("creature") && o.zone === "graveyard") recCreatures = true; });
    if (!recCreatures) walk(a.steps, (o) => { const t = o.types; if (Array.isArray(t) && t.includes("creature")) recCreatures = true; });
    const repeatable = (a.kind === "triggered" && !(a.trigger && ENTERS.has(a.trigger.event) && isSelfSubject(a.trigger.subject ?? "self"))) || a.kind === "activated" || a.kind === "static";
    if (repeatable && permanentCard) sh.recursionEngine = true; else sh.recursionOneShot = true;
    if (recCreatures) sh.recursesCreatures = true;
  }
  if (a.kind === "activated") {
    for (const c of a.costs ?? []) {
      if (c && typeof c === "object" && "sacrifice" in c) { sh.sacOutlet = true; if (c.sacrifice !== "self") sh.sacOther = true; }
    }
  }
  if (a.kind === "triggered" && a.trigger) {
    const t = a.trigger;
    const events = [t.event, ...(t.alsoOn ?? []).map((x) => x.event)];
    for (const e of events) sh.triggerEvents.add(e);
    walk(a.steps, (o) => { if (typeof o.kind === "string") sh.triggerProduces.add(o.kind); });
    const selfSubj = t.subject === undefined || isSelfSubject(t.subject);
    const mine = (() => { const s = t.subject as { controller?: string } | undefined; return !!s && typeof s === "object" && (s.controller === "you" || s.controller === undefined); })();
    for (const e of events) {
      if (e === "etb" && selfSubj) sh.etbTrigger = true;
      if ((e === "dies" || e === "leaves" || e === "sacrifice") && selfSubj) sh.selfLeaveTrigger = true;
      if ((e === "dies" || e === "sacrifice" || e === "leaves") && !selfSubj && mine) sh.deathPayoff = true;
      if (e === "cast") sh.castPayoff = true;
      if (e === "begin_step" && (t.step === "end_step") && (t.whose === "yours" || t.whose === "each")) sh.endStepEffect = true;
    }
    const prod = sh.triggerProduces;
    if (prod.has("draw_cards") || prod.has("add_mana") || prod.has("look_top") || prod.has("investigate")) sh.drawEngine = true;
  }
}

/** The shape of a card (cached per Card object). Unknown / undefined cards are an empty shape. */
export function shapeOf(def: CardDef | undefined): CardShape {
  const card = def?.kernel;
  if (!def || !card) return empty();
  const hit = cache.get(card);
  if (hit) return hit;
  const sh = empty();
  const permanentCard = def.types.some((t) => t === "creature" || t === "artifact" || t === "enchantment" || t === "planeswalker" || t === "land" || t === "battle");
  for (const a of card.abilities) { try { analyseAbility(a, sh, permanentCard); } catch { /* an odd ability never stops the AI */ } }
  for (const co of card.castOptions ?? []) { if ((co as { zone?: string }).zone === "graveyard") sh.graveyardPlay = true; }
  cache.set(card, sh);
  return sh;
}
