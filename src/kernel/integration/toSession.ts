// Reverse adapter: kernel GameState -> the legacy GameSession the existing 3D table (ThreeGameTable, RemoteTable) and the snapshot code render.
// One-way and read-only: nothing ever writes the derived session back. The session is built from `viewFor(state, viewer)`, so what the viewer may
// not know (opponents' hands, every library, other players' face-down cards) is a stub, exactly the shape multiplayer/view.ts makes
// (`hidden:<seat>:<zone>:<i>`, "Hidden card"). Effective characteristics (power / toughness, types, keywords, summoning sickness, attachments,
// combat role) come from the kernel's layers (`effectiveViews`), display data (art, oracle text, faces) from the card pack's `display`.
//
// Object identity is stable: pass the previous result as `previous` and every card / seat / board array / the session itself that did not change is
// returned as the SAME object (React rendering and memoisation do not thrash). The field-by-field coverage table is in README.md.
import type { ObjectView } from "../engine/legal";
import { effectiveViews } from "../engine/legal";
import { viewFor, type PlayerView } from "../engine/view";
import type { EngineContext, GameObject, GameState, ObjId, PlayerId } from "../engine/types";
import type { GameEvent as LogLine, GameSession, PlayerSeat, VisibleCard } from "../../lib/types";
import { hasKeyword as textHasKeyword } from "../../lib/keywords";
import { inferRoleFromRecord } from "../../lib/deckParser";
import { LEGACY_TO_KERNEL_PHASE } from "../observer/adapter";
import { displayFromDef, typeLineOf, type DisplayCard } from "./cardPack";
import { tokenSpecOf } from "./tokenArt";
import type { TokenSpec } from "../../lib/tokenArt";
import type { CardImageUris } from "../../lib/types";

export interface SeatMeta { kind?: "human" | "agent"; agentName?: PlayerSeat["agentName"]; remoteSlot?: string }

export interface ToSessionEnv {
  /** card lookup (+ CardDb) the game runs with: used for the effective views and as the display fallback */
  ctx: EngineContext;
  /** printed display data by card name (art, oracle text, faces); missing = synthesised from the card definition */
  display?: (name: string) => DisplayCard | undefined;
  /** art for a token (a pack kit's `tokenArt`); missing / undefined = the placeholder card (name, type line, P/T, rules text) */
  tokenArt?: (spec: TokenSpec) => CardImageUris | undefined;
  /** per player: human / agent / remote slot; default: the viewer is the (only) human, everybody else an agent */
  seats?: Record<PlayerId, SeatMeta>;
  /** the game log lines for THIS viewer (newest first, same shape as GameSession.events) */
  log?: LogLine[];
  /** kernel object id -> the legacy card id it had before the hand-off (cards that came from a legacy session keep their ids) */
  legacyIds?: ReadonlyMap<ObjId, string>;
  id?: string;
  createdAt?: string;
}

export const SPECTATOR = "spectator";

const PHASE_NAME: Record<string, string> = { ...Object.fromEntries(Object.entries(LEGACY_TO_KERNEL_PHASE).map(([legacy, kernel]) => [kernel, legacy])), first_strike_damage: "combat damage step" };
const LETTER: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G", colorless: "" };
const letterOf = (c: string): string => (LETTER[c.toLowerCase()] ?? c.toUpperCase()).slice(0, 1);

/** the legacy phase string for a kernel phase */
export const legacyPhase = (phase: string): string => PHASE_NAME[phase] ?? phase;

type Zone = VisibleCard["zone"];
const stub = (seat: string, zone: "hand" | "library" | "exile" | "battlefield", i: number): VisibleCard => ({ id: `hidden:${seat}:${zone}:${i}`, name: "Hidden card", typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "hidden", zone });

function shallowSame(a: object, b: object): boolean {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const x = (a as Record<string, unknown>)[k], y = (b as Record<string, unknown>)[k];
    if (x === y) continue;
    if (typeof x === "object" && x !== null && typeof y === "object" && y !== null && JSON.stringify(x) === JSON.stringify(y)) continue;
    return false;
  }
  return true;
}
const reuse = <T extends object>(prev: T | undefined, next: T): T => (prev && shallowSame(prev, next) ? prev : next);
const reuseArray = <T extends object>(prev: readonly T[] | undefined, next: T[]): T[] => (prev && prev.length === next.length && next.every((x, i) => x === prev[i]) ? (prev as T[]) : next);

const counterList = (c: Record<string, number>, skipLoyalty: boolean): Array<{ kind: string; count: number }> => Object.entries(c).filter(([k, n]) => n > 0 && !(skipLoyalty && k === "loyalty")).sort(([a], [b]) => a.localeCompare(b)).map(([kind, count]) => ({ kind, count }));
const counterBonus = (c: Record<string, number>): number => (c["+1/+1"] ?? 0) - (c["-1/-1"] ?? 0);

/** Everything toSession needs about one object, resolved once. */
interface Build { state: GameState; view: PlayerView; viewer: PlayerId; env: ToSessionEnv; views: Record<ObjId, ObjectView>; idOf(id: ObjId): string }

function displayOf(b: Build, o: GameObject): DisplayCard | undefined {
  if (o.token) return undefined;
  const hit = b.env.display?.(o.cardName);
  if (hit) return hit;
  const def = b.env.ctx.cards(o.cardName);
  return def ? displayFromDef(def) : undefined;
}

function cardOf(b: Build, o: GameObject, zone: Zone): VisibleCard {
  const v = b.views[o.id];
  const redacted = b.view.objects[o.id] ?? o;
  const faceDownHidden = !!o.faceDown && redacted.cardName === "Face-down card" && o.owner !== b.viewer && o.controller !== b.viewer;
  const onBf = zone === "battlefield";
  const d = faceDownHidden ? undefined : displayOf(b, o);
  const tok = o.token ?? o.copyDef;
  const faceRec = o.face ? d?.faces?.find((f) => f.name === o.face) : undefined;
  // ---- identity and text
  let name = v?.name || d?.name || o.cardName;
  let typeLine = faceRec?.typeLine ?? d?.typeLine ?? typeLineOf(v?.types ?? [], v?.subtypes ?? [], v?.supertypes ?? []);
  let oracle = faceRec?.oracleText ?? d?.oracleText ?? "";
  let manaCost = faceRec?.manaCost ?? d?.manaCost;
  let imageUris = faceRec?.imageUris ?? d?.imageUris;
  if (o.token && v) {
    typeLine = `Token ${typeLineOf(v.types, v.subtypes, v.supertypes)}`;
    oracle = [...(o.token.keywords.length ? [o.token.keywords.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(", ")] : []), ...(o.token.abilities ?? []).map((a) => a.text)].join("\n");
    manaCost = o.token.manaCost;
    // a token COPY of a card (Scion of the Ur-Dragon copying, Saheeli's copies) shows that card's art; any other token gets its Scryfall token printing
    const copied = b.env.display?.(o.cardName);
    imageUris = copied?.imageUris && !/^token\b/i.test(copied.typeLine) ? copied.imageUris : b.env.tokenArt?.(tokenSpecOf(o.token, typeLine, oracle));
  } else if (o.copyDef && v && onBf) {
    typeLine = typeLineOf(v.types, v.subtypes, v.supertypes);
    oracle = (o.copyDef.abilities ?? []).map((a) => a.text).join("\n") || oracle;
  } else if (onBf && v && !faceDownHidden && !o.faceDown) {
    // layers can add / remove types (Athreos, an animated land): the live type line is the effective one
    const eff = typeLineOf(v.types, v.subtypes, v.supertypes);
    const printedTypes = new Set(parseTypes(typeLine));
    if (v.types.length !== printedTypes.size || v.types.some((t) => !printedTypes.has(t))) typeLine = eff;
  }
  if (o.faceDown && onBf) {
    name = faceDownHidden ? "Face-down card" : "Face-down creature";
    typeLine = "Creature"; oracle = ""; manaCost = undefined; imageUris = undefined;
  }
  const colors = (v?.colors ?? d?.colors ?? []).map(letterOf).filter(Boolean);
  const card: VisibleCard = {
    id: b.idOf(o.id), name, typeLine, oracleText: oracle, manaValue: v?.manaValue ?? d?.manaValue ?? 0, colors,
    role: o.token ? "spell" : d ? inferRoleFromRecord({ ...d, id: o.id, colorIdentity: d.colorIdentity ?? [] } as never) : "spell", zone
  };
  if (manaCost) card.manaCost = manaCost;
  if (d?.colorIdentity) card.colorIdentity = d.colorIdentity;
  if (d?.producedMana) card.producedMana = d.producedMana;
  if (imageUris) card.imageUris = imageUris;
  if (!o.faceDown && d?.faces) card.faces = d.faces;
  if (o.face && d?.faces) { const i = d.faces.findIndex((f) => f.name === o.face); if (i > 0) card.unlockedFaceIndices = [i]; }
  if (o.token) { card.token = true; }
  if (o.owner !== o.controller) card.ownerSeatId = o.owner;
  if (zone === "exile") {
    // "you may cast / play this exiled card": the exile pile's cast button reads these three fields
    const d = b.state.durableEffects?.find((x) => x.permission && x.permission.objectId === o.id && x.permission.objectTs === o.timestamp);
    if (d) {
      card.exiledPlayableBySeatId = d.owner;
      if (d.expires.ev !== "never" && d.expires.turn !== undefined) card.exiledPlayableUntilTurn = d.expires.turn;
      if (d.permission!.withoutPaying) card.exiledPlayableFree = true;
    }
  }
  if (o.isCommander) { card.commander = true; const casts = b.state.players.find((p) => p.id === o.owner)?.commanderCasts[o.id]; if (casts) card.commanderTax = casts * 2; }
  if (o.isCopy) card.spellCopy = true;
  if (o.cast?.paid?.includes("kicker")) card.kicked = true;
  // ---- power / toughness: the printed strings plus an override so that effectivePower / effectiveToughness (counters added back on top) give the kernel's number
  if (v) {
    const printedP = o.faceDown ? undefined : faceRec?.power ?? d?.power ?? (v.printedPower !== undefined ? String(v.printedPower) : undefined);
    const printedT = o.faceDown ? undefined : faceRec?.toughness ?? d?.toughness ?? (v.printedToughness !== undefined ? String(v.printedToughness) : undefined);
    const hasPT = v.power !== undefined && v.toughness !== undefined && (v.types.includes("creature") || printedP !== undefined);
    if (hasPT) {
      card.power = printedP ?? String(v.power); card.toughness = printedT ?? String(v.toughness);
      const bonus = counterBonus(v.counters);
      const plainP = (Number.parseInt(card.power, 10) || 0) + bonus, plainT = (Number.parseInt(card.toughness, 10) || 0) + bonus;
      if (v.power !== plainP) card.setPowerOverride = v.power! - bonus;
      if (v.toughness !== plainT) card.setToughnessOverride = v.toughness! - bonus;
    }
    if (v.loyalty !== undefined) card.loyalty = String(v.loyalty);
  } else if (d) {
    if (d.power !== undefined) card.power = d.power;
    if (d.toughness !== undefined) card.toughness = d.toughness;
    if (d.loyalty !== undefined) card.loyalty = d.loyalty;
  }
  if (!onBf) return card;
  // ---- battlefield state
  if (o.tapped) card.tapped = true;
  if (v?.summoningSick) card.summoningSick = true;
  if (o.damage > 0) card.damage = o.damage;
  const counters = counterList(o.counters, v?.loyalty !== undefined);
  if (counters.length) card.counters = counters;
  if (o.chosen?.color) card.chosenColor = o.chosen.color;
  if (o.chosen?.type) card.chosenCreatureType = o.chosen.type;
  if (o.chosen?.mode) card.chosenMode = o.chosen.mode;
  if (v) {
    if (v.attachedTo) card.attachedToId = b.idOf(v.attachedTo);
    if (v.abilitiesStripped) card.abilitiesStripped = true;
    if (v.lostKeywords.length) card.lostKeywords = v.lostKeywords;
    const granted = v.keywords.filter((k) => !textHasKeyword(card.oracleText, k) && !(o.token?.keywords ?? []).map((x) => x.toLowerCase()).includes(k));
    if (granted.length) card.grantedKeywords = granted;
    const mana = v.grantedAbilities.filter((a) => a.kind === "mana").map((a) => a.text);
    const other = v.grantedAbilities.filter((a) => a.kind === "activated").map((a) => a.text);
    if (mana.length) card.grantedManaAbilityText = mana.join("\n");
    if (other.length) card.grantedAbilityText = other.join("\n");
    if (v.attacking) { card.attacking = true; if (v.attackTarget) card.attackTargetId = b.idOf(v.attackTarget); }
    if (v.blocking) { card.blocking = true; if (v.blockedAttackers[0]) card.blockingTargetId = b.idOf(v.blockedAttackers[0]); if (v.blockedAttackers[1]) card.extraBlockingTargetId = b.idOf(v.blockedAttackers[1]); }
  }
  if (o.faceDown && !faceDownHidden) card.faceDownCardName = o.cardName;
  card.permanentTimestamp = o.timestamp;
  return card;
}

function parseTypes(typeLine: string): string[] {
  return typeLine.split(" — ")[0].split(" // ")[0].replace(/^Token\s+/i, "").split(/\s+/).map((w) => w.toLowerCase()).filter((w) => ["artifact", "creature", "enchantment", "instant", "land", "planeswalker", "sorcery", "battle", "kindred", "tribal"].includes(w));
}

const sameBoard = (a: PlayerSeat["board"], b: PlayerSeat["board"]): boolean => a.hand === b.hand && a.battlefield === b.battlefield && a.graveyard === b.graveyard && a.exile === b.exile && a.commander === b.commander;

const emptyZones = (): PlayerSeat["zones"] => ({ library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 });

/** Floating mana per player (the table's `manaPool` prop / the snapshot's `manaPools`): plain pool only; restricted units are a gap. */
export function manaPoolsOf(state: GameState): Record<PlayerId, GameState["players"][number]["manaPool"]> {
  return Object.fromEntries(state.players.map((p) => [p.id, { ...p.manaPool }]));
}

export function toSession(state: GameState, viewer: PlayerId, env: ToSessionEnv, previous?: GameSession): GameSession {
  const view = viewFor(state, viewer);
  const visible = Object.keys(view.objects).filter((id) => view.objects[id].zone === "battlefield" || view.objects[id].zone === "command");
  const views = effectiveViews(state, env.ctx, visible);
  const legacy = env.legacyIds;
  const b: Build = { state, view, viewer, env, views, idOf: (id) => legacy?.get(id) ?? id };
  const prevCards = new Map<string, VisibleCard>();
  for (const s of previous?.seats ?? []) {
    for (const c of [...s.board.hand, ...s.board.battlefield, ...(s.board.graveyard ?? []), ...(s.board.exile ?? []), ...(s.library ?? [])]) prevCards.set(c.id, c);
    if (s.board.commander) prevCards.set(s.board.commander.id, s.board.commander);
  }
  const mk = (o: GameObject, zone: Zone): VisibleCard => { const c = cardOf(b, o, zone); return reuse(prevCards.get(c.id), c); };
  const stubOf = (seat: string, zone: "hand" | "library" | "exile" | "battlefield", i: number): VisibleCard => { const s = stub(seat, zone, i); return prevCards.get(s.id) ?? s; };

  const prevSeats = new Map((previous?.seats ?? []).map((s) => [s.id, s]));
  const seats: PlayerSeat[] = state.players.map((p, index) => {
    const objs = (ids: ObjId[]) => ids.map((id) => view.objects[id] ?? state.objects[id]).filter((o): o is GameObject => !!o);
    const mine = p.id === viewer;
    const pv = view.players.find((x) => x.id === p.id)!;
    const hand: VisibleCard[] = mine ? objs(pv.hand).map((o) => mk(state.objects[o.id], "hand")) : Array.from({ length: pv.handCount }, (_, i) => stubOf(p.id, "hand", i));
    const library: VisibleCard[] = Array.from({ length: pv.libraryCount }, (_, i) => (i === 0 && pv.topCard && state.objects[pv.topCard] ? mk(state.objects[pv.topCard], "library") : stubOf(p.id, "library", i)));
    const battlefield = state.battlefield.map((id) => view.objects[id] && state.objects[id]).filter((o): o is GameObject => !!o && o.controller === p.id).map((o) => mk(o, "battlefield"));
    const graveyard = p.graveyard.filter((id) => view.objects[id]).map((id) => mk(state.objects[id], "graveyard"));
    const exile = p.exile.map((id, i) => { const o = state.objects[id]; return o && view.objects[id] && !(o.faceDown && o.owner !== viewer) ? mk(o, "exile") : stubOf(p.id, "exile", i); });
    const cmdObjs = p.command.map((id) => state.objects[id]).filter((o): o is GameObject => !!o && !!view.objects[o.id]);
    const commanderObj = cmdObjs.find((o) => o.isCommander);
    const emblems = cmdObjs.filter((o) => o.token && o.token.types.map((t) => t.toLowerCase()).includes("emblem")).map((o) => ({ id: b.idOf(o.id), sourceName: o.token!.name, oracleText: (o.token!.abilities ?? []).map((a) => a.text).join("\n") }));
    const meta = env.seats?.[p.id];
    const spectatorHuman = viewer === SPECTATOR && index === 0;
    const seat: PlayerSeat = {
      id: p.id, name: p.name, kind: meta?.kind ?? (mine || spectatorHuman ? "human" : "agent"),
      ...(meta?.agentName ? { agentName: meta.agentName } : {}), ...(meta?.remoteSlot ? { remoteSlot: meta.remoteSlot } : {}),
      life: p.life, commanderDamage: Object.fromEntries(Object.entries(state.commanderDamage?.[p.id] ?? {}).map(([k, n]) => [b.idOf(k), n])),
      ...(p.counters?.poison ? { poison: p.counters.poison } : {}), ...(p.counters?.experience ? { experienceCounters: p.counters.experience } : {}),
      ...(p.hasLost ? { hasLost: true } : {}), ...(emblems.length ? { emblems } : {}),
      library, zones: { ...emptyZones(), library: pv.libraryCount, hand: pv.handCount, battlefield: battlefield.length, graveyard: graveyard.length, exile: exile.length, command: p.command.length },
      board: { hand, battlefield, graveyard, exile, ...(commanderObj ? { commander: mk(commanderObj, "command") } : {}) },
      floatingMana: { ...p.manaPool }
    };
    const prev = prevSeats.get(p.id);
    if (prev) {
      const board = { ...seat.board, hand: reuseArray(prev.board.hand, seat.board.hand), battlefield: reuseArray(prev.board.battlefield, seat.board.battlefield), graveyard: reuseArray(prev.board.graveyard, seat.board.graveyard ?? []), exile: reuseArray(prev.board.exile, seat.board.exile ?? []) };
      seat.board = sameBoard(prev.board, board) ? prev.board : board;
      seat.library = reuseArray(prev.library, seat.library ?? []);
      return reuse(prev, seat);
    }
    return seat;
  });

  const spellIds = state.stack.map((i) => i.objectId).filter((x): x is string => !!x).map((id) => b.idOf(id));
  const next: GameSession = {
    id: env.id ?? previous?.id ?? "kernel-session", createdAt: env.createdAt ?? previous?.createdAt ?? "",
    status: state.gameOver ? "complete" : "playing",
    ...(state.gameOver?.winner ? { winnerSeatId: state.gameOver.winner } : {}),
    activePlayerId: state.turn.active, phase: legacyPhase(state.turn.phase), turn: state.turn.number,
    xmage: previous?.xmage ?? { enabled: false, status: "not_configured", message: "" },
    seats, events: env.log ?? previous?.events ?? [],
    ...(state.monarch ? { monarchSeatId: state.monarch } : {}),
    ...(spellIds.length ? { stackSpellCardIds: spellIds } : {})
  };
  if (previous && shallowSame({ ...previous, seats: 0, events: 0 }, { ...next, seats: 0, events: 0 }) && previous.events === next.events && next.seats.length === previous.seats.length && next.seats.every((s, i) => s === previous.seats[i])) return previous;
  return next;
}

/** One object as a VisibleCard (for the stack panel and decision dialogs: an object that sits on the stack is in no seat zone). */
export function cardForObject(state: GameState, viewer: PlayerId, env: ToSessionEnv, id: ObjId, zone: VisibleCard["zone"] = "battlefield"): VisibleCard | undefined {
  const o = state.objects[id];
  if (!o) return undefined;
  const view = viewFor(state, viewer);
  if (!view.objects[id]) return undefined; // hidden from this viewer
  const b: Build = { state, view, viewer, env, views: effectiveViews(state, env.ctx, [id]), idOf: (x) => env.legacyIds?.get(x) ?? x };
  return cardOf(b, o, zone);
}

/**
 * An object a decision LISTED to the viewer, as a VisibleCard, also when the viewer's redacted view hides it (a scry / search / look-at-top / tutor
 * candidate still in the library, a card in the hand of the one who must choose). The kernel only lists an option to the player who decides, and its label
 * already carries the card's name, so showing the card is no new leak; for safety a hidden object is shown only when the label names it.
 */
export function cardForListedObject(state: GameState, viewer: PlayerId, env: ToSessionEnv, id: ObjId, label: string): VisibleCard | undefined {
  const o = state.objects[id];
  if (!o) return undefined;
  const zone = (o.zone as Zone) ?? "battlefield";
  const seen = cardForObject(state, viewer, env, id, zone);
  if (seen) return seen;
  if (!label.toLowerCase().includes(o.cardName.toLowerCase())) return undefined;
  const view = viewFor(state, viewer);
  const b: Build = { state, view, viewer, env, views: effectiveViews(state, env.ctx, []), idOf: (x) => env.legacyIds?.get(x) ?? x };
  return cardOf(b, o, zone);
}

/** A card by NAME (printed data from the pack / card definitions): the source of a question that is not on any visible zone. Never reads the game state. */
export function cardForName(env: ToSessionEnv, name: string): VisibleCard | undefined {
  const d = env.display?.(name) ?? (env.ctx.cards(name) ? displayFromDef(env.ctx.cards(name)!) : undefined);
  if (!d || (!d.typeLine && !d.oracleText && !d.imageUris)) return undefined;
  const card: VisibleCard = {
    id: `source:${name}`, name: d.name, typeLine: d.typeLine, oracleText: d.oracleText, manaValue: d.manaValue, colors: d.colors.map(letterOf).filter(Boolean),
    role: "spell", zone: "hand"
  };
  if (d.manaCost) card.manaCost = d.manaCost;
  if (d.imageUris) card.imageUris = d.imageUris;
  if (d.faces) card.faces = d.faces;
  if (d.power !== undefined) card.power = d.power;
  if (d.toughness !== undefined) card.toughness = d.toughness;
  if (d.loyalty !== undefined) card.loyalty = d.loyalty;
  return card;
}
