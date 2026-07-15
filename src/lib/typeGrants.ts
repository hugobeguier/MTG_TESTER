// Parses static abilities that grant an additional CARD TYPE (Artifact/Creature/Enchantment/Land/
// Planeswalker/Battle/Instant/Sorcery) to a set of permanents you control, e.g. Secret Arcade
// ("Nonland permanents you control ... are enchantments in addition to their other types.") or
// Biotransference ("Creatures you control are artifacts in addition to their other types.").
// Deliberately narrow, matching this codebase's pattern elsewhere: creature/land SUBTYPE grants
// ("are Angels/Zombies/Equipment/Clues/Swamps in addition to their other types" — far more common
// in real card text than card-type grants, but a different mechanic) are declined rather than
// misread, as are one-shot/targeted spell effects, Aura-attached grants, and any scope with an
// extra qualifying clause this regex doesn't expect (e.g. "creatures you control with +1/+1
// counters on them"). Also doesn't model "permanent spells you control" (the stack-side half of
// Secret Arcade's wording) — only battlefield permanents are affected.

const CARD_TYPES = ["artifact", "creature", "enchantment", "land", "planeswalker", "battle", "instant", "sorcery"];
const SCOPE_PREFIXES = ["nonland", "nontoken", "noncreature", "nonartifact"];
const SCOPE_NOUNS = ["permanent", "creature", "artifact", "land", "enchantment", "planeswalker"];

export interface TypeGrantEffect {
  granteeFilter: string; // e.g. "permanent", "nonland permanent", "creature", "artifact", "land"
  grantedType: string; // capitalized card type, e.g. "Enchantment"
}

function parseScopeFilter(scopePhrase: string): string | undefined {
  const words = scopePhrase.trim().split(/\s+/);
  const noun = words[words.length - 1]?.replace(/,$/, "").replace(/s$/, "");
  if (!noun || !SCOPE_NOUNS.includes(noun)) return undefined;
  const prefix = words.length > 1 ? words[words.length - 2] : undefined;
  return prefix && SCOPE_PREFIXES.includes(prefix) ? `${prefix} ${noun}` : noun;
}

export function parseTypeGrantEffects(oracleText: string): TypeGrantEffect[] {
  const effects: TypeGrantEffect[] = [];
  for (const rawLine of oracleText.split("\n")) {
    const line = rawLine.toLowerCase();
    const match = line.match(
      /\b([a-z][a-z ,\-]*?) you control(?:\s+and\s+[a-z][a-z ]*? you control)?\s+are\s+([a-z][a-z ]*?)\s+in addition to (?:their|its) other types?\b/
    );
    if (!match) continue;
    const granteeFilter = parseScopeFilter(match[1]);
    if (!granteeFilter) continue;
    const typeWords = match[2].trim().split(/\s+/);
    const lastWord = typeWords[typeWords.length - 1].replace(/s$/, "");
    if (!CARD_TYPES.includes(lastWord)) continue;
    effects.push({ granteeFilter, grantedType: lastWord.charAt(0).toUpperCase() + lastWord.slice(1) });
  }
  return effects;
}

export function typeGrantAppliesTo(granteeFilter: string, card: { typeLine: string }): boolean {
  const parts = granteeFilter.split(" ");
  const noun = parts[parts.length - 1];
  const prefix = parts.length > 1 ? parts[0] : undefined;
  if (noun === "permanent") {
    if (prefix === "nonland") return !card.typeLine.includes("Land");
    return true;
  }
  const capitalized = noun.charAt(0).toUpperCase() + noun.slice(1);
  return card.typeLine.includes(capitalized);
}

// The single choke point for "does this card have type X" that's aware of granted types —
// everything reading card.typeLine.includes(X) directly still ignores grants; this is used by the
// (still small) set of callers that need to see through them: generalized ETB-trigger matching and
// removal-spell target-type matching.
export function hasCardType(card: { typeLine: string; grantedTypes?: string[] }, type: string): boolean {
  return card.typeLine.includes(type) || Boolean(card.grantedTypes?.includes(type));
}
