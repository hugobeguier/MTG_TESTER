// Small helpers for the capability-family tests (choose / move / search / costs / hidden information): hand-authored cards on top
// of testcards.ts, and a table whose lookup knows them.

import { generatePrompts } from "../prompts";
import type { Ability, Card, Step } from "../schema";
import { CARDS, game } from "./testcards";
import type { CardDef } from "./types";
import type { Table } from "./testkit";

export const one = { min: 1, max: 1 };
export const mk = (name: string, meta: Omit<CardDef, "name" | "kernel">, abilities: Ability[]): CardDef => ({ name, ...meta, kernel: generatePrompts({ schemaVersion: 2, abilities } as Card, name) });
export const sorcery = (name: string, manaCost: string, steps: Step[], targets?: Ability["targets"]): CardDef =>
  mk(name, { manaCost, types: ["sorcery"] }, [{ id: "a1", kind: "spell_effect", text: name, steps, ...(targets ? { targets } : {}) }]);
export const instant = (name: string, manaCost: string, steps: Step[], targets?: Ability["targets"]): CardDef =>
  mk(name, { manaCost, types: ["instant"] }, [{ id: "a1", kind: "spell_effect", text: name, steps, ...(targets ? { targets } : {}) }]);
/** An artifact with one activated ability. */
export const device = (name: string, ability: Pick<Ability, "costs" | "steps"> & Partial<Ability>): CardDef =>
  mk(name, { manaCost: "{1}", types: ["artifact"] }, [{ id: "a1", kind: "activated", text: name, ...ability } as Ability]);
export const filler = (name: string, types = ["creature"], p = 1, t = 1, subtypes: string[] = []): CardDef => mk(name, { manaCost: "{1}", types, subtypes, power: p, toughness: t }, []);

export const famCards: Record<string, CardDef> = {
  "Fill A": filler("Fill A"), "Fill B": filler("Fill B"), "Fill C": filler("Fill C"), "Fill D": filler("Fill D"), "Fill E": filler("Fill E"),
  "Fill Land": mk("Fill Land", { types: ["land"] }, []),
  "Fill Artifact": filler("Fill Artifact", ["artifact"], 0, 0),
  "Big Elf": filler("Big Elf", ["creature"], 4, 4, ["Elf"])
};

export function fam(extra: Record<string, CardDef> = {}): Table { return game({ extra: { ...famCards, ...extra } }); }
export { CARDS };
