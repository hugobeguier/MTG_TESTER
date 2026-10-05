// Milestone 2 of the self-play plan — the headless orchestrator. Owns SEQUENCING ONLY (phase order,
// whose turn it is, when to ask a seat's brain for a decision); every actual rules effect is applied
// through the real exported engine functions from AppFlow.tsx, never reimplemented here. See the
// plan doc for the full design; the comments below focus on where this milestone's implementation
// had to diverge from that plan once the real casting/mana-payment code was actually read.
//
// KNOWN GAPS (headless mode only — the live UI is unaffected by any of this):
//
// 1. No stack (this was already flagged in the plan as GameSession having no stack field). This
//    orchestrator's cast flow pays a spell's cost immediately and resolves it with no response
//    window, exactly as planned. UPDATE (post-milestone-2 follow-up): resolvePendingAction's own
//    orchestration glue (setSession/setPendingRuleChoice/window.setTimeout-queued trigger resolution)
//    is indeed too React-coupled to hoist, matching the original milestone 2 finding — but reading
//    resolvePendingAction's actual spell-resolution body (AppFlow.tsx ~5595-6110) end to end showed
//    the EFFECT LOGIC underneath it is already factored into a chain of ~14 pure, module-level
//    parse+apply function pairs (parseRemovalEffect/applyRemovalEffect, parseZoneEffect/
//    applyZoneEffect, parseTargetedPump/applyTargetedPumpEffect, parseMassPump/applyMassPumpEffect,
//    parseMassBounceEffect/applyMassBounceEffect, parseSimpleLifeChange/applySimpleLifeChange,
//    parsePunisherChoiceEffect/applyPunisherChoiceEffect, parseSimpleDrawEffect/drawMultipleForSeat,
//    isLivingDeathEffect/applyLivingDeathEffect, grantsExtraTurn, parseCreateTokenSpecs/
//    createTokensForSeat, parseGenericModalEffect/applyGenericModalEffect), run in a fixed precedence
//    order and already used identically for AI-controlled casts in the live game (the interactive
//    legalTargets/preferredTargets branches earlier in resolvePendingAction only fire for
//    `actor?.kind === "human"`; every other seat already falls through to this exact chain, which
//    does its own internal heuristic targeting via chooseRemovalTarget/chooseCounterTarget — no
//    separate target-selection step was needed here). resolveBareSpellEffect below (see its own
//    comment) replicates that precedence order faithfully, calling the SAME functions the live game
//    calls (all newly exported from AppFlow.tsx this milestone — mechanical, no behaviour change,
//    same pattern as milestone 1's hoists). Games are no longer "permanents and combat only": a
//    removal spell destroys/exiles/bounces/damages its target, a Giant Growth-shaped pump buffs a
//    creature, a board wipe wipes, Living Death does its thing, tokens get created, life total spells
//    apply, "draw N cards" instants/sorceries draw. See resolveBareSpellEffect's own comment for the
//    precise, remaining gap list (tutors/search-library, counterspells, and any template none of the
//    ~14 parsers recognize).
// 2. activate_ability actions (equip, generic mana/tap/sacrifice abilities, loyalty abilities, ...)
//    are filtered out of what a brain is ever offered — every "apply" side for these lives in
//    AppFlow.tsx component closures with no pure equivalent, the same shape as reason #1 above.
// 3. Cards with a special multi-face cast shape (an MDFC's SPELL side, a Room's second door, an
//    independently-castable Adventure/Omen face) are filtered out of cast_spell options — only a
//    plain single-faced cast (including X-cost) is applied. An MDFC's LAND side is unaffected (land
//    plays never need this filtering: playCardFromZone handles any faceIndex generically).
// 4. declareAttack itself couldn't be hoisted in milestone 1 (see that milestone's report) because
//    even for a non-human seat it calls a React-state closure (addRestrictedManaBatch, for Klauth-
//    style "attacking adds mana" triggers) — so this file has its own minimal attack-declaration
//    function (applyAttackDeclaration below) covering rule 508.1a's actual core (tap unless
//    vigilant, mark attacking, pay any attack tax) but NOT Klauth's mana trigger, Metalcraft attack
//    debuffs, "whenever you attack a player" token creation, Breena's symmetric trigger, or
//    annihilator's forced sacrifices — all of which stay entirely inside AppFlow.tsx.
// 5. Saga chapter advancement is skipped, same as milestone 1's smoke test (advanceSagaLoreCounters
//    is still a nested, unhoistable AppFlow.tsx closure — see that milestone's report).
// 6. Cleanup step's discard-to-hand-size isn't modeled (no UI/brain hook for "which cards to
//    discard" exists in headless mode yet).
// 7. --seed only makes createSelfPlayGame's OWN randomness (deck shuffling, mulligan re-shuffles,
//    the starting-seat d20 roll) repeatable, by temporarily monkey-patching the global Math.random
//    for the duration of that one call. There is no seedable RNG threaded through the engine itself
//    (shuffleCards/rollD20/crypto.randomUUID all call the global Math.random directly) — a real fix
//    would mean plumbing a PRNG through AppFlow.tsx itself, out of scope here. Everything AFTER setup
//    (all of playGame) is already fully deterministic given a fixed starting session, since
//    heuristicBrain's scoring has no randomness of its own — so this narrower seed still delivers
//    "the same game replays the same way," just not via a single RNG source end to end.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  adjustedCastingCost,
  applyDeckToSeat,
  applyGenericModalEffect,
  applyLivingDeathEffect,
  applyMassBounceEffect,
  applyMassPumpEffect,
  applyEntersWithCounterReplacements,
  applySpellExtraEffect,
  applyPunisherChoiceEffect,
  payAdditionalDiscardCost,
  applyRemovalEffect,
  applySimpleLifeChange,
  applyTargetedPumpEffect,
  applyZoneEffect,
  assignBlockers,
  cleanupCombat,
  chooseManaSourcesForCost,
  countCreaturesAttackingSeat,
  createTokensForSeat,
  drawForSeat,
  drawMultipleForSeat,
  genericCostShim,
  grantsExtraTurn,
  hasVigilance,
  independentlyCastableSpellFaces,
  isAvailableManaSource,
  isLandCard,
  isLivingDeathEffect,
  legalAttackActions,
  legalBlockActions,
  legalMainPhaseActions,
  maxAffordableX,
  modalDoubleFacedLandSplit,
  moveCardAcrossSeats,
  parseCreateTokenSpecs,
  parseGenericModalEffect,
  parseMassBounceEffect,
  parseMassPump,
  parsePunisherChoiceEffect,
  parseSimpleDrawEffect,
  parseSimpleLifeChange,
  parseTargetedPump,
  phaseEvent,
  playCardFromZone,
  resolveAgentMulligans,
  resolveAttackTarget,
  resolveCombatDamage,
  resolvePendingUpkeepDraws,
  rollForStartingSeat,
  roomDoorFaces,
  runStateBasedActionsPass,
  shuffleCards,
  spendManaSources,
  substituteX,
  totalAttackTax,
  totalCastingCost,
  untapForSeat,
  withOpeningHand,
  type LegalAgentAction
} from "@/components/AppFlow";
import { parseSearchLibraryEffectText, type SearchLibraryEffect } from "@/lib/activatedAbilities";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { createDeckFromList } from "@/lib/deckParser";
import { cardMatchesTypeFilter, etbEffectText, parseModalHeader } from "@/lib/oracleClauses";
import { TURN_PHASES } from "@/lib/priorityStops";
import { parseRemovalEffect } from "@/lib/removalSpells";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
import { parseZoneEffect } from "@/lib/zoneEffects";
import type { CardLike, ScoringContext } from "@/lib/actionScoring";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { auditAfterAction, createAuditState, SelfPlayStrictViolationError, type AuditMeta, type AuditState, type AuditViolation } from "./audit";
import { createAnomalyState, scanForAnomalies, type Anomaly, type AnomalyState } from "./anomalies";
import type { Brain } from "./brains";

type TurnPhase = (typeof TURN_PHASES)[number];

// --- Setup (createSelfPlayGame) -------------------------------------------------------------------

export interface CreateSelfPlayGameOptions {
  // Paths relative to the repo root (process.cwd()) — defaults mirror milestone 1's smoke test,
  // whose pairing (Meren.txt vs UrDragon.txt) is known to build cleanly against the built-in card
  // catalog fallback (see readDeckList's own comment on why: no data/commander-cards.json is
  // checked into the repo yet).
  // Any number of seats (2 for the legacy pairings, 4 for a Commander pod) — one deck path per seat.
  deckListPaths?: string[];
  seatNames?: string[];
  // Forces which seat (index into deckListPaths/seatNames) rolls to go first instead of
  // letting rollForStartingSeat's own d20 roll decide — used by scripts/self-play.ts to swap who
  // goes first across games so first-player advantage cancels out over a run, per the plan.
  forceFirstSeatIndex?: number;
  // See gap #7 above — only covers this function's own setup randomness.
  seed?: number;
}

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededRandom<T>(seed: number | undefined, fn: () => T): T {
  if (seed === undefined) return fn();
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

function readRootDeckList(fileName: string): string {
  return readFileSync(path.join(process.cwd(), fileName), "utf8");
}

function buildBareSeat(id: string, name: string): PlayerSeat {
  return {
    id,
    name,
    kind: "agent",
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield: [] }
  };
}

export function createSelfPlayGame(opts: CreateSelfPlayGameOptions = {}): GameSession {
  return withSeededRandom(opts.seed, () => {
    const deckPaths = opts.deckListPaths ?? ["Meren.txt", "UrDragon.txt"];
    const names = opts.seatNames ?? deckPaths.map((_, index) => `Seat ${String.fromCharCode(65 + index)}`);

    const rawCatalog = loadCardCatalog();
    const catalog = { lookup: (name: string) => lookupCard(rawCatalog, name) };

    const builtSeats = deckPaths.map((deckPath, index) => {
      const seatId = `seat-${String.fromCharCode(97 + index)}`;
      const deck = createDeckFromList({ owner: seatId, deckList: readRootDeckList(deckPath), catalog });
      return applyDeckToSeat(buildBareSeat(seatId, names[index]), deck);
    });

    const openingSeats = builtSeats.map((seat) => withOpeningHand(seat, 7, 0));
    const { seats: mulliganedSeats } = resolveAgentMulligans(openingSeats);

    const firstSeatId =
      opts.forceFirstSeatIndex !== undefined ? mulliganedSeats[opts.forceFirstSeatIndex].id : rollForStartingSeat(mulliganedSeats).winnerId;

    return {
      id: `selfplay-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      createdAt: new Date().toISOString(),
      status: "playing",
      activePlayerId: firstSeatId,
      phase: TURN_PHASES[0],
      turn: 1,
      xmage: { enabled: false, status: "not_configured", message: "" },
      seats: mulliganedSeats,
      events: []
    };
  });
}

// --- Scoring context (what a brain sees) -----------------------------------------------------------

function toCardLike(card: VisibleCard): CardLike {
  return {
    id: card.id,
    name: card.name,
    typeLine: card.typeLine,
    power: card.power,
    toughness: card.toughness,
    manaValue: card.manaValue,
    role: card.role,
    tapped: card.tapped,
    oracleText: card.oracleText
  };
}

function buildScoringContext(session: GameSession, seatId: string, purpose: string): ScoringContext {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return { purpose, turn: session.turn };
  const opponents = session.seats.filter((item) => item.id !== seatId);
  const availableMana = seat.board.battlefield.filter((card) => isAvailableManaSource(card, seat, session.seats)).length;
  return {
    purpose,
    turn: session.turn,
    you: {
      life: seat.life,
      poison: seat.poison,
      commanderDamage: seat.commanderDamage,
      battlefield: seat.board.battlefield.map(toCardLike),
      hand: seat.board.hand.map(toCardLike),
      commander: seat.board.commander ? toCardLike(seat.board.commander) : undefined,
      availableMana: { total: availableMana }
    },
    opponents: opponents.map((opponent) => ({
      id: opponent.id,
      name: opponent.name,
      life: opponent.life,
      poison: opponent.poison,
      commanderDamage: opponent.commanderDamage,
      battlefield: opponent.board.battlefield.map(toCardLike)
    }))
  };
}

// --- playGame ---------------------------------------------------------------------------------------

export interface SelfPlayOptions {
  // Per-seat cap, matching GameSession.turn's own per-seat counting convention (see the milestone 1
  // smoke test's identical comment) — default comfortably over-provisioned for a real (attacking,
  // casting) game, not just the plumbing-only smoke test's phase-passing loop.
  turnCap?: number;
  timeoutMs?: number;
  strict?: boolean;
  verbose?: boolean;
}

export interface DecisionCounts {
  [seatId: string]: { [source: string]: number };
}

export interface PlayGameResult {
  session: GameSession;
  winnerSeatId?: string;
  turns: number;
  decisionCounts: DecisionCounts;
  terminationReason: "win" | "turn-cap" | "timeout" | "crash";
  violations: AuditViolation[];
  wallClockMs: number;
  // How many bare instant/sorcery resolutions resolveBareSpellEffect actually recognized vs. let
  // fall through with no effect (see that function's own gap list) — only counts spells that reached
  // resolution (mana paid, card moved to the graveyard), not ones a brain declined to cast at all.
  spellEffectCoverage: { matched: number; unmatched: number };
  // Card name -> how many times it resolved with no recognized effect this game. This is what makes
  // spellEffectCoverage's aggregate percentage actionable: a raw "45% coverage" number doesn't tell
  // you what to implement next, but "Ponder x3, Entomb x2" does. Only unmatched casts are tracked
  // (a matched cast isn't a backlog item); see resolveBareSpellEffect's own gap list for why each of
  // these falls through (tutors/library-search, counterspells, or a template none of the ~14
  // deterministic parsers recognize).
  unmatchedSpellCards: Record<string, number>;
  // Soft, review-queue findings from anomalies.ts — never disqualifies a run the way a violation
  // does, just surfaces suspicious-looking moments (see that module's own header) for a human to spot
  // check, ranked by how often each kind recurs across a batch (scripts/self-play.ts's report).
  anomalies: Anomaly[];
}

const MAX_MAIN_PHASE_ACTIONS = 40;
const MAX_ATTACK_DECLARATIONS = 20;
const MAX_BLOCK_DECLARATIONS = 20;
const MAX_BLOCKERS_PER_ATTACKER = 8;

function isPermanentTypeLine(typeLine: string): boolean {
  return !typeLine.includes("Instant") && !typeLine.includes("Sorcery");
}

// Only a plain single-faced cast_spell/cast_commander (no MDFC spell side, Room door, or
// independently-castable Adventure/Omen face — see gap #3 in the file header) is something this
// orchestrator can faithfully apply. Anything else, and activate_ability entirely (gap #2), is
// filtered out of what the brain is offered, rather than risk mispaying a cost this file doesn't
// know how to compute for that card shape. play_land and pass/end_turn are always supported.
function filterSupportedMainPhaseActions(actions: LegalAgentAction[], seat: PlayerSeat): LegalAgentAction[] {
  return actions.filter((action) => {
    if (action.actionType === "activate_ability") return false;
    if (action.actionType === "cast_spell") {
      if (action.sourceZone === "exile") return false;
      if (action.faceIndex !== undefined) return false;
      const card = seat.board.hand.find((item) => item.id === action.cardId);
      if (card && (modalDoubleFacedLandSplit(card) || roomDoorFaces(card) || independentlyCastableSpellFaces(card))) return false;
    }
    return true;
  });
}

// Precedence order copied from resolvePendingAction's own generic spell-resolution chain
// (AppFlow.tsx, the "regardless of destination" cluster starting around parseCreateTokenSpecs's own
// call site — see the file header comment above for the full trace/rationale). This dispatcher is
// only ever reached for a genuine instant/sorcery (the caller already resolved destination via
// isPermanentTypeLine before calling this, and only calls it when destination is "graveyard"), so
// every `destination === "battlefield"`-gated computation in the source chain (ETB counters,
// explore, chosen creature type/color, Saga lore counters, common ETB triggers,
// eachPlayerSacrificeEffect) is correctly omitted here — none of them can ever apply to a bare
// spell (eachPlayerSacrificeEffect's own gate in the source is literally `destination ===
// "battlefield"`, so a Plaguecrafter-shaped "each player sacrifices" effect is only ever a
// creature's ETB trigger, already covered by the existing permanent path in applyMainPhaseAction).
//
// KNOWN GAPS — the spell's mana is spent and the card still moves to the graveyard as normal, but
// its effect silently doesn't happen, exactly like EVERY instant/sorcery before this milestone. The
// `matched` flag on the return value lets callers measure how often this actually happens instead
// of guessing from a card list (see spellEffectCoverage in PlayGameResult / scripts/self-play.ts):
//  - Library search / tutor effects to hand, graveyard, OR battlefield (Fabricate, Entomb, Buried
//    Alive, Diabolic Intent, Farseek-style land ramp, ...) ARE handled, via applySearchLibraryEffect's
//    own simple auto-pick — see its comment for why that's deliberately NOT the live game's agent
//    heuristic (chooseAgentLibraryCardForRuleChoice, AppFlow.tsx ~7705, a component-nested closure
//    this file can't reach).
//  - Diabolic Intent-shaped "as an additional cost, sacrifice a creature" is not modeled: the search
//    still happens, but no creature is actually sacrificed to pay for it. Additional-cost payment
//    happens at cast time in the live game, a step this orchestrator doesn't have; treating the
//    search as free is a known simplification, not a rules-integrity violation (the audit only checks
//    card conservation, not whether an additional cost was paid).
//  - "Draw N cards, then put M back" (Brainstorm, Brainsurge) and "Surveil N" (Otherworldly Gaze) ARE
//    handled, via the shared parseZoneEffect/applyZoneEffect (draw_x_then_put_back's drawAmount field,
//    and the "surveil" kind) — both benefit the live game too, not just self-play. A "look at the top
//    N, put them back in any order, draw a card" shape (Ponder) is handled SELF-PLAY-ONLY, further
//    down in this function: the live game routes that one to the Rules Advisor for a real reorder
//    choice, which this auto-resolution deliberately doesn't attempt.
//  - Counterspells — unchanged; still need a real stack/priority window (documented as a known gap
//    from the plan's first draft, not attempted here).
//  - Any other shape none of the parsers below recognize (a pure "each player draws a card", a
//    copy-target-spell effect, a bare static/replacement-effect instant, "reveal the top N, keep a
//    matching one" digs like Grisly Salvage, a dynamic "draw cards equal to X" count, a mass "gain
//    indestructible" grant, an edict like "each player sacrifices N creatures," ...).
function resolveBareSpellEffect(session: GameSession, casterSeatId: string, sourceCard: VisibleCard, chosenX: number | undefined): { session: GameSession; matched: boolean } {
  const rawText = etbEffectText(sourceCard.oracleText);
  let working = session;
  let matched = false;

  // "Create N ... tokens" — applies regardless of modal status in the source chain too (a modal
  // card whose non-chosen bullet happens to mention tokens can misfire here exactly as it can live;
  // replicated faithfully rather than "fixed," per the task's own instruction to match real
  // precedence, not a guessed one).
  const tokenSpecs = parseCreateTokenSpecs(rawText, undefined, undefined, chosenX, countCreaturesAttackingSeat(working, casterSeatId));
  if (tokenSpecs.length > 0) {
    working = createTokensForSeat(working, casterSeatId, sourceCard.id, tokenSpecs).session;
    matched = true;
  }

  // Fog effects ("Prevent all combat damage that would be dealt this turn[, by non-X creatures]").
  const fogMatch = rawText.match(/\bprevent all combat damage that would be dealt this turn(?: by non-([a-z]+) creatures)?\b/i);
  if (fogMatch) {
    const exceptType = fogMatch[1] ? fogMatch[1].charAt(0).toUpperCase() + fogMatch[1].slice(1) : undefined;
    working = {
      ...working,
      combatDamagePrevented: { turn: working.turn, exceptType },
      events: [
        phaseEvent(casterSeatId, `${sourceCard.name}: all combat damage is prevented this turn${exceptType ? ` except from ${exceptType} creatures` : ""}.`),
        ...working.events
      ]
    };
    matched = true;
  }

  // Destroy/exile/bounce/damage (single or mass) — including the "modal" RemovalEffect kind, whose
  // own deterministic mode selection (applyRemovalEffect's "modal" case) needs no separate handling
  // here, same as the live game.
  const removalEffect = parseRemovalEffect(rawText);
  if (removalEffect) {
    working = applyRemovalEffect(working, casterSeatId, sourceCard.name, sourceCard, removalEffect, chosenX);
    matched = true;
  }

  const isModalCard = Boolean(parseModalHeader(sourceCard.oracleText));

  const zoneEffect = !isModalCard ? parseZoneEffect(rawText) : undefined;
  if (zoneEffect) {
    working = applyZoneEffect(working, casterSeatId, sourceCard.name, zoneEffect, chosenX);
    matched = true;
  }

  // Search your library for a[n] [type] card(s), put it into your hand/graveyard, then shuffle
  // (Fabricate, Entomb, Buried Alive, Diabolic Intent, ...) — see applySearchLibraryEffect's own
  // comment for why this uses its own simple auto-pick instead of the live game's agent heuristic.
  // Diabolic Intent-shaped cards lead with "As an additional cost to cast this spell, sacrifice a
  // creature." before the actual search clause; parseSearchLibraryEffectText's pattern is ^-anchored
  // (it needs to be, to avoid matching "search your library" appearing mid-sentence in an unrelated
  // clause elsewhere), so that leading sentence has to be stripped first or the whole match fails.
  // Since the sacrifice itself isn't paid here either way (see this function's own header gap list),
  // stripping it is consistent with the simplification already being made, not a separate one.
  const withoutAdditionalSacrificeCost = rawText.replace(/^as an additional cost to cast this spell,\s*sacrifice an?\s+[a-z]+\.\s*/i, "");
  const searchLibraryEffect = !isModalCard ? parseSearchLibraryEffectText(withoutAdditionalSacrificeCost) : undefined;
  if (searchLibraryEffect) {
    working = applySearchLibraryEffect(working, casterSeatId, sourceCard.name, searchLibraryEffect);
    matched = true;
  }

  if (!isModalCard && isLivingDeathEffect(rawText)) {
    working = applyLivingDeathEffect(working, sourceCard.name);
    matched = true;
  }

  // X-substitution first, same order as the source (substituteX before parseTargetedPump/parseMassPump).
  const xSubstitutedText = chosenX !== undefined ? substituteX(rawText, chosenX) : rawText;

  const pumpEffect = !isModalCard ? parseTargetedPump(xSubstitutedText) : undefined;
  if (pumpEffect) {
    working = applyTargetedPumpEffect(working, casterSeatId, sourceCard, pumpEffect);
    matched = true;
  }

  const massPumpEffect = !isModalCard ? parseMassPump(xSubstitutedText) : undefined;
  if (massPumpEffect) {
    working = applyMassPumpEffect(working, casterSeatId, sourceCard.name, massPumpEffect);
    matched = true;
  }

  const massBounceScope = !isModalCard ? parseMassBounceEffect(rawText) : undefined;
  if (massBounceScope) {
    working = applyMassBounceEffect(working, casterSeatId, sourceCard.name, massBounceScope);
    matched = true;
  }

  const simpleLifeEffect = !isModalCard ? parseSimpleLifeChange(rawText) : undefined;
  if (simpleLifeEffect) {
    working = applySimpleLifeChange(working, casterSeatId, sourceCard.name, simpleLifeEffect);
    matched = true;
  }

  const punisherEffect = !isModalCard ? parsePunisherChoiceEffect(rawText) : undefined;
  if (punisherEffect) {
    working = applyPunisherChoiceEffect(working, casterSeatId, sourceCard.name, punisherEffect, Math.max(0, chosenX ?? 0));
    matched = true;
  }

  const simpleDrawEffect = !isModalCard ? parseSimpleDrawEffect(rawText) : undefined;
  if (simpleDrawEffect) {
    const seatName = working.seats.find((seat) => seat.id === casterSeatId)?.name ?? "Player";
    working = drawMultipleForSeat(
      working,
      casterSeatId,
      simpleDrawEffect.amount,
      `${seatName} draws ${simpleDrawEffect.amount} card${simpleDrawEffect.amount === 1 ? "" : "s"} from ${sourceCard.name}.`
    );
    matched = true;
  }

  // One-off shapes (Sign in Blood, Hit the Mother Lode, Necrotic Hex, Monstrous Onslaught, ...) — see
  // spellExtras.ts. "Add {R} for each tapped land..." (Mana Geyser) is skipped: it needs the live game's
  // mana pool, which headless self-play doesn't have, so it stays an honest "unmatched" here.
  for (const extra of !isModalCard ? parseSpellExtraEffects(rawText) : []) {
    if (extra.kind === "add_mana_per_tapped_opponent_land") continue;
    working = applySpellExtraEffect(working, casterSeatId, sourceCard, extra, chosenX);
    matched = true;
  }

  // "Look at the top N cards of your library, then put them back in any order[. You may shuffle].
  // Draw a card." (Ponder, ...) — parseSimpleDrawEffect deliberately DECLINES this shape (see its own
  // comment) so the live game routes it to the Rules Advisor's real reorder_top_cards choice, which
  // self-play has no equivalent for. Self-play-only, not folded into the shared parser: "put them
  // back in any order" legally includes leaving them in the SAME order, and "you may shuffle" is
  // optional, so resolving this as a no-op look plus the actual draw is fully legal here — but it
  // would be a real, unwanted downgrade for the live game, which can make an informed reorder choice
  // this fallback deliberately doesn't attempt.
  const ponderShapedDraw = !matched
    ? rawText.match(/\blook at the top [a-z\d]+ cards? of your library, then put (?:them|it) back in any order\.(?:\s*you may shuffle\.)?\s*draw (a|one|two|three|four|five|\d+) cards?\b/i)
    : null;
  if (ponderShapedDraw) {
    const amount = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5 }[ponderShapedDraw[1].toLowerCase()] ?? Number.parseInt(ponderShapedDraw[1], 10);
    if (Number.isFinite(amount) && amount > 0) {
      const seatName = working.seats.find((seat) => seat.id === casterSeatId)?.name ?? "Player";
      working = drawMultipleForSeat(working, casterSeatId, amount, `${seatName} looks at their library with ${sourceCard.name}, keeps it in order, and draws ${amount} card${amount === 1 ? "" : "s"}.`);
      matched = true;
    }
  }

  // Rule 500.7 extra turns — unconditional regardless of modal status in the source too.
  if (grantsExtraTurn(sourceCard.oracleText)) {
    working = { ...working, extraTurnsQueue: [...(working.extraTurnsQueue ?? []), casterSeatId] };
    matched = true;
  }

  // "Choose one/two — ..." for a modal card with no removal-shaped mode (parseRemovalEffect already
  // owns a modal card with one — see its own "modal" kind above).
  const genericModalEffect = isModalCard && !removalEffect ? parseGenericModalEffect(sourceCard.oracleText, chosenX) : undefined;
  if (genericModalEffect) {
    working = applyGenericModalEffect(working, casterSeatId, sourceCard, genericModalEffect);
    matched = true;
  }

  return { session: working, matched };
}

// Self-play's own auto-pick for a library search, deliberately NOT the live game's agent heuristic
// (chooseAgentLibraryCardForRuleChoice, AppFlow.tsx ~7705) — that function is a component-nested
// closure over setPendingRuleChoice/completeRuleChoice, the same "too React-coupled to hoist"
// situation as every other interactive-choice flow this orchestrator can't reach. Just takes the
// first `effect.count` library cards matching effect.cardTypeFilter in library order: this is about
// measuring effect COVERAGE (did the tutor do something instead of nothing), not simulating a smart
// choice, matching this file's existing "was it recognized" bar for every other bare-spell effect.
export function applySearchLibraryEffect(session: GameSession, casterSeatId: string, sourceCardName: string, effect: SearchLibraryEffect): GameSession {
  const seat = session.seats.find((item) => item.id === casterSeatId);
  if (!seat) return session;
  const library = seat.library ?? [];
  const eligible = effect.cardTypeFilter ? library.filter((card) => cardMatchesTypeFilter(card.typeLine, effect.cardTypeFilter!)) : library;
  const found = eligible.slice(0, effect.count);

  if (found.length === 0) {
    return {
      ...session,
      seats: session.seats.map((item) => (item.id === casterSeatId ? { ...item, library: shuffleCards(library) } : item)),
      events: [phaseEvent(casterSeatId, `${seat.name} searches with ${sourceCardName} but finds no ${effect.cardTypeFilter ?? "matching"} card, and shuffles.`), ...session.events]
    };
  }

  // Battlefield destination (Farseek-style land ramp, ...) reuses moveCardAcrossSeats — the same
  // shared library->battlefield primitive the live game's own zone effects already lean on (see its
  // SacrificeThenReanimate caller) — rather than duplicating battlefield-entry setup here. This only
  // places the card; it does NOT run the fetched permanent's own ETB triggers (a land landing on the
  // battlefield via a search almost never has one worth modeling here, and self-play has no generic
  // ETB-trigger pipeline at all regardless — see this file's own header gap list).
  if (effect.destination === "battlefield") {
    const working = found.reduce(
      (acc, card) => moveCardAcrossSeats(acc, casterSeatId, card.id, casterSeatId, "battlefield", { tapped: effect.tapped }).session,
      session
    );
    return {
      ...working,
      seats: working.seats.map((item) => (item.id === casterSeatId ? { ...item, library: shuffleCards(item.library ?? []) } : item)),
      events: [
        phaseEvent(
          casterSeatId,
          `${seat.name} searches with ${sourceCardName} and puts ${found.map((card) => card.name).join(", ")} onto the battlefield${effect.tapped ? " tapped" : ""}.`
        ),
        ...working.events
      ]
    };
  }

  const foundIds = new Set(found.map((card) => card.id));
  const remainingLibrary = shuffleCards(library.filter((card) => !foundIds.has(card.id)));
  const toHand = effect.destination !== "graveyard";
  const movedCards = found.map((card) => ({ ...card, zone: toHand ? ("hand" as const) : ("graveyard" as const) }));

  return {
    ...session,
    seats: session.seats.map((item) => {
      if (item.id !== casterSeatId) return item;
      return {
        ...item,
        library: remainingLibrary,
        board: {
          ...item.board,
          hand: toHand ? [...item.board.hand, ...movedCards] : item.board.hand,
          graveyard: toHand ? item.board.graveyard : [...(item.board.graveyard ?? []), ...movedCards]
        },
        zones: {
          ...item.zones,
          library: remainingLibrary.length,
          hand: toHand ? item.zones.hand + movedCards.length : item.zones.hand,
          graveyard: toHand ? item.zones.graveyard : item.zones.graveyard + movedCards.length
        }
      };
    }),
    events: [
      phaseEvent(
        casterSeatId,
        `${seat.name} searches with ${sourceCardName} and finds ${found.map((card) => card.name).join(", ")}, putting ${found.length === 1 ? "it" : "them"} into ${toHand ? "hand" : "the graveyard"}.`
      ),
      ...session.events
    ]
  };
}

function applyMainPhaseAction(
  session: GameSession,
  seatId: string,
  action: LegalAgentAction
): { session: GameSession; manaPayment?: AuditMeta["manaPayment"]; changed: boolean; spellEffectMatched?: boolean; spellEffectCardName?: string } {
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return { session, changed: false };

  if (action.actionType === "play_land" && action.cardId) {
    const next = playCardFromZone(session, seatId, action.cardId, `${seat.name} plays a land.`, undefined, "battlefield", [], "hand", action.faceIndex);
    return { session: next, changed: next !== session };
  }

  if (action.actionType === "cast_commander" && action.cardId) {
    const commander = seat.board.commander;
    if (!commander || commander.id !== action.cardId) return { session, changed: false };
    const totalCost =
      adjustedCastingCost(seat, commander, commander.manaValue, "command", session.activePlayerId, session.seats) + (commander.commanderTax ?? 0);
    const payment = chooseManaSourcesForCost(seat, commander, totalCost, undefined, session.seats);
    if (!payment.ok) return { session, changed: false };
    const destination = isPermanentTypeLine(commander.typeLine) ? "battlefield" : "graveyard";
    const next = playCardFromZone(session, seatId, commander.id, `${seat.name} casts their commander ${commander.name}.`, undefined, destination, payment.sourceIds, "command", undefined);
    if (destination === "graveyard" && next !== session) {
      const resolved = resolveBareSpellEffect(next, seatId, commander, undefined);
      return {
        session: resolved.session,
        manaPayment: { seatId, sourceIds: payment.sourceIds, totalCost },
        changed: true,
        spellEffectMatched: resolved.matched,
        spellEffectCardName: commander.name
      };
    }
    return { session: next, manaPayment: { seatId, sourceIds: payment.sourceIds, totalCost }, changed: next !== session };
  }

  if (action.actionType === "cast_spell" && action.cardId) {
    const card = seat.board.hand.find((item) => item.id === action.cardId);
    if (!card) return { session, changed: false };
    const fixedCost = adjustedCastingCost(seat, card, card.manaValue, "hand", session.activePlayerId, session.seats);
    const chosenX = maxAffordableX(seat, card, fixedCost);
    const totalCost = totalCastingCost(seat, card, card.manaValue, chosenX);
    const payment = chooseManaSourcesForCost(seat, card, totalCost, undefined, session.seats);
    if (!payment.ok) return { session, changed: false };
    const destination = isPermanentTypeLine(card.typeLine) ? "battlefield" : "graveyard";
    // "As an additional cost to cast this spell, discard a card." (Unexpected Windfall) — paid at cast
    // time, before the spell leaves the hand, same as the live game (601.2h).
    const costPaid = payAdditionalDiscardCost(session, seatId, card);
    const next = playCardFromZone(costPaid, seatId, card.id, `${seat.name} casts ${card.name}.`, undefined, destination, payment.sourceIds, "hand", undefined);
    if (destination === "graveyard" && next !== session) {
      const resolved = resolveBareSpellEffect(next, seatId, card, chosenX);
      return {
        session: resolved.session,
        manaPayment: { seatId, sourceIds: payment.sourceIds, totalCost },
        changed: true,
        spellEffectMatched: resolved.matched,
        spellEffectCardName: card.name
      };
    }
    // Giada, Font of Hope-style "each other Angel you control enters with an additional +1/+1 counter".
    const withReplacementCounters = destination === "battlefield" && next !== session ? applyEntersWithCounterReplacements(next, seatId, card.id) : next;
    return { session: withReplacementCounters, manaPayment: { seatId, sourceIds: payment.sourceIds, totalCost }, changed: next !== session };
  }

  // pass_priority / end_turn / anything unrecognized: no session change, handled by the caller
  // (both just end this seat's main-phase decision loop for this phase; see gap notes on end_turn
  // not additionally skipping combat, a deliberate simplification documented in the report).
  return { session, changed: false };
}

async function runMainPhase(
  session: GameSession,
  seatId: string,
  brain: Brain,
  landPlaysThisTurn: Set<string>,
  recordDecision: (seatId: string, source: string) => void,
  afterAction: (prev: GameSession, next: GameSession, meta: AuditMeta) => void,
  recordSpellCoverage: (matched: boolean, cardName: string) => void
): Promise<GameSession> {
  let guard = 0;
  const activatedLoyaltyKeys = new Set<string>();
  while (guard < MAX_MAIN_PHASE_ACTIONS) {
    guard += 1;
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat || seat.hasLost) break;
    const hasPlayedLand = landPlaysThisTurn.has(`${seatId}:${session.turn}`);
    const rawActions = legalMainPhaseActions(seat, hasPlayedLand, session.activePlayerId, session.turn, activatedLoyaltyKeys, session);
    const legalActions = filterSupportedMainPhaseActions(rawActions, seat);
    const context = buildScoringContext(session, seatId, "main_phase");
    const decision = await brain({ seatId, seatName: seat.name, purpose: "main_phase", legalActions, context });
    recordDecision(seatId, decision.source);
    const legal = legalActions.find((item) => item.id === decision.action.legalActionId);
    if (!legal || legal.actionType === "pass_priority" || legal.actionType === "end_turn") break;

    const prev = session;
    const applied = applyMainPhaseAction(session, seatId, legal);
    if (!applied.changed) {
      // Enumerator offered it, but applying it produced no change (e.g. a payment that the
      // enumerator thought was legal turned out not to be at apply time) — don't loop forever
      // re-offering the same dead option; treat this decision as a pass instead.
      break;
    }
    if (legal.actionType === "play_land") landPlaysThisTurn.add(`${seatId}:${session.turn}`);
    if (applied.spellEffectMatched !== undefined && applied.spellEffectCardName !== undefined) {
      recordSpellCoverage(applied.spellEffectMatched, applied.spellEffectCardName);
    }
    session = runStateBasedActionsPass(applied.session).session;
    afterAction(prev, session, {
      seatId,
      turn: session.turn,
      phase: session.phase,
      actionType: legal.actionType,
      actionLabel: legal.label,
      cardId: legal.cardId,
      manaPayment: applied.manaPayment
    });
    if (session.status === "complete") break;
  }
  return session;
}

// Minimal attack declaration — see gap #4 in the file header for exactly what this omits relative to
// AppFlow.tsx's own (unhoistable) declareAttack.
function applyAttackDeclaration(
  session: GameSession,
  seatId: string,
  cardId: string,
  targetId: string | undefined
): { session: GameSession; manaPayment?: AuditMeta["manaPayment"] } {
  const attacker = session.seats.find((seat) => seat.id === seatId);
  if (!attacker) return { session };
  const attackingCard = attacker.board.battlefield.find((card) => card.id === cardId);
  const target = resolveAttackTarget(session, targetId);
  if (!attackingCard || !target) return { session };

  const tax = totalAttackTax(target.seat, Boolean(target.planeswalker));
  let working = session;
  let manaPayment: AuditMeta["manaPayment"];
  if (tax > 0) {
    const taxCard = genericCostShim(tax);
    const payment = chooseManaSourcesForCost(attacker, taxCard, tax, undefined, session.seats);
    if (!payment.ok) return { session };
    working = { ...working, seats: working.seats.map((seat) => (seat.id === seatId ? spendManaSources(seat, payment.sourceIds) : seat)) };
    manaPayment = { seatId, sourceIds: payment.sourceIds, totalCost: tax };
  }

  const staysUntapped = hasVigilance(attackingCard);
  const targetLabel = target.planeswalker ? `${target.planeswalker.name} (${target.seat.name})` : target.seat.name;
  const nextSession: GameSession = {
    ...working,
    seats: working.seats.map((seat) =>
      seat.id === seatId
        ? {
            ...seat,
            board: {
              ...seat.board,
              battlefield: seat.board.battlefield.map((card) =>
                card.id === cardId
                  ? { ...card, attacking: true, tapped: staysUntapped ? card.tapped : true, attackTargetId: target.planeswalker?.id ?? target.seat.id }
                  : card
              )
            }
          }
        : seat
    ),
    events: [phaseEvent(seatId, `${attacker.name} attacks ${targetLabel} with ${attackingCard.name}.`), ...working.events]
  };
  return { session: nextSession, manaPayment };
}

async function runDeclareAttackersStep(
  session: GameSession,
  seatId: string,
  brain: Brain,
  recordDecision: (seatId: string, source: string) => void,
  afterAction: (prev: GameSession, next: GameSession, meta: AuditMeta) => void
): Promise<GameSession> {
  let guard = 0;
  while (guard < MAX_ATTACK_DECLARATIONS) {
    guard += 1;
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat || seat.hasLost) break;
    const opponents = session.seats.filter((item) => item.id !== seatId && !item.hasLost);
    const legalActions = legalAttackActions(seat, opponents);
    if (!legalActions.some((item) => item.actionType === "attack")) break;
    const context = buildScoringContext(session, seatId, "declare_attackers");
    const decision = await brain({ seatId, seatName: seat.name, purpose: "declare_attackers", legalActions, context });
    recordDecision(seatId, decision.source);
    const legal = legalActions.find((item) => item.id === decision.action.legalActionId);
    if (!legal || legal.actionType !== "attack" || !legal.cardId) break;

    const prev = session;
    const applied = applyAttackDeclaration(session, seatId, legal.cardId, legal.targetIds[0]);
    if (applied.session === session) break;
    session = runStateBasedActionsPass(applied.session).session;
    afterAction(prev, session, {
      seatId,
      turn: session.turn,
      phase: session.phase,
      actionType: "attack",
      actionLabel: legal.label,
      cardId: legal.cardId,
      manaPayment: applied.manaPayment
    });
    if (session.status === "complete") break;
  }
  return session;
}

function findNextBlockChoice(session: GameSession, attackerSeatId: string): { attackerSeatId: string; defenderSeatId: string; attackerCardId: string; targetId: string } | undefined {
  const attacker = session.seats.find((seat) => seat.id === attackerSeatId);
  const attackingCard = attacker?.board.battlefield.find((card) => card.attacking && !card.blockDecided);
  if (!attacker || !attackingCard) return undefined;
  const target = resolveAttackTarget(session, attackingCard.attackTargetId);
  if (!target) return undefined;
  return {
    attackerSeatId: attacker.id,
    defenderSeatId: target.seat.id,
    attackerCardId: attackingCard.id,
    targetId: attackingCard.attackTargetId ?? target.seat.id
  };
}

async function runDeclareBlockersStep(
  session: GameSession,
  attackerSeatId: string,
  brains: Record<string, Brain>,
  recordDecision: (seatId: string, source: string) => void,
  afterAction: (prev: GameSession, next: GameSession, meta: AuditMeta) => void
): Promise<GameSession> {
  let guard = 0;
  while (guard < MAX_BLOCK_DECLARATIONS) {
    guard += 1;
    const choice = findNextBlockChoice(session, attackerSeatId);
    if (!choice) break;
    const defenderSeat = session.seats.find((seat) => seat.id === choice.defenderSeatId);
    const brain = brains[choice.defenderSeatId];
    if (!defenderSeat || !brain) break;

    const chosenBlockerIds: string[] = [];
    let innerGuard = 0;
    while (innerGuard < MAX_BLOCKERS_PER_ATTACKER) {
      innerGuard += 1;
      const rawActions = legalBlockActions(session, choice).filter((item) => item.actionType !== "block" || !chosenBlockerIds.includes(item.cardId ?? ""));
      if (!rawActions.some((item) => item.actionType === "block")) break;
      const purpose = chosenBlockerIds.length > 0 ? "declare_blockers_additional" : "declare_blockers";
      const context = buildScoringContext(session, choice.defenderSeatId, purpose);
      const decision = await brain({ seatId: choice.defenderSeatId, seatName: defenderSeat.name, purpose, legalActions: rawActions, context });
      recordDecision(choice.defenderSeatId, decision.source);
      const legal = rawActions.find((item) => item.id === decision.action.legalActionId);
      if (!legal || legal.actionType !== "block" || !legal.cardId) break;
      chosenBlockerIds.push(legal.cardId);
    }

    const prev = session;
    session = assignBlockers(session, choice, chosenBlockerIds);
    session = runStateBasedActionsPass(session).session;
    afterAction(prev, session, {
      seatId: choice.defenderSeatId,
      turn: session.turn,
      phase: session.phase,
      actionType: "block",
      actionLabel: `${chosenBlockerIds.length} blocker(s) for ${choice.attackerCardId}`,
      cardId: choice.attackerCardId
    });
    if (session.status === "complete") break;
  }
  return session;
}

export async function playGame(session: GameSession, brains: Record<string, Brain>, opts: SelfPlayOptions = {}): Promise<PlayGameResult> {
  const turnCapPerSeat = opts.turnCap ?? 60;
  const timeoutMs = opts.timeoutMs ?? 60000;
  const startedAt = Date.now();

  const auditState: AuditState = createAuditState(session);
  const anomalyState: AnomalyState = createAnomalyState();
  const decisionCounts: DecisionCounts = {};
  const landPlaysThisTurn = new Set<string>();
  const spellEffectCoverage = { matched: 0, unmatched: 0 };
  const unmatchedSpellCards: Record<string, number> = {};

  function recordDecision(seatId: string, source: string) {
    decisionCounts[seatId] ??= {};
    decisionCounts[seatId][source] = (decisionCounts[seatId][source] ?? 0) + 1;
  }

  function recordSpellCoverage(matched: boolean, cardName: string) {
    if (matched) {
      spellEffectCoverage.matched += 1;
    } else {
      spellEffectCoverage.unmatched += 1;
      unmatchedSpellCards[cardName] = (unmatchedSpellCards[cardName] ?? 0) + 1;
    }
  }

  function afterAction(prev: GameSession, next: GameSession, meta: AuditMeta) {
    auditAfterAction(auditState, next, meta, opts.strict ?? false);
    scanForAnomalies(anomalyState, prev, next, meta);
  }

  let phaseIndex = 0;
  let activeIndex = Math.max(0, session.seats.findIndex((seat) => seat.id === session.activePlayerId));
  let internalTurns = 0;
  let terminationReason: PlayGameResult["terminationReason"] = "turn-cap";

  try {
    while (session.status !== "complete" && internalTurns < turnCapPerSeat * session.seats.length) {
      if (Date.now() - startedAt > timeoutMs) {
        terminationReason = "timeout";
        break;
      }

      const phase: TurnPhase = TURN_PHASES[phaseIndex];
      const activeSeat = session.seats[activeIndex];
      session = { ...session, phase, activePlayerId: activeSeat.id };

      if (activeSeat.hasLost) {
        // A "loser stays in the rotation" seat (see nextInRotation's own comment on AppFlow.tsx) —
        // in a 2-player mirror this can't actually happen mid-game (the game completes the instant
        // one seat loses), kept only for forward-compatibility with a >2-seat self-play run later.
      } else {
        switch (phase) {
          case "untap step": {
            const prev = session;
            session = untapForSeat(session, activeSeat.id);
            afterAction(prev, session, { seatId: activeSeat.id, turn: session.turn, phase, actionType: "phase:untap" });
            break;
          }
          case "upkeep step": {
            const prev = session;
            session = resolvePendingUpkeepDraws(session);
            session = runStateBasedActionsPass(session).session;
            afterAction(prev, session, { seatId: activeSeat.id, turn: session.turn, phase, actionType: "phase:upkeep" });
            break;
          }
          case "draw step": {
            const prev = session;
            session = drawForSeat(session, activeSeat.id, `${activeSeat.name} draws for turn.`);
            session = runStateBasedActionsPass(session).session;
            afterAction(prev, session, { seatId: activeSeat.id, turn: session.turn, phase, actionType: "phase:draw" });
            break;
          }
          case "precombat main phase":
          case "postcombat main phase": {
            session = await runMainPhase(session, activeSeat.id, brains[activeSeat.id], landPlaysThisTurn, recordDecision, afterAction, recordSpellCoverage);
            break;
          }
          case "beginning of combat step":
            break;
          case "declare attackers step": {
            session = await runDeclareAttackersStep(session, activeSeat.id, brains[activeSeat.id], recordDecision, afterAction);
            break;
          }
          case "declare blockers step": {
            session = await runDeclareBlockersStep(session, activeSeat.id, brains, recordDecision, afterAction);
            break;
          }
          case "combat damage step": {
            const prev = session;
            session = resolveCombatDamage(session, activeSeat.id);
            session = runStateBasedActionsPass(session).session;
            afterAction(prev, session, { seatId: activeSeat.id, turn: session.turn, phase, actionType: "phase:combat_damage" });
            break;
          }
          case "end of combat step": {
            const prev = session;
            session = cleanupCombat(session, activeSeat.id);
            afterAction(prev, session, { seatId: activeSeat.id, turn: session.turn, phase, actionType: "phase:end_of_combat" });
            break;
          }
          case "end step":
          case "cleanup step":
            break;
        }
      }

      if (session.status === "complete") {
        terminationReason = "win";
        break;
      }

      phaseIndex += 1;
      if (phaseIndex >= TURN_PHASES.length) {
        phaseIndex = 0;
        activeIndex = (activeIndex + 1) % session.seats.length;
        session = { ...session, turn: session.turn + 1 };
        internalTurns += 1;
      }
    }
  } catch (error) {
    // Strict mode's whole point is to halt immediately and hand the caller (scripts/self-play.ts)
    // the session to dump for debugging — that's a deliberate stop, not an unexpected engine crash,
    // so it's rethrown rather than folded into the "crash" termination reason below.
    if (error instanceof SelfPlayStrictViolationError) throw error;
    terminationReason = "crash";
    return {
      session,
      winnerSeatId: session.winnerSeatId,
      turns: internalTurns,
      decisionCounts,
      terminationReason,
      violations: auditState.violations,
      wallClockMs: Date.now() - startedAt,
      spellEffectCoverage,
      unmatchedSpellCards,
      anomalies: anomalyState.anomalies
    };
  }

  return {
    session,
    winnerSeatId: session.winnerSeatId,
    turns: internalTurns,
    decisionCounts,
    terminationReason,
    violations: auditState.violations,
    wallClockMs: Date.now() - startedAt,
    spellEffectCoverage,
    unmatchedSpellCards,
    anomalies: anomalyState.anomalies
  };
}
