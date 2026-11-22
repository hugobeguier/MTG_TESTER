// step:choose. A player picks cards / permanents, a number, a mode or a color from a candidate list computed from the CURRENT
// zones when the question is asked (and recomputed, identically, when it is answered). The answer is saved under `saveAs`
// (default: the step id, else "chosen") for later steps: `{what: "chosen"}`, `{target: "chosen"}`, `{ref: "step_result"}`.
// Only imported by steps.ts (the registry); it may use steps.ts helpers lazily.

import { milledLive } from "./reveal7";
import type { ObjectFilter, Prompt, Step } from "../schema";
import { baseChars, label, tryObj, Unsupported, type Run } from "./core";
import { evalQuantity, matchesFilter, objectsMatching, resolvePlayers } from "./query";
import { liveIds, lookedLive, saveList, setResult } from "./saved";
import { decide, type AskSpec, type StepSpec } from "./steps";
import type { Env, PlayerId } from "./types";
import { emit } from "./core";

export const CHOOSE_FIELDS = ["choice", "exclude", "remember", "options", "who", "from", "count", "saveAs", "fromLooked", "fromRevealed", "fromMilled", "upTo", "anyNumber", "min", "max", "what"];
export const CHOOSE_CHOICES = ["color", "mode", "number", "creature_type", "card_type", "basic_land_type", "card_name", "player", "opponent"];
const CARD_TYPES = ["Artifact", "Creature", "Enchantment", "Instant", "Land", "Planeswalker", "Sorcery", "Battle", "Kindred"];
const LAND_TYPES = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
const CORE_CREATURE_TYPES = ["Angel", "Beast", "Bird", "Cat", "Cleric", "Demon", "Dragon", "Elf", "Elemental", "Goblin", "Human", "Merfolk", "Rogue", "Shapeshifter", "Soldier", "Spirit", "Vampire", "Warrior", "Wizard", "Zombie"];

/** Creature subtypes / card names the game knows about: every card object's printed values plus a core list (the engine has no card database). */
function knownValues(r: Run, what: "type" | "name"): string[] {
  const out = new Set<string>(what === "type" ? CORE_CREATURE_TYPES : []);
  // the host's card database (carddb.ts) supplies the complete lists; without one: the core list + every card in the game
  for (const v of (what === "type" ? r.db?.creatureTypes() : r.db?.cardNames()) ?? []) out.add(v);
  for (const o of Object.values(r.s.objects)) {
    const c = baseChars(r, o);
    if (what === "name") { if (c.name) out.add(c.name); }
    else if (c.types.includes("creature") || c.subtypes.length) for (const st of c.subtypes) if (!LAND_TYPES.includes(st) && !["Aura", "Equipment", "Saga", "Food", "Clue", "Treasure", "Aminatou"].includes(st)) out.add(st);
  }
  return [...out].sort();
}

export const fallbackPrompt = (r: Run, env: Env, title: string, instruction: string): Prompt => ({ title: `${label(r, env.source)}: ${title}`, instruction });

/** Who answers: the step's `who` (first player) or the controller of the ability. */
export function chooserOf(r: Run, env: Env, step: Step): PlayerId {
  const ps = resolvePlayers(r, step.who ?? "you", env);
  if (ps.length !== 1) throw new Unsupported("field:choose.who", `choose needs exactly one player, got ${ps.length}`);
  return ps[0];
}

/** Candidate objects for a choose-from-zone step, in zone order. */
export function chooseCandidates(r: Run, env: Env, step: Step, chooser: PlayerId): string[] {
  const f = (step.from ?? {}) as ObjectFilter;
  if (step.fromMilled) {
    const bare = { ...f, zone: "graveyard", owner: undefined, controller: undefined } as ObjectFilter; // keep a zone so "permanent card" means a permanent-type card
    return milledLive(r, env).filter((id) => matchesFilter(r, id, bare, { ...env, controller: chooser }));
  }
  if (step.fromLooked || step.fromRevealed) {
    // "reveal an artifact card from among them": the filter applies to the looked-at cards (their zone / owner is the library they came from)
    const bare = { ...f, zone: undefined, owner: undefined, controller: undefined } as ObjectFilter;
    return lookedLive(r, env).filter((id) => matchesFilter(r, id, bare, { ...env, controller: chooser }));
  }
  return liveIds(r, env, objectsMatching(r, f, { ...env, controller: chooser }));
}

const COLOR_NAMES: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };

export const chooseStep: StepSpec = {
  fields: CHOOSE_FIELDS,
  run: (r, ex, step, answer) => {
    const env = ex.env;
    const key = String(step.saveAs ?? step.id ?? "chosen");
    const chooser = chooserOf(r, env, step);
    const title = step.prompt ?? undefined;

    if (step.choice === "color") {
      const out = ((step.exclude as string[] | undefined) ?? []).map((x) => x.toLowerCase());
      const opts = Object.entries(COLOR_NAMES).filter(([k, n]) => !out.includes(n) && !out.includes(k.toLowerCase()));
      const spec: AskSpec = { kind: "choose_color", player: chooser, prompt: title ?? fallbackPrompt(r, env, "choose a color", "Choose a color."), options: opts.map(([k, n]) => ({ id: k, label: n })), min: 1, max: 1 };
      const d = decide(spec, answer);
      if ("ask" in d) return d;
      if (step.remember) { const o = tryObj(r, env.source); if (o) o.chosen = { ...o.chosen, color: d.ids[0] }; }
      saveList(r, env, key, d.ids);
      emit(r, { type: "color_chosen", source: env.source, player: chooser, color: d.ids[0] });
      return "done";
    }

    if (step.choice === "mode") {
      const opts = (step.options as string[] | undefined) ?? [];
      if (!opts.length) throw new Unsupported("field:choose.options");
      const spec: AskSpec = { kind: "choose_option", player: chooser, prompt: title ?? fallbackPrompt(r, env, "choose one", `Choose one: ${opts.join(", ")}.`), options: opts.map((o) => ({ id: o, label: o })), min: 1, max: 1 };
      const d = decide(spec, answer);
      if ("ask" in d) return d;
      if (step.remember) { const o = tryObj(r, env.source); if (o) o.chosen = { ...o.chosen, mode: d.ids[0] }; }
      saveList(r, env, key, d.ids);
      emit(r, { type: "option_chosen", source: env.source, player: chooser, option: d.ids[0] });
      return "done";
    }

    if (step.choice === "number") {
      const min = step.min === undefined ? 0 : evalQuantity(r, step.min as never, env);
      if (step.max === undefined) throw new Unsupported("field:choose.max", "choose number needs a maximum");
      const max = evalQuantity(r, step.max as never, env);
      const spec: AskSpec = { kind: "choose_number", player: chooser, prompt: title ?? fallbackPrompt(r, env, "choose a number", `Choose a number from ${min} to ${max}.`), options: [], min, max, numeric: true };
      const d = decide(spec, answer);
      if ("ask" in d) return d;
      saveList(r, env, key, []);
      setResult(env, key, d.number!);
      if (step.id && step.id !== key) setResult(env, step.id, d.number!);
      emit(r, { type: "number_chosen", source: env.source, player: chooser, number: d.number });
      return "done";
    }

    if (step.choice === "creature_type" || step.choice === "card_type" || step.choice === "basic_land_type" || step.choice === "card_name") {
      const opts = step.choice === "creature_type" ? knownValues(r, "type") : step.choice === "card_name" ? knownValues(r, "name") : step.choice === "card_type" ? CARD_TYPES : LAND_TYPES;
      const noun = step.choice.replace(/_/g, " ");
      const spec: AskSpec = { kind: "choose_option", player: chooser, prompt: title ?? fallbackPrompt(r, env, `choose a ${noun}`, `Choose a ${noun}.`), options: opts.map((o) => ({ id: o, label: o })), min: 1, max: 1 };
      const d = decide(spec, answer);
      if ("ask" in d) return d;
      if (step.remember) {
        const o = tryObj(r, env.source);
        if (o) o.chosen = { ...o.chosen, ...(step.choice === "creature_type" ? { type: d.ids[0] } : step.choice === "card_type" ? { cardType: d.ids[0] } : step.choice === "basic_land_type" ? { landType: d.ids[0] } : { name: d.ids[0] }) };
      }
      saveList(r, env, key, []);
      emit(r, { type: "option_chosen", source: env.source, player: chooser, option: d.ids[0], what: step.choice });
      return "done";
    }

    if (step.choice === "player" || step.choice === "opponent") {
      const ps = (step.choice === "opponent" ? resolvePlayers(r, "each_opponent", env) : resolvePlayers(r, "each_player", env));
      if (ps.length === 0) return "done";
      const spec: AskSpec = { kind: "choose_option", player: chooser, prompt: title ?? fallbackPrompt(r, env, `choose ${step.choice === "opponent" ? "an opponent" : "a player"}`, `Choose ${step.choice === "opponent" ? "an opponent" : "a player"}.`), options: ps.map((p) => ({ id: p, label: label(r, p) })), min: 1, max: 1 };
      const d = ps.length === 1 ? { ids: [ps[0]] } : decide(spec, answer);
      if ("ask" in d) return d;
      env.thatPlayer = d.ids[0]; // later steps say "that player"
      saveList(r, env, key, []);
      emit(r, { type: "player_chosen", source: env.source, player: chooser, chosen: d.ids[0] });
      return "done";
    }

    if (step.choice !== undefined) throw new Unsupported(`field:choose.choice=${String(step.choice)}`);
    if (!step.from && !step.fromLooked && !step.fromRevealed && !step.fromMilled) throw new Unsupported("field:choose.from", "choose needs `from` (or a choice kind)");

    // ---- cards / permanents from the current zones
    const cands = chooseCandidates(r, env, step, chooser);
    const count = step.count === undefined ? 1 : evalQuantity(r, step.count as never, env);
    const optionalCount = !!(step.upTo || step.anyNumber);
    const max = step.anyNumber ? cands.length : Math.min(count, cands.length);
    const min = optionalCount ? 0 : max;
    // a step with an id different from its saveAs also leaves "how many were chosen" as its numeric result ({ref: step_result})
    const count_ = (ids: string[]) => { saveList(r, env, key, ids); if (step.id && step.id !== key) setResult(env, step.id, ids.length); };
    if (cands.length === 0 || max === 0) { count_([]); return "done"; }
    if (min === max && max === cands.length) { count_(cands); return "done"; } // nothing to choose
    const spec: AskSpec = {
      kind: "choose_cards", player: chooser,
      prompt: title ?? fallbackPrompt(r, env, "choose", `Choose ${optionalCount ? "up to " : ""}${max} ${max === 1 ? "card" : "cards"}.`),
      options: cands.map((id) => ({ id, label: label(r, id) })), min, max
    };
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    count_(d.ids);
    emit(r, { type: "cards_chosen", player: chooser, count: d.ids.length });
    return "done";
  }
};
