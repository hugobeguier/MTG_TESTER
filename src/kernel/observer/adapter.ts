// Adapter: legacy GameSession -> kernel GameState (read-only, pure apart from the card lookup cache). See README.md for the coverage table.
//
// The legacy engine has no object identity beyond VisibleCard.id, no stack and no priority, so the adapter builds a kernel "snapshot":
//   - every card of every zone becomes a kernel object ("#n", numbered in a fixed order: per seat library, hand, graveyard, exile, command,
//     battlefield sorted by the legacy layer timestamp), `ids` maps legacy id <-> kernel id;
//   - the stack is always empty and priority is the active player's (the legacy self-play engine resolves spells instantly);
//   - everything the kernel recomputes from card text (keywords, attachments' bonuses, static P/T) is NOT copied: only the legacy facts that are
//     not derivable (zone, tapped, counters, damage, temporary until-end-of-turn effects, attachments, commander data).
// Data the adapter cannot represent is recorded in `gaps` (adapter_gap diffs) and listed in ADAPTER_COVERAGE.
import type { GameSession, PlayerSeat, VisibleCard } from "../../lib/types";
import type { Ability } from "../schema";
import type { Attacker, ContinuousEffect, GameObject, GameState, ObjId, PlayerState, TokenDef } from "../engine/types";
import type { DraftLookup } from "./draftLookup";
import { parseTypeLine } from "./draftLookup";

export const LEGACY_TO_KERNEL_PHASE: Record<string, GameState["turn"]["phase"]> = {
  "untap step": "untap",
  "upkeep step": "upkeep",
  "draw step": "draw",
  "precombat main phase": "precombat_main",
  "beginning of combat step": "beginning_of_combat",
  "declare attackers step": "declare_attackers",
  "declare blockers step": "declare_blockers",
  "combat damage step": "combat_damage",
  "end of combat step": "end_of_combat",
  "postcombat main phase": "postcombat_main",
  "end step": "end_step",
  "cleanup step": "cleanup"
};

export interface AdaptOptions {
  lookup: DraftLookup;
  seed?: number;
  /** kernel config.skipFirstDraw (default: 2 seats = true, like newGame) */
  skipFirstDraw?: boolean;
  /** run the kernel with lenient abilities (default false: strict, so unsupported abilities show up as capabilities) */
  lenient?: boolean;
}

export interface AdapterGap { field: string; count: number; examples: string[] }

export interface AdaptResult {
  state: GameState;
  /** legacy card id -> kernel object id, and back */
  toKernel: Map<string, ObjId>;
  toLegacy: Map<ObjId, string>;
  /** legacy card id -> VisibleCard (for names / labels) */
  legacyCards: Map<string, VisibleCard>;
  gaps: AdapterGap[];
  /** card names of the session that have no draft */
  noDraft: string[];
}

/** What is and is not mapped, for the README / report. status: mapped | approximate | unmapped. */
export const ADAPTER_COVERAGE: Array<{ legacy: string; kernel: string; status: "mapped" | "approximate" | "unmapped"; note?: string }> = [
  { legacy: "seat.id / name / life / hasLost", kernel: "players[].id/name/life/hasLost", status: "mapped" },
  { legacy: "seat.library (index 0 = top), board.hand, board.graveyard, board.exile", kernel: "players[].library/hand/graveyard/exile", status: "mapped", note: "order kept; library order of the legacy engine is assumed to be top-first" },
  { legacy: "board.commander / commander flag / commanderTax", kernel: "command zone + isCommander + commanderCasts (tax / 2)", status: "mapped" },
  { legacy: "seat.commanderDamage (by commander card id)", kernel: "state.commanderDamage[victim][commanderId]", status: "mapped" },
  { legacy: "board.battlefield cards: tapped, counters, damage, token, owner/controller", kernel: "GameObject", status: "mapped" },
  { legacy: "ownerSeatId", kernel: "GameObject.owner", status: "mapped" },
  { legacy: "attachedToId", kernel: "attachedTo / attachedToTs", status: "mapped" },
  { legacy: "summoningSick / enteredTurn", kernel: "controlledSince vs lastTurnStartTs", status: "mapped", note: "any legacy-sick permanent is sick in the kernel until its controller's next turn" },
  { legacy: "temporaryPower/ToughnessBonus, temporaryBasePower/Toughness, temporaryAbilitiesStripped, temporaryGrantedKeywords", kernel: "state.effects (until end of turn)", status: "mapped" },
  { legacy: "chosenColor / chosenCreatureType / chosenMode", kernel: "GameObject.chosen", status: "mapped" },
  { legacy: "faceDownCardName, unlockedFaceIndices/faces", kernel: "faceDown (name hidden)", status: "approximate", note: "back faces are not mapped (face stays undefined = front)" },
  { legacy: "turn / activePlayerId / phase", kernel: "turn {number, active, phase}", status: "mapped", note: "legacy turn counter counts every seat's turn, same as the kernel" },
  { legacy: "monarchSeatId", kernel: "state.monarch", status: "mapped" },
  { legacy: "floatingMana (agent seats)", kernel: "players[].manaPool", status: "mapped" },
  { legacy: "attacking / attackTargetId / blocking / blockingTargetId", kernel: "state.combat (attackers, blockers, expect)", status: "approximate", note: "extra blockers (extraBlockingTargetId) mapped as a second block; 'blocked' derived from the blocker list" },
  { legacy: "land drops this turn", kernel: "players[].landsPlayed", status: "approximate", note: "the orchestrator keeps the count outside the session; derived from lands that entered this turn from hand/command/graveyard/exile" },
  { legacy: "stack (does not exist; stackSpellCardIds)", kernel: "stack", status: "unmapped", note: "always empty: legacy resolves spells instantly" },
  { legacy: "priority / passes", kernel: "priority", status: "approximate", note: "always the active player" },
  { legacy: "turnLog-based counters (storm, 'this turn' conditions): damageThisTurn, creaturesDiedThisTurn, drawnThisTurn, createdTokenThisTurn, onceEachTurnEffectsUsed", kernel: "turnLog / activations", status: "unmapped" },
  { legacy: "experienceCounters", kernel: "players[].counters.experience", status: "mapped" },
  { legacy: "poison", kernel: "(no field)", status: "unmapped" },
  { legacy: "emblems, undercityRooms, initiativeSeatId", kernel: "(no field)", status: "unmapped" },
  { legacy: "damageShields, combatDamagePrevented, lockedUntilSeatTurn, creatureAttackBans, attackBans", kernel: "durableEffects replacement shields", status: "unmapped" },
  { legacy: "delayedPhaseTriggers, pendingUpkeepDraws, extraTurnsQueue, extraCombatsPending", kernel: "delayedTriggers / extraTurns / extraCombats", status: "unmapped" },
  { legacy: "exiledPlayableBySeatId / graveyardCastGrant / exiledUntilSourceLeaves / imprintedOnId / hideawaySourceId", kernel: "durableEffects.permission / links", status: "unmapped" },
  { legacy: "grantedKeywords, grantedTypes, abilitiesStripped, attachment*Bonus, lostKeywords (derived by the legacy SBA pass)", kernel: "(recomputed by chars() from card text)", status: "unmapped", note: "deliberately not copied: the kernel must derive them itself; a P/T difference is a real finding" },
  { legacy: "copyOriginal / temporaryCopyOriginal / imprisonedOriginal", kernel: "copyDef", status: "unmapped" },
  { legacy: "phasedOut", kernel: "(no phasing in the kernel)", status: "unmapped" },
  { legacy: "pending* prompt queues (pendingDiscardChoices, pendingPlayerChoices, ...)", kernel: "state.pending", status: "unmapped", note: "compared only as 'is a decision open'" },
  { legacy: "xmage, events, agent reasoning", kernel: "(not game state)", status: "unmapped" }
];

const FIELD_GAPS: Array<{ field: string; present: (card: VisibleCard) => boolean }> = [
  { field: "card.phasedOut", present: (c) => !!c.phasedOut },
  { field: "card.copyOriginal", present: (c) => !!c.copyOriginal || !!c.temporaryCopyOriginal },
  { field: "card.imprisonedOriginal", present: (c) => !!c.imprisonedOriginal },
  { field: "card.exiledPlayable", present: (c) => !!c.exiledPlayableBySeatId || !!c.graveyardCastGrant },
  { field: "card.exiledUntilSourceLeaves", present: (c) => !!c.exiledUntilSourceLeaves || !!c.imprintedOnId || !!c.hideawaySourceId },
  { field: "card.attackBans", present: (c) => !!c.attackBans?.length },
  { field: "card.temporaryControlChange", present: (c) => !!c.temporaryControlChange },
  { field: "card.animatedAsCreature", present: (c) => !!c.animatedAsCreature || !!c.temporaryAnimatedAsCreature },
  { field: "card.cdaOrSetOverride", present: (c) => c.setPowerOverride !== undefined || c.setToughnessOverride !== undefined }
];

const SESSION_GAPS: Array<{ field: string; present: (s: GameSession) => boolean }> = [
  { field: "session.damageShields", present: (s) => !!s.damageShields?.length || !!s.combatDamagePrevented },
  { field: "session.delayedPhaseTriggers", present: (s) => !!s.delayedPhaseTriggers?.length },
  { field: "session.extraTurnsQueue", present: (s) => !!s.extraTurnsQueue?.length || !!s.extraCombatsPending },
  { field: "session.initiative", present: (s) => !!s.initiativeSeatId },
  { field: "session.pendingChoices", present: (s) => hasPendingPrompt(s) }
];

const SEAT_GAPS: Array<{ field: string; present: (s: PlayerSeat) => boolean }> = [
  { field: "seat.poison", present: (s) => (s.poison ?? 0) > 0 },
    { field: "seat.emblems", present: (s) => !!s.emblems?.length },
  { field: "seat.lockedUntilSeatTurn", present: (s) => !!s.lockedUntilSeatTurn },
  { field: "seat.creatureAttackBans", present: (s) => !!s.creatureAttackBans?.length }
];

/** True when the legacy session has any open "pending*" prompt queue (a decision someone still owes). */
export function hasPendingPrompt(s: GameSession): boolean {
  const queues = [s.pendingDiscardChoices, s.pendingDiscoverChoices, s.pendingPunisherChoices, s.pendingFreeCastChoices, s.pendingBraidsChoices, s.pendingVentureChoices, s.pendingSacrificeChoices, s.pendingCounterChoices, s.pendingPlayerChoices, s.pendingShockChoices, s.pendingScriptedSearch];
  return queues.some((q) => !!q && q.length > 0);
}

const COLOR_WORDS: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
const normColor = (c: string): string => (COLOR_WORDS[c.toLowerCase()] ?? c.toUpperCase()).slice(0, 1);

const TREASURE: Ability = { id: "t:treasure", kind: "mana", text: "{T}, Sacrifice this artifact: Add one mana of any color.", costs: [{ tap: "self" }, { sacrifice: "self", count: 1 }], mana: { produces: [{ anyColor: 1 }] } } as unknown as Ability;
const KEYWORDS = ["flying", "first strike", "double strike", "deathtouch", "haste", "hexproof", "indestructible", "lifelink", "menace", "reach", "trample", "vigilance", "defender", "flash"];

function tokenDefOf(card: VisibleCard, dl: DraftLookup): TokenDef {
  const { types, subtypes, supertypes } = parseTypeLine(card.typeLine.replace(/^Token\s+/i, ""));
  const text = (card.oracleText ?? "").toLowerCase();
  const first = text.split("\n")[0];
  const keywords = KEYWORDS.filter((k) => first.split(/[,;]\s*/).map((x) => x.trim()).includes(k));
  const pn = Number.parseInt(card.power ?? "", 10), tn = Number.parseInt(card.toughness ?? "", 10);
  const abilities: Ability[] = subtypes.includes("Treasure") ? [TREASURE] : [];
  // a token that is a COPY of a drafted card (Saheeli's Mirrorworks copies, Mirror Gallery...) carries the card's printed abilities and cost
  let copyOf: { manaCost?: string } = {};
  if (dl.hasDraft(card.name) && !/^(Treasure|Food|Clue)$/.test(card.name)) {
    const def = dl.lookup(card.name);
    if (def && !dl.noDraft.has(card.name)) { abilities.push(...def.kernel.abilities); copyOf = { ...(def.manaCost ? { manaCost: def.manaCost } : {}) }; }
  }
  return {
    ...copyOf, name: tokenName(card.name), types, subtypes, colors: (card.colors ?? []).map(normColor), ...(Number.isFinite(pn) ? { power: pn } : {}), ...(Number.isFinite(tn) ? { toughness: tn } : {}), keywords, ...(abilities.length ? { abilities } : {}), ...(supertypes.length ? { supertypes } : {}) };
}

/** the legacy engine names tokens "Plant Token" / "Myr Token"; the kernel names them by the printed token name ("Plant") */
const tokenName = (name: string): string => name.replace(/ Token$/, "");

const seatOwner = (card: VisibleCard, seat: PlayerSeat): string => card.ownerSeatId ?? seat.id;

export function toKernelState(session: GameSession, opts: AdaptOptions): AdaptResult {
  const dl = opts.lookup;
  const toKernel = new Map<string, ObjId>();
  const toLegacy = new Map<ObjId, string>();
  const legacyCards = new Map<string, VisibleCard>();
  const gapMap = new Map<string, AdapterGap>();
  const gap = (field: string, example: string) => {
    const g = gapMap.get(field) ?? { field, count: 0, examples: [] };
    g.count += 1;
    if (g.examples.length < 3) g.examples.push(example);
    gapMap.set(field, g);
  };
  const noDraft = new Set<string>();

  const seats = session.seats;
  const activeId = session.activePlayerId ?? seats[0]?.id;
  const phase = LEGACY_TO_KERNEL_PHASE[session.phase] ?? "precombat_main";

  const players: PlayerState[] = seats.map((seat) => ({
    id: seat.id, name: seat.name, life: seat.life, library: [], hand: [], graveyard: [], exile: [], command: [],
    manaPool: { W: seat.floatingMana?.W ?? 0, U: seat.floatingMana?.U ?? 0, B: seat.floatingMana?.B ?? 0, R: seat.floatingMana?.R ?? 0, G: seat.floatingMana?.G ?? 0, C: seat.floatingMana?.C ?? 0 },
    landsPlayed: 0, lastTurnStartTs: 0, hasLost: !!seat.hasLost, drewFromEmpty: false,
    colorIdentity: seat.board.commander?.colorIdentity ?? ["W", "U", "B", "R", "G"], commanderCasts: {},
    ...((seat.experienceCounters ?? 0) > 0 ? { counters: { experience: seat.experienceCounters! } } : {})
  }));
  const state: GameState = {
    version: 1,
    config: { lenient: !!opts.lenient, skipFirstDraw: opts.skipFirstDraw ?? seats.length === 2, maxEventsPerPass: 5000, handSize: 7 },
    seed: opts.seed ?? 1, rngState: opts.seed ?? 1, nextId: 1, clock: 1, decisionSeq: 0, players, objects: {}, battlefield: [], stack: [],
    turn: { number: session.turn, active: activeId, phase }, priority: activeId, passes: [], effects: [], lki: {}, turnLog: [], activations: {},
    triggerQueue: [], priorityAfter: null, pending: null, gameOver: null, combat: null, extraCombats: 0
  };
  const activePlayer = players.find((p) => p.id === activeId);
  if (activePlayer) activePlayer.lastTurnStartTs = 1;
  const player = (id: string) => players.find((p) => p.id === id);

  const mk = (card: VisibleCard, owner: string, controller: string, zone: GameObject["zone"]): GameObject => {
    const id = `#${state.nextId++}`;
    const ts = ++state.clock;
    legacyCards.set(card.id, card);
    toKernel.set(card.id, id);
    toLegacy.set(id, card.id);
    const canon = card.token ? { card: card.name } : dl.canonical(card.name);
    const o: GameObject = { id, cardName: canon.card, ...(canon.face ? { face: canon.face } : {}), owner, controller, zone, timestamp: ts, controlledSince: 0, tapped: false, counters: {}, damage: 0 };
    if (card.token) o.token = tokenDefOf(card, dl);
    else {
      dl.register(card);
      if (!dl.hasDraft(card.name) && card.name) noDraft.add(card.name);
    }
    state.objects[id] = o;
    return o;
  };

  // ---- zones that are not the battlefield
  for (const seat of seats) {
    const p = player(seat.id)!;
    const put = (list: VisibleCard[] | undefined, zone: "library" | "hand" | "graveyard" | "exile" | "command") => {
      for (const c of list ?? []) {
        if (toKernel.has(c.id)) continue;
        const o = mk(c, seatOwner(c, seat), seat.id, zone);
        (p[zone] as string[]).push(o.id);
        if (zone === "command" || c.commander) o.isCommander = true;
        if (c.faceDownCardName) o.faceDown = true;
      }
    };
    put(seat.library, "library");
    put(seat.board.hand, "hand");
    put(seat.board.graveyard, "graveyard");
    put(seat.board.exile, "exile");
  }
  // ---- battlefield (layer timestamp order), then the command zone (a commander on the battlefield keeps its legacy flag)
  const onBf: Array<{ card: VisibleCard; seat: PlayerSeat }> = [];
  for (const seat of seats) for (const card of seat.board.battlefield) onBf.push({ card, seat });
  onBf.sort((a, b) => (a.card.permanentTimestamp ?? Number.MAX_SAFE_INTEGER) - (b.card.permanentTimestamp ?? Number.MAX_SAFE_INTEGER));
  const sickClock = state.clock + onBf.length + 5;
  for (const { card, seat } of onBf) {
    if (toKernel.has(card.id)) continue;
    const o = mk(card, seatOwner(card, seat), seat.id, "battlefield");
    state.battlefield.push(o.id);
    o.tapped = !!card.tapped;
    o.damage = card.damage ?? 0;
    for (const c of card.counters ?? []) if (c.count > 0) o.counters[c.kind] = (o.counters[c.kind] ?? 0) + c.count;
    if (card.loyalty && o.counters.loyalty === undefined && /planeswalker/i.test(card.typeLine) && Number.isFinite(Number(card.loyalty))) o.counters.loyalty = Number(card.loyalty);
    if (card.commander) o.isCommander = true;
    if (card.faceDownCardName) o.faceDown = true;
    const sick = card.summoningSick === true;
    o.controlledSince = sick ? sickClock : 0;
    const chosen: NonNullable<GameObject["chosen"]> = {};
    if (card.chosenColor) chosen.color = card.chosenColor;
    if (card.chosenCreatureType) chosen.type = card.chosenCreatureType;
    if (card.chosenMode) chosen.mode = card.chosenMode;
    if (Object.keys(chosen).length) o.chosen = chosen;
    for (const g of FIELD_GAPS) if (g.present(card)) gap(g.field, card.name);
  }
  state.clock = sickClock;
  // commander zone
  for (const seat of seats) {
    const p = player(seat.id)!;
    const cmd = seat.board.commander;
    if (cmd && !toKernel.has(cmd.id)) {
      const o = mk(cmd, seatOwner(cmd, seat), seat.id, "command");
      o.isCommander = true;
      p.command.push(o.id);
    }
    const tax = (cmd ?? seat.board.battlefield.find((c) => c.commander))?.commanderTax;
    const cid = cmd ? toKernel.get(cmd.id) : seat.board.battlefield.find((c) => c.commander) ? toKernel.get(seat.board.battlefield.find((c) => c.commander)!.id) : undefined;
    if (cid && tax) p.commanderCasts[cid] = Math.round(tax / 2);
    if (Object.keys(seat.commanderDamage ?? {}).length) {
      state.commanderDamage ??= {};
      state.commanderDamage[seat.id] = {};
      // keys are the damaging commander's card id; an unknown key (commander no longer in any zone we know) is kept verbatim so totals stay right
      for (const [src, n] of Object.entries(seat.commanderDamage)) if (n > 0) state.commanderDamage[seat.id][toKernel.get(src) ?? src] = n;
    }
    for (const g of SEAT_GAPS) if (g.present(seat)) gap(g.field, seat.name);
  }
  // ---- attachments, temporary effects
  for (const { card } of onBf) {
    const o = state.objects[toKernel.get(card.id)!];
    if (card.attachedToId) {
      const host = toKernel.get(card.attachedToId);
      if (host && state.objects[host]?.zone === "battlefield") { o.attachedTo = host; o.attachedToTs = state.objects[host].timestamp; }
    }
    if (card.attachedToSeatId) gap("card.attachedToSeat", card.name);
    const mkEffect = (e: Partial<ContinuousEffect>) => state.effects.push({ id: `e${state.effects.length + 1}`, timestamp: ++state.clock, objectId: o.id, objectTimestamp: o.timestamp, until: "end_of_turn", ...e });
    if (card.temporaryPowerBonus || card.temporaryToughnessBonus) mkEffect({ power: card.temporaryPowerBonus ?? 0, toughness: card.temporaryToughnessBonus ?? 0 });
    if (card.temporaryBasePower !== undefined && card.temporaryBaseToughness !== undefined) mkEffect({ base: { power: card.temporaryBasePower, toughness: card.temporaryBaseToughness } });
    if (card.temporaryAbilitiesStripped) mkEffect({ lose: "all abilities" });
    for (const kw of card.temporaryGrantedKeywords ?? []) mkEffect({ grant: kw });
  }
  // ---- "the next spell you cast this turn has improvise / affinity for artifacts" (Saheeli, the Gifted; Archway of Innovation)
  for (const seat of seats) {
    const grants: string[] = [];
    if (seat.nextSpellHasArtifactAffinity) grants.push("affinity for artifacts");
    if (seat.nextSpellHasImprovise) grants.push("improvise");
    if (grants.length) (state.durableEffects ??= []).push({ id: `d${state.durableEffects.length + 1}`, timestamp: ++state.clock, owner: seat.id, source: toKernel.get(seat.board.battlefield[0]?.id ?? "") ?? "#0", expires: { ev: "cleanup", turn: session.turn }, nextSpell: grants });
  }
  // ---- lands played this turn (approximate, see ADAPTER_COVERAGE)
  if (activePlayer) activePlayer.landsPlayed = onBf.filter(({ card, seat }) => seat.id === activeId && card.enteredTurn === session.turn && /\bland\b/i.test(card.typeLine) && card.enteredFrom !== "library" && card.enteredFrom !== undefined).length;
  // ---- combat
  const attackers: Attacker[] = [];
  for (const { card } of onBf) {
    if (!card.attacking) continue;
    const id = toKernel.get(card.id)!;
    const defender = card.attackTargetId ? toKernel.get(card.attackTargetId) ?? card.attackTargetId : seats.find((s) => s.id !== card.ownerSeatId && s.id !== activeId)?.id ?? "";
    const blockers = onBf.filter(({ card: b }) => b.blocking && (b.blockingTargetId === card.id || b.extraBlockingTargetId === card.id)).map(({ card: b }) => ({ id: toKernel.get(b.id)!, ts: state.objects[toKernel.get(b.id)!].timestamp }));
    attackers.push({ id, ts: state.objects[id].timestamp, defender, blockers, blocked: blockers.length > 0 });
  }
  const combatPhases = new Set(["declare_attackers", "declare_blockers", "first_strike_damage", "combat_damage", "end_of_combat"]);
  if (attackers.length > 0 || combatPhases.has(phase)) {
    state.combat = { attackers, dealtFirst: [], expect: null };
    if (phase === "declare_attackers" && attackers.length === 0) { state.combat.expect = { kind: "attackers", player: activeId }; state.priority = null; }
    if (phase === "declare_blockers") {
      const waiting = new Set<string>();
      for (const { card } of onBf) {
        if (!card.attacking || card.blockDecided) continue;
        const def = attackers.find((a) => a.id === toKernel.get(card.id))?.defender;
        const defObj = def ? state.objects[def] : undefined;
        const who = defObj ? defObj.controller : def;
        if (who) waiting.add(who);
      }
      if (waiting.size) { state.combat.expect = { kind: "blockers", players: seats.map((s) => s.id).filter((id) => waiting.has(id)) }; state.priority = null; }
    }
  }
  if (phase === "untap" || phase === "cleanup") state.priority = null;
  // ---- monarch, game over
  if (session.monarchSeatId) state.monarch = session.monarchSeatId;
  if (session.status === "complete") { state.gameOver = { ...(session.winnerSeatId ? { winner: session.winnerSeatId } : { draw: true }), reason: "legacy" }; state.priority = null; }
  // ---- whole-session gaps
  for (const g of SESSION_GAPS) if (g.present(session)) gap(g.field, `turn ${session.turn}`);

  return { state, toKernel, toLegacy, legacyCards, gaps: [...gapMap.values()], noDraft: [...noDraft] };
}
