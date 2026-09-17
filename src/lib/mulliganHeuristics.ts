import type { DeckArchetype, PlayerSeat, VisibleCard } from "./types";

export interface OpeningHandEvaluation {
  keep: boolean;
  score: number;
  reasons: string[];
  /** True for a hand bad enough that keeping it should never be a judgment call at all — not just
   *  "the heuristic leans mulligan" (any score < 0 already means that), but the same automatic-
   *  mulligan tier as 0/7 lands. Callers that let an LLM make the actual keep/mulligan call should
   *  treat this as authoritative and override a "keep" regardless of the model's stated reasoning. */
  forceMulligan: boolean;
}

type ManaColor = "W" | "U" | "B" | "R" | "G" | "C";

const BASIC_LAND_COLORS: Record<string, ManaColor> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
  Wastes: "C"
};

const IDEAL_MAX_LANDS = 4;
const MIN_TOTAL_SOURCES = 3;
const CHEAP_RAMP_MAX_MANA_VALUE = 2;
const MAX_CHEAP_RAMP_BONUS = 2;

// How far out the curve check looks. Commander games are slower than 1v1, but a hand that can't do
// anything through its first two land drops after the initial one is still a real risk of getting
// run over before it does anything — hence turns 3 AND 4 specifically, per the user's own framing
// of "ramp/lands for 3-4 rounds, and do I have a play turn 3-4."
const CURVE_TURNS = [3, 4] as const;
const CURVE_BOTH_TURNS_BONUS = 2;
const CURVE_ONE_TURN_BONUS = 1;
const CURVE_NO_PLAYS_PENALTY = -2;

const MAX_DRAW_BONUS = 2;
const MAX_INTERACTION_BONUS = 1;

// A 3-5 color commander has to actually find each of those colors, not just enough total mana —
// missing one is both much more likely and much more costly than in a 1-2 color deck, so it costs
// more here too. Reported live: Veyra (The Ur-Dragon, WUBRG) kept a 2-land Island/Plains hand with
// a green ramp creature it could never cast — a flat per-color penalty wasn't steep enough to flag
// that as the real problem it was.
const HIGH_COLOR_IDENTITY_THRESHOLD = 3;
const MISSING_COLOR_PENALTY = 1;
const MISSING_COLOR_PENALTY_HIGH_COLOR_IDENTITY = 2;

// A hand can rack up this much negative score from a combination of factors (thin mana, no curve,
// missing colors, ...) without ever tripping the 0/7-lands automatic mulligan above — but it's just
// as bad in practice, and an LLM asked to weigh it is only ever advised (not required) to defer to
// this heuristic. Reported live: Veyra (WUBRG) kept a score -8 hand — 2 lands, only 2 total mana
// sources, no curve plays through turn 4, missing a commander color — reasoning about "powerful
// cards" instead of the concrete mana problem it had itself identified. Matches the 0/7-lands
// penalty (-6) as the bar for "this is not a judgment call."
const HARD_MULLIGAN_SCORE_THRESHOLD = -6;

// Archetype-specific emphasis, layered on top of the same land/ramp/curve/draw/interaction scoring
// every hand gets — the foundation (lands, mana colors) never changes per archetype, since mana
// matters equally regardless of game plan, but how much curve/draw/interaction matter does: aggro
// leans on curving out with cheap threats, control leans on early interaction, and combo leans on
// card selection/ramp to assemble its pieces (this engine has no dedicated combo-piece tag, so the
// existing draw+ramp "advantage" signal doubles as the closest proxy for "setup pieces"). midrange
// (the default for any deck without a clearly dominant plan) leaves every weight at 1, i.e. today's
// unweighted behavior.
const ARCHETYPE_WEIGHTS: Record<DeckArchetype, { curve: number; draw: number; interaction: number }> = {
  aggro: { curve: 1.5, draw: 0.5, interaction: 0.5 },
  control: { curve: 0.75, draw: 1, interaction: 2 },
  combo: { curve: 0.5, draw: 1.5, interaction: 0.75 },
  midrange: { curve: 1, draw: 1, interaction: 1 }
};

function isLand(card: VisibleCard) {
  return card.role === "land" || card.typeLine.includes("Land");
}

function isRamp(card: VisibleCard) {
  return card.role === "ramp";
}

function isDraw(card: VisibleCard) {
  return card.role === "draw";
}

// Covers both removal and counterspells — deckRepair.ts' curated "removal" package already lumps
// counterspells (Counterspell, Arcane Denial, Negate, ...) in with hard removal, so a card's role
// on a hand card carries the same grouping here.
function isInteraction(card: VisibleCard) {
  return card.role === "removal";
}

// card.producedMana is imported straight from Scryfall's own produced_mana field (see
// import-commander-cards.mjs), which lists every color a card is EVER capable of producing under any
// circumstance, with no distinction between a plain "{T}: Add" ability and one gated behind extra
// mana, counters banked over several turns, or board state. That's fine for a quick "what colors does
// this card touch" lookup, but wrong for opening-hand evaluation, which needs "what can this actually
// produce right now." Reported live: Veyra kept a hand heuristic-scored as "covers all commander
// colors" on the strength of Crucible of the Spirit Dragon and Three Tree City — both list all five
// colors in produced_mana, but each land's only colored-mana ability is locked behind setup (storage
// counters accumulated over turns; mana equal to creatures of a chosen type, worthless at 0 creatures)
// that's never available in an opening hand. Only their unconditional "{T}: Add {C}" line is.
//
// A conservative filter, not a full cost parser: for a land specifically, only trust a color if some
// line of its own oracle text taps for it at a cost of exactly "{T}" alone — the plain-tap-fixer
// pattern (Command Tower, Exotic Orchard, basics, ...) — falling back to the raw producedMana list
// when the card has no oracle text to check (e.g. test fixtures) or no such line matches at all.
function immediatelyAvailableLandColors(card: VisibleCard): Set<ManaColor> | undefined {
  if (!card.oracleText) return undefined;
  const colors = new Set<ManaColor>();
  let matchedManaLine = false;
  for (const rawLine of card.oracleText.split("\n")) {
    const line = rawLine.trim().replace(/^\(/, "").replace(/\)$/, "");
    const match = /^\{T\}:\s*Add\s+(.+?)\.?$/i.exec(line);
    if (!match) continue;
    matchedManaLine = true;
    const effect = match[1];
    if (/any color/i.test(effect)) {
      for (const color of ["W", "U", "B", "R", "G"] as ManaColor[]) colors.add(color);
      continue;
    }
    for (const symbol of effect.matchAll(/\{([WUBRGC])\}/gi)) {
      colors.add(symbol[1].toUpperCase() as ManaColor);
    }
  }
  return matchedManaLine ? colors : undefined;
}

function producedColors(card: VisibleCard): Set<ManaColor> {
  if (isLand(card)) {
    const immediate = immediatelyAvailableLandColors(card);
    if (immediate) return immediate;
  }
  const colors = new Set<ManaColor>();
  for (const color of card.producedMana ?? []) {
    const normalized = color.toUpperCase();
    if (normalized === "W" || normalized === "U" || normalized === "B" || normalized === "R" || normalized === "G" || normalized === "C") {
      colors.add(normalized as ManaColor);
    }
  }
  for (const [name, color] of Object.entries(BASIC_LAND_COLORS)) {
    if (card.name === name || card.typeLine.includes(name)) colors.add(color);
  }
  return colors;
}

// Every color this hand's own lands/ramp can produce — shared by the commander color-coverage check
// and the curve check below, so "can I eventually cast my commander" and "can I actually cast the
// cards in my hand" agree on the same answer instead of two separately-maintained computations.
function handProducedColors(hand: VisibleCard[]): Set<ManaColor> {
  const covered = new Set<ManaColor>();
  for (const card of hand) {
    if (!isLand(card) && !isRamp(card)) continue;
    for (const color of producedColors(card)) covered.add(color);
  }
  return covered;
}

function missingCommanderColors(handColors: Set<ManaColor>, colorIdentity: string[]): string[] {
  if (colorIdentity.length === 0) return [];
  return colorIdentity.filter((color) => !handColors.has(color as ManaColor));
}

// A card with no colors of its own (an artifact, a colorless spell) is always castable color-wise;
// otherwise every one of its colors has to be among what this hand's own lands/ramp can produce.
function isCastableWithColors(card: VisibleCard, availableColors: Set<ManaColor>): boolean {
  if (!card.colors || card.colors.length === 0) return true;
  return card.colors.every((color) => availableColors.has(color.toUpperCase() as ManaColor));
}

// Rough mana projection, not a full turn-by-turn simulator: assumes one land drop per turn (capped
// by however many lands are actually in hand) plus any ramp in hand that would plausibly be online
// by that turn. A ramp piece costing X mana is assumed cast on turn X at the earliest and (mana dorks
// being summoning sick, sorcery-speed ramp spells' lands entering tapped, ...) starts paying off the
// turn after — so by turn T, ramp with mana value <= T-1 counts as already producing.
function projectedManaOnTurn(landCount: number, ramp: VisibleCard[], turn: number): number {
  const landsInPlay = Math.min(landCount, turn);
  const onlineRamp = ramp.filter((card) => card.manaValue <= turn - 1).length;
  return landsInPlay + onlineRamp;
}

// A card only counts as "a play" if this hand can actually pay its color requirements, not just its
// generic cost — a cheap card sitting uncastable for lack of the right color is not a play at all.
// Reported live: a green ramp creature counted as covering turn 3/4 in a hand with no green source.
function hasPlayOnTurn(hand: VisibleCard[], projectedMana: number, availableColors: Set<ManaColor>): boolean {
  return hand.some(
    (card) => !isLand(card) && card.manaValue >= 1 && card.manaValue <= projectedMana && isCastableWithColors(card, availableColors)
  );
}

export function evaluateOpeningHand(seat: PlayerSeat): OpeningHandEvaluation {
  const hand = seat.board.hand;
  const lands = hand.filter(isLand);
  const ramp = hand.filter(isRamp);
  const cheapRamp = ramp.filter((card) => card.manaValue <= CHEAP_RAMP_MAX_MANA_VALUE);
  const expensiveRampCount = ramp.length - cheapRamp.length;
  const totalSources = lands.length + ramp.length;

  const archetype = seat.deck?.archetype ?? "midrange";
  const weights = ARCHETYPE_WEIGHTS[archetype];
  const availableColors = handProducedColors(hand);

  const reasons: string[] = [];
  let score = 0;
  // 0, 1, 6, or 7 lands in an opening 7 are each treated as an almost-automatic mulligan (standard
  // mulligan advice, e.g. nerdleagues.com's "when should you mulligan" guide) — a much steeper
  // penalty than the merely-risky 2-lands-shy-of-ideal or 5-lands-flood-prone bands below it, and
  // 0/7 additionally force the keep to false outright (see forceMulligan) since no combination of
  // draw/ramp/removal bonuses elsewhere in this function should be able to out-vote "no lands at
  // all" or "the entire hand is lands."
  let forceMulligan = false;

  if (lands.length === 0 || lands.length === 7) {
    score -= 6;
    forceMulligan = true;
    reasons.push(`${lands.length} lands — an automatic mulligan`);
  } else if (lands.length === 1 || lands.length === 6) {
    score -= 4;
    reasons.push(`${lands.length} lands — very risky, close to an automatic mulligan`);
  } else if (lands.length <= IDEAL_MAX_LANDS) {
    score += 2;
    reasons.push(`${lands.length} lands is an ideal count`);
  } else {
    reasons.push(`${lands.length} lands is acceptable but flood-prone`);
  }

  if (totalSources < MIN_TOTAL_SOURCES) {
    score -= 2;
    reasons.push(`only ${totalSources} total mana sources (lands + ramp)`);
  }

  if (cheapRamp.length > 0) {
    score += Math.min(cheapRamp.length, MAX_CHEAP_RAMP_BONUS);
    reasons.push(`${cheapRamp.length} cheap ramp piece${cheapRamp.length === 1 ? "" : "s"}`);
  }
  if (expensiveRampCount > 0) {
    reasons.push(`${expensiveRampCount} higher-cost ramp piece${expensiveRampCount === 1 ? "" : "s"} (less impactful early)`);
  }

  // Priority #1 (alongside the land/ramp counts above): can this hand actually do something on
  // turns 3 and 4, once its own lands/ramp are accounted for, rather than just counting any 1-3
  // mana value card in isolation. Weighted harder for aggro (curving out IS the game plan) and
  // softer for combo (a combo hand can be patient about board development).
  const turnsWithPlays = CURVE_TURNS.filter((turn) => hasPlayOnTurn(hand, projectedManaOnTurn(lands.length, ramp, turn), availableColors));
  let curveBonus: number;
  let curveReason: string;
  if (turnsWithPlays.length === CURVE_TURNS.length) {
    curveBonus = CURVE_BOTH_TURNS_BONUS;
    curveReason = "has a play on curve for both turn 3 and turn 4";
  } else if (turnsWithPlays.length > 0) {
    curveBonus = CURVE_ONE_TURN_BONUS;
    curveReason = `has a play on curve for turn ${turnsWithPlays[0]} only`;
  } else {
    curveBonus = CURVE_NO_PLAYS_PENALTY;
    curveReason = "no plays on curve through turn 4 — hand risks sitting idle early";
  }
  score += Math.round(curveBonus * weights.curve);
  reasons.push(weights.curve === 1 ? curveReason : `${curveReason} (weighted for ${archetype})`);

  // Priority #2: card draw/advantage, so the hand doesn't run out of gas even once lands are fine.
  // Weighted up for combo (draw doubles as the closest proxy for finding its setup pieces) and down
  // for aggro (an aggro hand wants to be spending mana on threats, not digging).
  const draw = hand.filter(isDraw);
  if (draw.length > 0) {
    const drawBonus = Math.round(Math.min(draw.length, MAX_DRAW_BONUS) * weights.draw);
    score += drawBonus;
    reasons.push(
      `${draw.length} card draw/advantage spell${draw.length === 1 ? "" : "s"}${weights.draw === 1 ? "" : ` (weighted for ${archetype})`}`
    );
  }

  // Priority #3: interaction (removal/counterspells) and general board development — weighted below
  // both mana and card draw for most archetypes, since a hand that curves out and draws cards can
  // find these later. Control flips this: early interaction is exactly what a control hand needs.
  const interaction = hand.filter(isInteraction);
  if (interaction.length > 0) {
    const interactionBonus = Math.round(Math.min(interaction.length, MAX_INTERACTION_BONUS) * weights.interaction);
    score += interactionBonus;
    reasons.push(
      `${interaction.length} removal/counterspell${interaction.length === 1 ? "" : "s"} for interaction${
        weights.interaction === 1 ? "" : ` (weighted for ${archetype})`
      }`
    );
  }

  const commanderColors = seat.board.commander?.colorIdentity ?? [];
  const missingColors = missingCommanderColors(availableColors, commanderColors);
  if (missingColors.length > 0) {
    const isHighColorIdentity = commanderColors.length >= HIGH_COLOR_IDENTITY_THRESHOLD;
    const penaltyPerColor = isHighColorIdentity ? MISSING_COLOR_PENALTY_HIGH_COLOR_IDENTITY : MISSING_COLOR_PENALTY;
    score -= missingColors.length * penaltyPerColor;
    reasons.push(
      `missing a mana source for commander color${missingColors.length === 1 ? "" : "s"} ${missingColors.join("")}${
        isHighColorIdentity ? ` (a ${commanderColors.length}-color manabase needs this more)` : ""
      }`
    );
  } else if (commanderColors.length > 0) {
    score += 1;
    reasons.push("hand covers all commander colors");
  }

  if (!forceMulligan && score <= HARD_MULLIGAN_SCORE_THRESHOLD) {
    forceMulligan = true;
    reasons.push(`hand quality score ${score} is low enough to force a mulligan outright`);
  }

  return { keep: !forceMulligan && score >= 0, score, reasons, forceMulligan };
}

export function agentKeepsHand(seat: PlayerSeat) {
  return evaluateOpeningHand(seat).keep;
}

export function handHasLand(hand: VisibleCard[]): boolean {
  return hand.some(isLand);
}
