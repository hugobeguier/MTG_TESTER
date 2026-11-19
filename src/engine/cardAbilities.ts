// Card-specific activated abilities that no generic parser models (batch 3). Recognised by Oracle TEXT, never by name alone, so a reprint or a
// copy works. Each ability is a small description: where it can be activated from (battlefield / hand / graveyard), its cost, the choices the
// controller makes (`slots`, answered one at a time - sacrifices, targets, X - all of them interactive for a human), and its effect.
//
// The hook (components/game/useAbilities.ts activateScriptedAbility) drives it: it asks `scriptedNextSlot` until it says "done" (opening a
// choose_trigger_option prompt per slot for a human, so remote friends are covered by the normal prompt routing), pays the cost with
// `payScriptedCost` (pool first for a human) and resolves `applyScriptedAbility` (on the stack, except a mana ability). AI seats are not offered
// these abilities (legalActions never lists them): a deliberate scope limit, they only use the generic parsers.
//
// Same import-cycle rules as cardScripts.ts: only hoisted function declarations, no top-level calls of imported bindings.
import { manaValueFromManaCost } from "@/engine/costs";
import { hasHexproof, hasShroud } from "@/engine/damage";
import { applyMill, drawForSeat, genericManaAbilityCostShim } from "@/engine/effects";
import { destroyCreatures, moveCardAcrossSeats } from "@/engine/entry";
import { chooseManaSourcesForCost, payCostFromPool, spendManaSources } from "@/engine/mana";
import { makeCommonTrigger, resolveTriggerEffect } from "@/engine/triggers";
import { applyCounterDelta, queuePlayerChoice, rulesEvent } from "@/engine/zones";
import { reduceGenericCost } from "@/lib/graveyardAbilities";
import { counterCount, effectivePower, effectiveToughness } from "@/lib/counters";
import type { GameSession, ManaPool, PlayerSeat, VisibleCard } from "@/lib/types";

export interface ScriptedSlot {
  prompt: string;
  options: Array<{ label: string; value: string; cardId?: string }>;
}
interface Ctx {
  session: GameSession;
  seat: PlayerSeat;
  card: VisibleCard;
}
export interface ScriptedCost {
  mana?: string;
  tap?: boolean;
  life?: number;
  discardSelf?: boolean;
  removeCounters?: { kind: string; count: number };
  oncePerTurn?: boolean;
}
export interface ScriptedAbility {
  id: string;
  zone: "battlefield" | "hand" | "graveyard";
  /** Mana added to the controller's pool when it resolves (a mana ability resolves at once). */
  mana?: string;
  /** A mana ability: no stack, its mana goes straight to the pool. */
  manaAbility?: boolean;
  sorcery?: boolean;
  matches(card: VisibleCard): boolean;
  label(card: VisibleCard): string;
  cost(ctx: Ctx): ScriptedCost;
  /** The next question, "done" when every choice is made, undefined when the ability cannot be activated (no legal choice). */
  slots(ctx: Ctx, picks: string[]): ScriptedSlot | "done" | undefined;
  /** Permanents sacrificed as part of the cost, from the picks (never includes the source for a self-sacrifice: use sacrificeSelf). */
  sacrifices?(ctx: Ctx, picks: string[]): string[];
  apply(ctx: Ctx, picks: string[]): { session: GameSession; mana?: string };
}

const lines = (card: VisibleCard) => (card.oracleText ?? "").replace(/\([^)]*\)/g, "");
const has = (card: VisibleCard, pattern: RegExp) => pattern.test(lines(card));
const cardOpt = (c: VisibleCard, extra = "") => ({ label: `${c.name}${extra}`, value: c.id, cardId: c.id });
const weakFirst = (a: VisibleCard, b: VisibleCard) => Number(Boolean(b.token)) - Number(Boolean(a.token)) || effectivePower(a) + effectiveToughness(a) - (effectivePower(b) + effectiveToughness(b));
const isCreature = (c: VisibleCard) => c.typeLine.includes("Creature");
const legendaryCreatures = (seat: PlayerSeat) => seat.board.battlefield.filter((c) => isCreature(c) && c.typeLine.includes("Legendary")).length;
const done = (picks: string[]) => picks.includes("done");

function targetable(session: GameSession, holder: PlayerSeat, owner: PlayerSeat, card: VisibleCard): boolean {
  return !card.phasedOut && !hasShroud(card) && !(hasHexproof(card) && owner.id !== holder.id);
}

// --- Channel lands: "Channel — {cost}, Discard this card: ... This ability costs {1} less to activate for each legendary creature you control." ---
function channelCost(ctx: Ctx): ScriptedCost {
  const raw = lines(ctx.card).match(/channel\s*[—-]\s*((?:\{[^}]+\})+)/i)?.[1] ?? "";
  return { mana: reduceGenericCost(raw, legendaryCreatures(ctx.seat)), discardSelf: true };
}
function channelAbility(id: string, pattern: RegExp, slots: ScriptedAbility["slots"], apply: ScriptedAbility["apply"]): ScriptedAbility {
  return { id, zone: "hand", matches: (c) => has(c, pattern), label: (c) => `Channel ${c.name}`, cost: channelCost, slots, apply };
}

function eachOppSearchesLand(session: GameSession, holderId: string, victimId: string, sourceName: string): GameSession {
  // "That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle."
  const victim = session.seats.find((s) => s.id === victimId);
  if (!victim) return session;
  const lands = (victim.library ?? []).filter((c) => /\bLand\b/.test(c.typeLine) && /\b(Plains|Island|Swamp|Mountain|Forest)\b/.test(c.typeLine));
  if (lands.length === 0) return rulesEvent(session, victimId, `${victim.name} has no land with a basic land type to fetch for ${sourceName}.`);
  if (victim.kind === "human") {
    return queuePlayerChoice(session, { seatId: victimId, sourceCardId: "channel", sourceCardName: sourceName, prompt: `${sourceName}: search for a land with a basic land type (put onto the battlefield)?`, options: [...lands.slice(0, 40).map((c) => ({ label: c.name, value: c.id })), { label: "Don't search", value: "" }], resolver: "card_ability_choice", data: { kind: "fetch_land", holderId } });
  }
  const best = lands[0];
  const moved = moveCardAcrossSeats(session, victimId, best.id, victimId, "battlefield");
  return rulesEvent(moved.session, victimId, `${victim.name} searches for ${best.name} (${sourceName}) and puts it onto the battlefield.`);
}

// --- X helper: "choose X" slot from 1..max ---
function xSlot(card: VisibleCard, max: number, what: string): ScriptedSlot {
  return { prompt: `${card.name}: choose X (${what}).`, options: Array.from({ length: Math.min(max, 12) }, (_v, i) => ({ label: `X = ${i + 1}`, value: String(i + 1) })) };
}

function spendIdsAreSacrifices(ctx: Ctx, ids: string[]): VisibleCard[] {
  return ids.map((id) => ctx.seat.board.battlefield.find((c) => c.id === id)).filter((c): c is VisibleCard => Boolean(c));
}

const SQUIRREL_FILTER = (c: VisibleCard) => c.typeLine.includes("Squirrel");

export const SCRIPTED_ABILITIES: ScriptedAbility[] = [
  // Priest of Forgotten Gods
  {
    id: "priest_sacrifice_two",
    mana: "BB",
    zone: "battlefield",
    matches: (c) => has(c, /\{T\}, Sacrifice two other creatures: Any number of target players each lose 2 life and sacrifice a creature/i),
    label: () => "{T}, Sacrifice two other creatures: any number of target players each lose 2 life and sacrifice a creature; you add {B}{B} and draw a card",
    cost: () => ({ tap: true }),
    slots: ({ seat, session, card }, picks) => {
      const others = seat.board.battlefield.filter((c) => isCreature(c) && c.id !== card.id).sort(weakFirst);
      if (picks.length < 2) {
        const left = others.filter((c) => !picks.includes(c.id));
        return left.length >= 2 - picks.length ? { prompt: `${card.name}: sacrifice ${picks.length === 0 ? "the first" : "the second"} other creature.`, options: left.map((c) => cardOpt(c)) } : undefined;
      }
      if (done(picks)) return "done";
      const chosen = picks.slice(2);
      const left = session.seats.filter((s) => !s.hasLost && !chosen.includes(s.id));
      return { prompt: `${card.name}: choose ${chosen.length === 0 ? "a target player" : "another target player"} (or Done).`, options: [...left.map((s) => ({ label: s.name, value: s.id })), { label: chosen.length === 0 ? "Done (no target players)" : "Done", value: "done" }] };
    },
    sacrifices: (_ctx, picks) => picks.slice(0, 2),
    apply: ({ session, seat, card }, picks) => {
      let next = session;
      for (const targetId of picks.slice(2).filter((p) => p !== "done")) {
        const victim = next.seats.find((s) => s.id === targetId);
        if (!victim) continue;
        next = rulesEvent({ ...next, seats: next.seats.map((s) => (s.id === targetId ? { ...s, life: s.life - 2 } : s)) }, targetId, `${card.name}: ${victim.name} loses 2 life.`);
        next = resolveTriggerEffect(next, makeCommonTrigger(seat.id, seat.id, card, { kind: "each_opponent_sacrifices", filter: "creature", includeSelf: true, onlySeatId: targetId }, `${card.name} resolves.`));
      }
      next = drawForSeat(next, seat.id, `${card.name}: ${seat.name} draws a card.`);
      return { session: next, mana: "BB" };
    }
  },
  // Jarad, Golgari Lich Lord: recursion from the graveyard
  {
    id: "jarad_return",
    zone: "graveyard",
    matches: (c) => has(c, /Sacrifice a Swamp and a Forest: Return this card from your graveyard to your hand/i),
    label: () => "Sacrifice a Swamp and a Forest: return this card from your graveyard to your hand",
    cost: () => ({}),
    slots: ({ seat }, picks) => {
      const lands = seat.board.battlefield.filter((c) => /\bLand\b/.test(c.typeLine));
      const swamps = lands.filter((c) => /\bSwamp\b/.test(c.typeLine));
      const forests = lands.filter((c) => /\bForest\b/.test(c.typeLine));
      if (picks.length === 0) return swamps.length > 0 && forests.some((f) => swamps.length > 1 || f.id !== swamps[0].id) ? { prompt: "Jarad: sacrifice a Swamp.", options: swamps.filter((s) => swamps.length > 1 || forests.some((f) => f.id !== s.id)).map((c) => cardOpt(c)) } : undefined;
      if (picks.length === 1) {
        const rest = forests.filter((f) => f.id !== picks[0]);
        return rest.length > 0 ? { prompt: "Jarad: sacrifice a Forest.", options: rest.map((c) => cardOpt(c)) } : undefined;
      }
      return "done";
    },
    sacrifices: (_ctx, picks) => picks.slice(0, 2),
    apply: ({ session, seat, card }) => {
      const moved = moveCardAcrossSeats(session, seat.id, card.id, seat.id, "hand");
      return { session: rulesEvent(moved.session, seat.id, `${seat.name} returns ${card.name} from the graveyard to their hand.`) };
    }
  },
  // Takenuma, Abandoned Mire
  channelAbility(
    "channel_takenuma",
    /Channel\s*[—-].*Mill three cards, then return a creature or planeswalker card from your graveyard to your hand/i,
    () => "done",
    ({ session, seat, card }) => {
      const milled = applyMill(session, seat.id, card.name, 3);
      const me = milled.seats.find((s) => s.id === seat.id)!;
      const pool = (me.board.graveyard ?? []).filter((c) => /Creature|Planeswalker/.test(c.typeLine));
      if (pool.length === 0) return { session: rulesEvent(milled, seat.id, `${card.name}: no creature or planeswalker card to return.`) };
      if (seat.kind === "human") {
        return { session: queuePlayerChoice(milled, { seatId: seat.id, sourceCardId: card.id, sourceCardName: card.name, prompt: `${card.name}: return a creature or planeswalker card from your graveyard to your hand.`, options: pool.map((c) => ({ label: c.name, value: c.id })), resolver: "card_ability_choice", data: { kind: "graveyard_to_hand" } }) };
      }
      const best = [...pool].sort((a, b) => b.manaValue - a.manaValue)[0];
      const moved = moveCardAcrossSeats(milled, seat.id, best.id, seat.id, "hand");
      return { session: rulesEvent(moved.session, seat.id, `${card.name}: ${seat.name} returns ${best.name} to their hand.`) };
    }
  ),
  // Boseiju, Who Endures
  channelAbility(
    "channel_boseiju",
    /Channel\s*[—-].*Destroy target artifact, enchantment, or nonbasic land an opponent controls/i,
    ({ session, seat, card }, picks) => {
      if (picks.length > 0) return "done";
      const options = session.seats.filter((o) => o.id !== seat.id && !o.hasLost).flatMap((o) => o.board.battlefield.filter((c) => (/Artifact|Enchantment/.test(c.typeLine) || (/\bLand\b/.test(c.typeLine) && !/\bBasic\b/.test(c.typeLine))) && targetable(session, seat, o, c)).map((c) => ({ label: `${c.name} (${o.name})`, value: `${o.id}:${c.id}`, cardId: c.id })));
      return options.length > 0 ? { prompt: `${card.name}: choose an artifact, enchantment or nonbasic land an opponent controls.`, options } : undefined;
    },
    ({ session, seat, card }, picks) => {
      const [ownerId, targetId] = (picks[0] ?? "").split(":");
      const owner = session.seats.find((s) => s.id === ownerId);
      const target = owner?.board.battlefield.find((c) => c.id === targetId);
      if (!owner || !target) return { session: rulesEvent(session, seat.id, `${card.name}: its target is gone.`) };
      let next = session;
      if (/indestructible/i.test(target.oracleText ?? "") && !target.abilitiesStripped) next = rulesEvent(next, seat.id, `${card.name}: ${target.name} is indestructible and survives.`);
      else next = destroyCreatures(next, [{ seatId: ownerId, cardId: targetId, message: `${target.name} is destroyed by ${card.name}.` }], "Rules action");
      return { session: eachOppSearchesLand(next, seat.id, ownerId, card.name) };
    }
  ),
  // Eiganjo, Seat of the Empire
  channelAbility(
    "channel_eiganjo",
    /Channel\s*[—-].*deals 4 damage to target attacking or blocking creature/i,
    ({ session, seat, card }, picks) => {
      if (picks.length > 0) return "done";
      const options = session.seats.flatMap((o) => o.board.battlefield.filter((c) => isCreature(c) && (c.attacking || c.blocking) && targetable(session, seat, o, c)).map((c) => ({ label: `${c.name} (${o.name})`, value: `${o.id}:${c.id}`, cardId: c.id })));
      return options.length > 0 ? { prompt: `${card.name}: choose an attacking or blocking creature.`, options } : undefined;
    },
    ({ session, seat, card }, picks) => {
      const [ownerId, targetId] = (picks[0] ?? "").split(":");
      const owner = session.seats.find((s) => s.id === ownerId);
      const target = owner?.board.battlefield.find((c) => c.id === targetId);
      if (!owner || !target) return { session: rulesEvent(session, seat.id, `${card.name}: its target is gone.`) };
      const hit = { ...session, seats: session.seats.map((s) => (s.id !== ownerId ? s : { ...s, board: { ...s.board, battlefield: s.board.battlefield.map((c) => (c.id === targetId ? { ...c, damage: (c.damage ?? 0) + 4 } : c)) } })) };
      return { session: rulesEvent(hit, seat.id, `${card.name} deals 4 damage to ${target.name}.`) };
    }
  ),
  // Spymaster's Vault: connive X where X = creatures that died this turn
  {
    id: "vault_connive",
    zone: "battlefield",
    matches: (c) => has(c, /\{B\}, \{T\}: Target creature you control connives X, where X is the number of creatures that died this turn/i),
    label: () => "{B}, {T}: target creature you control connives X (X = creatures that died this turn)",
    cost: () => ({ mana: "{B}", tap: true }),
    slots: ({ seat, card }, picks) => {
      if (picks.length > 0) return "done";
      const mine = seat.board.battlefield.filter((c) => isCreature(c) && !c.phasedOut && !hasShroud(c));
      return mine.length > 0 ? { prompt: `${card.name}: choose a creature you control to connive.`, options: mine.map((c) => cardOpt(c)) } : undefined;
    },
    apply: ({ session, seat, card }, picks) => {
      const died = session.creaturesDiedThisTurn?.turn === session.turn ? Object.values(session.creaturesDiedThisTurn.bySeat).reduce((a, b) => a + b, 0) : 0;
      const target = seat.board.battlefield.find((c) => c.id === picks[0]);
      if (!target) return { session: rulesEvent(session, seat.id, `${card.name}: its target is gone.`) };
      return { session: conniveStep(session, seat.id, card.name, target.id, died) };
    }
  },
  // Chatterfang: {B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.
  {
    id: "chatterfang_pump",
    zone: "battlefield",
    matches: (c) => has(c, /\{B\}, Sacrifice X Squirrels: Target creature gets \+X\/-X until end of turn/i),
    label: () => "{B}, Sacrifice X Squirrels: target creature gets +X/-X until end of turn",
    cost: () => ({ mana: "{B}" }),
    slots: ({ session, seat, card }, picks) => {
      const squirrels = seat.board.battlefield.filter(SQUIRREL_FILTER);
      if (picks.length === 0) return squirrels.length > 0 ? xSlot(card, squirrels.length, "how many Squirrels to sacrifice") : undefined;
      const x = Number(picks[0]);
      if (picks.length <= x) {
        const left = squirrels.filter((c) => !picks.includes(c.id)).sort(weakFirst);
        return { prompt: `${card.name}: sacrifice Squirrel ${picks.length} of ${x}.`, options: left.map((c) => cardOpt(c)) };
      }
      if (picks.length === x + 1) {
        const options = session.seats.flatMap((o) => o.board.battlefield.filter((c) => isCreature(c) && targetable(session, seat, o, c) && !picks.includes(c.id)).map((c) => ({ label: `${c.name} (${o.name})`, value: `${o.id}:${c.id}`, cardId: c.id })));
        return options.length > 0 ? { prompt: `${card.name}: choose the creature that gets +${x}/-${x}.`, options } : undefined;
      }
      return "done";
    },
    sacrifices: (_ctx, picks) => picks.slice(1, 1 + Number(picks[0] ?? 0)),
    apply: ({ session, seat, card }, picks) => {
      const x = Number(picks[0]);
      const [ownerId, targetId] = (picks[x + 1] ?? "").split(":");
      return { session: pumpUntilEot(session, seat.id, card.name, ownerId, targetId, x, -x) };
    }
  },
  // Insatiable Frugivore: {3}{B}, Sacrifice X Foods: Creatures you control get +X/+0 and gain menace until end of turn.
  {
    id: "frugivore_pump",
    zone: "battlefield",
    matches: (c) => has(c, /\{3\}\{B\}, Sacrifice X Foods: Creatures you control get \+X\/\+0 and gain menace until end of turn/i),
    label: () => "{3}{B}, Sacrifice X Foods: creatures you control get +X/+0 and gain menace until end of turn",
    cost: () => ({ mana: "{3}{B}" }),
    slots: ({ seat, card }, picks) => {
      const foods = seat.board.battlefield.filter((c) => /\bFood\b/.test(c.typeLine));
      if (picks.length === 0) return foods.length > 0 ? xSlot(card, foods.length, "how many Foods to sacrifice") : undefined;
      const x = Number(picks[0]);
      if (picks.length <= x) return { prompt: `${card.name}: sacrifice Food ${picks.length} of ${x}.`, options: foods.filter((c) => !picks.includes(c.id)).map((c) => cardOpt(c)) };
      return "done";
    },
    sacrifices: (_ctx, picks) => picks.slice(1),
    apply: ({ session, seat, card }, picks) => {
      const x = Number(picks[0]);
      const next = { ...session, seats: session.seats.map((s) => (s.id !== seat.id ? s : { ...s, board: { ...s.board, battlefield: s.board.battlefield.map((c) => (isCreature(c) ? { ...c, temporaryPowerBonus: (c.temporaryPowerBonus ?? 0) + x, temporaryGrantedKeywords: [...(c.temporaryGrantedKeywords ?? []), "menace"] } : c)) } })) };
      return { session: rulesEvent(next, seat.id, `${card.name}: creatures ${seat.name} controls get +${x}/+0 and gain menace until end of turn.`) };
    }
  },
  // Ravenous Squirrel: {1}{B}{G}, Sacrifice an artifact or creature: You gain 1 life and draw a card.
  {
    id: "ravenous_squirrel_sacrifice",
    zone: "battlefield",
    matches: (c) => has(c, /\{1\}\{B\}\{G\}, Sacrifice an artifact or creature: You gain 1 life and draw a card/i),
    label: () => "{1}{B}{G}, Sacrifice an artifact or creature: gain 1 life and draw a card",
    cost: () => ({ mana: "{1}{B}{G}" }),
    slots: ({ seat, card }, picks) => {
      if (picks.length > 0) return "done";
      const fodder = seat.board.battlefield.filter((c) => isCreature(c) || c.typeLine.includes("Artifact")).sort(weakFirst);
      return fodder.length > 0 ? { prompt: `${card.name}: sacrifice an artifact or creature.`, options: fodder.map((c) => cardOpt(c)) } : undefined;
    },
    sacrifices: (_ctx, picks) => picks.slice(0, 1),
    apply: ({ session, seat, card }) => ({ session: drawForSeat({ ...session, seats: session.seats.map((s) => (s.id === seat.id ? { ...s, life: s.life + 1 } : s)) }, seat.id, `${card.name}: ${seat.name} gains 1 life and draws a card.`) })
  },
  // Oran-Rief, the Vastwood
  {
    id: "oran_rief_counters",
    zone: "battlefield",
    matches: (c) => has(c, /\{T\}: Put a \+1\/\+1 counter on each green creature that entered this turn/i),
    label: () => "{T}: put a +1/+1 counter on each green creature that entered this turn",
    cost: () => ({ tap: true }),
    slots: ({ session, seat }) => (seat.board.battlefield.some((c) => isCreature(c) && c.colors.includes("G") && c.enteredTurn === session.turn) ? "done" : undefined),
    apply: ({ session, seat, card }) => {
      const hit = seat.board.battlefield.filter((c) => isCreature(c) && c.colors.includes("G") && c.enteredTurn === session.turn);
      const next = { ...session, seats: session.seats.map((s) => (s.id !== seat.id ? s : { ...s, board: { ...s.board, battlefield: s.board.battlefield.map((c) => (hit.some((h) => h.id === c.id) ? applyCounterDelta(c, "+1/+1", 1) : c)) } })) };
      return { session: rulesEvent(next, seat.id, `${card.name}: ${hit.map((c) => c.name).join(", ")} each get a +1/+1 counter.`) };
    }
  },
  // Ramos, Dragon Engine: a mana ability whose cost is removing counters
  {
    id: "ramos_burst",
    mana: "WWUUBBRRGG",
    zone: "battlefield",
    manaAbility: true,
    matches: (c) => has(c, /Remove five \+1\/\+1 counters from [^:]+: Add \{W\}\{W\}\{U\}\{U\}\{B\}\{B\}\{R\}\{R\}\{G\}\{G\}\. Activate only once each turn/i),
    label: () => "Remove five +1/+1 counters: add {W}{W}{U}{U}{B}{B}{R}{R}{G}{G} (once each turn)",
    cost: () => ({ removeCounters: { kind: "+1/+1", count: 5 }, oncePerTurn: true }),
    slots: () => "done",
    apply: ({ session, seat, card }) => ({ session: rulesEvent(session, seat.id, `${seat.name} removes five +1/+1 counters from ${card.name} for WWUUBBRRGG.`), mana: "WWUUBBRRGG" })
  }
];

function pumpUntilEot(session: GameSession, controllerId: string, sourceName: string, ownerId: string, cardId: string, power: number, toughness: number): GameSession {
  const owner = session.seats.find((s) => s.id === ownerId);
  const target = owner?.board.battlefield.find((c) => c.id === cardId);
  if (!owner || !target) return rulesEvent(session, controllerId, `${sourceName}: its target is gone.`);
  const next = { ...session, seats: session.seats.map((s) => (s.id !== ownerId ? s : { ...s, board: { ...s.board, battlefield: s.board.battlefield.map((c) => (c.id === cardId ? { ...c, temporaryPowerBonus: (c.temporaryPowerBonus ?? 0) + power, temporaryToughnessBonus: (c.temporaryToughnessBonus ?? 0) + toughness } : c)) } })) };
  return rulesEvent(next, controllerId, `${sourceName}: ${target.name} gets ${power >= 0 ? "+" : ""}${power}/${toughness >= 0 ? "+" : ""}${toughness} until end of turn.`);
}

// Connive N on a chosen creature, one draw-and-discard at a time; a human picks each discard (parked choice), an agent discards its worst card.
function conniveStep(session: GameSession, seatId: string, sourceName: string, creatureId: string, remaining: number): GameSession {
  if (remaining <= 0) return session;
  let next = drawForSeat(session, seatId, `${sourceName}: connive draws a card.`);
  const seat = next.seats.find((s) => s.id === seatId);
  if (!seat || seat.board.hand.length === 0) return next;
  if (seat.kind === "human") {
    return queuePlayerChoice(next, { seatId, sourceCardId: creatureId, sourceCardName: sourceName, prompt: `${sourceName}: connive - discard a card (${remaining} left).`, options: seat.board.hand.map((c) => ({ label: c.name, value: c.id })), resolver: "card_ability_choice", data: { kind: "connive_discard", creatureId, remaining } });
  }
  const worst = [...seat.board.hand].sort((a, b) => Number(/Land/.test(b.typeLine)) - Number(/Land/.test(a.typeLine)) || a.manaValue - b.manaValue)[0];
  next = discardAndCounter(next, seatId, creatureId, worst.id);
  return conniveStep(next, seatId, sourceName, creatureId, remaining - 1);
}
function discardAndCounter(session: GameSession, seatId: string, creatureId: string, cardId: string): GameSession {
  const seat = session.seats.find((s) => s.id === seatId);
  const card = seat?.board.hand.find((c) => c.id === cardId);
  if (!seat || !card) return session;
  const nonland = !/Land/.test(card.typeLine);
  const moved = moveCardAcrossSeats(session, seatId, cardId, seatId, "graveyard").session;
  const counted = nonland ? { ...moved, seats: moved.seats.map((s) => (s.id !== seatId ? s : { ...s, board: { ...s.board, battlefield: s.board.battlefield.map((c) => (c.id === creatureId ? applyCounterDelta(c, "+1/+1", 1) : c)) } })) } : moved;
  return rulesEvent(counted, seatId, `${seat.name} discards ${card.name}${nonland ? " and the creature gets a +1/+1 counter" : ""}.`);
}

/** The deferred answers of this module (resolver "card_ability_choice", called from resolveDeferredChoice). */
export function resolveCardAbilityChoice(session: GameSession, seatId: string, sourceCardId: string, sourceName: string, data: Record<string, unknown>, value: string | undefined): GameSession {
  const kind = String(data.kind ?? "");
  if (kind === "graveyard_to_hand" && value) {
    const moved = moveCardAcrossSeats(session, seatId, value, seatId, "hand");
    return rulesEvent(moved.session, seatId, `${sourceName}: ${moved.movedCard?.name ?? "a card"} returns to hand.`);
  }
  if (kind === "fetch_land" && value) {
    const moved = moveCardAcrossSeats(session, seatId, value, seatId, "battlefield");
    return rulesEvent(moved.session, seatId, `${moved.movedCard?.name ?? "A land"} is put onto the battlefield (${sourceName}).`);
  }
  if (kind === "connive_discard" && value) {
    const creatureId = String(data.creatureId);
    const remaining = Number(data.remaining ?? 1);
    return conniveStep(discardAndCounter(session, seatId, creatureId, value), seatId, sourceName, creatureId, remaining - 1);
  }
  return session;
}

// --- public API ---
export function scriptedAbilitiesFor(card: VisibleCard, zone: "battlefield" | "hand" | "graveyard"): ScriptedAbility[] {
  if (card.abilitiesStripped || card.phasedOut) return [];
  return SCRIPTED_ABILITIES.filter((ability) => ability.zone === zone && ability.matches(card));
}
export function scriptedAbilityById(id: string): ScriptedAbility | undefined {
  return SCRIPTED_ABILITIES.find((ability) => ability.id === id);
}
/** Every scripted ability this card text has, in any zone (used by the ability audit). */
export function anyScriptedAbilityFor(card: { name: string; typeLine?: string; oracleText?: string }): ScriptedAbility[] {
  return SCRIPTED_ABILITIES.filter((ability) => ability.matches(card as VisibleCard));
}

function ctxFor(session: GameSession, seatId: string, cardId: string, zone: ScriptedAbility["zone"]): Ctx | undefined {
  const seat = session.seats.find((s) => s.id === seatId);
  const pool = zone === "battlefield" ? seat?.board.battlefield : zone === "hand" ? seat?.board.hand : seat?.board.graveyard;
  const card = pool?.find((c) => c.id === cardId);
  return seat && card ? { session, seat, card } : undefined;
}

/** Can the static part of the cost be paid right now (tap, life, counters, mana, once per turn)? Choices are checked by scriptedNextSlot. */
export function scriptedCostPayable(session: GameSession, seatId: string, card: VisibleCard, ability: ScriptedAbility, humanPool?: ManaPool): boolean {
  const ctx = ctxFor(session, seatId, card.id, ability.zone);
  if (!ctx) return false;
  const cost = ability.cost(ctx);
  if (cost.tap && (card.tapped || (isCreature(card) && card.summoningSick && !/\bhaste\b/i.test(card.oracleText ?? "")))) return false;
  if (cost.life && ctx.seat.life < cost.life) return false;
  if (cost.removeCounters && counterCount(card, cost.removeCounters.kind) < cost.removeCounters.count) return false;
  if (cost.oncePerTurn && session.onceEachTurnEffectsUsed?.includes(`${session.turn}:${card.id}:${ability.id}`)) return false;
  if (cost.mana) {
    const total = manaValueFromManaCost(cost.mana);
    const shim = genericManaAbilityCostShim({ costManaText: cost.mana });
    if (!(humanPool && payCostFromPool(humanPool, shim, total).ok) && !chooseManaSourcesForCost(ctx.seat, shim, total, card.id, session.seats).ok) return false;
  }
  return true;
}

export function scriptedNextSlot(session: GameSession, seatId: string, card: VisibleCard, ability: ScriptedAbility, picks: string[]): ScriptedSlot | "done" | undefined {
  const ctx = ctxFor(session, seatId, card.id, ability.zone);
  return ctx ? ability.slots(ctx, picks) : undefined;
}

/** Pays the cost (mana from the pool first for a human, then lands), taps / sacrifices / discards. Undefined when it cannot be paid. */
export function payScriptedCost(session: GameSession, seatId: string, card: VisibleCard, ability: ScriptedAbility, picks: string[], humanPool?: ManaPool): { session: GameSession; poolSpent?: ManaPool } | undefined {
  const ctx = ctxFor(session, seatId, card.id, ability.zone);
  if (!ctx || !scriptedCostPayable(session, seatId, card, ability, humanPool)) return undefined;
  const cost = ability.cost(ctx);
  let next = session;
  let poolSpent: ManaPool | undefined;
  if (cost.mana) {
    const total = manaValueFromManaCost(cost.mana);
    const shim = genericManaAbilityCostShim({ costManaText: cost.mana });
    const fromPool = humanPool ? payCostFromPool(humanPool, shim, total) : undefined;
    if (fromPool?.ok) poolSpent = fromPool.pool;
    else {
      const payment = chooseManaSourcesForCost(ctx.seat, shim, total, card.id, session.seats);
      if (!payment.ok) return undefined;
      next = { ...next, seats: next.seats.map((s) => (s.id === seatId ? spendManaSources(s, payment.sourceIds) : s)) };
    }
  }
  next = {
    ...next,
    ...(cost.oncePerTurn ? { onceEachTurnEffectsUsed: [...(next.onceEachTurnEffectsUsed ?? []), `${session.turn}:${card.id}:${ability.id}`] } : {}),
    seats: next.seats.map((s) =>
      s.id !== seatId
        ? s
        : {
            ...s,
            life: s.life - (cost.life ?? 0),
            board: {
              ...s.board,
              hand: cost.discardSelf ? s.board.hand.filter((c) => c.id !== card.id) : s.board.hand,
              graveyard: cost.discardSelf ? [...(s.board.graveyard ?? []), { ...card, zone: "graveyard" as const }] : s.board.graveyard,
              battlefield: s.board.battlefield.map((c) => (c.id !== card.id ? c : { ...c, ...(cost.tap ? { tapped: true } : {}), ...(cost.removeCounters ? applyCounterDelta(c, cost.removeCounters.kind, -cost.removeCounters.count) : {}) }))
            }
          }
    )
  };
  const sacrificed = ability.sacrifices ? spendIdsAreSacrifices(ctx, ability.sacrifices(ctx, picks)) : [];
  if (sacrificed.length > 0) {
    next = destroyCreatures(next, sacrificed.map((c) => ({ seatId, cardId: c.id, message: `${ctx.seat.name} sacrifices ${c.name} to activate ${card.name}.` })), "Rules action");
  }
  return { session: rulesEvent(next, seatId, `${ctx.seat.name} activates ${card.name}.`), poolSpent };
}

/** Resolves the effect with the (snapshot of the) source card; `card` may already have left its zone (channel, sacrifice). */
export function applyScriptedAbility(session: GameSession, seatId: string, card: VisibleCard, ability: ScriptedAbility, picks: string[]): { session: GameSession; mana?: string } {
  const seat = session.seats.find((s) => s.id === seatId);
  if (!seat) return { session };
  return ability.apply({ session, seat, card }, picks);
}

