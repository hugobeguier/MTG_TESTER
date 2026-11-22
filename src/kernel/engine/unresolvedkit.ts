// Helpers for the continue-mode tests (unresolved*.test.ts): hand-written cards with deliberately unsupported shapes.
import { generatePrompts } from "../prompts";
import { table } from "./testkit";
import type { CardDef, GameEvent } from "./types";

export type Raw = Record<string, unknown>;
/** A hand-written card: `abilities` are raw ability objects (the schema is not parsed, so deliberately unsupported shapes are fine). */
export const mk = (name: string, types: string[], abilities: Raw[], extra: Partial<CardDef> & { castOptions?: Raw[] } = {}): CardDef => {
  const { castOptions, ...rest } = extra;
  return {
    name, manaCost: rest.manaCost ?? "{U}", types, ...rest,
    kernel: { ...generatePrompts({ schemaVersion: 2, abilities: abilities.map((a, i) => ({ id: `a${i + 1}`, text: name, ...a })) } as never, name), ...(castOptions ? { castOptions } : {}) } as never
  };
};
export const spell = (name: string, steps: Raw[], extra: Raw = {}, cost = "{U}") => mk(name, ["instant"], [{ kind: "spell_effect", steps, ...extra }], { manaCost: cost });
export const perm = (name: string, abilities: Raw[], types = ["enchantment"], cost = "{U}") => mk(name, types, abilities, { manaCost: cost });

export const CONT = { onUnsupported: "continue" as const };
export const unres = (evs: GameEvent[]) => evs.filter((e) => e.type === "unresolved") as Array<GameEvent & Record<string, any>>;
/** A continue-mode table with `cards` registered, p1 holding a card named `name` in hand and `n` Islands on the battlefield. */
export function setup(cards: CardDef[], opts: { players?: string[]; mode?: "continue" | "error" } = {}) {
  const extra = Object.fromEntries(cards.map((c) => [c.name, c]));
  const t = table(opts.players ?? ["p1", "p2"], { extra, config: opts.mode === "error" ? {} : CONT });
  t.lands("p1", "Island", 6);
  return t;
}
export function cast(t: ReturnType<typeof setup>, name: string, zoneGive: "hand" = "hand") {
  const id = t.give("p1", name, zoneGive);
  const res = t.ok({ type: "castSpell", player: "p1", cardId: id });
  return { id, res };
}
/** cast + let everything resolve; returns all events */
export function castAndResolve(t: ReturnType<typeof setup>, name: string): { id: string; events: GameEvent[] } {
  const { id, res } = cast(t, name);
  const evs = [...res.events];
  let guard = 0;
  while (t.state.stack.length && guard++ < 10) evs.push(...t.resolveTop().events);
  return { id, events: evs };
}

