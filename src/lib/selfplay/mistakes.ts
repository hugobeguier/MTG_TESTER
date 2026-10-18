// Mistake detector for headless self-play (npm run agent:mistakes). It watches every decision a brain makes and every action the
// orchestrator applies, and flags "wasteful play": decisions a casual-Commander player would call dumb, even though they are legal.
//
// Two layers:
//   1. analyzeDecision()  — PURE: (decision point, chosen action, scored alternatives) -> flags. No session needed, so every flag
//      can be unit-tested (and replayed from docs/agents/real-game-mistakes.md fixtures) with a hand-built ScoringContext.
//   2. MistakeRecorder    — wraps a Brain (records each decision + alternatives) and observes applied actions (outcome flags such as a
//      self-inflicted wipe), keeping a compact per-game log and per-category counts.
//
// The detector is deliberately INDEPENDENT of whether the brain obeys the play guards: with the normal heuristic brain the guard-covered
// categories read ~0 (that is the point of the guards); run with --unguarded to see what the guards are preventing, and to prove the
// detectors themselves still fire. Findings are a review queue, not a verdict (some are legitimate in context).
import type { CardLike, ScorableAction, ScoredAction, ScoringContext } from "@/lib/actionScoring";
import { isBoardWipeText, scoreLegalActions } from "@/lib/actionScoring";
import { freeAttackVerdict, untappedBlockersFor } from "@/lib/freeAttack";
import { parseTargetedRemoval, protectionGuard, removalGuard, sacrificeGuard, situationalTimingGuard } from "@/lib/playGuards";
import { simulateDuel, parseNum } from "@/lib/combatSim";
import { creatureValue } from "@/lib/strategy";
import type { GameSession, VisibleCard } from "@/lib/types";
import type { AuditMeta } from "./audit";
import type { Brain, BrainRequest } from "./brains";

export type MistakeCategory =
  | "pointless_sacrifice"
  | "removal_on_low_threat"
  | "idle_protection_spell"
  | "combat_spell_outside_combat"
  | "declined_free_attack"
  | "unused_mana_castable_left"
  | "missed_land_drop"
  | "spell_no_target_or_effect"
  | "own_wipe_while_ahead"
  | "self_inflicted_loss"
  | "tapped_out_into_lethal"
  | "repeated_activation"
  | "suicide_attack"
  | "pointless_block"
  | "self_lethal_life_cost";

export const ALL_CATEGORIES: MistakeCategory[] = [
  "pointless_sacrifice",
  "removal_on_low_threat",
  "idle_protection_spell",
  "combat_spell_outside_combat",
  "declined_free_attack",
  "unused_mana_castable_left",
  "missed_land_drop",
  "spell_no_target_or_effect",
  "own_wipe_while_ahead",
  "self_inflicted_loss",
  "tapped_out_into_lethal",
  "repeated_activation",
  "suicide_attack",
  "pointless_block",
  "self_lethal_life_cost"
];

export interface MistakeFlag {
  category: MistakeCategory;
  message: string;
  cardNames: string[];
}

export interface DecisionPoint {
  purpose: string;
  context: ScoringContext;
  legalActions: ScorableAction[];
}

const isPass = (action: ScorableAction) => action.actionType === "pass_priority" || action.actionType === "end_turn";
const isCreatureCard = (card: CardLike) => (card.typeLine ?? "").includes("Creature");
const isLandCard = (card: CardLike) => (card.typeLine ?? "").includes("Land");
const cleanDetail = (action: ScorableAction) => (action.detail ?? "").replace(/Payable with[\s\S]*$/i, "").replace(/\([^)]*\)/g, "").toLowerCase();
const spellName = (action: ScorableAction) => (action.label ?? "").replace(/^(?:cast|activate)\s+/i, "");
const handCard = (context: ScoringContext, action: ScorableAction) => (context.you?.hand ?? []).find((card) => card.id === action.cardId) ?? (context.you?.commander?.id === action.cardId ? context.you?.commander : undefined);

// Damage the strongest single opponent could swing at me next turn, assuming I chump/block with `myBlockers` of their biggest bodies.
function crackBackDamage(context: ScoringContext, myBlockers: number): number {
  let worst = 0;
  for (const opponent of context.opponents ?? []) {
    const powers = (opponent.battlefield ?? [])
      .filter((card) => isCreatureCard(card))
      .map((card) => Math.max(0, parseNum(card.power) ?? 0))
      .sort((a, b) => b - a);
    worst = Math.max(worst, powers.slice(Math.min(myBlockers, powers.length)).reduce((sum, value) => sum + value, 0));
  }
  return worst;
}

const POSTCOMBAT = /postcombat/i;

// Pure per-decision analysis. `chosen` is the legal action the brain picked; `scored` is the scorer's view of ALL legal actions
// (used to tell "nothing sensible was castable" from "a good castable permanent was skipped").
export function analyzeDecision(point: DecisionPoint, chosen: ScorableAction, scored: ScoredAction[]): MistakeFlag[] {
  const { context, legalActions } = point;
  const flags: MistakeFlag[] = [];
  const add = (category: MistakeCategory, message: string, cardNames: string[]) => flags.push({ category, message, cardNames });
  const name = spellName(chosen);

  if (chosen.actionType === "activate_ability") {
    const sac = sacrificeGuard(chosen, context);
    if (!sac.allowed) add("pointless_sacrifice", sac.reason ?? "pointless sacrifice", [name]);
  }

  if (chosen.actionType === "cast_spell") {
    const removal = removalGuard(chosen, context);
    if (!removal.allowed) add("removal_on_low_threat", removal.reason ?? "removal on a low threat", [name, ...(removal.bestTarget?.name ? [removal.bestTarget.name] : [])]);
    const protection = protectionGuard(chosen, context);
    if (!protection.allowed) add("idle_protection_spell", protection.reason ?? "idle protection spell", [name]);
    const timing = situationalTimingGuard(chosen, context);
    if (!timing.allowed) add("combat_spell_outside_combat", timing.reason ?? "combat-only spell outside combat", [name]);

    const text = cleanDetail(chosen);
    const stackEmpty = (context.stack ?? []).length === 0 && !context.pendingAction;
    if (/\bcounter target (?:[a-z-]+ )*(?:spell|ability)\b/.test(text) && stackEmpty) add("spell_no_target_or_effect", "counterspell cast with nothing on the stack to counter", [name]);
    const targetsCreature = /\btarget (?:[a-z-]+ )*creature\b(?! you control)(?! card)/.test(text) && !/\btarget creature you control\b/.test(text) && !/\byou may\b/.test(text);
    const anyCreature = [...(context.you?.battlefield ?? []), ...(context.opponents ?? []).flatMap((o) => o.battlefield ?? [])].some(isCreatureCard);
    const head = text.split(".")[0] ?? "";
    const modal = /\bchoose (?:one|two|three|up to)\b/.test(text);
    // Targeted removal with no OPPOSING creature to hit: the only legal target is the caster's own creature (Swords on your own commander).
    const hitsOwnOnly = parseTargetedRemoval(chosen)?.scope === "creature" && !modal && (context.opponents ?? []).every((o) => !(o.battlefield ?? []).some(isCreatureCard)) && (context.you?.battlefield ?? []).some(isCreatureCard);
    if (hitsOwnOnly) add("spell_no_target_or_effect", "targeted creature removal cast with no opposing creature: it can only hit my own", [name]);
    const lifeCost = text.match(/\byou lose (\d+) life\b|\bpay (\d+) life\b/);
    if (lifeCost && !/\b(?:target|each) (?:opponent|player)s? loses?\b/.test(text.slice(0, lifeCost.index ?? 0))) {
      const cost = Number(lifeCost[1] ?? lifeCost[2]);
      if ((context.you?.life ?? 40) <= cost) add("self_lethal_life_cost", `${name} costs ${cost} life and I only have ${context.you?.life}`, [name]);
    }
    if (targetsCreature && !anyCreature && !modal && /\b(?:instant|sorcery|aura)\b/.test(head)) add("spell_no_target_or_effect", "spell needs a target creature and no creature is on the table", [name]);

    if (isBoardWipeText(text) && !/\bcounter target\b/.test(text)) {
      const mine = (context.you?.battlefield ?? []).filter(isCreatureCard);
      const mineValue = mine.reduce((sum, card) => sum + creatureValue(card), 0);
      // Everyone else's creatures combined (a wipe hits the whole table): a mistake when it costs me more than it costs them all.
      const theirs = (context.opponents ?? []).reduce((sum, o) => sum + (o.battlefield ?? []).filter(isCreatureCard).reduce((s, card) => s + creatureValue(card), 0), 0);
      if (mine.length >= 2 && mineValue >= 6 && mineValue > theirs) add("own_wipe_while_ahead", `board wipe cast with my creature value ${mineValue.toFixed(0)} against ${theirs.toFixed(0)} for the whole rest of the table`, [name]);
    }
  }

  if ((chosen.actionType === "cast_spell" || chosen.actionType === "cast_commander") && context.you) {
    const card = handCard(context, chosen);
    const mana = context.you.availableMana?.total ?? 0;
    const cost = card?.manaValue ?? 0;
    if (card && cost > 0 && mana - cost <= 0 && !isLandCard(card)) {
      const life = context.you.life ?? 40;
      const myBlockers = (context.you.battlefield ?? []).filter((c) => isCreatureCard(c) && !c.tapped).length + (isCreatureCard(card) ? 1 : 0);
      const damage = crackBackDamage(context, myBlockers);
      // Tapping out only matters when mana could have done something else: instant-speed cards held back, or the cast itself adds no
      // defence (a creature adds a blocker; removal/wipes answer the board).
      const heldInstant = (context.you?.hand ?? []).some((c) => c.id !== card.id && /Instant/.test(c.typeLine ?? "") && (c.manaValue ?? 0) <= mana);
      const defensive = isCreatureCard(card) || /Instant|Sorcery/.test(card.typeLine ?? "");
      if (life > 0 && damage >= life && (heldInstant || !defensive)) add("tapped_out_into_lethal", `tapped out for ${card.name} while an opponent's board can swing ~${damage} against my ${life} life`, [card.name ?? name]);
    }
  }

  if (point.purpose === "declare_attackers" && !(chosen.actionType === "attack")) {
    const free = legalActions.map((action) => ({ action, verdict: freeAttackVerdict(action, context) })).find((entry) => entry.verdict.free);
    if (free) add("declined_free_attack", `declined ${free.action.label}: ${free.verdict.reason}`, [spellName(free.action)]);
  }

  if (chosen.actionType === "attack") {
    const attacker = (context.you?.battlefield ?? []).find((card) => card.id === chosen.cardId);
    const defender = (context.opponents ?? []).find((o) => o.id === chosen.targetIds[0] || (o.battlefield ?? []).some((c) => c.id === chosen.targetIds[0]));
    if (attacker && defender && creatureValue(attacker) >= 3) {
      // Only blockers that can legally block THIS attacker (flying/reach/menace/can't-block), and only a mistake when the defender can
      // afford to eat every attacker I am sending at it (a lone big blocker facing a wide attack just eats one creature).
      const blockers = untappedBlockersFor(attacker, defender);
      const killers = blockers.filter((blocker) => {
        const duel = simulateDuel(attacker, blocker);
        return duel.attackerDies && !duel.blockerDies;
      });
      const myAttackers = new Set<string>([
        ...(context.you?.battlefield ?? []).filter((card) => card.attacking && (card.attackTargetId === defender.id || !card.attackTargetId)).map((card) => card.id),
        ...legalActions.filter((action) => action.actionType === "attack" && action.targetIds[0] === chosen.targetIds[0]).map((action) => action.cardId ?? "")
      ]);
      const lethalAlone = (parseNum(attacker.power) ?? 0) >= (defender.life ?? 40);
      if (killers.length > 0 && killers.length >= myAttackers.size && !lethalAlone) {
        add("suicide_attack", `${attacker.name} attacks into ${killers.map((k) => k.name).join(", ")}, which can block and kill it without dying (${myAttackers.size} attacker(s) vs ${killers.length} such blocker(s))`, [attacker.name ?? "attacker", ...killers.map((k) => k.name ?? "blocker")]);
      }
    }
  }

  if (chosen.actionType === "block") {
    const attacker = (context.opponents ?? []).flatMap((o) => o.battlefield ?? []).find((card) => card.id === chosen.targetIds[0]);
    const blocker = (context.you?.battlefield ?? []).find((card) => card.id === chosen.cardId);
    if (attacker && blocker) {
      const duel = simulateDuel(attacker, blocker);
      const life = context.you?.life ?? 40;
      const incoming = Math.max(0, parseNum(attacker.power) ?? 0);
      // Dies without killing it, saves only a small hit, and is not a throwaway body.
      if (duel.blockerDies && !duel.attackerDies && incoming < life / 2 && creatureValue(blocker) >= 3 && incoming <= 4) {
        add("pointless_block", `${blocker.name} blocks ${attacker.name} and dies without killing it, to save only ${incoming} damage (life ${life})`, [blocker.name ?? "blocker", attacker.name ?? "attacker"]);
      }
    }
  }

  if (isPass(chosen) && (point.purpose === "main_phase")) {
    const live = new Map(scored.map((entry) => [entry.id, entry]));
    const land = legalActions.find((action) => action.actionType === "play_land");
    if (land) add("missed_land_drop", `passed with ${land.label} available`, [spellName(land)]);
    const mana = context.you?.availableMana?.total ?? 0;
    if (POSTCOMBAT.test(context.phase ?? "") && mana >= 3) {
      const castable = legalActions.filter((action) => {
        if (action.actionType !== "cast_spell" && action.actionType !== "cast_commander") return false;
        if (live.get(action.id)?.vetoReason) return false;
        const card = handCard(context, action);
        if (!card || /Instant/.test(card.typeLine ?? "")) return false;
        // Sweepers and sorceries are held on purpose; this flag is about permanents (creatures, artifacts, enchantments, planeswalkers).
        if (/Sorcery/.test(card.typeLine ?? "")) return false;
        return (card.manaValue ?? 0) > 0 && (card.manaValue ?? 0) <= mana;
      });
      if (castable.length > 0) {
        const why = castable.map((action) => `${spellName(action)}: ${(live.get(action.id)?.reasons ?? []).slice(-2).join(" / ") || "no scorer penalty"}`).join("; ");
        add("unused_mana_castable_left", `ended the turn with ${mana} mana open while ${castable.map(spellName).join(", ")} was castable (${why})`, castable.map(spellName));
      }
    }
  }

  return flags;
}

// --- Recorder ---------------------------------------------------------------------------------------------------------------------

export interface MistakeRecord extends MistakeFlag {
  game: number;
  turn: number;
  phase: string;
  seat: string;
  purpose: string;
  state: {
    life: Record<string, number>;
    hand: string[];
    battlefield: Record<string, string[]>;
    openMana: number;
    stack: string[];
  };
  chosen: string;
  alternatives: Array<{ label: string; score: number; vetoed: boolean }>;
}

export interface GameMistakeLog {
  records: MistakeRecord[];
  decisions: number;
  decisionsByPurpose: Record<string, number>;
  actionsByType: Record<string, number>;
}

function cardLabel(card: CardLike): string {
  return card.power !== undefined && card.toughness !== undefined ? `${card.name} ${card.power}/${card.toughness}${card.tapped ? "(t)" : ""}` : `${card.name}${card.tapped ? "(t)" : ""}`;
}

function snapshot(point: DecisionPoint, seatName: string) {
  const { context } = point;
  const life: Record<string, number> = { [seatName]: context.you?.life ?? 0 };
  const battlefield: Record<string, string[]> = { [seatName]: (context.you?.battlefield ?? []).filter((c) => !isLandCard(c)).map(cardLabel) };
  for (const opponent of context.opponents ?? []) {
    life[opponent.name ?? opponent.id ?? "opp"] = opponent.life ?? 0;
    battlefield[opponent.name ?? opponent.id ?? "opp"] = (opponent.battlefield ?? []).filter((c) => !isLandCard(c)).map(cardLabel);
  }
  return {
    life,
    hand: (context.you?.hand ?? []).map((c) => c.name ?? "?"),
    battlefield,
    openMana: context.you?.availableMana?.total ?? 0,
    stack: [...(context.stack ?? []), ...(context.pendingAction ? [context.pendingAction] : [])].map((item) => item.cardName ?? "?")
  };
}

// Brain wrapper that scores the decision with the same scorer (for alternatives), flags it, and passes the brain's choice through
// untouched. Also exposes onAction for outcome flags. One recorder per game.
export class MistakeRecorder {
  readonly log: GameMistakeLog = { records: [], decisions: 0, decisionsByPurpose: {}, actionsByType: {} };
  private repeats = new Map<string, number>();

  constructor(private readonly game: number, private readonly seatNames: Record<string, string>) {}

  wrap(inner: Brain): Brain {
    return async (request: BrainRequest) => {
      const decision = await inner(request);
      this.observe(request, decision.action.legalActionId);
      return decision;
    };
  }

  observe(request: BrainRequest, chosenId: string | undefined) {
    this.log.decisions += 1;
    this.log.decisionsByPurpose[request.purpose] = (this.log.decisionsByPurpose[request.purpose] ?? 0) + 1;
    const chosen = request.legalActions.find((action) => action.id === chosenId);
    if (!chosen) return;
    this.log.actionsByType[chosen.actionType] = (this.log.actionsByType[chosen.actionType] ?? 0) + 1;
    const point: DecisionPoint = { purpose: request.purpose, context: request.context, legalActions: request.legalActions };
    const scored = scoreLegalActions(request.legalActions, request.context);
    const flags = analyzeDecision(point, chosen, scored);

    // Loops: the same non-land, non-attack action taken 3+ times by one seat in one phase of one turn.
    if (chosen.actionType === "activate_ability" || chosen.actionType === "cast_spell") {
      const key = `${request.seatId}|${request.context.turn}|${request.context.phase}|${chosen.label}`;
      const count = (this.repeats.get(key) ?? 0) + 1;
      this.repeats.set(key, count);
      if (count === 3) flags.push({ category: "repeated_activation", message: `${chosen.label} chosen ${count} times in the same phase`, cardNames: [spellName(chosen)] });
    }

    if (flags.length === 0) return;
    const state = snapshot(point, this.seatNames[request.seatId] ?? request.seatName);
    const alternatives = scored.slice(0, 6).map((entry) => ({ label: entry.label, score: Math.round(entry.score * 10) / 10, vetoed: Boolean(entry.vetoReason) }));
    for (const flag of flags) {
      this.log.records.push({ ...flag, game: this.game, turn: request.context.turn ?? 0, phase: request.context.phase ?? "", seat: request.seatName, purpose: request.purpose, state, chosen: chosen.label, alternatives });
    }
  }

  // Outcome flags: what an applied action did to the board.
  onAction = (prev: GameSession, next: GameSession, meta: AuditMeta) => {
    if (meta.actionType !== "cast_spell" && meta.actionType !== "cast_commander") return;
    const before = new Map<string, { card: VisibleCard; seatId: string }>();
    for (const seat of prev.seats) for (const card of seat.board.battlefield) before.set(card.id, { card, seatId: seat.id });
    const after = new Set<string>();
    for (const seat of next.seats) for (const card of seat.board.battlefield) after.add(card.id);
    // A seat that lost the game takes its whole board with it (rule 800.4a) — that is the life-loss flag's job, not this one.
    const lostSeats = new Set(next.seats.filter((seat) => seat.hasLost).map((seat) => seat.id));
    if (meta.seatId && lostSeats.has(meta.seatId)) return;
    let mineLost = 0;
    let theirsLost = 0;
    const lostNames: string[] = [];
    for (const [id, entry] of before) {
      if (after.has(id) || lostSeats.has(entry.seatId)) continue;
      const value = isLandCard(entry.card as unknown as CardLike) || entry.card.token ? 0.5 : Math.max(entry.card.manaValue, creatureValue(entry.card as unknown as CardLike));
      if (entry.seatId === meta.seatId) {
        mineLost += value;
        lostNames.push(entry.card.name);
      } else theirsLost += value;
    }
    // Only own losses clearly caused by this action count; losses of a few cheap permanents are noise.
    if (mineLost >= 6 && mineLost > theirsLost * 1.2) {
      const seat = prev.seats.find((s) => s.id === meta.seatId);
      this.log.records.push({
        category: "self_inflicted_loss",
        message: `casting ${meta.actionLabel ?? "a spell"} cost the caster ~${mineLost.toFixed(0)} of permanents (${lostNames.slice(0, 5).join(", ")}) against ~${theirsLost.toFixed(0)} for everyone else`,
        cardNames: lostNames.slice(0, 5),
        game: this.game,
        turn: meta.turn,
        phase: meta.phase,
        seat: seat?.name ?? meta.seatId ?? "?",
        purpose: "outcome",
        state: { life: Object.fromEntries(prev.seats.map((s) => [s.name, s.life])), hand: (seat?.board.hand ?? []).map((c) => c.name), battlefield: Object.fromEntries(prev.seats.map((s) => [s.name, s.board.battlefield.filter((c) => !c.typeLine.includes("Land")).map((c) => c.name)])), openMana: 0, stack: [] },
        chosen: meta.actionLabel ?? meta.actionType,
        alternatives: []
      });
    }
  };
}

// heuristicBrain with the play guards' veto penalties removed: what the guards are preventing. Used by --unguarded and by tests that
// need the detector to see the raw behaviour.
export const unguardedHeuristicBrain: Brain = async (request) => {
  const scored = scoreLegalActions(request.legalActions, request.context)
    .map((entry) => (entry.vetoReason ? { ...entry, score: entry.score + 50 } : entry))
    .sort((a, b) => b.score - a.score);
  const picked = scored[0];
  return {
    source: "heuristic",
    action: { actionType: picked.actionType, legalActionId: picked.id, targetIds: picked.targetIds, cardId: picked.cardId, reason: "heuristic (guards ignored)", fallbackAction: picked.actionType === "end_turn" ? "end_turn" : "pass_priority" }
  };
};
