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
  | { kind: "pump_dynamic"; scope: "all" | "controlled"; sign: 1 | -1; basis: PumpBasis; grantsTrample: boolean; excludeSubtype?: string }
  // "Draw cards equal to the greatest power among creatures you control. You may cast a spell with
  // mana value 5 or less from your hand without paying its mana cost." (Rishkar's Expertise)
  // excludeSubtype: "non-Human creatures you control" (Return of the Wildspeaker) counts only creatures without that subtype.
  | { kind: "draw_greatest_power_then_free_cast"; freeCastMaxManaValue: number; excludeSubtype?: string }
  // "The owner of target permanent shuffles it into their library, then reveals the top card of
  // their library. If it's a permanent card, they put it onto the battlefield." (Chaos Warp)
  | { kind: "shuffle_permanent_reveal_top" }
  // "Draw X cards, then discard a card." (Pull from Tomorrow)
  | { kind: "draw_x_then_discard"; discard: number }
  // "Draw three cards. Then discard two cards unless you discard an artifact card." (Thirst for Knowledge)
  | { kind: "draw_then_discard_unless"; draw: number; discard: number; unlessType: string }
  // "As an additional cost to cast this spell, pay X life. All creatures get -X/-X until end of turn." (Toxic Deluge)
  | { kind: "pay_x_life_mass_shrink" }
  // "Mill five cards, then return a creature card from your graveyard to the battlefield." (Incarnation Technique; demonstrate's copy is not modeled)
  | { kind: "mill_then_reanimate_creature"; mill: number }
  // "Each player sacrifices all permanents they control that are one or more colors." (All Is Dust)
  | { kind: "sacrifice_all_colored_permanents" }
  // "Return all attacking creatures to their owner's hand." (Aetherize)
  | { kind: "bounce_all_attackers" }
  // "Will of the council — Starting with you, each player votes for a nonland permanent you don't control. Exile each permanent with the most votes or tied for most votes." (Council's Judgment)
  | { kind: "council_judgment" }
  // Finale of Revelation: draw X; at X >= threshold shuffle the graveyard in, draw X, untap lands and lose the hand-size limit. The spell exiles itself.
  | { kind: "finale_of_revelation"; threshold: number; untapLands: number }
  // Reality Heist: look at the top N, take up to M cards of a type, the rest to the bottom in a random order.
  | { kind: "look_take_type_rest_bottom"; look: number; take: number; cardType: string }
  // Saheeli's Directive: reveal the top X, put any number of cards of a type with mana value <= X onto the battlefield, the rest to the graveyard.
  | { kind: "reveal_x_put_cheap_permanents"; cardType: string }
  // Crackle with Power: multiplier * X damage to each of up to X targets (any target).
  | { kind: "damage_times_x_to_up_to_x_targets"; multiplier: number }
  // "Target creature you control deals damage equal to its power to each other creature and each
  // opponent." (Chandra's Ignition)
  | { kind: "creature_damages_everything_else" }
  // "Target creature you control deals damage equal to its power to target creature or planeswalker
  // you don't control." (Bite Down)
  // trampleExcess: Ram Through's "If the creature you control has trample, excess damage is dealt to that creature's controller instead."
  | { kind: "creature_bites"; trampleExcess?: boolean }
  // "Draw a card for each creature you control." (Shamanic Revelation)
  | { kind: "draw_per_creature" }
  // "You gain 4 life for each creature you control with power 4 or greater." (Shamanic Revelation's ferocious line)
  | { kind: "gain_life_per_creature"; perCreature: number; minPower: number }
  // "Target permanent you control gains hexproof and indestructible until end of turn." (Tamiyo's Safekeeping)
  | { kind: "grant_keywords"; keywords: string[] }
  // "Permanents you control gain hexproof and indestructible until end of turn." (Heroic Intervention) — every permanent
  // the caster controls, no target to choose.
  | { kind: "grant_keywords_all_permanents"; keywords: string[] }
  // "Each other player sacrifices a creature of their choice. You create a 2/2 black Zombie creature token for
  // each creature sacrificed this way." (Syphon Flesh) — tokenClause is "create a 2/2 ... token".
  | { kind: "each_other_player_sacrifices"; tokenClause?: string }
  // "Target opponent sacrifices a creature with the greatest power among creatures they control." (Consumed by
  // Greed)
  | { kind: "opponent_sacrifices_greatest_power" }
  // "You and target opponent each draw three cards." (Secret Rendezvous)
  | { kind: "you_and_opponent_draw"; amount: number }
  // "Each opponent draws a card, then you draw a card for each opponent who drew a card this way." (Cut a Deal)
  | { kind: "opponents_draw_then_you_draw" }
  // "Add {R} for each tapped land your opponents control." (Mana Geyser)
  | { kind: "add_mana_per_tapped_opponent_land"; color: "W" | "U" | "B" | "R" | "G" | "C" }
  // "Add four mana in any combination of colors. Spend this mana only to cast Dragon spells." (Desolation of Smaug)
  | { kind: "add_restricted_mana"; amount: number; spellType: string }
  // "Add {B}{B}{B}." (Dark Ritual): a fixed amount of one color.
  | { kind: "add_fixed_mana"; color: "W" | "U" | "B" | "R" | "G" | "C"; amount: number }
  // "Destroy each nonland permanent with mana value 2 or less. Add {B} or {G} for each permanent destroyed this way." (Culling Ritual)
  | { kind: "destroy_each_nonland_at_most"; maxManaValue: number; manaColors: Array<"W" | "U" | "B" | "R" | "G"> }
  // "Reveal the top four cards of your library. Put all land cards revealed this way into your hand and the rest into your graveyard." (Mulch)
  | { kind: "mulch"; count: number }
  // "Each player sacrifices a creature or planeswalker of their choice. If you sacrificed a permanent this way, you may return another permanent card from your graveyard to your hand." (Deadly Brew)
  | { kind: "each_player_sacrifices_then_regrow" }
  // "Each opponent loses X life. You gain life equal to the life lost this way." (Exsanguinate)
  | { kind: "drain_x_each_opponent" }
  // "Return up to two target creature cards from your graveyard to your hand." (Find)
  | { kind: "return_creatures_from_graveyard"; count: number }
  // "You may put two +1/+1 counters on a creature you control. Then all creatures get -4/-4 until end of turn." (Finality)
  | { kind: "counters_then_mass_shrink"; counters: number; shrink: number };

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13 };

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

  const sacrifice = normalized.match(/\beach player sacrifices (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|\d+) creatures? of their choice\b/i);
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

  // "Non-Human creatures you control get +3/+3 until end of turn." (Return of the Wildspeaker)
  const nonTypePump = normalized.match(/^(?:[•*]\s*)?(?:until end of turn, )?non-([a-z]+) creatures you control get ([+-])(\d+)\/([+-])(\d+)(?: until end of turn)?\.?$/i);
  if (nonTypePump && nonTypePump[2] === nonTypePump[4] && nonTypePump[3] === nonTypePump[5]) {
    effects.push({
      kind: "pump_dynamic",
      scope: "controlled",
      sign: nonTypePump[2] === "-" ? -1 : 1,
      basis: { kind: "fixed", amount: Number.parseInt(nonTypePump[3], 10) },
      grantsTrample: false,
      excludeSubtype: nonTypePump[1].toLowerCase()
    });
  }

  const drawPower = normalized.match(/\bdraw cards equal to the greatest power among (?:non-([a-z]+) )?creatures you control\b/i);
  if (drawPower) {
    const freeCast = normalized.match(/\byou may cast a spell with mana value (\d+) or less from your hand without paying its mana cost\b/i);
    effects.push({
      kind: "draw_greatest_power_then_free_cast",
      freeCastMaxManaValue: freeCast ? Number.parseInt(freeCast[1], 10) : -1,
      ...(drawPower[1] ? { excludeSubtype: drawPower[1].toLowerCase() } : {})
    });
  }

  if (/\bthe owner of target permanent shuffles it into their library, then reveals the top card of their library\. if it'?s a permanent card, they put it onto the battlefield\b/i.test(normalized)) {
    effects.push({ kind: "shuffle_permanent_reveal_top" });
  }

  if (/\btarget creature you control deals damage equal to its power to each other creature and each opponent\b/i.test(normalized)) {
    effects.push({ kind: "creature_damages_everything_else" });
  }

  if (/\btarget creature you control deals damage equal to its power to target creature or planeswalker you don'?t control\b/i.test(normalized)) {
    effects.push({ kind: "creature_bites" });
  } else if (/\btarget creature you control deals damage equal to its power to target creature you don'?t control\b/i.test(normalized)) {
    effects.push({ kind: "creature_bites", trampleExcess: /\bif the creature you control has trample, excess damage is dealt to that creature'?s controller instead\b/i.test(normalized) });
  }

  if (/\bdraw a card for each creature you control\b/i.test(normalized)) effects.push({ kind: "draw_per_creature" });
  const lifePerCreature = normalized.match(/\byou gain (\d+) life for each creature you control with power (\d+) or greater\b/i);
  if (lifePerCreature) effects.push({ kind: "gain_life_per_creature", perCreature: Number.parseInt(lifePerCreature[1], 10), minPower: Number.parseInt(lifePerCreature[2], 10) });

  const permanentGrant = normalized.match(/\btarget permanent you control gains ([a-z]+(?: and [a-z]+)?) until end of turn\b/i);
  if (permanentGrant) effects.push({ kind: "grant_keywords", keywords: permanentGrant[1].toLowerCase().split(" and ") });
  const allPermanentsGrant = normalized.match(/\bpermanents you control gain ([a-z]+(?: and [a-z]+)?) until end of turn\b/i);
  if (allPermanentsGrant) effects.push({ kind: "grant_keywords_all_permanents", keywords: allPermanentsGrant[1].toLowerCase().split(" and ") });

  if (/\beach other player sacrifices (?:a|one) creature of their choice\b/i.test(normalized)) {
    const perSacrifice = normalized.match(/\b(create [^.]+?) for each creature sacrificed this way\b/i);
    effects.push({ kind: "each_other_player_sacrifices", ...(perSacrifice ? { tokenClause: perSacrifice[1] } : {}) });
  }

  if (/\btarget opponent sacrifices a creature with the greatest power among creatures they control\b/i.test(normalized)) {
    effects.push({ kind: "opponent_sacrifices_greatest_power" });
  }

  const mutualDraw = normalized.match(/\byou and target opponent each draw (a|one|two|three|four|five|\d+) cards?\b/i);
  if (mutualDraw) {
    const amount = wordToInt(mutualDraw[1]);
    if (amount) effects.push({ kind: "you_and_opponent_draw", amount });
  }
  if (/\beach opponent draws a card, then you draw a card for each opponent who drew a card this way\b/i.test(normalized)) {
    effects.push({ kind: "opponents_draw_then_you_draw" });
  }

  const addMana = normalized.match(/^add \{([wubrgc])\} for each tapped land your opponents control\b/i);
  if (addMana) effects.push({ kind: "add_mana_per_tapped_opponent_land", color: addMana[1].toUpperCase() as "W" | "U" | "B" | "R" | "G" | "C" });

  const restrictedMana = normalized.match(/\badd (a|an|one|two|three|four|five|six|seven|\d+) mana in any combination of colors\. spend this mana only to cast (?:an? )?([a-z]+) spells\b/i);
  if (restrictedMana) {
    const amount = wordToInt(restrictedMana[1]);
    if (amount) effects.push({ kind: "add_restricted_mana", amount, spellType: restrictedMana[2].charAt(0).toUpperCase() + restrictedMana[2].slice(1).toLowerCase() });
  }

  if (/^as an additional cost to cast this spell, pay x life\. all creatures get -x\/-x until end of turn\.?$/i.test(normalized)) effects.push({ kind: "pay_x_life_mass_shrink" });
  const fixedMana = normalized.match(/^add ((?:\{[wubrgc]\})+)\.?$/i);
  if (fixedMana) {
    const symbols = fixedMana[1].match(/\{[wubrgc]\}/gi) ?? [];
    const colors = new Set(symbols.map((symbol) => symbol[1].toUpperCase()));
    if (colors.size === 1) effects.push({ kind: "add_fixed_mana", color: [...colors][0] as "W" | "U" | "B" | "R" | "G" | "C", amount: symbols.length });
  }
  const cull = normalized.match(/^destroy each nonland permanent with mana value (\d+) or less\. add \{([wubrg])\} or \{([wubrg])\} for each permanent destroyed this way\.?$/i);
  if (cull) effects.push({ kind: "destroy_each_nonland_at_most", maxManaValue: Number.parseInt(cull[1], 10), manaColors: [cull[2].toUpperCase(), cull[3].toUpperCase()] as Array<"W" | "U" | "B" | "R" | "G"> });
  const mulch = normalized.match(/^reveal the top (a|one|two|three|four|five|six|\d+) cards? of your library\. put all land cards revealed this way into your hand and the rest into your graveyard\.?$/i);
  if (mulch) effects.push({ kind: "mulch", count: wordToInt(mulch[1]) ?? 4 });
  if (/^each player sacrifices a creature or planeswalker of their choice\. if you sacrificed a permanent this way, you may return another permanent card from your graveyard to your hand\.?$/i.test(normalized)) effects.push({ kind: "each_player_sacrifices_then_regrow" });
  if (/^each opponent loses x life\. you gain life equal to the life lost this way\.?$/i.test(normalized)) effects.push({ kind: "drain_x_each_opponent" });
  const returnCreatures = normalized.match(/^return up to (one|two|three|\d+) target creature cards? from your graveyard to your hand\.?$/i);
  if (returnCreatures) effects.push({ kind: "return_creatures_from_graveyard", count: wordToInt(returnCreatures[1]) ?? 1 });
  const finality = normalized.match(/^you may put (one|two|three|four|\d+) \+1\/\+1 counters? on a creature you control\. then all creatures get -(\d+)\/-(\d+) until end of turn\.?$/i);
  if (finality) effects.push({ kind: "counters_then_mass_shrink", counters: wordToInt(finality[1]) ?? 2, shrink: Number.parseInt(finality[2], 10) });
  const millReanimate = normalized.match(/^mill (a|one|two|three|four|five|six|seven|eight|\d+) cards?, then return a creature card from your graveyard to the battlefield\.?$/i);
  if (millReanimate) effects.push({ kind: "mill_then_reanimate_creature", mill: wordToInt(millReanimate[1]) ?? 1 });
  if (/^each player sacrifices all permanents they control that are one or more colors\.?$/i.test(normalized)) effects.push({ kind: "sacrifice_all_colored_permanents" });
  if (/^return all attacking creatures to their owner(?:'s|s')? hands?\.?$/i.test(normalized)) effects.push({ kind: "bounce_all_attackers" });
  if (/^will of the council\s*[—-]\s*starting with you, each player votes for a nonland permanent you don'?t control\. exile each permanent with the most votes or tied for most votes\.?$/i.test(normalized)) effects.push({ kind: "council_judgment" });

  const thirst = normalized.match(/^draw (a|one|two|three|four|five|\d+) cards?\. then discard (a|one|two|three|four|\d+) cards? unless you discard an? ([a-z]+) card\.?$/i);
  if (thirst) {
    const draw = wordToInt(thirst[1]);
    const discard = wordToInt(thirst[2]);
    if (draw && discard) effects.push({ kind: "draw_then_discard_unless", draw, discard, unlessType: thirst[3].toLowerCase() });
  }

  // "Draw X cards, then discard a card." (Pull from Tomorrow)
  const drawXDiscard = normalized.match(/^draw x cards, then discard (a|one|two|three|\d+) cards?\.?$/i);
  if (drawXDiscard) {
    const discard = wordToInt(drawXDiscard[1]);
    if (discard) effects.push({ kind: "draw_x_then_discard", discard });
  }

  // "Draw X cards. If X is 10 or more, instead shuffle your graveyard into your library, draw X cards, untap up to five lands, and you have no
  // maximum hand size for the rest of the game. Exile Finale of Revelation." (Finale of Revelation)
  const finale = normalized.match(/\bdraw x cards\. if x is (\d+) or more, instead shuffle your graveyard into your library, draw x cards, untap up to (a|one|two|three|four|five|six|seven|\d+) lands?, and you have no maximum hand size for the rest of the game\b/i);
  if (finale) effects.push({ kind: "finale_of_revelation", threshold: Number.parseInt(finale[1], 10), untapLands: wordToInt(finale[2]) ?? 0 });

  // "Look at the top seven cards of your library. You may reveal up to two artifact cards from among them and put them into your hand. Put the rest
  // on the bottom of your library in a random order." (Reality Heist)
  const lookTake = normalized.match(/\blook at the top (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library\. you may reveal up to (a|an|one|two|three|four|\d+) ([a-z]+) cards? from among them and put (?:it|them) into your hand\. put the rest on the bottom of your library in a random order\b/i);
  if (lookTake) {
    const look = wordToInt(lookTake[1]);
    const take = wordToInt(lookTake[2]);
    if (look && take) effects.push({ kind: "look_take_type_rest_bottom", look, take, cardType: lookTake[3].toLowerCase() });
  }

  // "Reveal the top X cards of your library. You may put any number of artifact cards with mana value X or less from among them onto the battlefield.
  // Then put all cards revealed this way that weren't put onto the battlefield into your graveyard." (Saheeli's Directive)
  const revealPut = normalized.match(/\breveal the top x cards of your library\. you may put any number of ([a-z]+) cards with mana value x or less from among them onto the battlefield\. then put all cards revealed this way that weren't put onto the battlefield into your graveyard\b/i);
  if (revealPut) effects.push({ kind: "reveal_x_put_cheap_permanents", cardType: revealPut[1].toLowerCase() });

  // "~ deals five times X damage to each of up to X targets." (Crackle with Power)
  const crackle = normalized.match(/\bdeals (two|three|four|five|six|\d+) times x damage to each of up to x targets\b/i);
  if (crackle) effects.push({ kind: "damage_times_x_to_up_to_x_targets", multiplier: wordToInt(crackle[1]) ?? 1 });

  return effects;
}
