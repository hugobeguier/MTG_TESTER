// Debug mode ("sandbox") actions: the kernel counterpart of the old game's sandbox tools (free cast, library search, draw, shuffle, life, counters, move to zone).
// Every one of them is refused with `sandbox_disabled` unless `config.sandbox` is true; only the host switches that (the `sandboxMode` action, which also records the switch in the
// log and marks the game `sandboxUsed`). They are never listed by legalActions and the AI / observer / a multiplayer guest never send them.
// They run through the normal machinery afterwards (state-based actions, triggers, replacement effects), so a card put onto the battlefield triggers its ETBs like a real effect would.
import { chars, defOf, drawCards, emit, faceNames, label, moveObject, newObject, obj, player, Reject, shuffleInPlace, tick, tryObj, type Run } from "./core";
import { addMana } from "./mana";
import { addCounters } from "./steps";
import { invalidateIndex } from "./layers";
import { playableFaces } from "./faces";
import type { LegalAction } from "./legal";
import { isObjId, SANDBOX_ACTION_TYPES, type Action, type ObjId, type PlayerId, type SandboxAction, type SandboxZone } from "./types";

export const isSandboxAction = (a: Action): a is SandboxAction => (SANDBOX_ACTION_TYPES as readonly string[]).includes(a.type);

/** what the host passes in (the resolve.ts functions this file must not import: they import this file) */
export interface SandboxHooks {
  castSpell: (r: Run, a: Extract<Action, { type: "castSpell" }>) => void;
  finish: (r: Run, keep?: PlayerId) => void;
}

const OWN_ZONES = ["hand", "graveyard", "exile", "library", "command"] as const;
const ZONE_LABEL: Record<SandboxZone, string> = { hand: "hand", battlefield: "the battlefield", graveyard: "graveyard", exile: "exile", command: "command zone", top_of_library: "the top of the library", bottom_of_library: "the bottom of the library" };

/** the public log line of a sandbox action (the game log shows `text` as is) */
function note(r: Run, player: PlayerId, action: string, text: string, extra: Record<string, unknown> = {}): void {
  r.s.sandboxUsed = true;
  emit(r, { type: "sandbox", player, action, text: `Debug: ${text}`, ...extra });
}

function moveTo(r: Run, id: ObjId, to: SandboxZone, controller: PlayerId): void {
  if (to === "top_of_library") moveObject(r, id, "library", { position: "top" });
  else if (to === "bottom_of_library") moveObject(r, id, "library", { position: "bottom" });
  else if (to === "battlefield") moveObject(r, id, "battlefield", { controller });
  else moveObject(r, id, to);
}

export function runSandbox(r: Run, a: SandboxAction, h: SandboxHooks): void {
  if (a.type === "sandboxMode") {
    if (r.s.pending?.ctx.t === "replay") throw new Reject("decision_pending", "answer the pending question before switching debug mode");
    r.s.config = { ...r.s.config, sandbox: a.on };
    if (a.on) r.s.sandboxUsed = true;
    emit(r, { type: "sandbox_mode", player: a.player, on: a.on, text: `Debug mode ${a.on ? "ON" : "OFF"}` });
    return;
  }
  if (!r.s.config.sandbox) throw new Reject("sandbox_disabled", "debug mode is off: tick \"Debug mode\" first");
  const p = player(r, a.player);
  const stackBefore = r.s.stack.length;
  const keep = r.s.priority ?? a.player;
  const settle = (): void => { if (r.s.stack.length !== stackBefore) r.s.passes = []; h.finish(r, keep); };
  const own = (id: string): ReturnType<typeof obj> => {
    const o = tryObj(r, id);
    if (!o) throw new Reject("unknown_object", `unknown card ${id}`);
    return o;
  };
  const ownedHere = (id: string): ReturnType<typeof obj> => {
    const o = own(id);
    if (o.owner !== a.player) throw new Reject("not_owner", `${a.player} does not own ${label(r, id)}`);
    if (!(OWN_ZONES as readonly string[]).includes(o.zone) || !(p[o.zone as "hand"] as ObjId[]).includes(id)) throw new Reject("not_in_zone", `${label(r, id)} is not in one of ${a.player}'s hidden / graveyard / exile / command zones`);
    return o;
  };

  switch (a.type) {
    case "sandboxCast": {
      const o = ownedHere(a.cardId);
      if (chars(r, o.id).types.includes("land") && a.face === undefined) return playLandFree(r, a.player, o.id, undefined, note, settle);
      note(r, a.player, "cast", `${a.player} casts ${label(r, o.id)} for free`, { id: o.id });
      r.sandbox = true; r.ignoreTiming = true;
      try { h.castSpell(r, { type: "castSpell", player: a.player, cardId: o.id, ...(a.face !== undefined ? { face: a.face } : {}), ...(a.modes ? { modes: a.modes } : {}), ...(a.targets ? { targets: a.targets } : {}), ...(a.x !== undefined ? { x: a.x } : {}), ...(a.extras ? { extras: a.extras } : {}) }); }
      finally { r.sandbox = false; r.ignoreTiming = false; }
      return;
    }
    case "sandboxPlayLand": {
      const o = ownedHere(a.cardId);
      return playLandFree(r, a.player, o.id, a.face, note, settle);
    }
    case "sandboxTutor": {
      const o = own(a.cardId);
      if (o.owner !== a.player || o.zone !== "library" || !p.library.includes(o.id)) throw new Reject("not_in_zone", `${label(r, a.cardId)} is not in ${a.player}'s library`);
      const to = a.to ?? "hand";
      note(r, a.player, "tutor", `${a.player} takes ${label(r, o.id)} from the library to ${ZONE_LABEL[to]}`, { id: o.id, to });
      moveTo(r, o.id, to, a.player);
      if (to !== "top_of_library" && to !== "bottom_of_library") { shuffleInPlace(r, p.library); emit(r, { type: "shuffle", player: a.player }); }
      return settle();
    }
    case "sandboxDraw": {
      const n = Math.max(0, Math.min(100, Math.floor(a.count)));
      note(r, a.player, "draw", `${a.player} draws ${n} card${n === 1 ? "" : "s"}`, { amount: n });
      drawCards(r, a.player, n);
      return settle();
    }
    case "sandboxShuffle": {
      note(r, a.player, "shuffle", `${a.player} shuffles their library`);
      shuffleInPlace(r, p.library); emit(r, { type: "shuffle", player: a.player });
      return;
    }
    case "sandboxSetLife": {
      const who = player(r, a.target ?? a.player);
      if (!Number.isFinite(a.life)) throw new Reject("invalid_choice", "life must be a number");
      note(r, a.player, "life", `${who.id}'s life set from ${who.life} to ${Math.floor(a.life)}`, { target: who.id, life: Math.floor(a.life) });
      who.life = Math.floor(a.life);
      return settle();
    }
    case "sandboxMove": {
      const o = own(a.cardId);
      if (o.zone === "stack") throw new Reject("not_in_zone", `${label(r, a.cardId)} is on the stack`);
      const ctl = a.controller ?? o.owner;
      player(r, ctl);
      note(r, a.player, "move", `${label(r, o.id)} moved from ${o.zone} to ${ZONE_LABEL[a.to]}`, { id: o.id, to: a.to });
      if (o.zone === "battlefield" && a.to === "battlefield") { o.controller = ctl; o.controlledSince = tick(r); invalidateIndex(r); }
      else moveTo(r, o.id, a.to, ctl);
      return settle();
    }
    case "sandboxCounters": {
      const delta = Math.trunc(a.delta);
      if (!a.kind) throw new Reject("invalid_choice", "name the kind of counter");
      if (!isObjId(a.cardId)) {
        const who = player(r, a.cardId);
        const next = Math.max(0, (who.counters?.[a.kind] ?? 0) + delta);
        note(r, a.player, "counters", `${who.id} ${delta >= 0 ? "gets" : "loses"} ${Math.abs(delta)} ${a.kind} counter${Math.abs(delta) === 1 ? "" : "s"}`, { target: who.id, kind: a.kind, delta });
        who.counters = { ...(who.counters ?? {}), [a.kind]: next };
        if (!next) delete who.counters[a.kind];
        return settle();
      }
      const o = own(a.cardId);
      note(r, a.player, "counters", `${label(r, o.id)} ${delta >= 0 ? "gets" : "loses"} ${Math.abs(delta)} ${a.kind} counter${Math.abs(delta) === 1 ? "" : "s"}`, { id: o.id, kind: a.kind, delta });
      if (o.zone === "battlefield") addCounters(r, [o.id], a.kind, delta);
      else { const next = Math.max(0, (o.counters[a.kind] ?? 0) + delta); if (next) o.counters[a.kind] = next; else delete o.counters[a.kind]; }
      invalidateIndex(r);
      return settle();
    }
    case "sandboxUntapAll": {
      note(r, a.player, "untap", `${a.player} untaps everything they control`);
      for (const id of r.s.battlefield) { const o = r.s.objects[id]; if (o && o.controller === a.player && o.tapped) { o.tapped = false; emit(r, { type: "untap", id }); } }
      return;
    }
    case "sandboxAddMana": {
      if (!a.colors.length) throw new Reject("invalid_choice", "choose some mana");
      note(r, a.player, "mana", `${a.player} adds ${a.colors.map((c) => `{${c}}`).join("")} to their mana pool`, { colors: a.colors });
      addMana(r, a.player, a.colors);
      return;
    }
    case "sandboxConjureCard": {
      const def = r.defs(a.name);
      if (!def) throw new Reject("unknown_card", `the card database has no card named "${a.name}"`);
      const to = a.to ?? "hand";
      const o = newObject(r, def.name, a.player, "hand");
      p.hand.push(o.id);
      note(r, a.player, "conjure", `${def.name} conjured into ${ZONE_LABEL[to]}`, { id: o.id, name: def.name, to });
      if (to !== "hand") moveTo(r, o.id, to, a.player);
      return settle();
    }
  }
}

/** a land put onto the battlefield from any own zone: no land-drop limit, any timing, no land drop used (but "whenever a land enters / is played" still sees it) */
function playLandFree(r: Run, pid: PlayerId, id: ObjId, face: string | undefined, noteFn: typeof note, settle: () => void): void {
  const o = obj(r, id);
  if (face !== undefined) {
    const def = defOf(r, o)!;
    if (!faceNames(def).includes(face) || !playableFaces(def).includes(face)) throw new Reject("invalid_choice", `"${face}" cannot be played as a land from ${label(r, id)}`);
    o.face = face;
  }
  if (!chars(r, id).types.includes("land")) throw new Reject("not_castable", `${label(r, id)} is not a land`);
  noteFn(r, pid, "land", `${pid} puts ${label(r, id)} onto the battlefield as a land play (no land drop used)`, { id });
  emit(r, { type: "land_played", player: pid, id });
  moveObject(r, id, "battlefield", { controller: pid });
  settle();
}

/** The debug free casts / land plays `player` could start (only listed when legalActions is asked for them with `{ sandbox: true }` and debug mode is on): every card in their hand, graveyard, exile and command zone */
export function sandboxLegal(r: Run, pid: PlayerId): LegalAction[] {
  const p = player(r, pid);
  const out: LegalAction[] = [];
  for (const zone of ["hand", "graveyard", "exile", "command"] as const) {
    for (const id of p[zone]) {
      const isLand = chars(r, id).types.includes("land");
      const action: Action = isLand ? { type: "sandboxPlayLand", player: pid, cardId: id } : { type: "sandboxCast", player: pid, cardId: id };
      out.push({ id: `${action.type}:${id}`, kind: isLand ? "sandboxPlayLand" : "sandboxCast", player: pid, objectId: id, zone, label: `Debug: ${isLand ? "put" : "cast"} ${label(r, id)} ${isLand ? "onto the battlefield" : "for free"}`, action });
    }
  }
  return out;
}
