// Sequencing of mass removal against my own deployment (found by the user in a real game: an agent cast a creature and then a board wipe the
// same turn, killing its own fresh creature). Pure helpers over a ScorableAction + ScoringContext:
//   * wipeScope / wipeVictims — which permanents a sweeper or mass-sacrifice effect takes from a board.
//   * freshOwnPermanents      — my permanents that entered THIS turn (CardLike.enteredTurn, falling back to summoning sickness for creatures).
//   * wipeSequencingGuard     — hard veto: never cast a wipe that kills a permanent I cast this turn, unless it is still clearly net-positive
//                               without those, or I am facing lethal. (Cast the wipe first, then deploy.)
//   * scoreWipeSequencing     — score: while a wipe I plan to cast this turn is in hand, hold back permanents it would kill, so the wipe is
//                               cast first and the deployment follows with the remaining mana.
import type { CardLike, ScorableAction, ScoringContext } from "./actionScoring";
import { isBoardWipeText } from "./actionScoring";
import { hasIndestructible, parseNum } from "./combatSim";
import { creatureValue } from "./strategy";

type Delta = (amount: number, reason: string) => void;
export type WipeScope = "creature" | "artifact" | "enchantment" | "nonland";

function clean(text: string | undefined): string {
  return (text ?? "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").toLowerCase();
}

function detailText(action: ScorableAction): string {
  return clean((action.detail ?? "").replace(/Payable with[\s\S]*$/i, ""));
}

const MASS_PERMANENT_RE = /\b(?:destroy|exile) all (?:non-?[a-z]+ )?(artifacts|enchantments|nonland permanents|permanents)\b|\beach player sacrifices (?:all|each|an?|two|three|\d+)? ?(?:non-?[a-z]+ )?(artifacts?|enchantments?|nonland permanents?|permanents?)\b/;

// What a mass effect takes: creature sweepers (destroy all creatures, -X/-X to all, damage to each creature, each player sacrifices creatures),
// "destroy all artifacts / enchantments / nonland permanents" (Vandalblast, Wildfire-style). Undefined when the text is not a mass effect.
export function wipeScope(text: string): WipeScope | undefined {
  const t = clean(text);
  if (/\bcounter target\b/.test(t)) return undefined;
  const mass = t.match(MASS_PERMANENT_RE);
  if (mass) {
    const noun = mass[1] ?? mass[2] ?? "";
    if (noun.startsWith("artifact")) return "artifact";
    if (noun.startsWith("enchantment")) return "enchantment";
    return "nonland";
  }
  if (isBoardWipeText(t)) return "creature";
  return undefined;
}

function isCreature(card: CardLike): boolean {
  return (card.typeLine ?? "").includes("Creature");
}

function inScope(card: CardLike, scope: WipeScope, text: string): boolean {
  if (card.typeLine?.includes("Land")) return false;
  if (hasIndestructible(card) && /\bdestroy\b/.test(text)) return false;
  switch (scope) {
    case "creature":
      return isCreature(card);
    case "artifact":
      return (card.typeLine ?? "").includes("Artifact");
    case "enchantment":
      return (card.typeLine ?? "").includes("Enchantment");
    case "nonland":
      return true;
  }
}

function value(card: CardLike): number {
  return isCreature(card) ? creatureValue(card) : Math.max(1, card.manaValue ?? 0);
}

export function wipeVictims(text: string, cards: CardLike[] | undefined): CardLike[] {
  const scope = wipeScope(text);
  if (!scope) return [];
  return (cards ?? []).filter((card) => inScope(card, scope, clean(text)));
}

// My permanents that entered the battlefield this turn.
export function freshOwnPermanents(context: ScoringContext): CardLike[] {
  return (context.you?.battlefield ?? []).filter((card) => (card.enteredTurn !== undefined ? card.enteredTurn === context.turn : isCreature(card) && Boolean(card.summoningSick)));
}

function sum(cards: CardLike[]): number {
  return cards.reduce((total, card) => total + value(card), 0);
}

// How much more the table loses than I do, with `mine` being whichever of my permanents the caller decides the sweeper would take.
function netBenefit(text: string, context: ScoringContext, mine: CardLike[]): number {
  const theirs = (context.opponents ?? []).reduce((total, opponent) => total + sum(wipeVictims(text, opponent.battlefield)), 0);
  return theirs - sum(mine);
}

function facingLethal(context: ScoringContext): boolean {
  const life = context.you?.life ?? 40;
  const myBlockers = (context.you?.battlefield ?? []).filter((card) => isCreature(card) && !card.tapped).length;
  return (context.opponents ?? []).some((opponent) => {
    const powers = (opponent.battlefield ?? []).filter(isCreature).map((card) => Math.max(0, parseNum(card.power) ?? 0)).sort((a, b) => b - a);
    return powers.slice(Math.min(myBlockers, powers.length)).reduce((total, power) => total + power, 0) >= life;
  });
}

const FRESH_VALUE_THRESHOLD = 3;

export function wipeSequencingGuard(action: ScorableAction, context: ScoringContext): { allowed: boolean; reason?: string } {
  if (action.actionType !== "cast_spell") return { allowed: true };
  const text = detailText(action);
  if (!wipeScope(text)) return { allowed: true };
  const victims = wipeVictims(text, freshOwnPermanents(context));
  if (sum(victims) < FRESH_VALUE_THRESHOLD) return { allowed: true };
  if (facingLethal(context)) return { allowed: true };
  // Still clearly net-positive with the fresh permanents counted as losses (the same bar scoreOwnBoardWipe rewards).
  const mine = wipeVictims(text, context.you?.battlefield);
  if (netBenefit(text, context, mine) >= 4) return { allowed: true };
  const name = (action.label ?? "").replace(/^cast\s+/i, "") || "the wipe";
  return { allowed: false, reason: `${name} held: it would kill ${victims.map((card) => card.name ?? "a permanent").join(", ")}, which entered this turn; cast the wipe BEFORE deploying, or wait for next turn` };
}

function handWipes(context: ScoringContext, exceptCardId: string | undefined): CardLike[] {
  const mana = context.you?.availableMana?.total ?? 0;
  return (context.you?.hand ?? []).filter((card) => card.id !== exceptCardId && (card.manaValue ?? 0) <= mana && wipeScope(card.oracleText ?? "") !== undefined && !(card.typeLine ?? "").includes("Land"));
}

// A wipe in hand that is worth casting THIS turn (net-positive on the board as it stands, i.e. without the permanent I am about to deploy).
export function plannedWipe(context: ScoringContext, exceptCardId: string | undefined): CardLike | undefined {
  return handWipes(context, exceptCardId).find((card) => {
    const text = clean(card.oracleText);
    return netBenefit(text, context, wipeVictims(text, context.you?.battlefield)) >= 4;
  });
}

export function scoreWipeSequencing(action: ScorableAction, context: ScoringContext, delta: Delta) {
  if (action.actionType !== "cast_spell" && action.actionType !== "cast_commander") return;
  const card = (context.you?.hand ?? []).find((item) => item.id === action.cardId) ?? (context.you?.commander?.id === action.cardId ? context.you?.commander : undefined);
  if (!card || (card.typeLine ?? "").includes("Instant") || (card.typeLine ?? "").includes("Sorcery")) return;
  const wipe = plannedWipe(context, card.id);
  if (!wipe) return;
  const text = clean(wipe.oracleText);
  if (wipeVictims(text, [card]).length === 0) return;
  delta(-7, `hold ${card.name}: ${wipe.name} is going to be cast this turn and would kill it — wipe first, then deploy with the remaining mana`);
}
