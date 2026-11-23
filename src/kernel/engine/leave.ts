// A player leaving the game (CR 800.4a, 104.3): lost by life / poison-less rules of this engine (0 life, empty library, commander damage).
//   - every object OWNED by that player leaves the game: battlefield, hand, library, graveyard, exile, command zone, the stack. Nothing
//     "dies" or "leaves the battlefield": no leaves / dies triggers (they simply cease to exist), Auras / Equipment they owned come off whatever
//     they were attached to (the Aura of someone else's creature is gone, the creature is no longer enchanted).
//   - spells and abilities they control on the stack cease to exist; their queued and delayed triggers are dropped.
//   - effects that gave them control of other players' permanents end: control returns (to the previous controller, else to the owner).
//   - they are removed from combat (their attackers / blockers, and attackers that were attacking them).
//   - turn order skips them (core.alive / nextPlayer already do); if it was their turn the turn ends (resolve.advanceStep).
import { emit, tick, type Run } from "./core";
import { releaseUnexiled } from "./durable";
import { invalidateIndex } from "./layers";
import type { GameObject, PlayerId } from "./types";

/** An object ceases to exist: out of every zone list, the stack, combat, effects and links. No events a trigger could see except `left_game`. */
function removeObject(r: Run, o: GameObject): void {
  const id = o.id;
  if (o.zone === "battlefield") releaseUnexiled(r, id, o.timestamp); // "exile ... until this leaves the battlefield": the other player's card comes back
  r.s.battlefield = r.s.battlefield.filter((x) => x !== id);
  if (r.s.phased) r.s.phased = r.s.phased.filter((x) => x.id !== id && x.indirectOf !== id);
  for (const p of r.s.players) { p.hand = p.hand.filter((x) => x !== id); p.library = p.library.filter((x) => x !== id); p.graveyard = p.graveyard.filter((x) => x !== id); p.exile = p.exile.filter((x) => x !== id); p.command = p.command.filter((x) => x !== id); }
  r.s.stack = r.s.stack.filter((i) => i.objectId !== id);
  r.s.effects = r.s.effects.filter((e) => e.objectId !== id);
  if (r.s.links) r.s.links = r.s.links.filter((l) => l.source !== id && l.object !== id);
  if (r.s.durableEffects) r.s.durableEffects = r.s.durableEffects.filter((d) => d.permission?.objectId !== id && d.control?.objectId !== id && d.unexile?.objectId !== id);
  if (r.s.combat) {
    r.s.combat.attackers = r.s.combat.attackers.filter((a) => a.id !== id && a.defender !== id);
    for (const a of r.s.combat.attackers) a.blockers = a.blockers.filter((b) => b.id !== id);
    r.s.combat.dealtFirst = r.s.combat.dealtFirst.filter((x) => x !== id);
  }
  // whatever was attached to it falls off (an Aura then goes to its owner's graveyard as a state-based action, Equipment stays unattached)
  for (const other of Object.values(r.s.objects)) if (other.attachedTo === id) { other.attachedTo = undefined; other.attachedToTs = undefined; }
  delete r.s.objects[id];
}

/** Called once, the moment a player has lost (the `hasLost` flag is already set). Idempotent. */
export function leaveGame(r: Run, pid: PlayerId): void {
  const p = r.s.players.find((x) => x.id === pid);
  if (!p) return;
  const alivePlayers = r.s.players.filter((x) => !x.hasLost).map((x) => x.id);

  // 1. spells and abilities on the stack: theirs cease to exist, and so does any spell whose card they own
  r.s.stack = r.s.stack.filter((i) => i.controller !== pid && !(i.objectId && r.s.objects[i.objectId]?.owner === pid));
  for (const o of Object.values(r.s.objects)) if (o.zone === "stack" && (o.controller === pid || o.owner === pid) && !r.s.stack.some((i) => i.objectId === o.id)) removeObject(r, o);
  r.s.triggerQueue = r.s.triggerQueue.filter((t) => t.controller !== pid);
  if (r.s.delayedTriggers) r.s.delayedTriggers = r.s.delayedTriggers.filter((d) => d.controller !== pid);

  // 2. control effects that gave them other players' permanents end: control reverts (the effect's previous controller, else the owner)
  for (const id of [...r.s.battlefield]) {
    const o = r.s.objects[id];
    if (!o || o.controller !== pid || o.owner === pid) continue;
    const dur = r.s.durableEffects?.find((d) => d.control?.objectId === id);
    const back = [dur?.control?.was, o.owner].find((x): x is PlayerId => !!x && x !== pid && alivePlayers.includes(x));
    if (dur && r.s.durableEffects) r.s.durableEffects = r.s.durableEffects.filter((d) => d !== dur);
    if (back) { o.controller = back; o.controlledSince = tick(r); emit(r, { type: "control_changed", id, from: pid, to: back }); }
    else removeObject(r, o); // nobody left to give it to
  }

  // 3. everything they own leaves the game, wherever it is (other players' battlefields and graveyards included)
  for (const o of Object.values(r.s.objects)) if (o.owner === pid) removeObject(r, o);
  r.s.durableEffects = (r.s.durableEffects ?? []).filter((d) => d.owner !== pid);
  r.s.extraTurns = (r.s.extraTurns ?? []).filter((x) => x !== pid);
  p.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }; p.manaUnits = []; p.manaTaps = [];
  r.s.passes = r.s.passes.filter((x) => x !== pid);

  // 4. combat bookkeeping and who holds priority / the monarchy
  if (r.s.combat?.expect?.kind === "blockers") r.s.combat.expect = { kind: "blockers", players: r.s.combat.expect.players.filter((x) => x !== pid) };
  if (r.s.monarch === pid) r.s.monarch = alivePlayers.includes(r.s.turn.active) ? r.s.turn.active : alivePlayers[0];
  if (r.s.priority === pid) r.s.priority = alivePlayers.find((x) => x !== pid) ?? null;
  invalidateIndex(r);
  emit(r, { type: "player_left", player: pid });
}
