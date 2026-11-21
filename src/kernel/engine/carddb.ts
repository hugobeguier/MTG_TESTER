// The host-supplied card database (kernel step 6). The engine never reads files: the host passes a `CardDb` next to the card lookup.
// It answers what the card JSON does not carry: the list of creature types / card names (choose a creature type / a card name), and
// the printed characteristics of faces and the layout of multi-faced cards (merged into a CardDef that lacks them).

import type { CardDb, CardDef, CardLookup } from "./types";

const merged = new WeakMap<CardDb, WeakMap<CardDef, CardDef>>();

/** Wraps a lookup so that defs without `faces` / `layout` / `manaCost` / types take them from the database (one object per card, cached). */
export function withCardDb(lookup: CardLookup, db: CardDb | undefined): CardLookup {
  if (!db) return lookup;
  let cache = merged.get(db);
  if (!cache) { cache = new WeakMap(); merged.set(db, cache); }
  const c = cache;
  return (name) => {
    const def = lookup(name);
    if (!def) return def;
    const hit = c.get(def);
    if (hit) return hit;
    const info = db.card(name);
    let out = def;
    if (info && (def.faces === undefined || def.layout === undefined)) {
      out = { ...def, faces: def.faces ?? info.faces, layout: def.layout ?? info.layout };
      if (out.faces === undefined) delete out.faces;
      if (out.layout === undefined) delete out.layout;
    }
    c.set(def, out);
    return out;
  };
}
