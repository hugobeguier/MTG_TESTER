// A browser-safe DraftLookup (the shape the forward adapter `toKernelState` needs) built from card packs: no fs, no sqlite.
// Cards the packs do not know (a card of a hand-off game that was never drafted) get the same STUB definition the Node lookup makes
// (printed data from the legacy card, no abilities) and are listed in `noDraft`.
import type { DraftLookup, LegacyCardInfo } from "../observer/draftLookup";
import { parseTypeLine } from "../observer/typeLine";
import type { CardDef } from "../engine/types";
import type { PackKit } from "./cardPack";

const BASIC_LANDS = /^(Snow-Covered )?(Plains|Island|Swamp|Mountain|Forest)$|^Wastes$/;
const num = (v: string | undefined): number | undefined => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : undefined);

export function packDraftLookup(kit: PackKit): DraftLookup {
  const legacy = new Map<string, LegacyCardInfo>();
  const noDraft = new Set<string>();
  const stubs = new Map<string, CardDef>();
  const aliases = new Map<string, string>();
  for (const n of kit.names) if (n.includes(" // ")) for (const part of n.split(" // ")) if (!aliases.has(part)) aliases.set(part, n);

  const stub = (name: string): CardDef | undefined => {
    const hit = stubs.get(name);
    if (hit) return hit;
    const info = kit.db.card(name);
    const l = legacy.get(name);
    if (!info && !l) return undefined;
    if (!BASIC_LANDS.test(name)) noDraft.add(name);
    const base = info ?? { name, ...(l!.manaCost ? { manaCost: l!.manaCost } : {}), ...parseTypeLine(l!.typeLine), ...(num(l!.power) !== undefined ? { power: num(l!.power) } : {}), ...(num(l!.toughness) !== undefined ? { toughness: num(l!.toughness) } : {}), ...(num(l!.loyalty) !== undefined ? { loyalty: num(l!.loyalty) } : {}) };
    const { oracle: _o, name: _n, ...meta } = base as typeof base & { oracle?: string };
    const def = { name, ...meta, kernel: { schemaVersion: 2, abilities: [] } } as CardDef;
    stubs.set(name, def);
    return def;
  };

  return {
    lookup: (name) => kit.lookup(name) ?? stub(name),
    db: kit.db,
    register(info) { if (!legacy.has(info.name)) legacy.set(info.name, info); },
    hasDraft: (name) => !!kit.lookup(name) || aliases.has(name) || BASIC_LANDS.test(name),
    canonical(name) {
      const full = aliases.get(name);
      if (!full || full === name) return { card: name };
      const parts = full.split(" // ");
      return parts[0] === name ? { card: full } : { card: full, face: name };
    },
    noDraft,
    draftCount: () => kit.names.length
  };
}
