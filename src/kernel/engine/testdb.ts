// TEST HELPER ONLY (reads data/cards.db): a CardDb adapter for the engine tests. The engine itself never imports this.
import Database from "better-sqlite3";
import path from "node:path";
import type { CardDb, CardInfo, FaceDef } from "./types";

const SUPERS = new Set(["legendary", "basic", "snow", "world", "ongoing"]);
const TYPES = new Set(["artifact", "creature", "enchantment", "instant", "land", "planeswalker", "sorcery", "battle", "kindred", "tribal"]);
function parseLine(line: string): { types: string[]; subtypes: string[]; supertypes: string[] } {
  const [left, right] = line.split(" — ");
  const words = left.split(/\s+/).map((w) => w.toLowerCase()).filter(Boolean);
  return { types: words.filter((w) => TYPES.has(w)), supertypes: words.filter((w) => SUPERS.has(w)), subtypes: right ? right.split(/\s+/) : [] };
}
const NOT_CREATURE_TYPES = new Set(["Forest", "Island", "Plains", "Swamp", "Mountain", "Aura", "Equipment", "Saga", "Food", "Clue", "Treasure"]);
interface RawFace { name: string; typeLine: string; manaCost?: string; colors?: string[]; power?: string; toughness?: string; loyalty?: string; oracleText?: string }
const num = (v: string | undefined) => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : undefined);
const faceOf = (f: RawFace): FaceDef => { const p = parseLine(f.typeLine); return { ...(f.manaCost ? { manaCost: f.manaCost } : {}), ...p, ...(f.colors ? { colors: f.colors } : {}), ...(num(f.power) !== undefined ? { power: num(f.power) } : {}), ...(num(f.toughness) !== undefined ? { toughness: num(f.toughness) } : {}), ...(num(f.loyalty) !== undefined ? { loyalty: num(f.loyalty) } : {}) }; };

export function sqliteCardDb(file = path.resolve(process.cwd(), "data/cards.db")): CardDb {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  let types: string[] | undefined, names: string[] | undefined;
  const byName = db.prepare("SELECT name, type_line, mana_cost, colors, oracle_text, raw FROM cards WHERE lower(name) = lower(?) OR lower(name) LIKE lower(?) || ' // %' LIMIT 1");
  return {
    creatureTypes() {
      if (!types) {
        const set = new Set<string>();
        for (const row of db.prepare("SELECT type_line FROM cards WHERE type_line LIKE '%Creature%' OR type_line LIKE '%Kindred%' OR type_line LIKE '%Tribal%'").all() as Array<{ type_line: string }>) {
          for (const face of row.type_line.split(" // ")) { const [l, r] = face.split(" — "); if (r && /creature|kindred|tribal/i.test(l)) for (const t of r.split(/\s+/)) if (t && !NOT_CREATURE_TYPES.has(t)) set.add(t); }
        }
        types = [...set].sort();
      }
      return types;
    },
    cardNames() { return (names ??= (db.prepare("SELECT name FROM cards").all() as Array<{ name: string }>).map((r) => r.name).sort()); },
    card(name): CardInfo | undefined {
      const row = byName.get(name, name) as { name: string; type_line: string; mana_cost: string | null; colors: string; oracle_text: string; raw: string } | undefined;
      if (!row) return undefined;
      const raw = JSON.parse(row.raw) as { power?: string; toughness?: string; loyalty?: string; faces?: RawFace[] };
      const rawFaces = raw.faces ?? [];
      const front = rawFaces[0] ? faceOf(rawFaces[0]) : { ...parseLine(row.type_line), ...(row.mana_cost ? { manaCost: row.mana_cost } : {}) };
      const info: CardInfo = { name: row.name, ...front, oracle: row.oracle_text, // power and toughness separately: a "*"/4 card (Callaphe, Beloved of the Sea) has a printed toughness and no numeric power
        ...(!rawFaces[0] && num(raw.power) !== undefined ? { power: num(raw.power) } : {}), ...(!rawFaces[0] && num(raw.toughness) !== undefined ? { toughness: num(raw.toughness) } : {}) };
      if (rawFaces.length >= 2) {
        info.faces = Object.fromEntries(rawFaces.map((f) => [f.name, faceOf(f)]));
        const back = faceOf(rawFaces[1]);
        const adventure = /adventure/i.test(rawFaces[1].typeLine);
        const spellBoth = rawFaces.every((f) => /instant|sorcery/i.test(f.typeLine));
        info.layout = adventure ? "adventure" : spellBoth ? "split" : (back.manaCost || (back.types.includes("land") && !front.types.includes("land"))) ? "modal_dfc" : "transform";
      }
      return info;
    }
  };
}

// ---- real cards for tests: the draft JSON + the printed data from data/cards.db (no hand-written metadata per card)
import fs from "node:fs";
import { table, type Table } from "./testkit";
import type { CardDef, PlayerId } from "./types";
import { CardSchema } from "../schema";

let nameToFile: Map<string, string> | undefined;
function files(): Map<string, string> {
  if (nameToFile) return nameToFile;
  const m = new Map<string, string>();
  const root = path.resolve(process.cwd(), "data/kernel-drafts");
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    const ix = path.join(root, d.name, "_index.json");
    if (!d.isDirectory() || !fs.existsSync(ix)) continue;
    for (const e of JSON.parse(fs.readFileSync(ix, "utf8")).cards as Array<{ name: string; slug: string }>) if (!m.has(e.name)) m.set(e.name, path.join(root, d.name, e.slug + ".json"));
  }
  return (nameToFile = m);
}
let sharedDb: CardDb | undefined;
export const testDb = (): CardDb => (sharedDb ??= sqliteCardDb());
const defs = new Map<string, CardDef | null>();
/** A CardDef for a drafted card: kernel JSON from data/kernel-drafts, printed characteristics from data/cards.db. */
export function realDef(name: string): CardDef | undefined {
  const hit = defs.get(name);
  if (hit !== undefined) return hit ?? undefined;
  const f = files().get(name);
  const info = f ? testDb().card(name) : undefined;
  if (!f || !info) { defs.set(name, null); return undefined; }
  const { oracle: _o, name: _n, ...meta } = info;
  const def: CardDef = { name, ...meta, kernel: CardSchema.parse(JSON.parse(fs.readFileSync(f, "utf8"))) } as CardDef;
  defs.set(name, def);
  return def;
}
/** Extra-card record for `table({extra})` that resolves any drafted card by name. */
export const realCards: Record<string, CardDef> = new Proxy({}, { get: (_t, n) => (typeof n === "string" ? realDef(n) : undefined) });
/** A table whose cards are real drafts + data/cards.db metadata, with the CardDb attached. Cards not in the drafts can be given in `extra`. */
const lookups = new WeakMap<object, (n: string) => CardDef | undefined>();
export function realTable(players: PlayerId[] = ["p1", "p2"], extra: Record<string, CardDef> = {}): Table {
  const look = (n: string): CardDef | undefined => extra[n] ?? realDef(n);
  const t = table(players, { extra: new Proxy(extra, { get: (tt, n) => (typeof n === "string" ? tt[n] ?? realDef(n) : undefined) }), db: testDb() });
  lookups.set(t, look);
  return t;
}

import { chars } from "./core";
/** Effective characteristics of an object in a table made by realTable (test helper). */
export function charsOf(t: Table, id: string) {
  return chars({ s: structuredClone(t.state), events: [], defs: lookups.get(t)!, scanned: 0 } as never, id);
}
