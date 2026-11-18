// Casting-cost computation, extracted verbatim from components/AppFlow.tsx (see docs/ARCHITECTURE.md section 5).
// Owns: manaValueFromManaCost, cardWithFaceManaCost, X / multikicker / kicker sizing (xSymbolCount, maxAffordableX,
// parseMultikickerCost, hasSingleKicker), cost reductions (adjustedCastingCost, totalCastingCost, staticCostReduction,
// parseGrantedCostReduction, self-scaling / conditional / unlock reductions, Saheeli affinity), free-cast and alt-cost
// permissions (Omniscience, One with the Multiverse, Demon of Fate's Design) and miracle costs.
// NOT here: spell-face helpers (spellFaceCostCard, castFaceOptions, ...) - they call timing/target checks that still live in AppFlow.tsx.
// AppFlow.tsx re-exports the previously public symbols so existing importers keep working.

import type { ManaPool, PlayerSeat, VisibleCard } from "@/lib/types";
import { counterCount, effectivePower } from "@/lib/counters";
import { permanentMatchesQualifier } from "@/lib/characteristics";
import { hasCardType } from "@/lib/typeGrants";
import { availableManaForSeat, isDragonMana } from "@/engine/mana";
import { capitalizeWord, emblemSourceCards, numberWordToInt } from "@/engine/shared";

// "Multikicker {2} (You may pay an additional {2} any number of times as you cast this spell.)"
// (Everflowing Chalice, ...) — a separate additional-cost mechanic, not an {X} in the printed mana
// cost, but structurally identical once cast: "pay N more times, get N of something." Reusing the
// existing chosenX field/maxAffordableX/totalCastingCost machinery for it (see those functions) means
// this doesn't need its own parallel casting-cost pipeline — a card is never both an {X} spell and
// multikicker in this codebase's real-card sample, so treating "times kicked" as chosenX is safe.
function parseMultikickerCost(oracleText: string): number | undefined {
  const match = oracleText.match(/\b(?:multi)?kicker\s+((?:\{[^}]+\})+)/i);
  return match ? manaValueFromManaCost(match[1]) : undefined;
}

// "Kicker {5}{B}" (single kicker, Josu Vess) — paid at most once, unlike multikicker. Rides the same chosenX
// plumbing, capped at one.
export function hasSingleKicker(oracleText: string): boolean {
  return /\bkicker\s+(?:\{[^}]+\})+/i.test(oracleText) && !/\bmultikicker\b/i.test(oracleText);
}

export function isHistoricCard(card: VisibleCard) {
  return card.typeLine.includes("Artifact") || card.typeLine.includes("Legendary") || card.typeLine.includes("Saga");
}

export function manaValueFromManaCost(manaCost: string | undefined): number {
  if (!manaCost) return 0;
  const symbols = manaCost.match(/\{[^}]+\}/g) ?? [];
  let total = 0;
  for (const raw of symbols) {
    const value = raw.slice(1, -1);
    const numeric = Number.parseInt(value, 10);
    if (!Number.isNaN(numeric)) {
      total += numeric;
      continue;
    }
    if (value === "X" || value === "Y" || value === "Z") continue;
    total += 1;
  }
  return total;
}

export function cardWithFaceManaCost(card: VisibleCard, manaCost: string | undefined): VisibleCard {
  return { ...card, manaCost };
}

export function xSymbolCount(manaCost: string | undefined): number {
  const symbols = manaCost?.match(/\{[^}]+\}/g) ?? [];
  return symbols.filter((symbol) => symbol.toUpperCase() === "{X}").length;
}

// This app has no interactive "choose X" prompt, so both agents and humans default to the
// largest X they can currently afford — the alternative (no default) is what caused the reported
// bug: X-cost cards carry manaValue 0 (the Scryfall off-stack convention), so with no X selection
// at all they were always "free" to cast regardless of available mana.
// Multikicker's per-kick cost stands in for xCount when the card has no {X} of its own — see
// parseMultikickerCost's comment for why reusing chosenX for "times kicked" is safe here.
function xOrMultikickerUnitCost(card: VisibleCard): number {
  const xCount = xSymbolCount(card.manaCost);
  return xCount > 0 ? xCount : (parseMultikickerCost(card.oracleText) ?? 0);
}

export function maxAffordableX(seat: PlayerSeat, card: VisibleCard, fixedCost: number, pool?: ManaPool): number {
  const unitCost = xOrMultikickerUnitCost(card);
  if (unitCost === 0) return 0;
  // fixedCost already had up to card.manaValue worth of any pending cost reduction subtracted
  // (adjustedCastingCost, called by every caller before this). A reduction bigger than the card's
  // non-X cost has leftover value that a flat-cost card would simply waste — for an X spell that
  // leftover instead buys extra X, since {X} contributes to the same generic total a reduction
  // discounts (e.g. Crackle with Power at {X}{R}{R}{R}: 10 artifacts discounts the 3 fixed RRR down
  // to paying just RRR, then the remaining 7 becomes 7 more X the player didn't have to tap for).
  const leftoverReduction = Math.max(0, pendingArtifactAffinityReduction(seat) - card.manaValue);
  const budget = availableManaForSeat(seat, pool) - fixedCost + leftoverReduction;
  const maxUnits = budget > 0 ? Math.floor(budget / unitCost) : 0;
  return hasSingleKicker(card.oracleText) ? Math.min(1, maxUnits) : maxUnits;
}

// Aminatou, Veil Piercer does not discount normal casting from hand — she grants miracle instead,
// handled by the miracle-offer flow. sourceZone/activeSeatId are currently unused by either cost
// reduction this applies (Saheeli's one-turn artifact affinity grant, staticCostReduction's
// permanent-granted discounts) but kept in the signature for future zone- or turn-scoped reductions.
// allSeats defaults to just the caster (undercounting a global-board-state discount like
// selfConditionalCostReduction's) for the handful of callers that don't have every seat on hand —
// safe-but-conservative there, never an exploit, since underestimating a discount can only ever
// overcharge, not undercharge.
// turn/onceEachTurnUsed are optional and only needed for One with the Multiverse's once-per-turn
// free cast — playCard (the single real cast-commit path both human clicks and agent decisions
// funnel through) passes the live session values so that check is accurate; the many other, purely
// informational callers (legal-action listings, cost previews) can omit them, at the cost of that
// one card's discount possibly showing as available a beat after it's actually been used that turn.
export function adjustedCastingCost(
  seat: PlayerSeat,
  card: VisibleCard,
  baseCost: number,
  sourceZone: "hand" | "command" | "exile" | "graveyard" | "library",
  activeSeatId: string | undefined,
  allSeats: PlayerSeat[] = [seat],
  turn?: number,
  onceEachTurnUsed?: string[]
) {
  // Mind's Dilation-style "you may cast that card without paying its mana cost" — the exile-play
  // permission itself already gates which zone/seat may cast it (see playCard's existing exile
  // checks); this only waives the cost on top of that, and only while actually casting from exile.
  if (sourceZone === "exile" && card.exiledPlayableFree) return 0;
  // "If you control a commander, you may cast this spell without paying its mana cost." (Flawless Maneuver, Fierce Guardianship, Deadly Rollick)
  if (/if you control a commander, you may cast this spell without paying its mana cost/i.test(card.oracleText) && seat.board.battlefield.some((permanent) => permanent.commander)) return 0;
  // Omniscience: "You may cast spells from your hand without paying their mana costs." An
  // unconditional standing permission (contrast Mind's Dilation's one-shot exile trigger above, or
  // One with the Multiverse's once-per-turn version below — see hasOmniscienceFreeHandCast's own
  // doc comment for why this card gets its own narrow check rather than a shared "free cast" grammar).
  if (sourceZone === "hand" && hasOmniscienceFreeHandCast(seat)) return 0;
  if (
    sourceZone === "hand" &&
    turn !== undefined &&
    hasOnceEachTurnFreeHandCastPermission(seat) &&
    !(onceEachTurnUsed ?? []).includes(onceEachTurnFreeCastKey(turn, seat.id))
  ) {
    return 0;
  }
  // Demon of Fate's Design: mana cost waived here (life is charged separately, at playCard's actual
  // cast-commit site — see hasFateDesignLifeAltCost's own doc comment); only the once-per-turn
  // budget and "this is an enchantment spell" are checked here.
  if (
    sourceZone === "hand" &&
    turn !== undefined &&
    card.typeLine.includes("Enchantment") &&
    // Rule 118.4: can't pay more life than you currently have — falls through to the normal mana
    // cost below when unaffordable, rather than offering an alt-cost the caster can't actually pay.
    seat.life >= baseCost &&
    hasFateDesignLifeAltCost(seat) &&
    !(onceEachTurnUsed ?? []).includes(fateDesignLifeAltCostKey(turn, seat.id))
  ) {
    return 0;
  }
  // Rule 601.2f: a plain "costs {N} less to cast" effect can only ever reduce a cost's GENERIC
  // portion — it can never eliminate a colored mana requirement, no matter how much reduction is
  // stacked. Floored at coloredPipCount(card) rather than 0, same fix already applied to
  // miracleCostFor below. The unconditional-0 early returns above (Mind's Dilation, Omniscience,
  // "without paying its mana cost" effects, ...) are real cast-for-free effects, rules-distinct
  // from a cost reduction, and correctly bypass this floor entirely.
  // "Spells you cast cost {1} less to cast for each card your opponents have drawn this turn." (Heliod, the Warped Eclipse)
  const drawnByOpponents =
    turn !== undefined && seat.board.battlefield.some((permanent) => !permanent.abilitiesStripped && /spells you cast cost \{1\} less to cast for each card your opponents have drawn this turn/i.test(permanent.oracleText))
      ? allSeats.filter((other) => other.id !== seat.id && other.drawnThisTurn?.turn === turn).reduce((total, other) => total + (other.drawnThisTurn?.count ?? 0), 0)
      : 0;
  return Math.max(
    coloredPipCount(card),
    baseCost - drawnByOpponents - pendingArtifactAffinityReduction(seat) - staticCostReduction(seat, card) - selfConditionalCostReduction(card, allSeats) - selfScalingCostReduction(card, seat, allSeats)
  );
}

export function onceEachTurnFreeCastKey(turn: number, seatId: string): string {
  return `${turn}:${seatId}:once_each_turn_free_hand_cast`;
}

export function fateDesignLifeAltCostKey(turn: number, seatId: string): string {
  return `${turn}:${seatId}:fate_design_life_alt_cost`;
}

// "You may cast spells from your hand without paying their mana costs." (Omniscience) — matched
// narrowly to this exact wording rather than a general "free cast" grammar, same single-card
// scoping as parseEnchantmentAnimationEffect/parsePhaseOutEffect elsewhere in this file; One with
// the Multiverse's similar-sounding permission is "once during each of your turns" (a limited,
// per-turn version, tracked separately via onceEachTurnEffectsUsed rather than this unconditional
// check) and is deliberately NOT matched here.
export function hasOmniscienceFreeHandCast(seat: PlayerSeat): boolean {
  return seat.board.battlefield.some((card) => /\byou may cast spells from your hand without paying (?:their|its) mana costs?\b/i.test(card.oracleText));
}

// "Once during each of your turns, you may cast a spell from your hand or the top of your library
// without paying its mana cost." (One with the Multiverse). Scoped to the hand half only — casting
// from the top of the library isn't modeled (this engine has no "library top is a playable zone"
// concept; see this card's playCard/adjustedCastingCost callers for where the hand half plugs in).
export function hasOnceEachTurnFreeHandCastPermission(seat: PlayerSeat): boolean {
  return seat.board.battlefield.some((card) => /\bonce during each of your turns, you may cast a spell from your hand or the top of your library without paying its mana cost\b/i.test(card.oracleText));
}

// "Once during each of your turns, you may cast an enchantment spell by paying life equal to its
// mana value rather than paying its mana cost." (Demon of Fate's Design) — an alternative cost, not
// a discount: the mana cost is waived entirely (handled the same way as the once-per-turn permission
// above, via adjustedCastingCost returning 0) but a real life cost equal to the spell's own mana
// value is charged instead, at the same playCard call site that marks the once-key used.
export function hasFateDesignLifeAltCost(seat: PlayerSeat): boolean {
  return seat.board.battlefield.some((card) =>
    /\bonce during each of your turns, you may cast an enchantment spell by paying life equal to its mana value rather than paying its mana cost\b/i.test(card.oracleText)
  );
}

// hasCardType, not a raw typeLine check: a permanent that's an artifact only via a granted type
// (Mycosynth Lattice's "All permanents are artifacts in addition to their other types") must count
// toward Saheeli's affinity discount the same as a printed one. Reported live as Mycosynth Lattice
// on the battlefield not increasing the discount at all, even though it makes every land and
// nonartifact permanent an artifact.
function artifactCount(seat: PlayerSeat) {
  return seat.board.battlefield.filter((card) => hasCardType(card, "Artifact")).length;
}

// "[Qualifier] spells you cast cost {N} less to cast." (Goblin Anarchomancer, Herald's Horn,
// Urza's Incubator, ...) — a static discount granted by a permanent on the caster's own
// battlefield, stacking across every matching source the same way real Magic cost reducers do.
// Before this, the only cost reduction this engine modeled at all was Saheeli's one-turn artifact
// affinity grant (pendingArtifactAffinityReduction) — every always-on reducer from a permanent was
// silently ignored, so those cards did nothing. Deliberately narrow, matching this codebase's other
// deterministic parsers: only a flat generic discount is recognized (not "costs {1} less to cast
// for each artifact you control"-style text printed on the spell itself, which needs to read the
// spell's own oracle text rather than a granting permanent's, and not effects that reduce colored
// mana symbols specifically — rule 601.2f, generic-only, matches the existing Saheeli handling).
// Eminence (The Ur-Dragon, Kaseto, ...) is specifically the ability keyword for "this static effect
// works from the command zone too, not just the battlefield" — the commander sits in
// seat.board.commander until actually cast, at which point it moves to the battlefield and this
// check naturally picks it up from there instead (never both at once), so this can't double-count.
export function staticCostReduction(seat: PlayerSeat, card: VisibleCard): number {
  const commander = seat.board.commander;
  const commanderReduction = commander && /\beminence\b/i.test(commander.oracleText) ? parseGrantedCostReduction(commander, card) : 0;
  // An emblem's "Artifact spells you cast cost {1} less to cast." (Saheeli, Filigree Master) is a standing reducer like a permanent's.
  const emblemReduction = emblemSourceCards(seat).reduce((total, source) => total + parseGrantedCostReduction(source, card), 0);
  return commanderReduction + emblemReduction + seat.board.battlefield.reduce((total, source) => (source.phasedOut ? total : total + parseGrantedCostReduction(source, card)), 0);
}

// "Unlock costs you pay cost {1} less." (Inquisitive Glimmer, ...) — a differently-worded sibling
// of staticCostReduction/parseGrantedCostReduction above (that one only ever matches "...spells...
// cost {N} less to cast", nothing about unlocking a Room door), so it needed its own small parser
// rather than trying to shoehorn "unlock" into the spell-cost regex.
export function unlockCostReduction(seat: PlayerSeat): number {
  return seat.board.battlefield.reduce((total, source) => {
    const match = source.oracleText.match(/unlock costs you pay cost \{(\d+)\} less\.?/i);
    if (!match) return total;
    const amount = Number.parseInt(match[1], 10);
    return Number.isFinite(amount) && amount > 0 ? total + amount : total;
  }, 0);
}

// "This spell costs {N} less to cast if there are [X] or more creatures on the battlefield."
// (Blasphemous Edict and the rest of that "discount when the board is already full of creatures"
// board-wipe family) — self-referential and printed on the spell being cast, unlike
// staticCostReduction's shape above (a discount granted by some OTHER permanent). "The battlefield"
// here means every player's creatures, not just the caster's — allSeats is passed in by
// adjustedCastingCost's callers for exactly this reason.
function selfConditionalCostReduction(card: VisibleCard, allSeats: PlayerSeat[]): number {
  const match = card.oracleText.match(/this spell costs \{(\d+)\} less to cast if there are (\w+) or more creatures on the battlefield\.?/i);
  if (!match) return 0;
  const amount = Number.parseInt(match[1], 10);
  const threshold = numberWordToInt(match[2].toLowerCase());
  if (!Number.isFinite(amount) || amount <= 0 || !threshold) return 0;
  const creatureCount = allSeats.reduce((total, seat) => total + seat.board.battlefield.filter((permanent) => permanent.typeLine.includes("Creature")).length, 0);
  return creatureCount >= threshold ? amount : 0;
}

// A reduction that scales with the board: "This spell costs {1} less to cast for each creature on the battlefield."
// (Blasphemous Act — every player's creatures) and "This spell costs {X} less to cast, where X is the total power of
// creatures you control." (Ghalta, Primal Hunger — the caster's only). Neither was understood, so both were always full price.
function selfScalingCostReduction(card: VisibleCard, caster: PlayerSeat, allSeats: PlayerSeat[]): number {
  const perCreature = card.oracleText.match(/this spell costs \{(\d+)\} less to cast for each creature on the battlefield/i);
  if (perCreature) {
    const each = Number.parseInt(perCreature[1], 10);
    const creatures = allSeats.reduce((total, seat) => total + seat.board.battlefield.filter((permanent) => permanent.typeLine.includes("Creature")).length, 0);
    return Number.isFinite(each) ? each * creatures : 0;
  }
  // "This spell costs {1} less to cast for each attacking creature." (Ancient Stone Idol)
  const perAttacker = card.oracleText.match(/this spell costs \{(\d+)\} less to cast for each attacking creature/i);
  if (perAttacker) {
    const attackers = allSeats.reduce((total, seat) => total + seat.board.battlefield.filter((permanent) => permanent.attacking).length, 0);
    return Number.parseInt(perAttacker[1], 10) * attackers;
  }
  // Printed "Affinity for artifacts" (Thought Monitor, Reality Heist, Emry): {1} less per artifact the caster controls. (Saheeli's one-turn
  // grant is a separate, additive pendingArtifactAffinityReduction.)
  const affinity = card.oracleText.match(/^\s*affinity for ([a-z]+?)s?\b/im);
  if (affinity) {
    const type = capitalizeWord(affinity[1].toLowerCase());
    return caster.board.battlefield.filter((permanent) => hasCardType(permanent, type)).length;
  }
  if (/this spell costs \{x\} less to cast, where x is the total power of creatures you control/i.test(card.oracleText)) {
    return caster.board.battlefield.filter((permanent) => permanent.typeLine.includes("Creature")).reduce((total, permanent) => total + Math.max(0, effectivePower(permanent)), 0);
  }
  return 0;
}

// "[Qualifier] spells [you cast ]cost {N} less to cast." and its "of the chosen type" tribal
// variant (Urza's Incubator: "Creature spells of the chosen type cost {2} less to cast."; Herald's
// Horn: "Creature spells you cast of the chosen type cost {1} less to cast.") — the latter only
// applies once the source has locked in a chosenCreatureType (see pickChosenCreatureType) and the
// cast card's type line includes that type. Morophon's colored-pip reduction ("cost {W}{U}{B}{R}{G}
// less to cast") isn't a flat generic amount and is deliberately left unparsed, same "narrow,
// well-templated shapes only" boundary as the rest of this codebase's cost-reduction parsing.
// Eminence-keyworded commanders (The Ur-Dragon, Kaseto, ...) print this same reduction with a
// leading "Eminence — As long as ~ is in the command zone or on the battlefield, other" preamble —
// matched via the "start of clause OR right after a comma" alternation below, with a leading
// "other" stripped from the qualifier itself, rather than requiring the whole clause to be nothing
// but the reduction sentence. Without this, an Eminence card's reduction never matched at all (not
// a colored-vs-generic-mana issue — rule 601.2f generic-only scope is still correct and unchanged,
// the clause was silently declined outright regardless of the cast card's cost).
function parseGrantedCostReduction(source: VisibleCard, castCard: VisibleCard): number {
  if (isDragonMana(source) && castCard.typeLine.includes("Dragon")) return 1;
  const clauses = source.oracleText.split("\n").map((line) => line.trim()).filter(Boolean);
  let total = 0;
  for (const clause of clauses) {
    // "Angel spells and Human spells you cast cost {1} less to cast for each +1/+1 counter on this creature." (Herald of War)
    const perCounter = clause.match(/^([a-z]+) spells and ([a-z]+) spells you cast cost \{(\d+)\} less to cast for each \+1\/\+1 counter on this creature\.?$/i);
    if (perCounter) {
      if (!matchesCostReductionQualifier(perCounter[1].toLowerCase(), castCard) && !matchesCostReductionQualifier(perCounter[2].toLowerCase(), castCard)) continue;
      total += Number.parseInt(perCounter[3], 10) * counterCount(source, "+1/+1");
      continue;
    }
    const match = clause.match(/(?:^|,\s*)(?:other\s+)?(?:([a-z][a-z ]*?)\s+)?spells(?:\s+you cast)?(?:\s+of the chosen type)?(?:\s+you cast)?(?:\s+with power (\d+) or greater)? cost \{(\d+)\} less to cast\.?$/i);
    if (!match) continue;
    const qualifier = (match[1] ?? "").toLowerCase().trim();
    const amount = Number.parseInt(match[3], 10);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    // "Creature spells you cast with power 4 or greater cost {2} less" (Goreclaw) — the cast creature's printed power.
    if (match[2] !== undefined && !(Number.parseInt(castCard.power ?? "", 10) >= Number.parseInt(match[2], 10))) continue;
    if (/\bof the chosen type\b/i.test(clause)) {
      if (!source.chosenCreatureType || !castCard.typeLine.includes(source.chosenCreatureType)) continue;
    }
    if (qualifier === "" || matchesCostReductionQualifier(qualifier, castCard)) total += amount;
  }
  return total;
}

function matchesCostReductionQualifier(qualifier: string, card: VisibleCard): boolean {
  if (qualifier === "creature") return card.typeLine.includes("Creature");
  if (qualifier === "noncreature") return !card.typeLine.includes("Creature");
  if (qualifier === "instant and sorcery" || qualifier === "instant or sorcery") return card.typeLine.includes("Instant") || card.typeLine.includes("Sorcery");
  if (qualifier === "artifact") return card.typeLine.includes("Artifact");
  if (qualifier === "enchantment") return card.typeLine.includes("Enchantment");
  if (qualifier === "planeswalker") return card.typeLine.includes("Planeswalker");
  if (qualifier === "legendary") return card.typeLine.includes("Legendary");
  if (qualifier === "historic") return isHistoricCard(card);
  // Tribal cost reducers (Urza's Incubator's chosen creature type, Herald's Horn's chosen type,
  // ...) — match the qualifier word against the type line's own text (creature subtypes live after
  // the em dash). A multi-word or colored qualifier ("black creature", Bontu's Monument) goes through the
  // shared qualifier matcher, which knows colors — a plain substring test never matched "black creature".
  if (/\s/.test(qualifier) || /^(?:white|blue|black|red|green|nontoken|colorless)$/.test(qualifier)) return permanentMatchesQualifier(card, qualifier);
  return card.typeLine.toLowerCase().includes(qualifier);
}

// The fixedCost passed to maxAffordableX already had the pending reduction subtracted (capped at
// baseCost) so it could size how much extra X headroom a leftover reduction buys — but that alone
// isn't the actual bill once X is chosen: {X} symbols contribute X to the total per copy
// (xSymbolCount of them), and a "costs {N} less" effect discounts that whole total, not just the
// non-X portion. Re-deriving the total from baseCost + xCount*chosenX and applying the reduction
// once here (instead of adding xCount*chosenX on top of the already-discounted fixedCost) is what
// keeps a leftover reduction from being counted twice: once to justify affording a higher X, and
// then never actually subtracted from what's paid.
export function totalCastingCost(seat: PlayerSeat, card: VisibleCard, baseCost: number, chosenX: number, allSeats?: PlayerSeat[]) {
  const unitCost = xOrMultikickerUnitCost(card);
  // The spell's own reductions (Ghalta's "costs {X} less, where X is the total power of creatures you control", Blasphemous Act) were part of
  // adjustedCastingCost - which decides whether a spell is castable - but never of this, which decides what is charged, so the two disagreed.
  const ownReduction = allSeats ? selfConditionalCostReduction(card, allSeats) + selfScalingCostReduction(card, seat, allSeats) : 0;
  // Rule 601.2f: same colored-pip floor as adjustedCastingCost above — a flat cost reduction can
  // never eat into X/multikicker-inflated cost's colored requirement either.
  return Math.max(coloredPipCount(card), baseCost + unitCost * chosenX - pendingArtifactAffinityReduction(seat) - staticCostReduction(seat, card) - ownReduction);
}

// Saheeli, the Gifted's second +1: "The next spell you cast this turn has affinity for artifacts.
// (It costs {1} less to cast for each artifact you control as you cast it.)" — evaluated against
// artifacts controlled at cast time, not when the loyalty ability was activated.
function pendingArtifactAffinityReduction(seat: PlayerSeat) {
  return seat.nextSpellHasArtifactAffinity ? artifactCount(seat) : 0;
}

export function coloredPipCount(card: VisibleCard) {
  return (card.manaCost?.match(/\{[WUBRG]\}/gi) ?? []).length;
}

export function findMiracleGranter(seat: PlayerSeat): VisibleCard | undefined {
  return seat.board.battlefield.find(
    (card) => card.name === "Aminatou, Veil Piercer" || /enchantment cards? in your hand (has|have) miracle/i.test(card.oracleText)
  );
}

// staticCostReduction stacks with the granted-miracle discount itself, same as it would with any
// other cost reduction (rule 601.2f floors the combined total at coloredPipCount, never below it) —
// previously omitted entirely, so a static reducer on the battlefield (Inquisitive Glimmer, ...)
// was silently ignored for a miracle cast even though the exact same reduction was already correctly
// applied for a normal hand cast (adjustedCastingCost). Reported live as Aminatou, Veil Piercer's
// granted miracle (-4) plus Inquisitive Glimmer's own discount (-1) only ever reducing the cost by
// 4, not the expected 5.
export function miracleCostFor(seat: PlayerSeat, card: VisibleCard) {
  return Math.max(coloredPipCount(card), card.manaValue - 4 - staticCostReduction(seat, card));
}

// A card's own printed "Miracle {cost}" line (Temporal Mastery: "Miracle {1}{U}"), as opposed to
// miracleCostFor's estimate — used for a granted-miracle card (Aminatou, Veil Piercer's enchantments)
// that has no real miracle cost printed on it at all.
export function parseMiracleCost(card: VisibleCard): number | undefined {
  const match = card.oracleText.match(/\bmiracle\s+((?:\{[^}]+\})+)/i);
  return match ? manaValueFromManaCost(match[1]) : undefined;
}
