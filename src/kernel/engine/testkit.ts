// Test helpers (file reads are allowed here, never in the engine): card definitions from data/kernel-drafts plus
// a few hand-authored cards for rules the drafted cards do not exercise.

import fs from "node:fs";
import path from "node:path";
import { sphinx } from "../fixtures/examples";
import { generatePrompts } from "../prompts";
import { CardSchema, type Card } from "../schema";
import { createEngine } from "./setup";
import type { Action, CardDef, Choice, GameState, ObjId, PlayerId, ResolveResult } from "./types";

const DRAFTS = path.resolve(process.cwd(), "data/kernel-drafts");
let index: Map<string, string> | undefined;
function draftIndex(): Map<string, string> {
  if (index) return index;
  const m = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".json") && !e.name.startsWith("_") && !m.has(e.name.slice(0, -5))) m.set(e.name.slice(0, -5), p);
    }
  };
  walk(DRAFTS);
  return (index = m);
}
export function loadDraft(slug: string): Card {
  const p = draftIndex().get(slug);
  if (!p) throw new Error(`no draft for ${slug}`);
  return CardSchema.parse(JSON.parse(fs.readFileSync(p, "utf8")));
}
export function allDraftFiles(): string[] { return [...draftIndex().values()]; }

type Meta = Omit<CardDef, "kernel" | "name"> & { slug: string };
const land = (sub: string): Meta => ({ slug: sub.toLowerCase(), types: ["land"], subtypes: [sub], supertypes: ["basic"] });
const META: Record<string, Meta> = {
  Island: land("Island"), Plains: land("Plains"), Swamp: land("Swamp"), Mountain: land("Mountain"), Forest: land("Forest"),
  "Lightning Bolt": { slug: "lightning-bolt", manaCost: "{R}", types: ["instant"] },
  "Sol Ring": { slug: "sol-ring", manaCost: "{1}", types: ["artifact"] },
  "Arcane Signet": { slug: "arcane-signet", manaCost: "{2}", types: ["artifact"] },
  "Mind-Stone": { slug: "mind-stone", manaCost: "{2}", types: ["artifact"] },
  "Valorous Stance": { slug: "valorous-stance", manaCost: "{1}{W}", types: ["instant"] },
  "Casualties of War": { slug: "casualties-of-war", manaCost: "{2}{B}{B}{G}{G}", types: ["sorcery"] },
  "Ledger Shredder": { slug: "ledger-shredder", manaCost: "{1}{U}", types: ["creature"], subtypes: ["Bird", "Artificer"], power: 1, toughness: 3 },
  "Mazemind Tome": { slug: "mazemind-tome", manaCost: "{2}", types: ["artifact"] },
  Counterspell: { slug: "counterspell", manaCost: "{U}{U}", types: ["instant"] },
  Negate: { slug: "negate", manaCost: "{1}{U}", types: ["instant"] },
  "Swords to Plowshares": { slug: "swords-to-plowshares", manaCost: "{W}", types: ["instant"] },
  "Ravenous Chupacabra": { slug: "ravenous-chupacabra", manaCost: "{2}{B}{B}", types: ["creature"], subtypes: ["Beast", "Horror"], power: 2, toughness: 2 },
  "Midnight Reaper": { slug: "midnight-reaper", manaCost: "{2}{B}", types: ["creature"], subtypes: ["Zombie", "Knight"], power: 3, toughness: 2 },
  Plaguecrafter: { slug: "plaguecrafter", manaCost: "{2}{B}", types: ["creature"], subtypes: ["Human", "Shaman"], power: 3, toughness: 2 },
  "Rootcast Apprenticeship": { slug: "rootcast-apprenticeship", manaCost: "{4}{G}", types: ["sorcery"] },
  Brainstorm: { slug: "brainstorm", manaCost: "{U}", types: ["instant"] },
  "Spymaster's Vault": { slug: "spymaster-s-vault", types: ["land"] },
  "Llanowar Elves": { slug: "llanowar-elves", manaCost: "{G}", types: ["creature"], subtypes: ["Elf", "Druid"], power: 1, toughness: 1 },
  "Caves of Koilos": { slug: "caves-of-koilos", types: ["land"] }
};

const one = { min: 1, max: 1 };
const prompted = (name: string, card: Card): Card => generatePrompts(card, name);
const CUSTOM: Record<string, CardDef> = {
  "Sphinx's Insight": { name: "Sphinx's Insight", manaCost: "{2}{U}{U}", types: ["instant"], kernel: prompted("Sphinx's Insight", sphinx.card) },
  // choose three, the same mode more than once
  "Triple Choice": {
    name: "Triple Choice", manaCost: "{2}{R}", types: ["sorcery"],
    kernel: prompted("Triple Choice", {
      schemaVersion: 2,
      abilities: [{
        id: "a1", kind: "spell_effect", text: "Choose three. You may choose the same mode more than once.\n• Draw a card.\n• You gain 2 life.\n• Triple Choice deals 1 damage to any target.",
        modes: {
          choose: { min: 3, max: 3 }, distinct: false, repeatable: true,
          options: [
            { id: "m1", text: "Draw a card.", steps: [{ kind: "draw_cards", amount: 1, who: "you" }] },
            { id: "m2", text: "You gain 2 life.", steps: [{ kind: "life_change", lifeDelta: 2, who: "you" }] },
            { id: "m3", text: "Triple Choice deals 1 damage to any target.", targets: [{ id: "t1", what: "any", count: one }], steps: [{ kind: "damage_target", target: "t1", amount: 1 }] }
          ]
        }
      }]
    })
  },
  "Mind Rot": {
    name: "Mind Rot", manaCost: "{2}{B}", types: ["sorcery"],
    kernel: prompted("Mind Rot", { schemaVersion: 2, abilities: [{ id: "a1", kind: "spell_effect", text: "Target player discards two cards.", targets: [{ id: "t1", what: "player", count: one }], steps: [{ kind: "discard", who: "target_player", amount: 2 }] }] })
  },
  "Curious Peek": {
    name: "Curious Peek", manaCost: "{U}", types: ["instant"],
    kernel: prompted("Curious Peek", { schemaVersion: 2, abilities: [{ id: "a1", kind: "spell_effect", text: "You may draw a card.", steps: [{ kind: "draw_cards", amount: 1, who: "you", optional: true }] }] })
  },
  "Bear Cub": { name: "Bear Cub", manaCost: "{1}{G}", types: ["creature"], subtypes: ["Bear"], power: 2, toughness: 2, kernel: { schemaVersion: 2, abilities: [] } },
  // mandatory infinite loop: every creature that enters makes another creature that enters
  "Soldier Factory": {
    name: "Soldier Factory", manaCost: "{1}{W}", types: ["creature"], subtypes: ["Human"], power: 1, toughness: 1,
    kernel: prompted("Soldier Factory", {
      schemaVersion: 2,
      abilities: [{
        id: "a1", kind: "triggered", text: "Whenever a creature enters the battlefield under your control, create a 1/1 white Soldier creature token.",
        trigger: { event: "etb", subject: { types: ["creature"], controller: "you" } },
        steps: [{ kind: "create_tokens", tokenCount: 1, tokenName: "Soldier", tokenPower: 1, tokenToughness: 1, tokenColors: ["white"], tokenTypeLine: "Creature — Soldier" }]
      }]
    })
  },
  "Echo Watcher": {
    name: "Echo Watcher", manaCost: "{1}", types: ["creature"], subtypes: ["Spirit"], power: 1, toughness: 1,
    kernel: prompted("Echo Watcher", { schemaVersion: 2, abilities: [{ id: "a1", kind: "triggered", text: "Whenever a creature enters the battlefield, you gain 1 life.", trigger: { event: "etb", subject: { types: ["creature"] } }, steps: [{ kind: "life_change", lifeDelta: 1, who: "you" }] }] })
  },
  "Fizzle Pinger": {
    name: "Fizzle Pinger", manaCost: "{R}", types: ["instant"],
    kernel: prompted("Fizzle Pinger", { schemaVersion: 2, abilities: [{ id: "a1", kind: "spell_effect", text: "Deal 2 damage to target creature.", targets: [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: one }], steps: [{ kind: "damage_target", target: "t1", amount: 2 }] }] })
  },
  "Fireball Lite": {
    name: "Fireball Lite", manaCost: "{X}{R}", types: ["sorcery"],
    kernel: prompted("Fireball Lite", { schemaVersion: 2, abilities: [{ id: "a1", kind: "spell_effect", text: "Fireball Lite deals X damage to any target.", targets: [{ id: "t1", what: "any", count: one }], steps: [{ kind: "damage_target", target: "t1", amount: { ref: "X" } }] }] })
  }
};

export function lookup(name: string): CardDef | undefined {
  if (CUSTOM[name]) return CUSTOM[name];
  const m = META[name];
  if (!m) return undefined;
  const { slug, ...rest } = m;
  return { name, ...rest, kernel: loadDraft(slug) };
}

export const engDefault = createEngine(lookup);
export const eng = engDefault;

type Zone = "hand" | "battlefield" | "graveyard" | "library" | "exile";

/** A game with the given players and empty zones; cards are added with `give`. */
export function table(playerIds: PlayerId[] = ["p1", "p2"], opts: { phase?: "upkeep" | "precombat_main"; config?: Parameters<typeof eng.newGame>[0]["config"]; extra?: Record<string, CardDef> } = {}) {
  const eng = opts.extra ? createEngine((n) => opts.extra![n] ?? lookup(n)) : engDefault;
  let state: GameState = eng.newGame({ players: playerIds.map((id) => ({ id, deck: [] })), seed: 7, openingHand: 0, startPhase: opts.phase ?? "precombat_main", config: opts.config });
  const api = {
    get state(): GameState { return state; },
    set state(s: GameState) { state = s; },
    give(owner: PlayerId, name: string, zone: Zone, o?: { tapped?: boolean; fresh?: boolean; counters?: Record<string, number>; top?: boolean }): ObjId {
      const res = eng.place(state, owner, name, zone, o);
      state = res.state;
      return res.id;
    },
    lands(owner: PlayerId, name: string, n: number): ObjId[] { return Array.from({ length: n }, () => api.give(owner, name, "battlefield")); },
    do(action: Action): ResolveResult {
      const res = eng.resolve(state, action);
      if (!res.error) state = res.state;
      return res;
    },
    ok(action: Action): ResolveResult {
      const res = api.do(action);
      if (res.error) throw new Error(`${action.type} failed: ${res.error.code} ${res.error.message}`);
      return res;
    },
    pass(...ps: PlayerId[]): ResolveResult { let last!: ResolveResult; for (const p of ps) last = api.ok({ type: "passPriority", player: p }); return last; },
    answer(res: ResolveResult, choice: Choice): ResolveResult {
      return api.ok({ type: "answerDecision", player: res.pending!.player, decisionId: res.pending!.id, choice });
    },
    obj(id: ObjId) { return state.objects[id]; },
    p(id: PlayerId) { return state.players.find((x) => x.id === id)!; },
    /** every player passes in turn order starting from the priority holder (resolves the top of the stack) */
    resolveTop(): ResolveResult {
      let last!: ResolveResult;
      for (let i = 0; i < state.players.length + 1; i++) {
        last = api.ok({ type: "passPriority", player: state.priority! });
        if (state.pending || state.passes.length === 0) break;
      }
      return last;
    }
  };
  return api;
}
export type Table = ReturnType<typeof table>;
