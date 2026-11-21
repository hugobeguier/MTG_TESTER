// Commander rules (kernel step 7): the 40-life / commander-damage / commander-tax / command-zone parts of the format.
//   - commander designation: `GameObject.isCommander` (set by newGame for `PlayerSetup.commander`); casting from the command zone adds
//     {2} per previous cast (resolve.ts commitDraft, `PlayerState.commanderCasts`).
//   - command zone option (903.9): a commander that would go to the hand or library (replacement) may go to the command zone instead; one
//     that went to the graveyard or exile may be moved by a state-based action. Both are a yes/no decision for the OWNER, asked through the
//     replay protocol (deterministic). Declining a graveyard/exile move is remembered until the card changes zone (`commanderDeclined`).
//   - commander damage (903.10a): combat damage dealt to a player by a commander is counted per commander; 21 from one commander = loss.
//   - `can_be_your_commander` scripted ability: a deck-construction marker (a legal commander is a legendary creature or has it).

import type { Prompt } from "../schema";
import { NeedAsk, label, takeAnswer, tryObj, type Run } from "./core";
import type { AskSpec } from "./steps";
import type { CardDef, GameObject, ObjId, PlayerId } from "./types";

export const COMMANDER_DAMAGE_LIMIT = 21;

export function canBeCommander(def: CardDef | undefined): boolean {
  if (!def) return false;
  const types = def.types.map((t) => t.toLowerCase()), sup = (def.supertypes ?? []).map((t) => t.toLowerCase());
  if (sup.includes("legendary") && types.includes("creature")) return true;
  return def.kernel.abilities.some((a) => a.scripted?.handler === "can_be_your_commander");
}

const yesNo = (p: PlayerId, prompt: Prompt): AskSpec => ({ kind: "choose_yes_no", player: p, prompt, options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], min: 1, max: 1 });

/** Replacement-style question: the owner of a commander that would go to hand / library / graveyard / exile. true = command zone instead. */
export function askCommandZone(r: Run, o: GameObject, to: string): boolean {
  const given = takeAnswer(r);
  if (given === undefined) {
    const name = label(r, o.id);
    throw new NeedAsk(yesNo(o.owner, { title: `${name}: command zone?`, instruction: `${name} would go to ${to === "hand" ? "your hand" : to === "library" ? "your library" : `the ${to}`}. Put it into the command zone instead?` }));
  }
  return given.yes === true || given.ids?.[0] === "yes";
}

export function addCommanderDamage(r: Run, victim: PlayerId, commander: ObjId, amount: number): void {
  const m = ((r.s.commanderDamage ??= {})[victim] ??= {});
  m[commander] = (m[commander] ?? 0) + amount;
}

export const isCommanderObj = (r: Run, id: ObjId | undefined): boolean => !!id && !!tryObj(r, id)?.isCommander;

/** Players with 21+ commander damage from a single commander. */
export function overCommanderLimit(r: Run, pid: PlayerId): boolean {
  return Object.values(r.s.commanderDamage?.[pid] ?? {}).some((n) => n >= COMMANDER_DAMAGE_LIMIT);
}
