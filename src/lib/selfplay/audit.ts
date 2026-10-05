// Milestone 2 of the self-play plan — the rules-integrity audit. Runs after every action the
// orchestrator applies and flags (default: flag-and-continue, never halts) anything that looks like
// the engine did something a real game of Magic couldn't. This is the actual deliverable of
// milestone 2: a win-rate number from a run containing violations is untrustworthy (see the plan's
// "why win rate alone is not enough"), so this module exists to produce the violation count, not
// the win rate.
import type { GameSession, PlayerSeat } from "@/lib/types";

export type AuditCheck =
  | "card_conservation"
  | "mana_payment"
  | "land_drop"
  | "combat_attacker"
  | "combat_blocker"
  | "life_loss"
  | "liveness";

export interface AuditViolation {
  check: AuditCheck;
  seatId?: string;
  turn: number;
  phase: string;
  // What the orchestrator had just applied when this was detected — e.g. "cast_spell:Sol Ring" or
  // "phase:combat damage step" — not a full action object, since the point is a human-readable trail
  // through a JSONL log, not a byte-for-byte replay.
  precedingAction: string;
  message: string;
  // A trimmed snapshot, not the whole GameSession (that would make the JSONL output unusable at any
  // real game count) — just enough to see what was actually going on: both seats' life/hand size/
  // battlefield size, and whichever single seat this violation is about, in more detail.
  snapshot: unknown;
}

export interface AuditMeta {
  seatId?: string;
  turn: number;
  phase: string;
  actionType: string;
  actionLabel?: string;
  cardId?: string;
  // Present only for a cast/attack-tax payment the orchestrator just applied — lets the mana check
  // verify the specific sources it claims to have spent actually left play/got tapped, rather than
  // re-deriving "what should have been paid" from scratch (which would just re-run
  // chooseManaSourcesForCost and trivially agree with itself).
  manaPayment?: { seatId: string; sourceIds: string[]; totalCost: number };
}

export class SelfPlayStrictViolationError extends Error {
  constructor(
    public readonly violations: AuditViolation[],
    public readonly session: GameSession
  ) {
    super(`Self-play audit violation(s) in strict mode: ${violations.map((violation) => `[${violation.check}] ${violation.message}`).join("; ")}`);
    this.name = "SelfPlayStrictViolationError";
  }
}

interface SeatCardTotal {
  seatId: string;
  // Every card OWNED by this seat, once, across every zone it could be in — library, hand,
  // battlefield (excluding tokens, which are created from nothing and aren't part of the original
  // count; and counted by ownerSeatId, not which seat's board.battlefield array currently holds it —
  // see countNonTokenCards' own comment on why, since a control-change effect is real now),
  // graveyard, exile, and the command zone (0 or 1, for a not-yet-cast/returned commander). Captured
  // once at game start; checked to still hold after every single action for the rest of the game —
  // this engine expects EXACT conservation, not "only changes via known effects," since self-play's
  // cast->resolve flow only ever creates a NEW card via a known, auditable token effect.
  total: number;
}

interface PhaseLivenessTracker {
  key: string; // `${seatId}:${turn}:${phase}`
  lastSnapshot: string;
  repeats: number;
}

export interface AuditState {
  violations: AuditViolation[];
  initialCardTotals: SeatCardTotal[];
  landDropsBySeatTurn: Map<string, number>;
  livenessBySeat: Map<string, PhaseLivenessTracker>;
}

// Counts every non-token card OWNED by ownerSeatId, scanning every seat's zones — not just
// ownerSeatId's own — because milestone 3's resolveBareSpellEffect (src/lib/selfplay/orchestrator.ts)
// made zoneEffect's "gain_control" kind (Threaten-style "gain control of target creature" spells)
// a real, reachable effect in self-play for the first time. changeControlWithinBattlefield
// (AppFlow.tsx:12299) correctly moves a stolen permanent into the NEW controller's board.battlefield
// array while preserving its ownerSeatId — that's correct Magic rules behaviour (control and
// ownership are different, rule 108.4), but the original per-seat-own-zones version of this function
// (written when no instant/sorcery effect actually did anything yet, see its own stale comment on
// AuditState.initialCardTotals) implicitly assumed a card only ever sits in its owner's zones, so a
// legitimate control change looked identical to "a card was created out of nowhere" for the new
// controller and "a card vanished" for the original owner. Reported by this milestone's own Ollama
// matchup run: 64 card_conservation violations in a single game, all traced to one gain_control cast
// (Sable's non-token total read 101/100, Veyra's read 99/100 — a stolen-card-shaped off-by-one on
// both sides at once, not a real duplication/destruction bug). Every OTHER zone a card can be in
// (library/hand/graveyard/exile/command) never crosses seat boundaries in this engine, so scanning
// those under their own seat is still correct; only battlefield needs the ownerSeatId indirection.
function countNonTokenCards(session: GameSession, ownerSeatId: string): number {
  let total = 0;
  for (const seat of session.seats) {
    if (seat.id === ownerSeatId) {
      total += (seat.library?.length ?? 0) + seat.board.hand.length + (seat.board.graveyard ?? []).filter((card) => !card.token).length + (seat.board.exile ?? []).filter((card) => !card.token).length;
      if (seat.board.commander && !seat.board.commander.token) total += 1;
    }
    total += seat.board.battlefield.filter((card) => !card.token && (card.ownerSeatId ?? seat.id) === ownerSeatId).length;
  }
  return total;
}

function seatSummary(seat: PlayerSeat) {
  return {
    id: seat.id,
    name: seat.name,
    life: seat.life,
    hasLost: seat.hasLost,
    lossReason: seat.lossReason,
    poison: seat.poison,
    handSize: seat.board.hand.length,
    battlefieldSize: seat.board.battlefield.length,
    librarySize: seat.library?.length ?? 0,
    graveyardSize: seat.board.graveyard?.length ?? 0
  };
}

function snapshotFor(session: GameSession, seatId?: string) {
  return {
    turn: session.turn,
    phase: session.phase,
    seats: session.seats.map(seatSummary),
    focusSeatId: seatId
  };
}

export function createAuditState(initialSession: GameSession): AuditState {
  return {
    violations: [],
    initialCardTotals: initialSession.seats.map((seat) => ({ seatId: seat.id, total: countNonTokenCards(initialSession, seat.id) })),
    landDropsBySeatTurn: new Map(),
    livenessBySeat: new Map()
  };
}

function pushViolation(state: AuditState, session: GameSession, meta: AuditMeta, check: AuditCheck, message: string) {
  state.violations.push({
    check,
    seatId: meta.seatId,
    turn: meta.turn,
    phase: meta.phase,
    precedingAction: meta.cardId ? `${meta.actionType}:${meta.cardId}` : meta.actionType,
    message,
    snapshot: snapshotFor(session, meta.seatId)
  });
}

// Rule 508.1a-ish: an attacker must have been untapped, not summoning sick (unless it has haste),
// and not already attacking, at the moment it's declared. By the time this check runs, the
// orchestrator has already SET attacking:true/tapped:true on the card being audited, so this checks
// the post-condition shape (attacking creatures should never simultaneously read as
// summoningSick:true with no haste-granting text, since canAttack in AppFlow.tsx would have refused
// to offer them) rather than re-deriving legality from scratch — this audit's job is to catch the
// engine disagreeing with itself, not to re-implement canAttack a second time.
function auditCombatAttackers(state: AuditState, session: GameSession, meta: AuditMeta) {
  for (const seat of session.seats) {
    for (const card of seat.board.battlefield) {
      if (!card.attacking) continue;
      if (card.summoningSick && !/\bhaste\b/i.test(card.oracleText) && !card.grantedKeywords?.some((keyword) => keyword.toLowerCase() === "haste")) {
        pushViolation(state, session, { ...meta, seatId: seat.id }, "combat_attacker", `${card.name} (${seat.name}) is attacking while summoning sick with no haste.`);
      }
      if (card.tapped && !/\bvigilance\b/i.test(card.oracleText) && !card.grantedKeywords?.some((keyword) => keyword.toLowerCase() === "vigilance")) {
        // Tapped-while-attacking is actually the NORMAL case (attacking taps a creature) — this is
        // only a violation if the card was ALREADY tapped before this specific attack declaration,
        // which this generic post-hoc check can't distinguish on its own. Left as a documented
        // non-check: see the orchestrator's own applyAttackDeclaration, which refuses to attack with
        // an already-tapped, non-vigilant creature in the first place (mirroring canAttack), so a
        // violation here would only ever be secondary to an already-caught bug upstream.
      }
    }
  }
}

function auditCombatBlockers(state: AuditState, session: GameSession, meta: AuditMeta) {
  for (const seat of session.seats) {
    for (const card of seat.board.battlefield) {
      if (!card.blocking) continue;
      if (card.tapped) {
        pushViolation(state, session, { ...meta, seatId: seat.id }, "combat_blocker", `${card.name} (${seat.name}) is blocking while tapped.`);
      }
      if (!card.typeLine.includes("Creature") && !card.grantedTypes?.includes("Creature")) {
        pushViolation(state, session, { ...meta, seatId: seat.id }, "combat_blocker", `${card.name} (${seat.name}) is blocking but isn't a creature.`);
      }
    }
  }
}

function auditCardConservation(state: AuditState, session: GameSession, meta: AuditMeta) {
  for (const expected of state.initialCardTotals) {
    const seat = session.seats.find((item) => item.id === expected.seatId);
    if (!seat) continue;
    const actual = countNonTokenCards(session, seat.id);
    if (actual !== expected.total) {
      pushViolation(
        state,
        session,
        { ...meta, seatId: seat.id },
        "card_conservation",
        `${seat.name}'s non-token card total is ${actual}, expected ${expected.total} (library+hand+battlefield+graveyard+exile+command). A card was created, destroyed, or double-counted outside a token effect.`
      );
    }
  }
}

// One land per turn per seat (rule 305.2a), unless a "you may play an additional land" effect is in
// play. meta.actionType === "play_land" fires once per successful land play (see the orchestrator's
// applyMainPhaseAction) — this just counts them per (seat, turn) and flags the second one, since
// legalMainPhaseActions itself is supposed to stop offering play_land once hasPlayedLand is true,
// so a second one getting through and applied cleanly would mean that gate silently failed.
function auditLandDrop(state: AuditState, session: GameSession, meta: AuditMeta) {
  if (meta.actionType !== "play_land" || !meta.seatId) return;
  const key = `${meta.seatId}:${meta.turn}`;
  const count = (state.landDropsBySeatTurn.get(key) ?? 0) + 1;
  state.landDropsBySeatTurn.set(key, count);
  if (count <= 1) return;
  const seat = session.seats.find((item) => item.id === meta.seatId);
  const grantsExtraLand = seat?.board.battlefield.some((card) => /play an additional land/i.test(card.oracleText)) ?? false;
  if (grantsExtraLand) return;
  pushViolation(state, session, meta, "land_drop", `${seat?.name ?? meta.seatId} played land #${count} this turn with no "additional land" effect in play.`);
}

// A cast's cost was actually paid: every sourceId the orchestrator's own chooseManaSourcesForCost
// chose is now tapped (or gone, for a sacrifice-to-tap source like a Treasure — see
// spendManaSources' own comment on isSacrificeManaSource), and the payment's totalCost is never
// negative (this engine has no floating mana pool for agent seats — see the orchestrator's own doc
// comment on why — so "never negative" here means "chooseManaSourcesForCost never returned ok:true
// for a cost below 0", which the cost-computation call sites already guard against; this check exists
// so a future regression there doesn't silently start paying negative costs unnoticed).
function auditManaPayment(state: AuditState, session: GameSession, meta: AuditMeta) {
  if (!meta.manaPayment) return;
  const { seatId, sourceIds, totalCost } = meta.manaPayment;
  if (totalCost < 0) {
    pushViolation(state, session, { ...meta, seatId }, "mana_payment", `Computed a negative total cost (${totalCost}) for ${meta.actionType}:${meta.cardId ?? "?"}.`);
    return;
  }
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return;
  for (const sourceId of sourceIds) {
    const stillOnBattlefield = seat.board.battlefield.find((card) => card.id === sourceId);
    // A sacrifice-to-tap source (Treasure, ...) is expected to be GONE, not tapped — spendManaSources
    // already knows which; this audit only has the post-state, so "gone" always passes and "still
    // present but untapped" is what's actually wrong.
    if (stillOnBattlefield && !stillOnBattlefield.tapped) {
      pushViolation(
        state,
        session,
        { ...meta, seatId },
        "mana_payment",
        `${seat.name}'s mana source ${stillOnBattlefield.name} (${sourceId}) was claimed as spent for ${meta.actionType}:${meta.cardId ?? "?"} but is still untapped.`
      );
    }
  }
}

// hasLost must never disagree with runStateBasedActionsPass's own criteria (life<=0, 21+ commander
// damage from one commander, 10+ poison, empty-library draw — see AppFlow.tsx's SBA pass and
// drawForSeat). Since the orchestrator calls the REAL exported runStateBasedActionsPass after every
// action (never its own copy), a disagreement here would mean hasLost got set some OTHER way — which
// would be exactly the kind of engine bug this whole harness exists to catch.
function auditLifeAndLoss(state: AuditState, session: GameSession, meta: AuditMeta) {
  for (const seat of session.seats) {
    if (!seat.hasLost) continue;
    const byLife = seat.life <= 0;
    const byCommanderDamage = Object.values(seat.commanderDamage ?? {}).some((amount) => amount >= 21);
    const byPoison = (seat.poison ?? 0) >= 10;
    const byEmptyLibrary = seat.lossReason === "drew from an empty library";
    if (!byLife && !byCommanderDamage && !byPoison && !byEmptyLibrary) {
      pushViolation(
        state,
        session,
        { ...meta, seatId: seat.id },
        "life_loss",
        `${seat.name} has hasLost:true (reason: "${seat.lossReason ?? "none given"}") but matches none of the SBA loss criteria (life ${seat.life}, commanderDamage ${JSON.stringify(seat.commanderDamage)}, poison ${seat.poison ?? 0}).`
      );
    }
  }
}

// Stall/infinite-loop detector: if the SAME (seat, turn, phase) triple keeps producing identical
// board snapshots across repeated calls (e.g. a main-phase decision loop that keeps "choosing" an
// action that changes nothing), something is looping without making progress. Cheap JSON-based
// fingerprint rather than a real hash — session objects here are small enough (one game, two seats)
// that this is fast, and exactness matters more than speed for a check that only runs when the
// orchestrator's own loop guards (MAX_MAIN_PHASE_ACTIONS etc.) are already suspiciously close to
// their cap.
function auditLiveness(state: AuditState, session: GameSession, meta: AuditMeta) {
  if (!meta.seatId) return;
  const key = `${meta.seatId}:${meta.turn}:${meta.phase}`;
  // blockDecided (set by assignBlockers, AppFlow.tsx) has to be part of the fingerprint, not just
  // tapped/attacking/blocking — a defender declaring "no blockers" for an attacker changes NOTHING
  // else on that attacker (it was already tapped from attacking, stays not-blocking), so a wide
  // combat with more unblocked attackers than the repeat threshold below (5+ creatures attacking into
  // a single blocker, or none) produced an IDENTICAL fingerprint for every one of those legitimate,
  // real per-attacker resolutions and falsely tripped this detector as a "stall." Reproduced live:
  // `--strict` halting on turn 15's declare blockers step with 6 real attackers (Grim Haruspex,
  // Sakura-Tribe Elder, Shriekmaw, Caustic Caterpillar, Midnight Reaper, Merciless Executioner) each
  // legitimately resolving to "no blockers" one at a time against a single blocker — every one of
  // this run's "liveness" violations against declare blockers step was this same false positive, not
  // a real engine loop.
  const fingerprint = JSON.stringify(
    session.seats.map((seat) => ({ life: seat.life, hand: seat.board.hand.length, bf: seat.board.battlefield.map((card) => `${card.id}:${card.tapped}:${card.attacking}:${card.blocking}:${card.blockDecided}`) }))
  );
  const existing = state.livenessBySeat.get(key);
  if (!existing || existing.lastSnapshot !== fingerprint) {
    state.livenessBySeat.set(key, { key, lastSnapshot: fingerprint, repeats: 0 });
    return;
  }
  existing.repeats += 1;
  if (existing.repeats === 5) {
    pushViolation(state, session, meta, "liveness", `${meta.phase} (turn ${meta.turn}) for seat ${meta.seatId} produced 5 consecutive identical board states with no visible progress — possible stall.`);
  }
}

// The single entry point the orchestrator calls after every action it applies. Default behavior is
// flag-and-continue: violations accumulate on state.violations and this function never throws.
// Pass strict:true to make the FIRST violation from this call throw SelfPlayStrictViolationError
// instead (self-play.ts's --strict flag), which halts the game and dumps the session for debugging.
export function auditAfterAction(state: AuditState, session: GameSession, meta: AuditMeta, strict = false): AuditViolation[] {
  const before = state.violations.length;
  auditCardConservation(state, session, meta);
  auditManaPayment(state, session, meta);
  auditLandDrop(state, session, meta);
  auditCombatAttackers(state, session, meta);
  auditCombatBlockers(state, session, meta);
  auditLifeAndLoss(state, session, meta);
  auditLiveness(state, session, meta);
  const fresh = state.violations.slice(before);
  if (strict && fresh.length > 0) {
    throw new SelfPlayStrictViolationError(fresh, session);
  }
  return fresh;
}
