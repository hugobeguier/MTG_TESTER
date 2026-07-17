// Parses the common shapes of targeted removal and direct-damage effects, following this
// codebase's deterministic-first pattern (see staticEffects.ts). Deliberately narrow: variable/X
// amounts (Fireball), multi-target-divided damage, and effects with a complex non-destroy/exile
// follow-up ("shuffles it into their library, then reveals...") are recognized as "not this
// pattern" and left unparsed rather than guessed at.

import { parseModalHeader } from "./oracleClauses";

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
  targetType: "creature" | "artifact" | "enchantment";
}

// "Destroy all creatures with mana value N or less/greater" (Austere Command's creature modes,
// and similar mono-condition sweepers). Only the mana-value-threshold shape is modeled; power/
// toughness-conditioned wipes aren't common enough in this codebase's data to be worth the extra
// branch, and are left unparsed (parseDestroy simply won't match them) rather than guessed at.
export interface DestroyAllConditionalEffect {
  kind: "destroy_all_conditional";
  threshold: number;
  comparison: "or_less" | "or_greater";
}

export interface ExileEffect {
  kind: "exile";
  targetType: RemovalTargetType;
}

export interface DamageEffect {
  kind: "damage";
  // "X" for a variable-damage spell whose amount is the caster's chosen X (Comet Storm) — resolved
  // against the caster's actual chosenX at the call site, not guessed at here.
  amount: number | "X";
  // "player" (Boros Charm's "target player or planeswalker" mode) is kept distinct from "any" —
  // unlike "any target", it can never legally resolve against a creature.
  targetType: "any" | "creature" | "player";
}

export interface BounceEffect {
  kind: "bounce";
  targetType: RemovalTargetType;
}

// "Choose one/two — • mode. • mode. ..." where each mode independently matches one of the shapes
// above. Modes this parser can't recognize (card draw, pumps, life totals, ...) are simply absent
// from `modes` — a modal spell where NO mode is removal-shaped parses to undefined entirely (see
// parseModal), same "decline rather than guess" behavior as every other unmatched shape here.
export interface ModalEffect {
  kind: "modal";
  chooseCount: number;
  modes: Exclude<RemovalEffect, ModalEffect>[];
}

export type RemovalEffect = DestroyEffect | DestroyAllEffect | DestroyAllConditionalEffect | ExileEffect | DamageEffect | BounceEffect | ModalEffect;

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

function parseDestroy(text: string): DestroyEffect | DestroyAllEffect | DestroyAllConditionalEffect | undefined {
  // Negative lookahead excludes "destroy all creatures with mana value 3 or less" (Austere
  // Command) from matching as an unconditional wipe — it used to, since "destroy all creatures"
  // is a literal substring of that conditional clause, which meant a "choose two" modal wipe with
  // a mana-value-gated creature mode always resolved as an unconditional full board wipe.
  if (/\bdestroy all creatures\b(?!\s+with\b)/.test(text)) return { kind: "destroy_all", targetType: "creature" };
  if (/\bdestroy all artifacts\b/.test(text)) return { kind: "destroy_all", targetType: "artifact" };
  if (/\bdestroy all enchantments\b/.test(text)) return { kind: "destroy_all", targetType: "enchantment" };
  const conditional = text.match(/\bdestroy all creatures with mana value (\d+) or (less|greater)\b/);
  if (conditional) {
    return {
      kind: "destroy_all_conditional",
      threshold: Number.parseInt(conditional[1], 10),
      comparison: conditional[2] === "less" ? "or_less" : "or_greater"
    };
  }
  const clauseMatch = text.match(/\bdestroy (?:another )?target [^.]+\./);
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

// "Exile target/another target [type]." — but NOT when immediately followed by a "Return it/that
// card/that permanent/that creature..." sentence (Angel of Condemnation, Touch the Spirit Realm,
// Mistmeadow Witch, ...): that's a temporary exile (a flicker effect this engine doesn't model —
// parseZoneEffect's own scope is reanimate/regrow/mill/etc., not "exile then return"), and reading
// just the first sentence in isolation would misclassify it as permanent removal, which is a worse
// outcome than declining it outright.
function parseExile(text: string): ExileEffect | undefined {
  const clauseMatch = text.match(/\bexile (?:another )?target [^.]+\./);
  if (!clauseMatch || clauseMatch.index === undefined) return undefined;
  const remainder = text.slice(clauseMatch.index + clauseMatch[0].length);
  if (/^\s*return (?:it|that card|that permanent|that creature|the exiled card)\b/i.test(remainder)) return undefined;
  const targetType = matchTargetType(clauseMatch[0]);
  if (!targetType) return undefined;
  return { kind: "exile", targetType };
}

function parseDamage(text: string): DamageEffect | undefined {
  const anyTargetX = text.match(/deals x damage to any target\b/);
  if (anyTargetX) return { kind: "damage", amount: "X", targetType: "any" };
  const creatureTargetX = text.match(/deals x damage to target creature\b/);
  if (creatureTargetX) return { kind: "damage", amount: "X", targetType: "creature" };
  // "Choose any target, then choose another target for each time this spell was kicked. ... deals
  // X damage to each of them." (Comet Storm) — the multikicker/multi-target part isn't modeled
  // (chooseDamageTarget only ever resolves a single target), but the common single-target case
  // ("cast it unkicked, hit one thing for X") is real and worth having rather than a flat no-op.
  const eachOfThemX = text.match(/deals x damage to each of them\b/);
  if (eachOfThemX) return { kind: "damage", amount: "X", targetType: "any" };
  const anyTarget = text.match(/deals (\d+) damage to any target\b/);
  if (anyTarget) return { kind: "damage", amount: Number.parseInt(anyTarget[1], 10), targetType: "any" };
  const creatureTarget = text.match(/deals (\d+) damage to target creature\b/);
  if (creatureTarget) return { kind: "damage", amount: Number.parseInt(creatureTarget[1], 10), targetType: "creature" };
  // "target player or planeswalker" (Boros Charm and its ilk) can never legally hit a creature —
  // distinct from "any target", which can.
  const playerOrPlaneswalkerTarget = text.match(/deals (\d+) damage to target player or planeswalker\b/);
  if (playerOrPlaneswalkerTarget) return { kind: "damage", amount: Number.parseInt(playerOrPlaneswalkerTarget[1], 10), targetType: "player" };
  return undefined;
}

// "Return target [nonX] <type> to its owner's hand" (Unsummon, Cyclonic Rift, Vapor Snag, ...).
// A "you don't control" qualifier some bounce spells carry (Cyclonic Rift) isn't separately
// enforced — this engine's removal targeting already defaults to preferring opponents' permanents
// (see chooseRemovalTarget), which lines up with that restriction in the common case.
function parseBounce(text: string): BounceEffect | undefined {
  const clauseMatch = text.match(/\breturn (?:another )?target [^.]+ to its owner'?s hand\./);
  if (!clauseMatch) return undefined;
  const targetType = matchTargetType(clauseMatch[0]);
  if (!targetType) return undefined;
  return { kind: "bounce", targetType };
}

function parseSingleRemovalEffect(text: string): Exclude<RemovalEffect, ModalEffect> | undefined {
  return parseDestroy(text) ?? parseExile(text) ?? parseDamage(text) ?? parseBounce(text);
}

// "Choose one/two —\n• mode.\n• mode. ..." (Boros Charm, Austere Command, ...). Each bullet is
// parsed independently through the same single-mode parsers above; a mode this parser doesn't
// recognize (card draw, pumps, life totals, ...) is simply dropped rather than guessed at, and a
// modal spell where NO mode is removal-shaped parses to undefined for the whole card. Checked
// before the single-mode parsers in parseRemovalEffect so a bullet's own text (e.g. a "deals N
// damage to any target" mode) can't be mistaken for the whole card's effect out of context.
function parseModal(oracleText: string): ModalEffect | undefined {
  const header = parseModalHeader(oracleText);
  if (!header) return undefined;
  const modes = header.modeTexts.map((modeText) => parseSingleRemovalEffect(modeText.toLowerCase())).filter((mode): mode is Exclude<RemovalEffect, ModalEffect> => mode !== undefined);
  if (modes.length === 0) return undefined;
  return { kind: "modal", chooseCount: header.chooseCount, modes };
}

export function parseRemovalEffect(oracleText: string): RemovalEffect | undefined {
  return parseModal(oracleText) ?? parseSingleRemovalEffect(oracleText.toLowerCase());
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
