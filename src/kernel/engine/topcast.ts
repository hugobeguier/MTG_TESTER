// Top-of-library permissions (kernel step 8): "You may look at the top card of your library any time", "You may cast Dragon spells from the top
// of your library" (Korlessa), "You may play lands and cast spells from the top of your library" (One with the Multiverse),
// "creature spells with power 4 or greater ... gains haste" (Thundermane Dragon). Read from the abilities of the permanents a player controls.
// The cast itself is an ordinary cast option (cast_from_zone from "library") offered only for the top card, see castopts.grantedTop.

import type { Ability, ObjectFilter } from "../schema";
import { abilitiesOf, tryObj, type Run } from "./core";
import { withCharsEpoch } from "./layers";
import type { ObjId, PlayerId } from "./types";

export interface TopPerm { filter: ObjectFilter; lands: boolean; haste: boolean }

const POWER4: ObjectFilter = { types: ["creature"], power: { op: ">=", value: 4 } } as ObjectFilter;

export const TOP_HANDLERS = ["look_at_top_card_any_time", "cast_from_top_of_library_permission", "play_from_top_of_library"];
export const TOP_GRANTS = ["look_at_top_card_of_library_any_time", "cast_creature_spells_with_power_4_or_greater_from_top_of_library"];

function* abilitiesOfPlayer(r: Run, pid: PlayerId): Generator<Ability> {
  for (const id of r.s.battlefield) { const o = r.s.objects[id]; if (o?.controller === pid) yield* abilitiesOf(r, o); }
}
const grantsOf = (a: Ability): string[] => (a.kind === "static" && a.static ? a.static.modify.flatMap((m) => ("grant" in m ? [m.grant] : [])) : []);

/** Permissions to cast (and maybe play) cards from the top of `pid`'s library. */
export function topPerms(r: Run, pid: PlayerId): TopPerm[] {
  const out: TopPerm[] = [];
  for (const a of abilitiesOfPlayer(r, pid)) {
    const h = a.scripted?.handler;
    if (h === "cast_from_top_of_library_permission") { const sp = String((a.scripted?.params as { spells?: string } | undefined)?.spells ?? ""); out.push({ filter: sp ? { subtypes: [sp] } : {}, lands: false, haste: false }); }
    else if (h === "play_from_top_of_library") out.push({ filter: {}, lands: true, haste: false });
    for (const g of grantsOf(a)) if (g === "cast_creature_spells_with_power_4_or_greater_from_top_of_library") out.push({ filter: POWER4, lands: false, haste: true });
  }
  return out;
}

/** "You may look at the top card of your library any time" (the card is visible to its owner, see view.ts). */
export function looksAtTop(r: Run, pid: PlayerId): boolean {
  for (const a of abilitiesOfPlayer(r, pid)) if (a.scripted?.handler === "look_at_top_card_any_time" || grantsOf(a).includes("look_at_top_card_of_library_any_time")) return true;
  return false;
}

export const isTopCard = (r: Run, id: ObjId): boolean => { const o = tryObj(r, id); return !!o && o.zone === "library" && r.s.players.find((p) => p.id === o.owner)?.library[0] === id; };

/** Players who currently see their own top card (stored on the state so the hidden-information view, which has no card definitions, can show it). */
export function refreshTopLookers(r: Run): void {
  const who = withCharsEpoch(r, () => r.s.players.filter((p) => !p.hasLost && looksAtTop(r, p.id)).map((p) => p.id)); // pure reads: one shared characteristics memo for all players
  if (who.length) r.s.topLookers = who; else delete r.s.topLookers;
}
