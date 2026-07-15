// Parses the common shapes of targeted removal and direct-damage effects, following this
// codebase's deterministic-first pattern (see staticEffects.ts). Deliberately narrow: variable/X
// amounts (Fireball), multi-target-divided damage, and effects with a complex non-destroy/exile
// follow-up ("shuffles it into their library, then reveals...") are recognized as "not this
// pattern" and left unparsed rather than guessed at.

export type RemovalTargetType =
  | "creature"
  | "creature_or_planeswalker"
  | "artifact_creature_or_planeswalker"
  | "artifact"
  | "enchantment"
  | "permanent"
  | "nonland_permanent";

export interface DestroyEffect {
  kind: "destroy";
  targetType: RemovalTargetType;
  excludedColors: string[];
  artifactsExcluded: boolean;
}

export interface DestroyAllEffect {
  kind: "destroy_all";
}

export interface ExileEffect {
  kind: "exile";
  targetType: RemovalTargetType;
}

export interface DamageEffect {
  kind: "damage";
  amount: number;
  targetType: "any" | "creature";
}

export interface BounceEffect {
  kind: "bounce";
  targetType: RemovalTargetType;
}

export type RemovalEffect = DestroyEffect | DestroyAllEffect | ExileEffect | DamageEffect | BounceEffect;

// "target [nonX, nonY] <type>" — restrictions like "target nonartifact, nonblack creature" sit
// between "target" and the type noun, so every pattern needs to tolerate them.
const QUALIFIER = "(?:non\\w+[,\\s]*)*";
const TARGET_TYPE_PATTERNS: Array<{ pattern: RegExp; type: RemovalTargetType }> = [
  { pattern: new RegExp(`target ${QUALIFIER}artifact, creature, or planeswalker`), type: "artifact_creature_or_planeswalker" },
  { pattern: new RegExp(`target ${QUALIFIER}creature or planeswalker`), type: "creature_or_planeswalker" },
  { pattern: /target nonland permanent/, type: "nonland_permanent" },
  { pattern: new RegExp(`target ${QUALIFIER}permanent`), type: "permanent" },
  { pattern: new RegExp(`target ${QUALIFIER}artifact\\b`), type: "artifact" },
  { pattern: new RegExp(`target ${QUALIFIER}enchantment\\b`), type: "enchantment" },
  { pattern: new RegExp(`target ${QUALIFIER}creature\\b`), type: "creature" }
];

function matchTargetType(clause: string): RemovalTargetType | undefined {
  for (const { pattern, type } of TARGET_TYPE_PATTERNS) {
    if (pattern.test(clause)) return type;
  }
  return undefined;
}

const COLORS = ["white", "blue", "black", "red", "green"];

function parseDestroy(text: string): DestroyEffect | DestroyAllEffect | undefined {
  if (/\bdestroy all creatures\b/.test(text)) return { kind: "destroy_all" };
  const clauseMatch = text.match(/\bdestroy target [^.]+\./);
  if (!clauseMatch) return undefined;
  const clause = clauseMatch[0];
  const targetType = matchTargetType(clause);
  if (!targetType) return undefined;
  return {
    kind: "destroy",
    targetType,
    excludedColors: COLORS.filter((color) => clause.includes(`non${color}`)),
    artifactsExcluded: clause.includes("nonartifact")
  };
}

function parseExile(text: string): ExileEffect | undefined {
  const clauseMatch = text.match(/\bexile target [^.]+\./);
  if (!clauseMatch) return undefined;
  const targetType = matchTargetType(clauseMatch[0]);
  if (!targetType) return undefined;
  return { kind: "exile", targetType };
}

function parseDamage(text: string): DamageEffect | undefined {
  const anyTarget = text.match(/deals (\d+) damage to any target\b/);
  if (anyTarget) return { kind: "damage", amount: Number.parseInt(anyTarget[1], 10), targetType: "any" };
  const creatureTarget = text.match(/deals (\d+) damage to target creature\b/);
  if (creatureTarget) return { kind: "damage", amount: Number.parseInt(creatureTarget[1], 10), targetType: "creature" };
  return undefined;
}

// "Return target [nonX] <type> to its owner's hand" (Unsummon, Cyclonic Rift, Vapor Snag, ...).
// A "you don't control" qualifier some bounce spells carry (Cyclonic Rift) isn't separately
// enforced — this engine's removal targeting already defaults to preferring opponents' permanents
// (see chooseRemovalTarget), which lines up with that restriction in the common case.
function parseBounce(text: string): BounceEffect | undefined {
  const clauseMatch = text.match(/\breturn target [^.]+ to its owner'?s hand\./);
  if (!clauseMatch) return undefined;
  const targetType = matchTargetType(clauseMatch[0]);
  if (!targetType) return undefined;
  return { kind: "bounce", targetType };
}

export function parseRemovalEffect(oracleText: string): RemovalEffect | undefined {
  const text = oracleText.toLowerCase();
  return parseDestroy(text) ?? parseExile(text) ?? parseDamage(text) ?? parseBounce(text);
}

// Accepts grantedTypes (see typeGrants.ts) so a permanent that's only an artifact/enchantment/etc.
// because of a separate static ability (Secret Arcade-style "X you control are Y in addition to
// their other types") is still a legal target for removal that cares about that type.
export function matchesTargetType(card: { typeLine: string; grantedTypes?: string[] }, targetType: RemovalTargetType): boolean {
  const has = (type: string) => card.typeLine.includes(type) || Boolean(card.grantedTypes?.includes(type));
  switch (targetType) {
    case "creature":
      return has("Creature");
    case "creature_or_planeswalker":
      return has("Creature") || has("Planeswalker");
    case "artifact_creature_or_planeswalker":
      return has("Artifact") || has("Creature") || has("Planeswalker");
    case "artifact":
      return has("Artifact");
    case "enchantment":
      return has("Enchantment");
    case "permanent":
      return true;
    case "nonland_permanent":
      return !card.typeLine.includes("Land");
  }
}
