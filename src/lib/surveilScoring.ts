// Deterministic "what does this agent need right now" scoring for surveil (rule 701.42: look at the top N cards, put any number into the
// graveyard, the rest back on top in any order). Pure: a seat snapshot + the revealed cards in, {toGraveyard, topOrder} out.
//
// Every revealed card gets a KEEP VALUE in rough "points" (a typical playable spell is about 3, a card that does nothing for the agent
// right now is below BIN_BELOW). Cards under the bar go to the graveyard (subject to the library-safety cap), the rest go back on top in
// order of need. Signals, all read from data the engine already carries (type line, mana cost/value, colours, oracle text, role):
//   lands      how many lands the agent has (play + hand + the ones kept from this very look) against how many it wants (commander cost / hand
//              curve, 4..8); a missing colour a land would fix; a redundant basic once there are enough; a land the commander needs is never binned
//   spells     base value (creature body value from strategy.creatureValue, draw/ramp/removal roles), castable within ~2 turns of mana, colours
//              the agent cannot produce and cannot fix from its hand, a glut of spells already in hand
//   dead cards removal with no worthwhile target (reuses playGuards.removalGuard), counterspells (reactive), a board wipe when the agent is
//              ahead, an Aura/Equipment with no creature of its own, a legendary permanent it already controls, a second copy
//   graveyard  with a reanimation/recursion engine on the table, in hand or in the command zone, a big creature or an enters-effect creature is
//              better in the graveyard (it becomes a target) while the recursion piece itself stays; delve/escape/flashback make filler worth binning
// Library safety: a nearly empty library never gets milled below MIN_LIBRARY_AFTER, and a small one only bins truly dead cards.

import type { CardLike, ScorableAction, ScoringContext } from "./actionScoring";
import { isBoardWipeText } from "./actionScoring";
import { parseTargetedRemoval, removalGuard } from "./playGuards";
import { producedColors } from "./mulliganHeuristics";
import { creatureValue } from "./strategy";
import type { VisibleCard } from "./types";

export interface SurveilSeatState {
  turn: number;
  life: number;
  /** Cards in the library BEFORE this surveil (the revealed cards are its first entries). */
  librarySize: number;
  battlefield: VisibleCard[];
  hand: VisibleCard[];
  graveyard: VisibleCard[];
  /** The commander while it sits in the command zone (its colours and cost drive land/colour needs). */
  commander?: VisibleCard;
  /** Opposing battlefields, for removal target-worth and board-wipe decisions. */
  opponents?: Array<{ id?: string; life?: number; battlefield?: CardLike[] }>;
}

export interface SurveilCardScore {
  id: string;
  name: string;
  keepValue: number;
  reasons: string[];
}

export interface SurveilDecision {
  toGraveyard: string[];
  /** Cards that stay on top, best (needed soonest) first. */
  topOrder: string[];
  scores: SurveilCardScore[];
}

export const BIN_BELOW = 1.5;
export const MIN_LIBRARY_AFTER = 5;
export const SMALL_LIBRARY = 12;
const SMALL_LIBRARY_DEAD_ONLY_BELOW = -1;

type ManaColor = "W" | "U" | "B" | "R" | "G";
const COLORS: ManaColor[] = ["W", "U", "B", "R", "G"];

const isLand = (card: VisibleCard) => card.typeLine.includes("Land") || card.role === "land";
const isCreature = (card: VisibleCard) => card.typeLine.includes("Creature");
const text = (card: { oracleText?: string }) => (card.oracleText ?? "").replace(/\([^)]*\)/g, "").toLowerCase();

// Graveyard engines: reanimation/recursion text on a card (not merely "mentions the graveyard").
const CREATURE_RECURSION = /\bcreature cards? (?:in|from) (?:your|a|target player's|an opponent's) graveyards?\b|\breturn target (?:[a-z]+ )?creature card\b|\bcast (?:creature|permanent|spells?|a creature|target creature)[^.]*from your graveyard\b|\breanimate\b/;
const ANY_RECURSION = /\breturn [^.]*\bfrom (?:your|a|target player's) graveyard to the battlefield\b|\bfrom your graveyard to (?:the battlefield|your hand)\b|\byou may cast [^.]*from your graveyard\b|\bcards? in your graveyard\b[^.]*\bhave (?:flashback|escape)\b|\bplay (?:lands|cards) from your graveyard\b/;
const FUEL_KEYWORDS = /\bdelve\b|\bescape\b|\bflashback\b|\bunearth\b|\bthreshold\b|\bdelirium\b|\bcards? in your graveyard\b/;

export function hasCreatureRecursion(card: { oracleText?: string }): boolean {
  return CREATURE_RECURSION.test(text(card));
}
export function hasAnyRecursion(card: { oracleText?: string }): boolean {
  return CREATURE_RECURSION.test(text(card)) || ANY_RECURSION.test(text(card));
}

// Colours a spell needs: the mandatory coloured pips of its mana cost (hybrid/Phyrexian pips excluded), else its colour list.
function requiredColors(card: VisibleCard): ManaColor[] {
  if (card.manaCost) {
    const found = new Set<ManaColor>();
    for (const match of card.manaCost.matchAll(/\{([WUBRG])\}/g)) found.add(match[1] as ManaColor);
    return [...found];
  }
  return (card.colors ?? []).map((c) => c.toUpperCase()).filter((c): c is ManaColor => (COLORS as string[]).includes(c));
}

function colorsOf(card: VisibleCard): Set<string> {
  return producedColors(card) as Set<string>;
}

function isManaPermanent(card: VisibleCard): boolean {
  return !isLand(card) && (card.role === "ramp" || /\{t\}: add\b/.test(text(card)));
}

// A land with something to do beyond tapping for mana (a utility/man-land/card-advantage land).
function isUtilityLand(card: VisibleCard): boolean {
  const lines = text(card).split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.some((line) => !/^\{t\}: add\b/.test(line) && !/^(?:this land|[a-z' ,-]+) enters (?:the battlefield )?tapped/.test(line) && !/^\{t\}, pay \d+ life: add\b/.test(line));
}

function isLegendary(card: VisibleCard): boolean {
  return card.typeLine.includes("Legendary");
}

function isPermanentCard(card: VisibleCard): boolean {
  return !/\b(?:Instant|Sorcery)\b/.test(card.typeLine);
}

interface Landscape {
  landsInPlay: number;
  landsInHand: number;
  manaNow: number;
  reach: number; // mana plausibly available within ~2 turns
  target: number; // how many lands the agent wants
  sources: Set<string>;
  needed: Set<string>;
  commanderCost: number;
  commanderColors: string[];
}

function assess(state: SurveilSeatState): Landscape {
  const landsInPlay = state.battlefield.filter(isLand).length;
  const handLands = state.hand.filter(isLand);
  const rocks = state.battlefield.filter(isManaPermanent);
  const manaNow = landsInPlay + rocks.length;
  const reach = manaNow + Math.min(2, handLands.length);
  const handSpells = state.hand.filter((card) => !isLand(card));
  const commander = state.commander;
  const commanderCost = commander ? commander.manaValue + (commander.commanderTax ?? 0) : 0;
  const commanderColors = (commander?.colorIdentity ?? commander?.colors ?? []).map((c) => c.toUpperCase());
  const highest = Math.max(0, ...handSpells.map((card) => card.manaValue));
  const target = Math.min(8, Math.max(4, commanderCost, Math.min(highest, 6), 5));
  const sources = new Set<string>();
  for (const card of [...state.battlefield.filter((c) => isLand(c) || isManaPermanent(c)), ...handLands, ...state.hand.filter(isManaPermanent)]) {
    for (const color of colorsOf(card)) sources.add(color);
  }
  const needed = new Set<string>(commanderColors);
  for (const card of handSpells) for (const color of requiredColors(card)) needed.add(color);
  if (commander) for (const color of requiredColors(commander)) needed.add(color);
  return { landsInPlay, landsInHand: handLands.length, manaNow, reach, target, sources, needed, commanderCost, commanderColors };
}

// Is there something worth casting removal on right now? Reuses playGuards.removalGuard (the same target-worth bar the agent uses to cast it).
function removalHasNoWorthyTarget(card: VisibleCard, state: SurveilSeatState): boolean {
  const action: ScorableAction = {
    id: `surveil-${card.id}`,
    actionType: "cast_spell",
    cardId: card.id,
    targetIds: [],
    label: card.name,
    detail: `${card.manaCost ?? ""} ${card.typeLine}. ${card.oracleText}`
  };
  if (!parseTargetedRemoval(action)) return false;
  const context: ScoringContext = {
    turn: state.turn,
    you: { life: state.life, battlefield: state.battlefield, hand: [...state.hand, card] },
    opponents: (state.opponents ?? []).map((opponent) => ({ id: opponent.id, life: opponent.life, battlefield: opponent.battlefield ?? [] }))
  };
  return !removalGuard(action, context).allowed;
}

interface Running {
  extraLands: number;
  sources: Set<string>;
  seenNames: Map<string, number>;
}

function scoreLand(card: VisibleCard, state: SurveilSeatState, land: Landscape, run: Running): SurveilCardScore {
  const reasons: string[] = [];
  let value = 0;
  const add = (amount: number, reason: string) => {
    value += amount;
    reasons.push(`${reason} (${amount >= 0 ? "+" : ""}${amount.toFixed(1)})`);
  };
  const total = land.landsInPlay + land.landsInHand + run.extraLands;
  const gap = land.target - total; // lands still wanted
  if (gap >= 2) add(6, `land-light (${total} lands, want ${land.target})`);
  else if (gap === 1) add(4, `one land short of ${land.target}`);
  else if (gap === 0) add(2.4, `exactly the ${land.target} lands wanted`);
  else if (gap === -1) add(1, "one land past what is wanted");
  else add(-1, `flooded (${total} lands, want ${land.target})`);
  const produces = colorsOf(card);
  const missing = [...land.needed].filter((color) => !run.sources.has(color) && produces.has(color));
  if (missing.length > 0) add(3.5, `fixes missing colour ${missing.join("")}`);
  else if (gap <= 0 && !isUtilityLand(card)) {
    const addsNeeded = [...produces].some((color) => land.needed.has(color) && !run.sources.has(color));
    if (!addsNeeded) add(-1.2, "redundant: adds no new colour");
  }
  if (produces.size > 0 && [...produces].every((color) => color === "C") && land.needed.size > 0 && total >= 3) add(-0.8, "colourless land while colours are needed");
  if (isUtilityLand(card)) add(0.8, "utility land");
  if (state.commander && total < land.commanderCost) value = Math.max(value, 5);
  return { id: card.id, name: card.name, keepValue: value, reasons };
}

function scoreSpell(card: VisibleCard, state: SurveilSeatState, land: Landscape, run: Running, recursion: { creature: boolean; any: boolean }): SurveilCardScore {
  const reasons: string[] = [];
  let value = 3;
  const add = (amount: number, reason: string) => {
    value += amount;
    reasons.push(`${reason} (${amount >= 0 ? "+" : ""}${amount.toFixed(1)})`);
  };
  const body = text(card);
  const mv = card.manaValue;
  const landsTotal = land.landsInPlay + land.landsInHand;
  const late = state.turn >= 8;

  if (isCreature(card)) {
    const worth = Math.min(2.5, creatureValue(card as CardLike) / 4);
    add(worth - 0.5, "creature body value");
  }
  if (card.role === "draw" || /\bdraw (?:a|one|two|three|\d+) cards?\b/.test(body)) add(0.5, "card advantage");
  if (card.role === "ramp" && land.manaNow < 6 && state.turn <= 7) add(1.5, "ramp while mana is still scarce");
  if (/\bsearch your library for\b/.test(body) && /\bland\b/.test(body) && land.manaNow < 6) add(1, "fetches lands while mana is scarce");

  // Castability: mana plausibly available within ~2 turns, with a late-game discount (bombs stay good).
  const gapMana = mv - Math.max(land.reach, Math.min(landsTotal + 2, land.reach + 1));
  if (gapMana > 0) {
    const penalty = Math.min(3, 0.6 * gapMana + 0.2) * (late ? 0.4 : 1);
    add(-penalty, `${mv} mana is ${gapMana} beyond what the agent can reach soon`);
  }

  // Colours it cannot produce.
  const missing = requiredColors(card).filter((color) => !run.sources.has(color));
  if (missing.length > 0) {
    const outsideCommander = land.commanderColors.length > 0 && missing.some((color) => !land.commanderColors.includes(color));
    const fixable = state.hand.some((other) => (isLand(other) || isManaPermanent(other)) && missing.every((color) => colorsOf(other).has(color)));
    const fewLands = landsTotal < 3;
    const hit = outsideCommander ? 5 : fixable ? 0.8 : fewLands ? 1.2 : Math.min(4, 2.5 * missing.length);
    add(-hit, `cannot produce ${missing.join("")}${fixable ? " yet (a land in hand fixes it)" : ""}`);
  }

  // Dead cards.
  if (removalHasNoWorthyTarget(card, state)) add(-3.5, "removal with no worthwhile target on the table");
  if (/\bcounter target\b/.test(body)) add(-1, "reactive counterspell, nothing to counter now");
  const myCreatures = state.battlefield.filter(isCreature).length;
  const theirCreatures = (state.opponents ?? []).reduce((sum, opp) => sum + (opp.battlefield ?? []).filter((c) => (c.typeLine ?? "").includes("Creature")).length, 0);
  if (isBoardWipeText(body)) {
    if (myCreatures >= theirCreatures && myCreatures >= 1) add(-2.5, "board wipe while the agent is ahead on creatures");
    else if (theirCreatures >= myCreatures + 2) add(1, "board wipe against a bigger opposing board");
  }
  const isEquipment = card.typeLine.includes("Equipment");
  const isOwnAura = /\bAura\b/.test(card.typeLine) && /\benchant (?:a )?creature you control\b/.test(body);
  if ((isEquipment || isOwnAura) && myCreatures === 0 && !state.hand.some((other) => isCreature(other))) add(-2, "attachment with no creature to carry it");
  if (isLegendary(card) && isPermanentCard(card)) {
    const owned = [...state.battlefield, ...state.hand, ...(state.commander ? [state.commander] : [])].some((other) => other.name === card.name);
    if (owned) add(-4.5, "legendary permanent already controlled");
  }
  if (!card.typeLine.includes("Basic")) {
    const inHand = state.hand.filter((other) => other.name === card.name).length;
    const seen = run.seenNames.get(card.name) ?? 0;
    if (!isLegendary(card) && (inHand > 0 || seen > 0)) add(-1.5, "redundant extra copy");
  }

  // Graveyard plan.
  if (recursion.creature || recursion.any) {
    const thisRecursion = hasAnyRecursion(card);
    if (thisRecursion) add(2, "recursion piece: keep it");
    else if (recursion.creature && isCreature(card)) {
      const etb = /\bwhen(?:ever)? (?:this creature|[^,]+) (?:enters|dies)\b/.test(body);
      if (mv >= 4 || creatureValue(card as CardLike) >= 6) add(-3.5, "big creature: better as a reanimation target in the graveyard");
      else if (etb && mv >= 3) add(-3, "enters/dies value creature: reanimation target");
    }
  }
  // Delve/escape/flashback cards in hand want a full graveyard: cheap filler is worth a little less than usual.
  if (mv <= 2 && !hasAnyRecursion(card) && state.hand.some((c) => FUEL_KEYWORDS.test(text(c)) && /\bdelve\b|\bescape\b|\bflashback\b/.test(text(c)))) add(-0.6, "cheap filler, graveyard fuel for delve/escape");

  // Spell glut: already holding several uncast spells.
  const handSpells = state.hand.filter((c) => !isLand(c)).length;
  if (handSpells >= 4 && mv >= 3) add(-0.5, `already holding ${handSpells} spells`);

  return { id: card.id, name: card.name, keepValue: value, reasons };
}

export function scoreSurveil(state: SurveilSeatState, looked: VisibleCard[]): SurveilDecision {
  const land = assess(state);
  const run: Running = { extraLands: 0, sources: new Set(land.sources), seenNames: new Map() };
  const recursionSources = [...state.battlefield, ...state.hand, ...(state.commander ? [state.commander] : [])];
  const recursion = {
    creature: recursionSources.some(hasCreatureRecursion),
    any: recursionSources.some(hasAnyRecursion)
  };

  const byId = new Map<string, SurveilCardScore>();
  const lands = looked.filter(isLand);
  // Best lands first (colour fixers before plain ones), so the one that fixes a colour is kept before a redundant basic is judged.
  const landRank = (card: VisibleCard) => [...colorsOf(card)].filter((c) => land.needed.has(c) && !land.sources.has(c)).length * 10 + (isUtilityLand(card) ? 1 : 0);
  const orderedLands = [...lands].sort((a, b) => landRank(b) - landRank(a) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const card of orderedLands) {
    const score = scoreLand(card, state, land, run);
    byId.set(card.id, score);
    if (score.keepValue >= BIN_BELOW) {
      run.extraLands += 1;
      for (const color of colorsOf(card)) run.sources.add(color);
    }
  }
  // Name/id order, so which of several identical copies counts as "the first" never depends on the order the library happened to be in.
  const spellsStable = looked.filter((c) => !isLand(c)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const card of spellsStable) {
    const score = scoreSpell(card, state, land, run, recursion);
    byId.set(card.id, score);
    run.seenNames.set(card.name, (run.seenNames.get(card.name) ?? 0) + 1);
  }
  const scores = looked.map((card) => byId.get(card.id)!);

  // Binning candidates, worst first; the library never drops below a safe size.
  const small = state.librarySize <= SMALL_LIBRARY;
  const bar = small ? SMALL_LIBRARY_DEAD_ONLY_BELOW : BIN_BELOW;
  const maxBin = Math.max(0, state.librarySize - MIN_LIBRARY_AFTER);
  const nameOf = new Map(looked.map((card) => [card.id, card.name]));
  const worstFirst = [...scores].sort((a, b) => a.keepValue - b.keepValue || nameOf.get(a.id)!.localeCompare(nameOf.get(b.id)!) || a.id.localeCompare(b.id));
  // Everything under the bar goes, worst first, up to the library cap. (If every card is under the bar they all go: the next draw is a fresh card.)
  const bins = worstFirst.filter((score) => score.keepValue < bar).slice(0, maxBin);
  const binned = new Set(bins.map((score) => score.id));

  // Order of need: land first when land-light, cheap castable plays next, expensive/uncastable last.
  const orderScore = (card: VisibleCard) => {
    const score = byId.get(card.id)!.keepValue;
    if (isLand(card)) return score + (land.landsInPlay + land.landsInHand + 1 < land.target ? 3 : -0.5);
    return score + (card.manaValue <= land.reach ? 1.5 : card.manaValue <= land.reach + 2 ? 0.5 : 0) - 0.1 * card.manaValue;
  };
  const kept = looked
    .filter((card) => !binned.has(card.id))
    .sort((a, b) => orderScore(b) - orderScore(a) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  return {
    toGraveyard: looked.filter((card) => binned.has(card.id)).map((card) => card.id),
    topOrder: kept.map((card) => card.id),
    scores
  };
}
