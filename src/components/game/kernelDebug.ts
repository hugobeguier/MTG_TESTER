// Kernel debug mode, the pure part (no React, no DOM): the remembered checkbox, when the panel shows, the library picker's filter / sort, what a pick turns into
// (a sandbox action), the conjure search, and the per-card "Cast for free (debug)" entry. The engine side is kernel/engine/sandbox.ts; the panel and the picker are
// KernelDebugPanel.tsx / KernelDebugPicker.tsx. Nothing here talks to the engine, so it is all unit-testable.
import type { VisibleCard } from "@/lib/types";
import type { ManaColor, SandboxAction, SandboxZone } from "@/kernel/engine/types";

/** a sandbox action without its seat: the controller adds the human's seat */
export type DebugInput = SandboxAction extends infer A ? (A extends { player: string } ? Omit<A, "player"> : never) : never;

export const DEBUG_STORAGE_KEY = "mtg-kernel-debug-mode";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const browserStorage = (): StorageLike | undefined => { try { return typeof window !== "undefined" ? window.localStorage : undefined; } catch { return undefined; } };

/** the remembered checkbox (off when nothing is stored or the storage is unavailable) */
export function loadDebugFlag(storage: StorageLike | undefined = browserStorage()): boolean {
  try { return storage?.getItem(DEBUG_STORAGE_KEY) === "1"; } catch { return false; }
}
export function saveDebugFlag(on: boolean, storage: StorageLike | undefined = browserStorage()): void {
  try { storage?.setItem(DEBUG_STORAGE_KEY, on ? "1" : "0"); } catch { /* private window / blocked storage: the checkbox just is not remembered */ }
}

/** the Debug tools panel (and its buttons) exist only while the checkbox is ticked AND the engine accepted the switch */
export function debugPanelVisible(checkbox: boolean, engineSandbox: boolean): boolean { return checkbox && engineSandbox; }

// ---------------------------------------------------------------- the picker (library search / put a card into a zone)

export type PickerSource = "library" | "hand" | "graveyard" | "exile";
export const PICKER_SOURCES: ReadonlyArray<{ id: PickerSource; label: string }> = [
  { id: "library", label: "Library" }, { id: "hand", label: "Hand" }, { id: "graveyard", label: "Graveyard" }, { id: "exile", label: "Exile" }
];

export type PickerSort = "library" | "name" | "mana" | "type";
export const PICKER_SORTS: ReadonlyArray<{ id: PickerSort; label: string }> = [
  { id: "library", label: "Library order (top first)" }, { id: "name", label: "Name" }, { id: "mana", label: "Mana value" }, { id: "type", label: "Type" }
];

/** where a pick can go; the first one is the default ("To hand") */
export const PICKER_DESTINATIONS: ReadonlyArray<{ id: SandboxZone; label: string }> = [
  { id: "hand", label: "To hand" }, { id: "battlefield", label: "To battlefield" }, { id: "graveyard", label: "To graveyard" }, { id: "exile", label: "To exile" }, { id: "top_of_library", label: "To top" }
];
/** a card already in a zone has no use for that same destination (a hand card is not put "to hand"); the library keeps all of them (a tutor to the top is fine) */
export function destinationsFor(source: PickerSource): ReadonlyArray<{ id: SandboxZone; label: string }> {
  return PICKER_DESTINATIONS.filter((d) => d.id !== source);
}

const norm = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** name, type line and rules text, every word of the query must appear (case and accents ignored); an empty query keeps everything */
export function filterPickerCards<T extends Pick<VisibleCard, "name" | "typeLine" | "oracleText">>(cards: readonly T[], query: string): T[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...cards];
  return cards.filter((c) => { const hay = norm(`${c.name} ${c.typeLine} ${c.oracleText}`); return words.every((w) => hay.includes(w)); });
}

const TYPE_ORDER = ["land", "creature", "planeswalker", "artifact", "enchantment", "instant", "sorcery", "battle"];
const typeRank = (c: Pick<VisibleCard, "typeLine">): number => { const t = c.typeLine.toLowerCase().split("—")[0]; const i = TYPE_ORDER.findIndex((x) => t.includes(x)); return i < 0 ? TYPE_ORDER.length : i; };

/** "library" keeps the incoming order (a library is listed top first); the others are stable sorts (ties keep library order) */
export function sortPickerCards<T extends Pick<VisibleCard, "name" | "typeLine" | "manaValue">>(cards: readonly T[], sort: PickerSort): T[] {
  const list = [...cards];
  if (sort === "library") return list;
  const idx = new Map(list.map((c, i) => [c, i] as const));
  const tie = (a: T, b: T): number => idx.get(a)! - idx.get(b)!;
  if (sort === "name") return list.sort((a, b) => a.name.localeCompare(b.name) || tie(a, b));
  if (sort === "mana") return list.sort((a, b) => (a.manaValue ?? 0) - (b.manaValue ?? 0) || a.name.localeCompare(b.name) || tie(a, b));
  return list.sort((a, b) => typeRank(a) - typeRank(b) || a.name.localeCompare(b.name) || tie(a, b));
}

/** what the picker shows: filter first, then sort */
export function pickerCards<T extends Pick<VisibleCard, "name" | "typeLine" | "oracleText" | "manaValue">>(cards: readonly T[], query: string, sort: PickerSort): T[] {
  return sortPickerCards(filterPickerCards(cards, query), sort);
}

/** the sandbox action for a pick: out of the library it is a tutor (shuffles unless it goes on top), out of any other zone a plain move */
export function pickAction(source: PickerSource, cardId: string, to: SandboxZone = "hand"): DebugInput {
  return source === "library" ? { type: "sandboxTutor", cardId, to } : { type: "sandboxMove", cardId, to };
}

/** the one-line summary shown under the picker ("12 of 61 cards") */
export function pickerCount(shown: number, total: number): string { return shown === total ? `${total} card${total === 1 ? "" : "s"}` : `${shown} of ${total} cards`; }

// ---------------------------------------------------------------- conjure (any card of the loaded packs by name)

/** names containing every word of the query, prefix matches first, then alphabetical; at most `limit` */
export function conjureMatches(names: readonly string[], query: string, limit = 40): string[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = names.filter((n) => { const h = norm(n); return words.every((w) => h.includes(w)); });
  const q = norm(query).trim();
  hits.sort((a, b) => Number(norm(b).startsWith(q)) - Number(norm(a).startsWith(q)) || a.localeCompare(b));
  return hits.slice(0, limit);
}

// ---------------------------------------------------------------- small buttons

export const MANA_BUTTONS: readonly ManaColor[] = ["W", "U", "B", "R", "G", "C"];

/** the panel's one-click buttons, in order: their label and the action they send */
export const QUICK_BUTTONS: ReadonlyArray<{ id: string; label: string; title: string; action: DebugInput }> = [
  { id: "draw1", label: "Draw 1", title: "Draw a card (through replacement effects and draw triggers)", action: { type: "sandboxDraw", count: 1 } },
  { id: "draw7", label: "Draw 7", title: "Draw seven cards", action: { type: "sandboxDraw", count: 7 } },
  { id: "shuffle", label: "Shuffle", title: "Shuffle your library", action: { type: "sandboxShuffle" } },
  { id: "untap", label: "Untap all", title: "Untap every permanent you control", action: { type: "sandboxUntapAll" } }
];

/** life buttons: the new life total is computed from the current one by the caller */
export const LIFE_STEPS: readonly number[] = [-10, -1, 1, 10];
export const lifeLabel = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
export const lifeAction = (current: number, delta: number): DebugInput => ({ type: "sandboxSetLife", life: current + delta });

// ---------------------------------------------------------------- per-card action ("Cast for free (debug)")

export const DEBUG_ACTION_PREFIX = "debug:";
/** zones a debug cast can start from (your own cards) */
const CAST_ZONES = new Set(["hand", "graveyard", "exile", "command"]);

/** the card inspector's extra action for one of your own cards, or undefined (debug mode off, a battlefield card, someone else's card) */
export function debugCardAction(on: boolean, o: { zone: string; owner: string; id: string; isLand: boolean } | undefined, human: string): { id: string; label: string; title: string } | undefined {
  if (!on || !o || o.owner !== human || !CAST_ZONES.has(o.zone)) return undefined;
  return { id: `${DEBUG_ACTION_PREFIX}cast:${o.id}`, label: o.isLand ? "Put onto the battlefield (debug)" : "Cast for free (debug)", title: "Debug mode: no mana, any time; the spell still goes on the stack and resolves normally" };
}
/** the action behind a `debug:` id (the id carries the kernel object id) */
export function debugOptionAction(optionId: string, isLand: (cardId: string) => boolean): DebugInput | undefined {
  const m = /^debug:cast:(.+)$/.exec(optionId);
  if (!m) return undefined;
  return isLand(m[1]) ? { type: "sandboxPlayLand", cardId: m[1] } : { type: "sandboxCast", cardId: m[1] };
}
