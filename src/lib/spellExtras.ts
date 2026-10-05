// Deterministic parsers for the one-off instant/sorcery shapes that none of the older per-template
// parsers (removalSpells.ts, zoneEffects.ts, the token/draw/pump parsers in AppFlow.tsx) recognize.
// Each of these cards was resolving as "mana spent, no effect" — found by 4-player self-play with the
// Foundations Commander precons — and in the live game was falling through to the LLM planner, which
// is exactly the "confidently wrong" path this codebase tries to keep off the rules-critical route.
//
// Pure text -> structured effect, same decline-rather-than-guess convention as the sibling parsers.
// The matching applier is applySpellExtraEffect in AppFlow.tsx (it needs the session helpers there).

import { parseWhereX, type DynamicAmount } from "./removalSpells";

export type PumpBasis = DynamicAmount | { kind: "greatest_power_you_control" } | { kind: "fixed"; amount: number };

export type SpellExtraEffect =
  // "Target player draws two cards and loses 2 life." (Sign in Blood) — the caster is always the
  // target here: there's no target-selection step for it, and drawing is what the card is for.
  | { kind: "draw_and_lose_life"; draw: number; lose: number }
  // "Discover N. If the discovered card's mana value is less than N, create a number of tapped
  // Treasure tokens equal to the difference." (Hit the Mother Lode)
  | { kind: "discover"; amount: number; treasuresForDifference: boolean }
  // "Each player sacrifices six creatures of their choice." (Necrotic Hex)
  | { kind: "each_player_sacrifices"; count: number }
  // "~ deals X damage divided as you choose among any number of target creatures, where X is the
  // greatest power among creatures you control as you cast this spell." (Monstrous Onslaught)
  | { kind: "divided_damage_greatest_power" }
  // "For each creature your opponents control, create a 4/4 green Phyrexian Beast creature token.
  // Each of those tokens fights a different one of those creatures." (Ezuri's Predation)
  | { kind: "tokens_fight_each_opponent_creature"; power: string; toughness: string; colors: string[]; subtype: string }
  // "All creatures get -1/-1 until end of turn for each Swamp you control." (Mutilate) and
  // "Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest
  // power among creatures you control." (Overwhelming Stampede)
  | { kind: "pump_dynamic"; scope: "all" | "controlled"; sign: 1 | -1; basis: PumpBasis; grantsTrample: boolean }
  // "Draw cards equal to the greatest power among creatures you control. You may cast a spell with
  // mana value 5 or less from your hand without paying its mana cost." (Rishkar's Expertise)
  | { kind: "draw_greatest_power_then_free_cast"; freeCastMaxManaValue: number }
  // "The owner of target permanent shuffles it into their library, then reveals the top card of
  // their library. If it's a permanent card, they put it onto the battlefield." (Chaos Warp)
  | { kind: "shuffle_permanent_reveal_top" }
  // "Target creature you control deals damage equal to its power to each other creature and each
  // opponent." (Chandra's Ignition)
  | { kind: "creature_damages_everything_else" }
  // "Target creature you control deals damage equal to its power to target creature or planeswalker
  // you don't control." (Bite Down)
  | { kind: "creature_bites" }
  // "Each other player sacrifices a creature of their choice. You create a 2/2 black Zombie creature token for
  // each creature sacrificed this way." (Syphon Flesh) — tokenClause is "create a 2/2 ... token".
  | { kind: "each_other_player_sacrifices"; tokenClause?: string }
  // "Target opponent sacrifices a creature with the greatest power among creatures they control." (Consumed by
  // Greed)
  | { kind: "opponent_sacrifices_greatest_power" }
  // "Add {R} for each tapped land your opponents control." (Mana Geyser)
  | { kind: "add_mana_per_tapped_opponent_land"; color: "W" | "U" | "B" | "R" | "G" | "C" };

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function wordToInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) return parsed;
  return WORDS[value.toLowerCase()];
}

const COLOR_WORDS: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };

function parsePumpBasis(text: string): PumpBasis | undefined {
  const where = parseWhereX(text);
  if (where) return where;
  if (/\bwhere x is the greatest power among creatures you control\b/i.test(text)) return { kind: "greatest_power_you_control" };
  const perLand = text.match(/\bfor each (plains|island|swamp|mountain|forest) you control\b/i);
  if (perLand) return { kind: "lands_you_control", subtype: perLand[1].toLowerCase() };
  return undefined;
}

export function parseSpellExtraEffects(text: string): SpellExtraEffect[] {
  const effects: SpellExtraEffect[] = [];
  const normalized = text.replace(/\s+/g, " ").trim();

  const drawLose = normalized.match(/\btarget player draws (a|an|one|two|three|four|five|\d+) cards? and loses (\d+) life\b/i);
  if (drawLose) {
    const draw = wordToInt(drawLose[1]);
    if (draw) effects.push({ kind: "draw_and_lose_life", draw, lose: Number.parseInt(drawLose[2], 10) });
  }

  const discover = normalized.match(/\bdiscover (\d+)\b/i);
  if (discover) {
    effects.push({
      kind: "discover",
      amount: Number.parseInt(discover[1], 10),
      treasuresForDifference: /\bcreate a number of tapped treasure tokens equal to the difference\b/i.test(normalized)
    });
  }

  const sacrifice = normalized.match(/\beach player sacrifices (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) creatures? of their choice\b/i);
  if (sacrifice) {
    const count = wordToInt(sacrifice[1]);
    if (count) effects.push({ kind: "each_player_sacrifices", count });
  }

  if (/\bdeals x damage divided as you choose among any number of target creatures, where x is the greatest power among creatures you control\b/i.test(normalized)) {
    effects.push({ kind: "divided_damage_greatest_power" });
  }

  const fightTokens = normalized.match(
    /\bfor each creature your opponents control, create an? (\d+)\/(\d+) ((?:(?:white|blue|black|red|green) )+)([A-Za-z' -]+?) creature token\. each of those tokens fights a different one of those creatures\b/i
  );
  if (fightTokens) {
    effects.push({
      kind: "tokens_fight_each_opponent_creature",
      power: fightTokens[1],
      toughness: fightTokens[2],
      colors: fightTokens[3].trim().split(/\s+/).map((word) => COLOR_WORDS[word.toLowerCase()]).filter(Boolean),
      subtype: fightTokens[4].trim()
    });
  }

  // "[All/Each] creatures get ±N/±N until end of turn for each <basis>." and "Until end of turn,
  // creatures you control [gain trample and] get ±X/±X, where X is <basis>."
  const perUnitPump = normalized.match(/\b(all|each) creatures? gets? ([+-])(\d+)\/([+-])(\d+) until end of turn for each (plains|island|swamp|mountain|forest) you control\b/i);
  if (perUnitPump && perUnitPump[2] === perUnitPump[4] && perUnitPump[3] === perUnitPump[5]) {
    effects.push({
      kind: "pump_dynamic",
      scope: "all",
      sign: perUnitPump[2] === "-" ? -1 : 1,
      basis: { kind: "lands_you_control", subtype: perUnitPump[6].toLowerCase() },
      grantsTrample: false
    });
  }
  const xPump = normalized.match(/\buntil end of turn, creatures you control (gain trample and )?get ([+-])x\/([+-])x\b/i);
  if (xPump && xPump[2] === xPump[3]) {
    const basis = parsePumpBasis(normalized);
    if (basis) effects.push({ kind: "pump_dynamic", scope: "controlled", sign: xPump[2] === "-" ? -1 : 1, basis, grantsTrample: Boolean(xPump[1]) });
  }

  const drawPower = normalized.match(/\bdraw cards equal to the greatest power among creatures you control\b/i);
  if (drawPower) {
    const freeCast = normalized.match(/\byou may cast a spell with mana value (\d+) or less from your hand without paying its mana cost\b/i);
    effects.push({ kind: "draw_greatest_power_then_free_cast", freeCastMaxManaValue: freeCast ? Number.parseInt(freeCast[1], 10) : -1 });
  }

  if (/\bthe owner of target permanent shuffles it into their library, then reveals the top card of their library\. if it'?s a permanent card, they put it onto the battlefield\b/i.test(normalized)) {
    effects.push({ kind: "shuffle_permanent_reveal_top" });
  }

  if (/\btarget creature you control deals damage equal to its power to each other creature and each opponent\b/i.test(normalized)) {
    effects.push({ kind: "creature_damages_everything_else" });
  }

  if (/\btarget creature you control deals damage equal to its power to target creature or planeswalker you don'?t control\b/i.test(normalized)) {
    effects.push({ kind: "creature_bites" });
  }

  if (/\beach other player sacrifices (?:a|one) creature of their choice\b/i.test(normalized)) {
    const perSacrifice = normalized.match(/\b(create [^.]+?) for each creature sacrificed this way\b/i);
    effects.push({ kind: "each_other_player_sacrifices", ...(perSacrifice ? { tokenClause: perSacrifice[1] } : {}) });
  }

  if (/\btarget opponent sacrifices a creature with the greatest power among creatures they control\b/i.test(normalized)) {
    effects.push({ kind: "opponent_sacrifices_greatest_power" });
  }

  const addMana = normalized.match(/^add \{([wubrgc])\} for each tapped land your opponents control\b/i);
  if (addMana) effects.push({ kind: "add_mana_per_tapped_opponent_land", color: addMana[1].toUpperCase() as "W" | "U" | "B" | "R" | "G" | "C" });

  return effects;
}
