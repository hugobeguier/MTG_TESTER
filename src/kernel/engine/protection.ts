// Protection (kernel step 9): "protection from Humans / red / creatures / everything" as a keyword ability with a text parameter.
// DEBT: damage dealt by such sources is prevented, they cannot target it, creatures with the quality cannot block it.
// (Enchant / equip legality and the state-based unattaching of already-attached Auras / Equipment are not modelled.)

import { chars, tryObj, type Run } from "./core";
import type { ObjId } from "./types";

const COLOR_WORDS: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
const TYPE_WORDS = new Set(["artifact", "creature", "enchantment", "land", "planeswalker", "instant", "sorcery", "battle"]);
const singular = (w: string): string => (w.endsWith("ies") ? w.slice(0, -3) + "y" : w.endsWith("ves") ? w.slice(0, -3) + "f" : w.endsWith("s") ? w.slice(0, -1) : w);

/** the parameters of every protection keyword the object has, lower-cased ("humans", "red", "everything") */
export function protectionParams(r: Run, id: ObjId): string[] {
  if (!tryObj(r, id)) return [];
  return chars(r, id).abilities.filter((a) => a.kind === "keyword" && a.keyword?.name.toLowerCase() === "protection" && a.keyword.param !== undefined).map((a) => String(a.keyword!.param).toLowerCase().trim());
}

/** Does `source` (any object: permanent, spell, ability source) have a quality that `id` has protection from? */
export function protectedFrom(r: Run, id: ObjId, source: ObjId | undefined): boolean {
  if (!source) return false;
  const params = protectionParams(r, id);
  if (!params.length) return false;
  const so = tryObj(r, source);
  if (!so) return false;
  const sc = chars(r, source);
  const colors = sc.colors ?? [];
  for (const p of params) {
    if (p === "everything") return true;
    if (p === "each color" || p === "all colors") { if (colors.length) return true; continue; }
    if (p === "monocolored") { if (colors.length === 1) return true; continue; }
    if (p === "multicolored") { if (colors.length > 1) return true; continue; }
    if (p === "colorless") { if (!colors.length) return true; continue; }
    if (p in COLOR_WORDS) { if (colors.includes(COLOR_WORDS[p] as never)) return true; continue; }
    const one = singular(p);
    if (TYPE_WORDS.has(one) || one === "permanent" || one === "spell") { if (sc.types.includes(one)) return true; if (one === "permanent" && so.zone === "battlefield") return true; if (one === "spell" && so.zone === "stack") return true; continue; }
    if (sc.subtypes.some((s) => s.toLowerCase() === one)) return true;
  }
  return false;
}
