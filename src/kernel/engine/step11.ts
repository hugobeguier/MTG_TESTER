// Kernel step 11: steps and internal handlers added for the Squirreled Away / Breena decks (repeat_process, voting, outlast ...). Registered by steps.ts.

import type { Step } from "../schema";
import { chars, emit, label, moveObject, player, tryObj, Unsupported } from "./core";
import { isObjId } from "./types";
import { revealCards } from "./library";
import { evalPredicate, objectsMatching, resolvePlayers } from "./query";
import { liveIds, saveList } from "./saved";
import { changeLife, decide, fallbackPromptOf, type Handler, type StepSpec } from "./steps";

export const STEPS11: Record<string, StepSpec> = {};
export const INTERNAL11: Record<string, Handler> = {};

// "..., then you may exile three cards from your graveyard. If you do, repeat this process." (Insatiable Frugivore): the nested steps run, then they run again
// for as long as `repeatIf` (usually step_done of the optional step) is true. The ids of the nested steps are forgotten before every round so "if you do" is per round.
const ids = (ss: Step[]): string[] => ss.flatMap((s) => [...(s.id ? [s.id] : []), ...ids(s.then ?? []), ...ids(s.else ?? []), ...ids(s.steps ?? [])]);
const round = (step: Step, n: number): Step[] => [{ kind: "__rp_begin" as never, clear: ids(step.steps ?? []) } as unknown as Step, ...(step.steps ?? []), { kind: "__rp_check" as never, process: step, n } as unknown as Step];
STEPS11.repeat_process = { fields: ["steps", "repeatIf"], run: (_r, _ex, step) => ({ push: round(step, 0) }) };
INTERNAL11.__rp_begin = (_r, ex, step) => { for (const id of (step.clear as string[]) ?? []) ex.env.done = ex.env.done.filter((d) => d !== id); return "done"; };
INTERNAL11.__rp_check = (r, ex, step) => {
  const p = step.process as Step, n = Number(step.n);
  if (n >= 200 || !p.repeatIf || !evalPredicate(r, p.repeatIf as never, ex.env)) return "done";
  return { push: round(p, n + 1) };
};

// ---------------------------------------------------------------- voting (CR 701.32): Council's Judgment
// "Starting with you, each player votes for a nonland permanent you don't control. Exile each permanent with the most votes or tied for most votes."
// The voters answer one after the other (starting with the controller, then turn order); the winners are saved as `vote_winners`.
STEPS11.vote = {
  fields: ["voters", "candidates", "tie"],
  run: (r, ex, step) => {
    const env = ex.env;
    const all = resolvePlayers(r, (step.voters ?? "each_player") as never, env);
    const i = all.indexOf(env.controller);
    const order = i > 0 ? [...all.slice(i), ...all.slice(0, i)] : all; // starting with the caster
    return { push: [{ kind: "__vote_begin" } as unknown as Step, ...order.map((p) => ({ kind: "__vote_ask", player: p, candidates: step.candidates } as unknown as Step)), { kind: "__vote_tally", id: step.id } as unknown as Step] };
  }
};
INTERNAL11.__vote_begin = (_r, ex) => { ex.env.chosen.__votes = []; return "done"; };
INTERNAL11.__vote_ask = (r, ex, step, answer) => {
  const env = ex.env, pid = String(step.player);
  const cands = liveIds(r, env, objectsMatching(r, (step.candidates ?? {}) as never, env));
  if (!cands.length) return "done";
  const d = decide({ kind: "choose_cards", player: pid, prompt: fallbackPromptOf(r, env, "vote", "Vote for a permanent."), options: cands.map((id) => ({ id, label: label(r, id) })), min: 1, max: 1 }, answer);
  if ("ask" in d) return d;
  env.chosen.__votes = [...(env.chosen.__votes ?? []), d.ids[0]];
  emit(r, { type: "voted", player: pid, id: d.ids[0], source: env.source });
  return "done";
};
INTERNAL11.__vote_tally = (r, ex) => {
  const votes = ex.env.chosen.__votes ?? [];
  const count = new Map<string, number>();
  for (const v of votes) count.set(v, (count.get(v) ?? 0) + 1);
  const top = Math.max(0, ...count.values());
  saveList(r, ex.env, "vote_winners", [...count.entries()].filter(([, n]) => n === top && top > 0).map(([id]) => id));
  return "done";
};

// ---------------------------------------------------------------- mutual reveal (Keen Duelist, Parker Luck)
// "You and target opponent / two target players each reveal the top card of your library. You each lose life equal to the mana value of the card revealed by the
// other player. You each put the card you revealed into your hand." (all at once: the mana values are read before anything moves)
STEPS11.mutual_reveal = {
  fields: ["players"],
  run: (r, ex, step) => {
    const env = ex.env;
    const targeted = [...new Set(Object.values(env.targets ?? {}).flat().filter((x) => !isObjId(x)))];
    const ps = step.players === "you_and_target_player" ? [env.controller, targeted[0]] : step.players === "target_players" ? targeted.slice(0, 2) : undefined;
    if (!ps) throw new Unsupported("field:mutual_reveal.players");
    const who = ps.filter((p): p is string => !!p && !player(r, p).hasLost);
    const cards = who.map((p) => player(r, p).library[0]);
    who.forEach((p, i) => { if (cards[i]) revealCards(r, p, [cards[i]], env.source); });
    const mv = cards.map((id) => (id ? chars(r, id).mv : 0));
    who.forEach((p, i) => { const lost = who.length === 2 ? mv[1 - i] : 0; if (lost > 0) changeLife(r, env, p, -lost); });
    cards.forEach((id) => { if (id && tryObj(r, id)?.zone === "library") moveObject(r, id, "hand"); });
    return "done";
  }
};
