// Phase-trigger registry: "At the beginning of <step/phase>, ..." abilities, derived deterministically from the permanents on the battlefield
// (ANY seat's), plus one-shot delayed triggers created by resolved effects ("at the beginning of the next end step").
//
// Why this exists: the engine used to sweep only the ACTIVE player's permanents when a step began and applied each effect directly, so an
// opponent's "each upkeep / each end step / each opponent's upkeep" permanent never fired on the right turns and nothing went on the stack
// (no response window, no recorded target). This module is pure (no React, no session mutation): it parses the wording into a spec, lists
// the standing "watchers" for a set of seats, and, for a given (step, active seat), returns the watchers that trigger, grouped in APNAP order
// (rule 603.3b: the active player's triggers are put on the stack first, then each other player's in turn order, so the LAST seat's
// triggers resolve first). AppFlow.tsx turns the result into real trigger stack items.
import type { TURN_PHASES } from "./priorityStops";
import { isActivatedAbilityClause, mergeModalBulletClauses, oracleClauses } from "./oracleClauses";

export type PhaseName = (typeof TURN_PHASES)[number];

// Whose step it must be for the ability to trigger, relative to the permanent's controller.
//  controller: only on the controller's own turn ("your upkeep", "combat on your turn", "your end step")
//  each: every turn ("each upkeep", "each end step", "each combat", "the end step", bare "beginning of combat")
//  each_player: every turn, and the effect refers to that turn's player ("each player's upkeep", "that player draws")
//  opponents: only on an opponent's turn ("each opponent's upkeep")
//  enchanted_player: the turn of the player an Aura enchants (Shadow of the Second Sun) - not resolved by the registry
export type PhaseTurnScope = "controller" | "each" | "each_player" | "opponents" | "enchanted_player";

export interface PhaseTriggerSpec {
  phase: PhaseName;
  scope: PhaseTurnScope;
  // The whole clause as printed (modal bullets folded in), the intervening "if" condition text (rule 603.4: checked when the step begins AND on
  // resolution), and what the ability does.
  clause: string;
  condition?: string;
  effectText: string;
  optional: boolean;
  // echo / vanishing / fading / cumulative upkeep: upkeep keyword abilities, which are triggers too.
  keyword?: "echo" | "vanishing" | "fading" | "cumulative upkeep";
  // "• Khans — At the beginning of ..." (Outpost Siege, Citadel Siege): only active when that label is the one chosen as the permanent entered.
  modeLabel?: string;
}

// The "when" part of "at the beginning of <when>," -> phase and scope. undefined = wording this registry does not know.
function parseWhen(raw: string): { phase: PhaseName; scope: PhaseTurnScope } | { delayed: true } | undefined {
  const when = raw.toLowerCase().trim().replace(/\s+/g, " ");
  if (/^(?:your |the )?next\b/.test(when) || /^the next (?:turn'?s )?(?:upkeep|draw step|end step|combat)/.test(when) || /\bnext turn'?s\b/.test(when)) return { delayed: true };
  const table: Array<[RegExp, PhaseName, PhaseTurnScope]> = [
    // untap / cleanup (rare, but they are real step wordings)
    [/^your untap step$/, "untap step", "controller"],
    [/^your cleanup step$/, "cleanup step", "controller"],
    // upkeep
    [/^(?:your|each of your) upkeeps?$/, "upkeep step", "controller"],
    [/^(?:each|the) upkeep$/, "upkeep step", "each"],
    [/^each player'?s upkeep$/, "upkeep step", "each_player"],
    [/^each opponent'?s upkeep$/, "upkeep step", "opponents"],
    // draw step
    [/^your draw step$/, "draw step", "controller"],
    [/^each draw step$/, "draw step", "each"],
    [/^each player'?s draw step$/, "draw step", "each_player"],
    [/^each opponent'?s draw step$/, "draw step", "opponents"],
    // main phases ("first main phase" = precombat, "second main phase" = postcombat)
    [/^your (?:precombat|first) main phase$/, "precombat main phase", "controller"],
    [/^each of your (?:precombat|first) main phases$/, "precombat main phase", "controller"],
    [/^each player'?s (?:precombat|first) main phase$/, "precombat main phase", "each_player"],
    [/^your (?:postcombat|second) main phase$/, "postcombat main phase", "controller"],
    [/^each of your (?:postcombat|second) main phases$/, "postcombat main phase", "controller"],
    [/^each player'?s (?:postcombat|second) main phase$/, "postcombat main phase", "each_player"],
    [/^each of enchanted player'?s postcombat main phases$/, "postcombat main phase", "enchanted_player"],
    // combat
    [/^combat on your turn$/, "beginning of combat step", "controller"],
    [/^combat on each opponent'?s turn$/, "beginning of combat step", "opponents"],
    [/^combat on each player'?s turn$/, "beginning of combat step", "each_player"],
    [/^your combat$/, "beginning of combat step", "controller"],
    [/^(?:each |the )?combat$/, "beginning of combat step", "each"],
    [/^each player'?s combat$/, "beginning of combat step", "each_player"],
    [/^each opponent'?s combat$/, "beginning of combat step", "opponents"],
    // end step
    [/^your end step$/, "end step", "controller"],
    [/^(?:each|the) end step$/, "end step", "each"],
    [/^each player'?s end step$/, "end step", "each_player"],
    [/^each opponent'?s end step$/, "end step", "opponents"]
  ];
  for (const [pattern, phase, scope] of table) if (pattern.test(when)) return { phase, scope };
  return undefined;
}

function conditionAndEffect(rest: string): { condition?: string; effectText: string } {
  const match = rest.match(/^if\s+(.+?),\s*(.+)$/is);
  if (match && !/^you may\b/i.test(match[1])) return { condition: match[1].trim(), effectText: match[2].trim() };
  return { effectText: rest.trim() };
}

// Keyword upkeep abilities. Echo {cost}, Vanishing N, Fading N, Cumulative upkeep {cost}.
function keywordSpec(clause: string): PhaseTriggerSpec | undefined {
  const keyword = /^(echo)\b(?=\s*(?:\{|\d))/i.exec(clause)?.[1] ?? /^(vanishing|fading)\s+\d+/i.exec(clause)?.[1] ?? /^(cumulative upkeep)\b/i.exec(clause)?.[1];
  if (!keyword) return undefined;
  return { phase: "upkeep step", scope: "controller", clause, effectText: clause, optional: false, keyword: keyword.toLowerCase() as PhaseTriggerSpec["keyword"] };
}

// A clause that merely MENTIONS a phase ("... at the beginning of the next end step") is not a standing watcher: only a clause that STARTS with
// the wording (after an ability word such as "Lieutenant —" or a mode label such as "• Khans —", or "When ~ enters and at the beginning of ...").
// A double-faced / adventure face label ("Virtue of Persistence: At the beginning of ...") is accepted as a prefix too.
const LEAD = /^(?:(?:[•*]\s*)?[A-Za-z' ]{1,40}\s[—–-]\s+|[A-Z][A-Za-z',\- ]{1,50}:\s+|when(?:ever)?\b[^,]*?\band\s+)?(?:at the beginning of|at the end of|at end of) /i;

export interface ParsedPhaseTriggers {
  specs: PhaseTriggerSpec[];
  // "At the beginning of ..." clauses the registry could not classify (the card-text audit lists these so a new wording is noticed, not silently dropped).
  unrecognized: string[];
  // Clauses that are one-shot delayed wordings on a permanent ("at the beginning of your next upkeep") - not standing watchers.
  delayed: string[];
}

// Parses every standing phase trigger on a card's oracle text. Activated abilities are skipped (a loyalty ability's emblem text is not the planeswalker's own trigger).
export function parsePhaseTriggersDetailed(oracleText: string): ParsedPhaseTriggers {
  const out: ParsedPhaseTriggers = { specs: [], unrecognized: [], delayed: [] };
  if (!oracleText) return out;
  for (const clause of mergeModalBulletClauses(oracleClauses(oracleText))) {
    if (isActivatedAbilityClause(clause)) continue;
    const plain = clause.replace(/\([^)]*\)/g, " ").replace(/[ \t]+/g, " ").trim();
    const keyword = keywordSpec(plain);
    if (keyword) {
      out.specs.push({ ...keyword, clause });
      continue;
    }
    if (!LEAD.test(plain)) continue;
    // "at end of combat" / "at the end of combat [on your turn]," -> end of combat step
    const endOfCombat = plain.match(/^(?:[^,]*?\band\s+|(?:[•*]\s*)?[A-Za-z' ]{1,40}\s[—–-]\s+|[A-Z][A-Za-z',\- ]{1,50}:\s+)?at (?:the )?end of combat( on your turn)?,\s*(.*)$/is);
    if (endOfCombat) {
      const { condition, effectText } = conditionAndEffect(endOfCombat[2]);
      out.specs.push({ phase: "end of combat step", scope: endOfCombat[1] ? "controller" : "each", clause, condition, effectText, optional: /\byou may\b/i.test(effectText.split(".")[0] ?? "") });
      continue;
    }
    const match = plain.match(/at the beginning of ([^,]+),\s*(.*)$/is);
    if (!match) continue;
    const parsed = parseWhen(match[1]);
    if (!parsed) {
      out.unrecognized.push(clause);
      continue;
    }
    if ("delayed" in parsed) {
      out.delayed.push(clause);
      continue;
    }
    const { condition, effectText } = conditionAndEffect(match[2]);
    const modeLabel = plain.match(/^[•*]\s*([A-Za-z]+)\s*[—–-]/)?.[1];
    out.specs.push({ phase: parsed.phase, scope: parsed.scope, clause, condition, effectText, optional: /\byou may\b/i.test(effectText.split(/[.]/)[0] ?? ""), ...(modeLabel ? { modeLabel } : {}) });
  }
  return out;
}

export function parsePhaseTriggers(oracleText: string): PhaseTriggerSpec[] {
  return parsePhaseTriggersDetailed(oracleText).specs;
}

// --- watchers ------------------------------------------------------------------------------------------------------------------------------

// The minimal shape of a seat / permanent this module reads (structurally satisfied by PlayerSeat / VisibleCard).
export interface PhaseCardView {
  id: string;
  name: string;
  oracleText: string;
  abilitiesStripped?: boolean;
  phasedOut?: boolean;
  chosenMode?: string;
}
export interface PhaseSeatView {
  id: string;
  hasLost?: boolean;
  board: { battlefield: PhaseCardView[] };
  emblems?: Array<{ id: string; sourceName: string; oracleText: string }>;
}

export interface PhaseWatcher {
  // Stable per (source, clause) so a test or the stack can name it.
  id: string;
  controllerSeatId: string;
  sourceCardId: string;
  sourceCardName: string;
  emblem?: boolean;
  // Set on a due delayed trigger that returns a recorded card.
  returnCard?: DelayedReturnCard;
  spec: PhaseTriggerSpec;
}

// Every standing watcher of the given seats, for any phase. Permanents that lost their abilities, phased-out permanents and seats that have lost
// the game contribute nothing.
export function buildPhaseWatchers(seats: PhaseSeatView[]): PhaseWatcher[] {
  const watchers: PhaseWatcher[] = [];
  for (const seat of seats) {
    if (seat.hasLost) continue;
    for (const card of seat.board.battlefield) {
      if (card.abilitiesStripped || card.phasedOut) continue;
      parsePhaseTriggers(card.oracleText).forEach((spec, index) => {
        if (spec.modeLabel && card.chosenMode && card.chosenMode.toLowerCase() !== spec.modeLabel.toLowerCase()) return;
        watchers.push({ id: `${card.id}#${index}`, controllerSeatId: seat.id, sourceCardId: card.id, sourceCardName: card.name, spec });
      });
    }
    for (const emblem of seat.emblems ?? []) {
      parsePhaseTriggers(emblem.oracleText).forEach((spec, index) => watchers.push({ id: `${emblem.id}#${index}`, controllerSeatId: seat.id, sourceCardId: emblem.id, sourceCardName: emblemDisplayName(emblem.sourceName), emblem: true, spec }));
    }
  }
  return watchers;
}

// Whether a spec's scope puts it on this turn's step.
export function phaseScopeApplies(scope: PhaseTurnScope, controllerSeatId: string, activeSeatId: string): boolean {
  if (scope === "controller") return controllerSeatId === activeSeatId;
  if (scope === "opponents") return controllerSeatId !== activeSeatId;
  if (scope === "enchanted_player") return false;
  return true;
}

// --- delayed (one-shot) triggers ------------------------------------------------------------------------------------------------------------

// "At the beginning of the next end step, ..." created by a resolved effect (rule 603.7). It fires once, at the first matching step that BEGINS after
// it was created (a step already under way does not count), then is removed.
// A delayed trigger that returns one specific card ("return that card to the battlefield at the beginning of the next end step", Daretti's and
// Liliana's emblems): the card is recorded when the emblem triggers; it only moves if it is still in its owner's graveyard when the step begins.
export interface DelayedReturnCard {
  cardId: string;
  cardName: string;
  ownerSeatId: string;
  // Who controls it when it returns (the emblem's controller for "under your control", else the owner).
  controlSeatId: string;
}

// "Tezzeret's emblem": what the stack and the log call an emblem's ability (the part of the source's name before the first comma / face separator).
export function emblemDisplayName(sourceName: string): string {
  const short = sourceName.split(" // ")[0].split(",")[0].trim();
  return `${short || sourceName}'s emblem`;
}

export interface DelayedPhaseTrigger {
  id: string;
  returnCard?: DelayedReturnCard;
  controllerSeatId: string;
  sourceCardId: string;
  sourceCardName: string;
  phase: PhaseName;
  // "controller": the controller's next such step ("your next upkeep"); "any": the very next such step, whoever's turn ("the next end step").
  scope: "controller" | "any";
  effectText: string;
  createdTurn: number;
  createdPhase: PhaseName;
}

const PHASE_ORDER: readonly PhaseName[] = [
  "untap step", "upkeep step", "draw step", "precombat main phase", "beginning of combat step", "declare attackers step", "declare blockers step",
  "combat damage step", "end of combat step", "postcombat main phase", "end step", "cleanup step"
];

export function delayedTriggerDue(trigger: DelayedPhaseTrigger, phase: PhaseName, activeSeatId: string, turn: number): boolean {
  if (trigger.phase !== phase) return false;
  if (trigger.scope === "controller" && trigger.controllerSeatId !== activeSeatId) return false;
  if (turn > trigger.createdTurn) return true;
  return turn === trigger.createdTurn && PHASE_ORDER.indexOf(phase) > PHASE_ORDER.indexOf(trigger.createdPhase);
}

// --- collection ----------------------------------------------------------------------------------------------------------------------------

export interface PhaseTriggerEntry {
  watcher: PhaseWatcher;
  // Set for a delayed trigger: it is removed from the session once put on the stack.
  delayed?: DelayedPhaseTrigger;
}

export interface PhaseTriggerGroup {
  seatId: string;
  entries: PhaseTriggerEntry[];
}

// The triggers that go on the stack when `phase` begins on `activeSeatId`'s turn, grouped by controller in APNAP order (active player first, then the
// others in turn order). Entries inside a group are in the controller's default order (battlefield order; a human may reorder them).
export function collectPhaseTriggers(
  seats: PhaseSeatView[],
  phase: PhaseName,
  activeSeatId: string,
  options: { delayed?: DelayedPhaseTrigger[]; turn?: number } = {}
): PhaseTriggerGroup[] {
  const watchers = buildPhaseWatchers(seats);
  const activeIndex = Math.max(0, seats.findIndex((seat) => seat.id === activeSeatId));
  const apnap = [...seats.slice(activeIndex), ...seats.slice(0, activeIndex)].filter((seat) => !seat.hasLost);
  const groups: PhaseTriggerGroup[] = [];
  for (const seat of apnap) {
    const entries: PhaseTriggerEntry[] = watchers
      .filter((watcher) => watcher.controllerSeatId === seat.id && watcher.spec.phase === phase && phaseScopeApplies(watcher.spec.scope, seat.id, activeSeatId))
      .map((watcher) => ({ watcher }));
    for (const delayed of options.delayed ?? []) {
      if (delayed.controllerSeatId !== seat.id || !delayedTriggerDue(delayed, phase, activeSeatId, options.turn ?? Number.MAX_SAFE_INTEGER)) continue;
      entries.push({
        delayed,
        watcher: {
          id: delayed.id,
          controllerSeatId: seat.id,
          sourceCardId: delayed.sourceCardId,
          sourceCardName: delayed.sourceCardName,
          ...(delayed.returnCard ? { returnCard: delayed.returnCard } : {}),
          spec: { phase, scope: "each", clause: delayed.effectText, effectText: delayed.effectText, optional: /\byou may\b/i.test(delayed.effectText) }
        }
      });
    }
    if (entries.length > 0) groups.push({ seatId: seat.id, entries });
  }
  return groups;
}

// Resolution order of a batch: APNAP is the order triggers are PUT on the stack, so the last player's group resolves first and the active player's
// last. Within a group the controller's own order is kept (first = resolves first).
export function stackResolutionOrder(groups: PhaseTriggerGroup[]): PhaseTriggerEntry[] {
  return [...groups].reverse().flatMap((group) => group.entries);
}

// True when any seat has any watcher for this step (the End Turn shortcut must not skip a step something would trigger on).
export function anyPhaseTrigger(seats: PhaseSeatView[], phase: PhaseName, activeSeatId: string, options: { delayed?: DelayedPhaseTrigger[]; turn?: number } = {}): boolean {
  return collectPhaseTriggers(seats, phase, activeSeatId, options).length > 0;
}

// Only "the number" helper used by tests/consumers that want to describe a spec in the stack text.
export function describePhaseSpec(spec: PhaseTriggerSpec): string {
  const when = spec.scope === "controller" ? "your" : spec.scope === "opponents" ? "each opponent's" : spec.scope === "each_player" ? "each player's" : "each";
  return `At the beginning of ${when} ${spec.phase.replace(/ step$/, "")}${spec.condition ? `, if ${spec.condition}` : ""}: ${spec.effectText}`;
}

