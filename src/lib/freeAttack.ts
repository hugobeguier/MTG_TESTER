// Deterministic "free attack" rule: attacking with a creature is strongly favored when the defending player has no untapped creature
// that could legally block it, unless a real downside exists:
//   - the creature has a {T} ability that is usable right now and worth more than the damage (a mana ability with spells in hand to
//     cast, a token/draw engine; Speaker of the Heavens' "activate only if you have at least 7 life more than your starting life
//     total" only counts when that life total is actually reached),
//   - tapping it leaves a lethal crack-back (strategy.attackEconomics),
//   - the attack costs extra mana (Propaganda-style tax shows in the legal action's detail).
// "Can't attack" and goad are already handled by the legal-action list itself (an illegal attack is never offered).
// actionScoring.scoreLegalActions applies it as a score bonus and as a veto on "declare no attackers" while a free attack is on offer,
// so resolveGuardedChoice also overrules an LLM that passes on free damage.

import type { CardLike, ScorableAction, ScoringContext } from "./actionScoring";
import { attackEconomics, defenderOf } from "./strategy";
import { canLegallyBlock, parseNum } from "./combatSim";

type Opponent = NonNullable<ScoringContext["opponents"]>[number];

const STARTING_LIFE = 40;

export interface FreeAttackVerdict {
  free: boolean;
  reason?: string;
  // Why a blocker-free attack is nonetheless not free (set only when no blocker exists).
  downside?: string;
}

function cleanText(card: CardLike): string {
  return (card.oracleText ?? "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").toLowerCase();
}

function isCreatureCard(card: CardLike): boolean {
  return (card.typeLine ?? "").includes("Creature") || (parseNum(card.power) !== undefined && parseNum(card.toughness) !== undefined && !(card.typeLine ?? "").includes("Land"));
}

export function untappedBlockersFor(attacker: CardLike, defender: Opponent): CardLike[] {
  const board = defender.battlefield ?? [];
  const cantBlockSelf = (card: CardLike) => {
    const own = (card.name ?? "").toLowerCase();
    return cleanText(card).split(/[.\n]/).some((line) => {
      const clause = line.trim();
      return clause === "this creature can't block" || (own !== "" && clause === `${own} can't block`);
    });
  };
  return board.filter((card) => isCreatureCard(card) && !card.tapped && !cantBlockSelf(card) && canLegallyBlock(attacker, card, board));
}

// A {T} ability line on the attacker that attacking (which taps it) would forfeit, and whether it is worth more than the damage.
export function tapAbilityDownside(attacker: CardLike, context: ScoringContext): string | undefined {
  const text = cleanText(attacker);
  const lines = text.split(/\n|(?<=\.)\s+(?=\{)/).map((line) => line.trim());
  const tapLines = lines.filter((line) => /^[^"]*?\{t\}[^:]*:/.test(line) && !/^(?:whenever|when|at the beginning)/.test(line));
  if (tapLines.length === 0) return undefined;
  const life = context.you?.life ?? STARTING_LIFE;
  const hasSpells = (context.you?.hand ?? []).some((card) => !(card.typeLine ?? "").includes("Land"));
  for (const line of tapLines) {
    const lifeGate = line.match(/activate (?:this ability )?only if you have at least (\d+) life more than your starting life total/);
    if (lifeGate) {
      if (life >= STARTING_LIFE + Number(lifeGate[1])) return `its {T} ability is usable now (life ${life} >= starting ${STARTING_LIFE} + ${lifeGate[1]})`;
      continue; // gated and not reachable: tapping to attack costs nothing
    }
    if (/\badd \{|\badd (?:one|two|three) mana\b/.test(line)) {
      if (hasSpells) return "it is a mana source and there are spells in hand to cast";
      continue;
    }
    return "it has a {T} ability that attacking would forfeit";
  }
  return undefined;
}

export function freeAttackVerdict(action: ScorableAction, context: ScoringContext): FreeAttackVerdict {
  if (action.actionType !== "attack") return { free: false };
  const attacker = (context.you?.battlefield ?? []).find((card) => card.id === action.cardId);
  if (!attacker || (parseNum(attacker.power) ?? 0) <= 0) return { free: false };
  const defender = defenderOf(context, action.targetIds[0]);
  if (!defender) return { free: false };
  if (untappedBlockersFor(attacker, defender).length > 0) return { free: false };
  const name = defender.name ?? "the defender";

  if (/additional \{\d+\} generic mana/i.test(action.detail ?? "")) return { free: false, downside: "the attack costs extra mana (attack tax)" };
  const tap = tapAbilityDownside(attacker, context);
  if (tap) return { free: false, downside: tap };
  const economics = attackEconomics(attacker, defender, context, 0);
  if (economics.reasons.some((reason) => /\(lethal!\)/.test(reason))) return { free: false, downside: "tapping it leaves a lethal crack-back" };
  return { free: true, reason: `free attack: ${name} has no untapped creature that can block ${attacker.name ?? "it"}, and attacking forfeits nothing` };
}

// The defender to prefer for this attacker among the players with no possible blocker: one it can eliminate, else the lowest life.
export function preferredFreeDefender(attacker: CardLike, context: ScoringContext): Opponent | undefined {
  const power = Math.max(0, parseNum(attacker.power) ?? 0);
  const open = (context.opponents ?? []).filter((opponent) => untappedBlockersFor(attacker, opponent).length === 0);
  if (open.length === 0) return undefined;
  const lethal = open.filter((opponent) => (opponent.life ?? STARTING_LIFE) <= power);
  const pool = lethal.length > 0 ? lethal : open;
  return [...pool].sort((a, b) => (a.life ?? STARTING_LIFE) - (b.life ?? STARTING_LIFE))[0];
}

// Score adjustment for one attack action: bonus when free (extra for the preferred defender, which also settles which free target wins).
export function freeAttackBonus(action: ScorableAction, context: ScoringContext): { amount: number; reason: string } | undefined {
  const verdict = freeAttackVerdict(action, context);
  if (!verdict.free || !verdict.reason) return undefined;
  const attacker = (context.you?.battlefield ?? []).find((card) => card.id === action.cardId);
  const preferred = attacker ? preferredFreeDefender(attacker, context) : undefined;
  const defender = defenderOf(context, action.targetIds[0]);
  if (preferred && defender && preferred.id !== defender.id && (preferred.life ?? STARTING_LIFE) !== (defender.life ?? STARTING_LIFE)) return { amount: 5, reason: verdict.reason };
  return { amount: 9, reason: verdict.reason };
}

// While a free attack is on offer, "declare no attackers" is not an acceptable choice.
export function declineFreeAttackReason(action: ScorableAction, actions: ScorableAction[], context: ScoringContext): string | undefined {
  if (context.purpose !== "declare_attackers") return undefined;
  if (action.actionType !== "pass_priority" && action.actionType !== "end_turn") return undefined;
  for (const candidate of actions) {
    const verdict = freeAttackVerdict(candidate, context);
    if (verdict.free) return `free attack declined: ${candidate.label} — ${verdict.reason}`;
  }
  return undefined;
}
