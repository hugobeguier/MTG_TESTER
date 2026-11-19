// Token parsing and pure token builders, extracted verbatim from components/AppFlow.tsx (see docs/ARCHITECTURE.md section 5).
// Owns: the TokenSpec type, turning oracle text into TokenSpec[] (parseCreateTokenSpecs, predefinedTokenSpec,
// parseCreatureTokenDescription), building a token card from a spec (createTokenCard), and agent copy-target scoring.
// Also here (moved later): createTokensForSeat / createCopyTokenForSeat / resolveCopyOneOfCandidates. Those call applyEntryEffects,
// checkStateBasedActions and findCommonTriggersForPermanentEntered, so this file is part of a deliberate import cycle with entry.ts /
// stateBased.ts / triggers.ts (function declarations used at call time only, so init order is safe).
// AppFlow.tsx re-exports the previously public symbols so existing importers keep working.

import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { effectivePower, effectiveToughness } from "@/lib/counters";
import { etbEffectText } from "@/lib/oracleClauses";
import { capitalizeWord, numberWordToInt } from "@/engine/shared";
import { applyEntryEffects } from "@/engine/entry";
import { checkStateBasedActions } from "@/engine/stateBased";
import { findCommonTriggersForPermanentEntered } from "@/engine/triggers";
import { findPermanentById, queuePlayerChoice, rulesEvent } from "@/engine/zones";

export interface TokenSpec {
  count: number;
  name: string;
  colors: string[];
  typeLine: string;
  power?: string;
  toughness?: string;
  oracleText: string;
  role: string;
  // "Create thirteen TAPPED 2/2 black Zombie creature tokens." (Army of the Damned, Necrotic Hex) —
  // only set when the card says so; absent means the token enters untapped like any other.
  tapped?: boolean;
  // "a number of ... tokens equal to the number of opponents you have" (Chittering Witch): count is a placeholder, resolved to the creating player's
  // opponents still in the game when the tokens are created (applyTokenCreationReplacements).
  countBasis?: "opponents";
}

export function createTokenCard(seatId: string, sourceCardId: string, spec: TokenSpec): VisibleCard {
  return {
    id: `${seatId}-token-${crypto.randomUUID()}`,
    name: spec.name,
    typeLine: spec.typeLine,
    oracleText: spec.oracleText,
    manaValue: 0,
    colors: spec.colors,
    colorIdentity: spec.colors,
    role: spec.role,
    zone: "battlefield",
    token: true,
    tokenSourceCardId: sourceCardId,
    ownerSeatId: seatId,
    power: spec.power,
    toughness: spec.toughness,
    summoningSick: spec.typeLine.includes("Creature"),
    ...(spec.tapped ? { tapped: true } : {})
  };
}

// How much an agent wants a token copy of this creature: its own enters-the-battlefield value first (a copy re-runs it), then raw size. A legendary
// copy would just hit the legend rule, so it is a last resort.
function tokenCopyWorth(card: VisibleCard): number {
  const hasEtb = etbEffectText(card.oracleText).trim().length > 0;
  return (hasEtb ? 20 : 0) + card.manaValue * 2 + effectivePower(card) + effectiveToughness(card) - (card.typeLine.includes("Legendary") ? 100 : 0);
}

export function agentBestCopyCandidate(candidates: VisibleCard[]): VisibleCard {
  return [...candidates].sort((a, b) => tokenCopyWorth(b) - tokenCopyWorth(a))[0];
}

export function parseCreateTokenSpecs(
  oracleText: string,
  dynamicCounterCount?: number,
  controllerSeat?: PlayerSeat,
  chosenX?: number,
  // "Create X 1/2 green Spider creature tokens with reach, where X is the number of creatures
  // attacking you." (Arachnogenesis) — a board-state count unrelated to any {X} the caster paid
  // (this card has no {X} in its cost at all), so it needs its own parameter rather than reusing
  // chosenX. Supplied by the caller, which has the full session (countCreaturesAttackingSeat); this
  // function only ever sees one controllerSeat, not the other seats' attackers.
  attackersTargetingCount?: number
): TokenSpec[] {
  const specs: TokenSpec[] = [];
  const normalized = oracleText.replace(/\s+/g, " ");
  const predefined = [
    { name: "Treasure", spec: predefinedTokenSpec("Treasure") },
    { name: "Food", spec: predefinedTokenSpec("Food") },
    { name: "Clue", spec: predefinedTokenSpec("Clue") },
    { name: "Blood", spec: predefinedTokenSpec("Blood") },
    { name: "Powerstone", spec: predefinedTokenSpec("Powerstone") }
  ];

  for (const item of predefined) {
    const match = normalized.match(new RegExp(`creates?\\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)\\s+(tapped\\s+)?${item.name}\\s+tokens?`, "i"));
    // "...a Treasure token for each opponent who ..." / "...for each nontoken creature that died this turn": a dynamic count this
    // function can't see (Smuggler's Share, Gadrak — the latter has its own phase-trigger handler). Declined, not silently made 1.
    const trailing = match ? normalized.slice((match.index ?? 0) + match[0].length) : "";
    if (match && item.spec && !/^\s*(?:for each|equal to)\b/i.test(trailing)) {
      specs.push({ ...item.spec, count: numberWordToInt(match[1]) ?? 1, ...(match[2] ? { tapped: true } : {}) });
    }
  }

  // "Create twice X 1/1 black and green Pest creature tokens ..." (Pest Infestation) — "twice x" is
  // a count phrasing no other card in this codebase's real data uses, so it gets its own literal
  // alternative here rather than a general "N times X" grammar; resolved against chosenX below the
  // same "not guessed at here" way DamageEffect.amount's own "X" already is. Bare "x" (Arachnogenesis:
  // "Create X ... tokens, where X is the number of creatures attacking you") is a separate dynamic
  // basis, resolved against attackersTargetingCount instead — see the "where x is..." check below.
  const creaturePattern =
    /creates?\s+(a number of|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twice x|x|\d+)\s+(?:tapped\s+)?((?:\d+\/\d+\s+)?(?:(?:white|blue|black|red|green|colorless|multicolored)\s+)*(?:[A-Z][a-zA-Z'-]*\s+){0,4}creature tokens?(?: with [^.]+)?)/gi;
  // "...with reach, where X is the number of creatures attacking you." (Arachnogenesis) — this
  // clause sits INSIDE the "with [ability]" tail creaturePattern's own capture already grabs (unlike
  // forEachControlledPattern's basis below, which trails AFTER the match entirely on cards with no
  // "with ability" tail), so it has to be detected and stripped out of `description` itself rather
  // than checked against the text following the match.
  const whereXAttackersPattern = /,?\s*where x is the number of creatures attacking you\b\.?/i;
  // "...with flying, where X is the number of counters it had on it." (Felisa, Fang of Silverquill) — the count the caller passes as dynamicCounterCount.
  const whereXCountersPattern = /,?\s*where x is the number of counters it had on it\b\.?/i;
  const dynamicCounterCountPattern = /for each\s+(?:\+1\/\+1\s+)?counter\s+on\s+(?:this creature|it|this permanent|this artifact)\b/i;
  // "... creature token for each land you control." (Avenger of Zendikar, and the same "one token
  // per permanent-type-you-control" shape on similar cards) — a dynamic count that trails AFTER
  // "creature token(s)" rather than preceding it, so hasUnmodeledDynamicCount's precedingText check
  // below never sees it; without this, the "a" in "create A ... token" was read as the literal
  // count, always creating exactly one token regardless of how many lands were actually controlled.
  const forEachControlledPattern = /^\s*for each ([a-z]+) you control\b/i;
  // "... Insect creature token for each creature card in your graveyard." (Izoni, Thousand-Eyed) —
  // same trailing-count shape, counted against the controller's own graveyard by card type.
  const forEachGraveyardCardPattern = /^\s*for each ([a-z]+) card in your graveyard\b/i;
  for (const match of normalized.matchAll(creaturePattern)) {
    const rawDescription = match[2].trim();
    const whereXAttackersMatch = whereXAttackersPattern.test(rawDescription);
    const whereXCountersMatch = whereXCountersPattern.test(rawDescription);
    // Stripped before parseCreatureTokenDescription ever sees it below — otherwise "where X is the
    // number of creatures attacking you" would be misread as part of the token's own granted-ability
    // text (it's the trailing half of the same "with reach, where X is..." clause).
    const description = (whereXAttackersMatch ? rawDescription.replace(whereXAttackersPattern, "") : whereXCountersMatch ? rawDescription.replace(whereXCountersPattern, "") : rawDescription).trim();
    const matchEnd = (match.index ?? 0) + match[0].length;
    const forEachControlledMatch = normalized.slice(matchEnd, matchEnd + 60).match(forEachControlledPattern);
    // "For each 1 damage prevented this way, create a ... token" (Inkshield, ...) — a dynamic count
    // based on something this engine doesn't track (only the counters-on-source basis above, and
    // the controlled-permanent-count basis just below, are modeled). The word captured right before
    // "creature token(s)" in that shape is just the article from "create a ... token," not the real
    // count, so using it as a literal "1" silently created exactly one token regardless of how much
    // damage was actually prevented — and since there's no damage-prevention-shield mechanic in
    // this engine at all yet, no damage was ever prevented either. Declining the token creation here
    // (rather than confidently guessing "1") at least avoids a misleadingly-partial resolution; the
    // missing prevention effect itself is a real, separate gap, not something this narrow parser can fix.
    const precedingText = normalized.slice(Math.max(0, (match.index ?? 0) - 80), match.index ?? 0);
    const hasUnmodeledDynamicCount =
      /\bfor each\b/i.test(precedingText) && !dynamicCounterCountPattern.test(precedingText) && !dynamicCounterCountPattern.test(description);
    if (hasUnmodeledDynamicCount) continue;
    const forEachGraveyardMatch = normalized.slice(matchEnd, matchEnd + 60).match(forEachGraveyardCardPattern);
    let count: number;
    // "Create a number of 1/1 black Rat creature tokens equal to the number of opponents you have." (Chittering Witch): the count is read when the
    // tokens are created (the number of opponents still in the game), see TokenSpec.countBasis. Any other "a number of" basis is declined.
    const opponentsBasis = match[1].toLowerCase() === "a number of" && /^\s*equal to the number of opponents you have\b/i.test(normalized.slice(matchEnd));
    if (match[1].toLowerCase() === "a number of" && !opponentsBasis) continue;
    if (opponentsBasis) {
      const opponentSpec = parseCreatureTokenDescription(description);
      if (opponentSpec) specs.push({ ...opponentSpec, count: 1, countBasis: "opponents" });
      continue;
    }
    if (forEachGraveyardMatch) {
      if (!controllerSeat) continue;
      const wantedType = forEachGraveyardMatch[1].toLowerCase();
      count = (controllerSeat.board.graveyard ?? []).filter((card) => card.typeLine.toLowerCase().includes(wantedType)).length;
    } else if (forEachControlledMatch) {
      // Declined (not created at all) without a controllerSeat to actually count against, rather
      // than falling back to the meaningless "a" = 1 default — a caller that cares whether this
      // clause is "handled at all" (skipping a redundant rules-advisor consult) still needs to pass
      // a seat for that check to mean anything for this shape.
      if (!controllerSeat) continue;
      count = controllerSeat.board.battlefield.filter((card) => card.typeLine.toLowerCase().includes(forEachControlledMatch[1].toLowerCase())).length;
    } else if (match[1].toLowerCase() === "twice x") {
      // Same "decline what we can't count, don't guess" convention as forEachControlledMatch just
      // above — without a real chosenX for this cast, defaulting to some fixed number would be a
      // guess, not a resolution.
      if (chosenX === undefined) continue;
      count = chosenX * 2;
    } else if (whereXCountersMatch) {
      // Same "decline rather than guess" convention: without the dead creature's real counter total there is no honest count.
      if (dynamicCounterCount === undefined) continue;
      count = dynamicCounterCount;
    } else if (whereXAttackersMatch) {
      // Arachnogenesis: "where X is the number of creatures attacking you" — same "decline rather
      // than guess" convention as the other dynamic bases here, without a real attackersTargetingCount.
      if (attackersTargetingCount === undefined) continue;
      count = attackersTargetingCount;
    } else {
      count = dynamicCounterCount !== undefined && dynamicCounterCountPattern.test(description) ? dynamicCounterCount : (numberWordToInt(match[1]) ?? 1);
    }
    const spec = parseCreatureTokenDescription(description);
    const entersTapped = /^create\s+(?:twice x|\S+)\s+tapped\b/i.test(match[0]);
    if (spec) specs.push({ ...spec, count, ...(entersTapped ? { tapped: true } : {}) });
  }

  return specs;
}

export function predefinedTokenSpec(name: "Treasure" | "Food" | "Clue" | "Blood" | "Powerstone"): TokenSpec {
  if (name === "Treasure") {
    return {
      count: 1,
      name: "Treasure",
      colors: [],
      typeLine: "Token Artifact - Treasure",
      oracleText: "{T}, Sacrifice this artifact: Add one mana of any color.",
      role: "token"
    };
  }
  if (name === "Food") {
    return {
      count: 1,
      name: "Food",
      colors: [],
      typeLine: "Token Artifact - Food",
      oracleText: "{2}, {T}, Sacrifice this artifact: You gain 3 life.",
      role: "token"
    };
  }
  if (name === "Clue") {
    return {
      count: 1,
      name: "Clue",
      colors: [],
      typeLine: "Token Artifact - Clue",
      oracleText: "{2}, Sacrifice this artifact: Draw a card.",
      role: "token"
    };
  }
  if (name === "Blood") {
    return {
      count: 1,
      name: "Blood",
      colors: [],
      typeLine: "Token Artifact - Blood",
      oracleText: "{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.",
      role: "token"
    };
  }
  return {
    count: 1,
    name: "Powerstone",
    colors: [],
    typeLine: "Token Artifact - Powerstone",
    oracleText: "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.",
    role: "token"
  };
}

function parseCreatureTokenDescription(description: string): TokenSpec | undefined {
  const pt = description.match(/\b(\d+)\/(\d+)\b/);
  const colors = tokenColors(description);
  const abilities = description.match(/\bwith\s+(.+)$/i)?.[1]?.trim();
  const beforeCreature = description
    .replace(/\b\d+\/\d+\b/i, "")
    .replace(/\b(white|blue|black|red|green|colorless|multicolored)\b/gi, "")
    .replace(/\bwith\s+.+$/i, "")
    .replace(/\bcreature tokens?\b/i, "")
    .replace(/\band\b/gi, " ")
    .trim();
  // "1/1 colorless Servo artifact creature token": "artifact"/"enchantment" are card TYPES, not subtypes. They used to stay glued to the
  // subtype ("Token Creature - Servo artifact"), so every Servo/Thopter/Myr/Golem token failed the case-sensitive "Artifact" type checks
  // (affinity, Chief of the Foundry, Darksteel Juggernaut, Padeem, Skullclamp...).
  const extraTypes = ["artifact", "enchantment"].filter((type) => new RegExp(`\\b${type}\\b`, "i").test(beforeCreature));
  const subtypeWords = beforeCreature.replace(/\b(artifact|enchantment)\b/gi, " ").replace(/\s+/g, " ").trim();
  const subtypes = subtypeWords || (extraTypes.length > 0 ? "" : "Creature");
  const cardTypes = [...extraTypes.map(capitalizeWord), "Creature"].join(" ");
  return {
    count: 1,
    name: `${subtypes || "Creature"} Token`,
    colors,
    typeLine: `Token ${cardTypes}${subtypes ? ` - ${subtypes}` : ""}`,
    power: pt?.[1] ?? "1",
    toughness: pt?.[2] ?? "1",
    oracleText: abilities ? sentenceCaseAbilities(abilities) : "",
    role: "creature"
  };
}

function tokenColors(description: string) {
  const colors: string[] = [];
  const colorMap: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
  for (const [word, symbol] of Object.entries(colorMap)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(description)) colors.push(symbol);
  }
  return colors;
}

function sentenceCaseAbilities(abilities: string) {
  return abilities
    .split(/\s+and\s+/i)
    .map((ability) => ability.trim())
    .filter(Boolean)
    .map((ability) => ability.charAt(0).toUpperCase() + ability.slice(1))
    .join(", ");
}

// ---- Session-level token creation (moved from AppFlow.tsx; part of the resolution import cycle, see entry.ts)
//
// THE TOKEN CREATION PIPELINE. Every token a card, ability or trigger creates goes through createTokenBatch (createTokensForSeat for "create N X
// tokens", createCopyTokenForSeat / createCopyTokensForSeat for "create a token that's a copy of ..."). One call is ONE creation event (rule 111.1):
// first the replacement effects the creating player controls rewrite the request (applyTokenCreationReplacements), then the tokens enter together,
// then entry effects, state-based actions and "enters" triggers run. A new "if you would create a token" card is a new rule inside
// applyTokenCreationReplacements, not a new code path at each creating card.
export interface TokenCreationRequest {
  specs: TokenSpec[];
  copies: Array<{ source: VisibleCard; notLegendary?: boolean; asArtifact?: boolean }>;
}

const CLUE_FOOD_TREASURE = ["Clue", "Food", "Treasure"] as const;
function predefinedKindOf(spec: TokenSpec): string | undefined {
  return CLUE_FOOD_TREASURE.find((kind) => spec.name === kind || new RegExp(`\\b${kind}\\b`).test(spec.typeLine));
}

// Replacement effects on tokens the player is about to create, in a fixed order that matches how a player would sequence them for the best result
// (they are the affected player's choice in the rules): Draconic Visitor (artifact tokens become Dragons), Academy Manufactor (Clue/Food/Treasure
// become one of each), then Chatterfang (the whole event, counted last, gets that many extra Squirrels). Doubling effects (Doubling Season, Parallel
// Lives) are not modelled; none is in the decks this was built for.
export function applyTokenCreationReplacements(session: GameSession, seatId: string, request: TokenCreationRequest): TokenCreationRequest {
  const controller = session.seats.find((seat) => seat.id === seatId);
  if (!controller) return request;
  const active = controller.board.battlefield.filter((card) => !card.abilitiesStripped && !card.phasedOut);
  let { specs, copies } = request;
  // Counts that depend on the board when the tokens are created: "the number of opponents you have".
  if (specs.some((spec) => spec.countBasis)) {
    const opponents = session.seats.filter((seat) => seat.id !== seatId && !seat.hasLost).length;
    specs = specs.map((spec) => (spec.countBasis === "opponents" ? { ...spec, count: opponents, countBasis: undefined } : spec));
  }

  // Draconic Visitor: "If one or more artifact tokens would be created under your control, that many 5/5 red Dragon creature tokens with flying are
  // created instead." (Treasures, Clues, Thopters, ... all become Dragons.)
  if (active.some((card) => /if one or more artifact tokens would be created under your control, that many 5\/5 red dragon creature tokens with flying are created instead/i.test(card.oracleText))) {
    const dragonSpec = parseCreateTokenSpecs("create a 5/5 red Dragon creature token with flying")[0];
    if (dragonSpec) specs = specs.map((spec) => (spec.typeLine.includes("Artifact") ? { ...dragonSpec, count: spec.count } : spec));
  }

  // Academy Manufactor: "If you would create a Clue, Food, or Treasure token, instead create one of each." Each such token becomes one of each of the
  // three (so two Treasures become two Clues, two Foods and two Treasures). A token that is a copy of one of those counts the same.
  if (active.some((card) => /if you would create a clue, food, or treasure token, instead create one of each/i.test(card.oracleText))) {
    const expanded: TokenSpec[] = [];
    for (const spec of specs) {
      const kind = predefinedKindOf(spec);
      if (!kind) {
        expanded.push(spec);
        continue;
      }
      for (const other of CLUE_FOOD_TREASURE) {
        const base = other === kind ? spec : predefinedTokenSpec(other);
        if (base) expanded.push({ ...base, count: spec.count, ...(spec.tapped ? { tapped: true } : {}) });
      }
    }
    for (const copy of copies) {
      const kind = copy.source.token ? CLUE_FOOD_TREASURE.find((candidate) => new RegExp(`\\b${candidate}\\b`).test(copy.source.typeLine)) : undefined;
      if (!kind) continue;
      for (const other of CLUE_FOOD_TREASURE) {
        const base = other === kind ? undefined : predefinedTokenSpec(other);
        if (base) expanded.push({ ...base, count: 1 });
      }
    }
    specs = expanded;
  }

  // Chatterfang, Squirrel General: "If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature
  // tokens are created instead." Each Chatterfang adds as many Squirrels as the event holds at that moment.
  const squirrelSpec = parseCreateTokenSpecs("create a 1/1 green Squirrel creature token")[0];
  for (const card of active) {
    if (!squirrelSpec || !/if one or more tokens would be created under your control, those tokens plus that many 1\/1 green squirrel creature tokens are created instead/i.test(card.oracleText)) continue;
    const total = specs.reduce((sum, spec) => sum + spec.count, 0) + copies.length;
    if (total > 0) specs = [...specs, { ...squirrelSpec, count: total }];
  }
  return { specs, copies };
}

function buildCopyToken(seatId: string, source: VisibleCard, options: { notLegendary?: boolean; asArtifact?: boolean } = {}): VisibleCard {
  // A token copy takes the source's copiable values (name, type line, oracle text, mana cost/value, colors, power/toughness) - not its current counters,
  // attachments, or any other continuous-effect state (rule 707.2), so a fresh minimal object is correct here rather than spreading `source`. Types
  // granted by a separate static ability (e.g. Secret Arcade) aren't copied either; they apply fresh via the same grantedTypes recompute.
  return {
    id: `${seatId}-token-${crypto.randomUUID()}`,
    name: source.name,
    typeLine: (() => {
      const base = options.notLegendary ? source.typeLine.replace(/\bLegendary\s+/, "") : source.typeLine;
      return options.asArtifact && !base.includes("Artifact") ? "Artifact " + base : base;
    })(),
    oracleText: source.oracleText,
    manaCost: source.manaCost,
    manaValue: source.manaValue,
    colors: source.colors,
    colorIdentity: source.colorIdentity,
    // A copy keeps every copiable value the mana code reads: producedMana is what offers EVERY color of a Talisman/Bridge token (it used to lose R).
    producedMana: source.producedMana,
    imageUris: source.imageUris,
    faces: source.faces,
    unlockedFaceIndices: source.unlockedFaceIndices,
    role: source.role,
    zone: "battlefield",
    token: true,
    tokenSourceCardId: source.id,
    ownerSeatId: seatId,
    power: source.power,
    toughness: source.toughness,
    summoningSick: source.typeLine.includes("Creature")
  };
}

// The one creation event. queueEntries (default on): the new tokens also go into pendingEntries so their "enters" triggers (and other permanents'
// "whenever a Zombie enters") fire through the usual queue. The spell-resolution caller of createTokensForSeat turns it off because it captures the
// returned triggers itself.
function createTokenBatch(
  session: GameSession,
  seatId: string,
  sourceCardId: string,
  request: TokenCreationRequest,
  options: { queueEntries?: boolean } = {}
): { session: GameSession; createdTokens: VisibleCard[]; copyTokens: VisibleCard[] } {
  const replaced = applyTokenCreationReplacements(session, seatId, request);
  const specTokens = replaced.specs.flatMap((spec) => Array.from({ length: spec.count }, () => createTokenCard(seatId, sourceCardId, spec)));
  const copyTokens = replaced.copies.map((copy) => buildCopyToken(seatId, copy.source, copy));
  const createdTokens = [...specTokens, ...copyTokens];
  const nextSession: GameSession = {
    ...session,
    pendingEntries: options.queueEntries === false || createdTokens.length === 0 ? session.pendingEntries : [...(session.pendingEntries ?? []), ...createdTokens.map((token) => ({ seatId, card: token }))],
    seats: session.seats.map((seat) =>
      seat.id === seatId && createdTokens.length > 0
        ? {
            ...seat,
            createdTokenThisTurn: true,
            board: { ...seat.board, battlefield: [...seat.board.battlefield, ...createdTokens] },
            zones: { ...seat.zones, battlefield: seat.zones.battlefield + createdTokens.length }
          }
        : seat
    )
  };
  // Dragonstorm Globe / Giada: "enters with an additional +1/+1 counter" applies to tokens too (e.g. Dragon tokens).
  return { session: createdTokens.reduce((acc, token) => applyEntryEffects(acc, seatId, token.id), nextSession), createdTokens, copyTokens };
}

export function createTokensForSeat(session: GameSession, seatId: string, sourceCardId: string, rawSpecs: TokenSpec[], options: { queueEntries?: boolean } = {}) {
  const created = createTokenBatch(session, seatId, sourceCardId, { specs: rawSpecs, copies: [] }, options);
  const createdTokens = created.createdTokens;
  // Run state-based actions before checking ETB-trigger applicability for the same reason as the
  // spell-resolution pipeline: a created token that only becomes (e.g.) an enchantment via a
  // separate static ability needs grantedTypes computed before "an enchantment enters" watchers
  // (including the token's own) can recognize it.
  const sbaCheckedSession = checkStateBasedActions(created.session);
  const triggers = createdTokens.flatMap((token) => findCommonTriggersForPermanentEntered(sbaCheckedSession, seatId, token));
  return { session: sbaCheckedSession, createdTokens, triggers };
}

// Token copies of several permanents in ONE event (Second Harvest: "For each token you control, create a token that's a copy of that permanent";
// Hazel of the Rootbloom's two copies of a Squirrel). Replacement effects see the whole batch, so Chatterfang adds Squirrels once per event, by count.
export function createCopyTokensForSeat(
  session: GameSession,
  seatId: string,
  sources: VisibleCard[],
  options: { notLegendary?: boolean; asArtifact?: boolean } = {},
  sourceCardId = sources[0]?.id ?? ""
): { session: GameSession; tokens: VisibleCard[]; createdTokens: VisibleCard[] } {
  if (sources.length === 0) return { session, tokens: [], createdTokens: [] };
  const created = createTokenBatch(session, seatId, sourceCardId, { specs: [], copies: sources.map((source) => ({ source, ...options })) });
  return { session: created.session, tokens: created.copyTokens, createdTokens: created.createdTokens };
}

export function createCopyTokenForSeat(session: GameSession, seatId: string, source: VisibleCard, options: { notLegendary?: boolean; asArtifact?: boolean } = {}): { session: GameSession; token: VisibleCard } {
  const created = createCopyTokensForSeat(session, seatId, [source], options);
  return { session: created.session, token: created.tokens[0] };
}

// "Create a token that's a copy of one of them." (Twilight Diviner): one candidate copies straight away; with several a human is asked
// (resolver "copy_token_choice") and an agent takes agentBestCopyCandidate. Candidates that have left the battlefield since the trigger was queued drop out.
export function resolveCopyOneOfCandidates(session: GameSession, controllerSeatId: string, sourceCardId: string, sourceName: string, candidateIds: string[]): GameSession {
  const controller = session.seats.find((seat) => seat.id === controllerSeatId);
  if (!controller) return session;
  const candidates = candidateIds.map((id) => findPermanentById(session, id)).filter((card): card is VisibleCard => card !== undefined);
  if (candidates.length === 0) return rulesEvent(session, controllerSeatId, `${sourceName} triggers, but none of the creatures it could copy are still on the battlefield.`);
  if (candidates.length > 1 && controller.kind === "human") {
    return queuePlayerChoice(session, {
      seatId: controllerSeatId,
      sourceCardId,
      sourceCardName: sourceName,
      prompt: `${sourceName}: create a token that's a copy of which creature?`,
      options: candidates.map((card) => ({ label: `${card.name} (${effectivePower(card)}/${effectiveToughness(card)})`, value: card.id })),
      resolver: "copy_token_choice",
      data: {}
    });
  }
  const chosen = candidates.length === 1 ? candidates[0] : agentBestCopyCandidate(candidates);
  const { session: copied } = createCopyTokenForSeat(session, controllerSeatId, chosen);
  return rulesEvent(copied, controllerSeatId, `${sourceName} trigger resolves. ${controller.name} creates a token that's a copy of ${chosen.name}.`);
}
