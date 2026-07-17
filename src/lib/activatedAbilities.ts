// Parses the common "{cost}, Sacrifice ~: effect" template (Viscera Seer, Carrion Feeder, Food/
// Clue tokens, etc.) into structured data, following this codebase's deterministic-first pattern
// (see staticEffects.ts). Only covers effect shapes this engine can safely execute today — mana-
// producing and temporary-pump effects are recognized as "sacrifice ability shaped" but return no
// effect, so callers can choose not to surface them as legal actions rather than silently no-op.

// "Search your library for a[n] [Type] card[, reveal it], put it/that card into your hand/onto the
// battlefield[ tapped], then shuffle." — the general tutor shape underlying most non-basic-land
// search effects (Fauna Shaman, Diabolic Intent-style "for a card," Sakura-Tribe Elder-style
// generalized to any card type, ...), distinct from the narrower basic-land-only auto-resolving
// fetch system (isBasicLandFetchAbility in AppFlow.tsx) — this one is resolved through the same
// interactive "search library" choice UI real tutor spells already use, agent-auto-picked the same
// way. A dynamic/comparative qualifier after the card type ("with mana value equal to...", "with
// power 2 or less", ...) is declined rather than guessed at (Birthing Pod's sacrifice-scaled search
// is the motivating exclusion) — resolving it correctly would need to know which permanent was just
// sacrificed, which this text-only parser has no way to see.
export interface SearchLibraryEffect {
  kind: "search_library";
  destination: "hand" | "battlefield";
  tapped: boolean;
  cardTypeFilter?: string;
}

const SEARCH_LIBRARY_PATTERN =
  /^search your library for an? (?:([a-z][a-z ]*?)\s+)?cards?,?(?: reveal it,?)? put (?:it|that card|them) (into your hand|onto the battlefield(?: tapped)?),? then shuffle\.?/i;

export function parseSearchLibraryEffectText(text: string): SearchLibraryEffect | undefined {
  const match = text.match(SEARCH_LIBRARY_PATTERN);
  if (!match) return undefined;
  const typeWord = match[1]?.trim();
  if (typeWord && /\bwith\b/i.test(typeWord)) return undefined;
  const destinationText = match[2].toLowerCase();
  return {
    kind: "search_library",
    destination: destinationText.includes("battlefield") ? "battlefield" : "hand",
    tapped: destinationText.includes("tapped"),
    cardTypeFilter: typeWord && !/^cards?$/i.test(typeWord) ? typeWord : undefined
  };
}

export type SacrificeEffect =
  | { kind: "scry" | "surveil" | "draw_cards" | "gain_life" | "lose_life"; amount: number }
  | { kind: "add_counter"; counterKind: string; amount: number }
  | { kind: "create_tokens" }
  | SearchLibraryEffect
  // "Transform this land/permanent/creature[, then untap it]." (Westvale Abbey -> Ormendahl,
  // Profane Prince). Whether it also untaps is read straight from the clause text at apply time
  // (transformPermanent in AppFlow.tsx), not carried here, since it's a trailing modifier on the
  // same sentence rather than a distinct effect shape.
  | { kind: "transform_self" };

export interface SacrificeAbility {
  costMana: number;
  costTap: boolean;
  costDiscard: boolean;
  sacrificeTarget: "self" | "creature";
  // Set when the sacrificed permanent must be a specific creature type (Retrofitter Foundry's
  // "Sacrifice a Servo"/"Sacrifice a Thopter", not just "sacrifice a creature") — undefined means
  // any creature qualifies. Only meaningful when sacrificeTarget is "creature".
  sacrificeTargetTypeFilter?: string;
  // How many creatures must be sacrificed — 1 for the ordinary "sacrifice a/an creature" shape,
  // N for a fixed-count plural shape (Westvale Abbey's "Sacrifice five creatures"). Always 1 when
  // sacrificeTarget is "self" (a card never sacrifices multiple copies of itself).
  sacrificeCount: number;
  effect: SacrificeEffect;
  clause: string;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
};

function numberWordToInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) return parsed;
  return NUMBER_WORDS[value.toLowerCase()];
}

// The target group accepts "this <word>" (self-sacrifice), "a/an creature" (any creature), or
// "a/an <Type>" (Retrofitter Foundry's "Sacrifice a Servo"/"Sacrifice a Thopter" — a specific
// creature type). The negative lookahead excludes the common nouns that follow "sacrifice a/an"
// in a DIFFERENT shape this parser doesn't model — "sacrifice a land"/"sacrifice a permanent"/
// "sacrifice an artifact" name a category, not a creature type, and guessing they're a creature
// type would search for the wrong kind of permanent at resolution time.
const SACRIFICE_CLAUSE_PATTERN =
  /^((?:(?:\{[^}]+\}|discard a card)\s*,?\s*)*)sacrifice\s+(this\s+[a-z]+|an?\s+creature|(?:a|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+creatures|an?\s+(?!permanents?\b|lands?\b|cards?\b|artifacts?\b|enchantments?\b|planeswalkers?\b|tokens?\b)[a-z]+)\s*:\s*(.+?)\.?\s*$/i;

const SACRIFICE_COUNT_PATTERN = /^(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+creatures$/i;

export function parseGenericSacrificeAbilities(oracleText: string): SacrificeAbility[] {
  const abilities: SacrificeAbility[] = [];
  const clauses = oracleText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const match = clause.match(SACRIFICE_CLAUSE_PATTERN);
    if (!match) continue;

    const costPrefix = match[1];
    const targetPhrase = match[2];
    const effectText = match[3];

    const costTap = /\{t\}/i.test(costPrefix);
    const costDiscard = /discard a card/i.test(costPrefix);
    const manaSymbols = costPrefix.match(/\{(\d+)\}/g) ?? [];
    const costMana = manaSymbols.reduce((total, symbol) => total + (Number.parseInt(symbol.replace(/[{}]/g, ""), 10) || 0), 0);
    const sacrificeTarget: "self" | "creature" = /^this\b/i.test(targetPhrase) ? "self" : "creature";
    const countMatch = targetPhrase.match(SACRIFICE_COUNT_PATTERN);
    const sacrificeCount = countMatch ? numberWordToInt(countMatch[1]) ?? 1 : 1;
    const typeWord = countMatch ? undefined : targetPhrase.replace(/^an?\s+/i, "");
    const sacrificeTargetTypeFilter = sacrificeTarget === "creature" && typeWord !== undefined && !/^creatures?$/i.test(typeWord) ? typeWord : undefined;

    const effect = parseSacrificeEffectText(effectText);
    if (!effect) continue;

    abilities.push({ costMana, costTap, costDiscard, sacrificeTarget, sacrificeTargetTypeFilter, sacrificeCount, effect, clause });
  }

  return abilities;
}

// Plain "{cost}, {T}: effect." activated abilities that DON'T sacrifice anything (Retrofitter
// Foundry's three abilities are the motivating case: make a token; pay {1} and untap-put a counter
// on and upgrade a Servo; pay {2} and untap-bounce a Servo). Deliberately narrow, matching this
// codebase's other deterministic parsers: only the three effect shapes below are recognized —
// token creation, "+1/+1 counter on target X you control" (optionally paired with a "becomes an
// N/N Y" upgrade in the same sentence), and "return a/an X you control to its owner's hand". Any
// other effect text (or any clause that also sacrifices something, which
// parseGenericSacrificeAbilities already owns) is declined rather than guessed at.
export type GenericTapEffect =
  | { kind: "create_tokens" }
  | { kind: "counter_and_transform"; targetTypeFilter?: string; power?: number; toughness?: number; addedType?: string }
  | { kind: "bounce_own"; targetTypeFilter?: string }
  | SearchLibraryEffect;

export interface GenericTapAbility {
  costMana: number;
  // "Discard a [Type] card" as part of the cost (Fauna Shaman's "{G}, {T}, Discard a creature
  // card: ..."). Not type-filtered at resolution time — chooseWorstHandCardToDiscard picks
  // whatever's worst regardless of type, the same simplification parseGenericSacrificeAbilities'
  // own costDiscard already makes — but the gate (is there anything in hand at all to discard) is
  // still enforced.
  costDiscard: boolean;
  // "Untap ~." as the ability's own first sentence (this card, or Umbral Mantle-style effects) —
  // tapping to pay the cost still happens, but the permanent ends up untapped once the ability
  // resolves, so it can be activated again the same turn if its cost can be paid again.
  untapsSelf: boolean;
  effect: GenericTapEffect;
  clause: string;
}

// {T} isn't pinned to a fixed position (e.g. always last, right before the colon) — Fauna Shaman's
// real cost is "{G}, {T}, Discard a creature card:", with {T} in the MIDDLE. The whole cost prefix
// is captured generically (same shape as parseGenericSacrificeAbilities' own cost prefix) and {T}
// presence is checked afterward instead, the same way costTap is already derived there.
const GENERIC_TAP_CLAUSE_PATTERN = /^((?:(?:\{[^}]+\}|discard an? (?:[a-z]+ )?card)\s*,?\s*)+):\s*(.+?)\.?\s*$/i;

export function parseGenericTapAbilities(oracleText: string): GenericTapAbility[] {
  const abilities: GenericTapAbility[] = [];
  const clauses = oracleText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    // Sacrifice-cost tap abilities are parseGenericSacrificeAbilities's shape, not this one.
    if (/\bsacrifice\b/i.test(clause)) continue;
    const match = clause.match(GENERIC_TAP_CLAUSE_PATTERN);
    if (!match) continue;

    const costPrefix = match[1];
    // Not every "{cost}: effect" clause this pattern happens to match actually costs {T} —
    // without this check, a plain "{2}, Discard a card: effect." (parseGenericManaAbilities' own
    // shape) would double-match here too, since the cost-prefix grammar is now the same as
    // parseGenericSacrificeAbilities' (any mix of {..} and discard tokens).
    if (!/\{t\}/i.test(costPrefix)) continue;
    let effectText = match[2].trim();
    const manaSymbols = costPrefix.match(/\{(\d+)\}/g) ?? [];
    const costMana = manaSymbols.reduce((total, symbol) => total + (Number.parseInt(symbol.replace(/[{}]/g, ""), 10) || 0), 0);
    const costDiscard = /discard an? (?:[a-z]+ )?card/i.test(costPrefix);

    let untapsSelf = false;
    const untapMatch = effectText.match(/^untap [^.]+\.\s*/i);
    if (untapMatch) {
      untapsSelf = true;
      effectText = effectText.slice(untapMatch[0].length).trim();
    }

    const effect = parseGenericTapEffectText(effectText);
    if (!effect) continue;

    abilities.push({ costMana, costDiscard, untapsSelf, effect, clause });
  }

  return abilities;
}

function parseGenericTapEffectText(text: string): GenericTapEffect | undefined {
  if (/\bcreate\b[^.]*\btokens?\b/i.test(text)) {
    return { kind: "create_tokens" };
  }

  const counterMatch = text.match(/put an? \+1\/\+1 counter on target (?:(\w+) )?creature you control\.?\s*(.*)$/i);
  if (counterMatch) {
    const targetTypeFilter = counterMatch[1];
    const becomesMatch = (counterMatch[2] ?? "").match(/becomes an? (\d+)\/(\d+)\s+([a-z]+)\b/i);
    return {
      kind: "counter_and_transform",
      targetTypeFilter,
      power: becomesMatch ? Number.parseInt(becomesMatch[1], 10) : undefined,
      toughness: becomesMatch ? Number.parseInt(becomesMatch[2], 10) : undefined,
      addedType: becomesMatch ? becomesMatch[3] : undefined
    };
  }

  const bounceMatch = text.match(/return an? (\w+) you control to its owner'?s hand/i);
  if (bounceMatch) {
    const word = bounceMatch[1];
    return { kind: "bounce_own", targetTypeFilter: /^creatures?$/i.test(word) ? undefined : word };
  }

  const searchLibrary = parseSearchLibraryEffectText(text);
  if (searchLibrary) return searchLibrary;

  return undefined;
}

// "{cost}: Untap ~." with no {T} in its own cost and no other effect (Retrofitter Foundry's first
// ability, "{3}: Untap this artifact.") — a standalone way to ready a permanent so its OTHER tap
// abilities (parseGenericTapAbilities' shape) can be activated again the same turn. Deliberately
// excludes any clause with {T} in the cost — that's a different ability that also taps to
// activate, whose own "Untap ~." effect-prefix is handled by parseGenericTapAbilities instead.
export interface SelfUntapAbility {
  costMana: number;
  clause: string;
}

const SELF_UNTAP_CLAUSE_PATTERN = /^((?:\{[^}]+\}\s*,?\s*)+):\s*untap\s+[^.]+\.?\s*$/i;

export function parseSelfUntapAbilities(oracleText: string): SelfUntapAbility[] {
  const abilities: SelfUntapAbility[] = [];
  const clauses = oracleText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    if (/\{t\}/i.test(clause)) continue;
    const match = clause.match(SELF_UNTAP_CLAUSE_PATTERN);
    if (!match) continue;
    const manaSymbols = match[1].match(/\{(\d+)\}/g) ?? [];
    const costMana = manaSymbols.reduce((total, symbol) => total + (Number.parseInt(symbol.replace(/[{}]/g, ""), 10) || 0), 0);
    abilities.push({ costMana, clause });
  }

  return abilities;
}

// Plain "{cost}[, Discard a card]: effect." activated abilities — no {T}, no sacrifice (those are
// parseGenericTapAbilities'/parseGenericSacrificeAbilities' shapes respectively) and no bare
// "Untap ~" effect (parseSelfUntapAbilities' shape). The effect itself isn't parsed here: unlike
// the sacrifice/tap parsers above (which only ever recognize a handful of hardcoded effect shapes),
// this hands back the raw effect text so the caller (AppFlow.tsx) can dispatch it through the same
// removal/zone/common-trigger parsers already used for modal spells and recurring phase triggers —
// reusing that machinery instead of re-narrowing the effect vocabulary all over again. {X} costs
// are declined rather than guessed at: the digit-only mana-symbol sum below would otherwise treat
// an X-cost ability as free.
export interface GenericManaAbility {
  costMana: number;
  costDiscard: boolean;
  effectText: string;
  clause: string;
}

const GENERIC_MANA_CLAUSE_PATTERN = /^((?:(?:\{[^}]+\}|discard a card)\s*,?\s*)+):\s*(.+?)\.?\s*$/i;

export function parseGenericManaAbilities(oracleText: string): GenericManaAbility[] {
  const abilities: GenericManaAbility[] = [];
  const clauses = oracleText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    if (/\{[tx]\}/i.test(clause) || /\bsacrifice\b/i.test(clause)) continue;
    const match = clause.match(GENERIC_MANA_CLAUSE_PATTERN);
    if (!match) continue;

    const costPrefix = match[1];
    const effectText = match[2].trim();
    if (/^untap\b/i.test(effectText)) continue;

    const costDiscard = /discard a card/i.test(costPrefix);
    const manaSymbols = costPrefix.match(/\{(\d+)\}/g) ?? [];
    const costMana = manaSymbols.reduce((total, symbol) => total + (Number.parseInt(symbol.replace(/[{}]/g, ""), 10) || 0), 0);

    abilities.push({ costMana, costDiscard, effectText, clause });
  }

  return abilities;
}

function parseSacrificeEffectText(text: string): SacrificeEffect | undefined {
  const lower = text.toLowerCase();

  const scryMatch = lower.match(/\bscry\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (scryMatch) {
    const amount = numberWordToInt(scryMatch[1]);
    if (amount) return { kind: "scry", amount };
  }

  const surveilMatch = lower.match(/\bsurveil\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (surveilMatch) {
    const amount = numberWordToInt(surveilMatch[1]);
    if (amount) return { kind: "surveil", amount };
  }

  const drawMatch = lower.match(/\bdraw\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/);
  if (drawMatch) {
    const amount = numberWordToInt(drawMatch[1]);
    if (amount) return { kind: "draw_cards", amount };
  }

  const gainMatch = lower.match(/\byou gain\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\b/);
  if (gainMatch) {
    const amount = numberWordToInt(gainMatch[1]);
    if (amount) return { kind: "gain_life", amount };
  }

  const loseMatch = lower.match(/\byou lose\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+life\b/);
  if (loseMatch) {
    const amount = numberWordToInt(loseMatch[1]);
    if (amount) return { kind: "lose_life", amount };
  }

  const counterMatch = lower.match(/\bput an? \+1\/\+1 counter on (?:this creature|it)\b/);
  if (counterMatch) return { kind: "add_counter", counterKind: "+1/+1", amount: 1 };

  if (/\bcreate\b[^.]*\btokens?\b/.test(lower)) return { kind: "create_tokens" };

  if (/^transform this (?:land|permanent|artifact|creature|enchantment)\b/.test(lower)) return { kind: "transform_self" };

  const searchLibrary = parseSearchLibraryEffectText(lower);
  if (searchLibrary) return searchLibrary;

  return undefined;
}
