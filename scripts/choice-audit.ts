// Choice audit: for every card in the catalog, finds the decisions a player makes (a target, a "you may", a mode, "any number of", naming a card,
// a non-creature sacrifice cost) and checks whether the engine asks a HUMAN or decides for them. Cards are ranked by EDHREC popularity
// (data/edhrec-ranks.json, from `node scripts/fetch-edhrec-ranks.mjs`) so the cards most players bring come first.
//
//   npm run choice-audit
//
// Writes bench/coverage/choice-audit.md (summary + the 200 most popular cards with a gap) and choice-audit.csv (every card with a gap).
// The scan is text-based and conservative: "ask" is only credited for effect shapes that really open a prompt (listed below), so a card shows up
// when in doubt. Cards the deterministic parsers don't claim at all are "unrecognised" (they use the LLM path, whose prompts are unchecked).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadCardCatalog } from "../src/lib/cardCatalog";
import { removalEffectTargetSpec, zoneEffectTargetSpec } from "../src/lib/targetSpecs";
import { parseRemovalEffect } from "../src/lib/removalSpells";
import { parseZoneEffect } from "../src/lib/zoneEffects";
import { parseGenericTapAbilities, parseGenericSacrificeAbilities, parseGenericManaAbilities } from "../src/lib/activatedAbilities";
import { castStructure, commonTriggerEffect, parseGenericAbilityEffect, parseGenericModalEffect, parseTargetedPump } from "../src/components/AppFlow";
import { parseModalHeader } from "../src/lib/oracleClauses";

// Trigger effect kinds that open a prompt for the human whenever the card's text has a target or choice (kept in step with AppFlow's
// openTriggerOptionPrompt / triggerCardPrompt / finishTriggerResolution).
const TRIGGER_ASKS_TARGET = new Set([
  "pump_target_creature", "exile_up_to_artifacts_enchantments", "exile_until_leaves_each_opponent", "damage_effect", "context_power_damage",
  "graveyard_creature_to_library_top", "exile_self_return_creature_to_hand", "gift_destroy_artifact_or_enchantment", "target_creature_gains_keyword",
  "counters_on_up_to_creatures", "double_power_counters", "landfall_return_nonland_permanent", "pay_then_zone", "put_land_from_hand",
  "dragon_from_hand_attacking", "venture_room", "modal", "choose_named_mode", "hideaway", "pay_red_for_damage", "discard_any_then_draw",
  "sacrifice_surplus_then_draw", "add_counter", "proliferate", "connive", "draw_then_put_back", "scry_cards", "surveil_cards", "seat_discards",
  "discard_then_draw", "blink", "copy_token", "targeted_effect", "drain"
]);

const ranks: Record<string, number> = (() => {
  try {
    return JSON.parse(readFileSync(path.join("data", "edhrec-ranks.json"), "utf8")) as Record<string, number>;
  } catch {
    return {};
  }
})();

type Issue = "unrecognised" | "target" | "optional" | "modal_multi" | "any_number" | "name_a_card" | "noncreature_sacrifice_cost" | "x_or_amount_pick";

function stripReminder(line: string): string {
  return line.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

function isKeywordOnly(line: string): boolean {
  return /^(?:[a-z ]+?(?: \{[^}]+\}| \d+| [a-z]+ from [a-z]+)?)(?:, [a-z ]+)*$/i.test(line) && line.length < 60 && !/[.:]/.test(line) && !/\b(?:target|you|your|creature|whenever|when|at the)\b/i.test(line);
}

function auditCard(card: { name: string; typeLine: string; oracleText: string; manaCost?: string }): Issue[] {
  const issues = new Set<Issue>();
  const isSpell = /Instant|Sorcery/.test(card.typeLine);
  // Instants and sorceries ask for modes and targets when they are cast.
  // A choose-several card whose every mode is understood: its triggers / casts ask the human for the modes.
  const modalHeader = parseModalHeader(card.oracleText);
  const modalFullyParsed = Boolean(modalHeader && parseGenericModalEffect(card.oracleText, undefined)?.modes.length === modalHeader.modeTexts.length);
  const castPrompts = isSpell ? castStructure(card as never) !== undefined : false;
  for (const raw of card.oracleText.split("\n")) {
    const line = stripReminder(raw);
    if (!line || isKeywordOnly(line)) continue;
    const triggered = /^(?:when|whenever|at the beginning)/i.test(line);
    const activated = /^[^"]*?:\s/.test(line) && !triggered && /^(?:\{|[a-z]+,? ?)/i.test(line);
    const effectText = activated ? line.split(/:\s(.+)/)[1] ?? line : line;
    // "becomes the target of a spell" is a trigger condition, not a choice.
    const hasTarget = /\btarget\b/i.test(effectText.replace(/\b(?:becomes? the|is the) target of\b[^,.]*/gi, ""));
    // Playing exiled/impulse cards is a permission on the card (the cast button), not a prompt.
    const hasMay =
      /\byou may\b/i.test(effectText) &&
      !/\byou may (?:play|cast) (?:that card|those cards|the exiled card|it)\b/i.test(effectText) &&
      !/^you may (?:play|cast)\b[^.]*\bfrom (?:the top|exile|your graveyard)/i.test(effectText);
    const modalMulti = /\bchoose (?:two|three|one or more|up to (?:two|three)|any number)\b/i.test(line);
    const anyNumber = /\bany number of\b/i.test(effectText);
    const nameCard = /\bname a (?:nonland )?card\b|\bchoose a card name\b/i.test(effectText);
    const sacrificeCost = activated
      ? /^[^:]*\bsacrifice (?:an?|another) (artifact|land|permanent|enchantment|nonland permanent)\b/i.test(line) &&
        !parseGenericSacrificeAbilities(line).some((ability) => ability.sacrificeTarget === "permanent")
      : false;
    const xPick = /\bchoose a number\b|\bpay any amount\b/i.test(effectText);
    if (!(hasTarget || hasMay || modalMulti || anyNumber || nameCard || sacrificeCost || xPick)) continue;

    let recognisedEffect: { kind: string; optional?: boolean } | undefined;
    let asksTarget = false;
    if (isSpell) {
      asksTarget = castPrompts;
      recognisedEffect = castPrompts ? { kind: "cast" } : undefined;
      if (!castPrompts && (hasTarget || modalMulti)) issues.add(parseRemovalEffect(effectText) || parseZoneEffect(effectText) ? "target" : "unrecognised");
    } else if (triggered) {
      const effect = commonTriggerEffect(line, "clause") ?? commonTriggerEffect(line.replace(/^[^,]*,\s*/, ""), "clause");
      recognisedEffect = effect;
      // add_counter only asks when the counter goes on a target; a drain only when it names a target player.
      asksTarget = Boolean(
        effect &&
          TRIGGER_ASKS_TARGET.has(effect.kind) &&
          (effect.kind !== "add_counter" || String((effect as { scope?: string }).scope).startsWith("target")) &&
          (effect.kind !== "drain" || (effect as { scope?: string }).scope === "target_player")
      );
      if (!effect) issues.add("unrecognised");
    } else if (activated) {
      const abilityEffect = parseGenericAbilityEffect(effectText);
      const tapAbilities = parseGenericTapAbilities(line);
      const sacAbilities = parseGenericSacrificeAbilities(line);
      const manaAbilities = parseGenericManaAbilities(line);
      recognisedEffect = abilityEffect ? { kind: abilityEffect.kind === "trigger" ? abilityEffect.effect.kind : abilityEffect.kind } : tapAbilities[0] ? { kind: tapAbilities[0].effect.kind } : sacAbilities[0] ? { kind: sacAbilities[0].effect.kind } : manaAbilities[0] ? { kind: "mana" } : undefined;
      if (!recognisedEffect) issues.add("unrecognised");
      const removal = parseRemovalEffect(effectText);
      const zone = parseZoneEffect(effectText);
      asksTarget = Boolean(
        (removal && (removal.kind === "modal" || removalEffectTargetSpec(removal, "x") !== undefined || removal.kind === "damage")) ||
          (zone && zoneEffectTargetSpec(zone) !== undefined) ||
          parseTargetedPump(effectText) ||
          (abilityEffect?.kind === "trigger" && abilityEffect.effect.kind === "targeted_effect") ||
          (sacAbilities[0] && ["targeted_effect", "zone_effect"].includes(sacAbilities[0].effect.kind)) ||
          (tapAbilities[0] && ["exile_graveyard_creature_then_tokens", "grant_graveyard_cast", "zone_effect", "target_unblockable", "targeted_effect"].includes(tapAbilities[0].effect.kind)) ||
          (abilityEffect && ["exile_graveyard_card_scavenge", "search_library"].includes(abilityEffect.kind))
      );
    } else {
      // Static or replacement text with a choice in it ("you may have ... enter as a copy", "as ... enters, choose").
      recognisedEffect = undefined;
    }
    if (!recognisedEffect && (hasTarget || hasMay)) {
      issues.add("unrecognised");
      continue;
    }
    if (hasTarget && !asksTarget && !isSpell) issues.add("target");
    // Only a RECOGNISED effect can silently auto-accept a "you may"; an unrecognised one is already listed as such. Dig effects prompt the human themselves.
    const humanPromptsKinds = new Set(["dig_type_to_hand", "dig_creature_to_battlefield", "dig_nonland_to_hand", "search_library"]);
    if (hasMay && recognisedEffect && !humanPromptsKinds.has(recognisedEffect.kind) && !(recognisedEffect as { optional?: boolean }).optional && !castPrompts && !asksTarget) issues.add("optional");
    if (modalMulti && !castPrompts && !modalFullyParsed) issues.add("modal_multi");
    if (anyNumber && !asksTarget && !castPrompts) issues.add("any_number");
    if (nameCard) issues.add("name_a_card");
    if (sacrificeCost) issues.add("noncreature_sacrifice_cost");
    if (xPick) issues.add("x_or_amount_pick");
  }
  return [...issues];
}

const catalog = loadCardCatalog() as unknown as { byName: Map<string, { name: string; typeLine: string; oracleText?: string; manaCost?: string }> };
const rows: Array<{ name: string; rank: number; issues: Issue[]; first: string }> = [];
const counts: Record<string, number> = {};
let scanned = 0;
let clean = 0;
const seenCards = new Set<string>();
for (const card of catalog.byName.values()) {
  const identity = (card as { oracleId?: string }).oracleId ?? card.name;
  if (seenCards.has(identity)) continue;
  seenCards.add(identity);
  if (!card.oracleText || /Token|Emblem|Scheme|Plane\b|Vanguard/.test(card.typeLine)) continue;
  scanned += 1;
  let issues: Issue[];
  try {
    issues = auditCard({ ...card, oracleText: card.oracleText });
  } catch {
    issues = ["unrecognised"];
  }
  if (issues.length === 0) {
    clean += 1;
    continue;
  }
  for (const issue of issues) counts[issue] = (counts[issue] ?? 0) + 1;
  rows.push({ name: card.name, rank: ranks[card.name] ?? 999999, issues, first: stripReminder(card.oracleText.split("\n").find((line) => /target|you may|choose|any number|name a|sacrifice/i.test(line)) ?? "").slice(0, 150) });
}
rows.sort((a, b) => a.rank - b.rank);

mkdirSync(path.join("bench", "coverage"), { recursive: true });
const gaps = rows.filter((row) => !row.issues.every((issue) => issue === "unrecognised"));
const md = [
  "# Choice audit (generated by `npm run choice-audit`)",
  "",
  `Cards scanned: ${scanned}. No decision the engine could be skipping: ${clean}. Cards with at least one flagged decision: ${rows.length}.`,
  "",
  "Flag meanings: **target** = text has a target but the engine picks it for a human; **optional** = a \"you may\" the engine auto-accepts; **modal_multi** = choose two / one or more with no prompt; **any_number** = \"any number of\" picked automatically; **name_a_card** = no way to name a card; **noncreature_sacrifice_cost** = sacrifice an artifact/land/etc. chosen for you; **unrecognised** = no deterministic parser (LLM path, prompts unchecked).",
  "",
  "## Flag counts",
  ...Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([issue, count]) => `- ${issue}: ${count}`),
  "",
  "## Most popular cards with a decision the engine may be making for you (EDHREC rank, lower = more played)",
  ...gaps.slice(0, 200).map((row) => `- #${row.rank === 999999 ? "?" : row.rank} **${row.name}** [${row.issues.join(", ")}] ${row.first}`)
].join("\n");
writeFileSync(path.join("bench", "coverage", "choice-audit.md"), md);
writeFileSync(
  path.join("bench", "coverage", "choice-audit.csv"),
  ["name,edhrec_rank,flags,first_line", ...rows.map((row) => `"${row.name.replace(/"/g, '""')}",${row.rank === 999999 ? "" : row.rank},"${row.issues.join(" ")}","${row.first.replace(/"/g, '""')}"`)].join("\n")
);
console.log(`scanned ${scanned}; clean ${clean}; flagged ${rows.length} (${gaps.length} with a non-"unrecognised" gap) -> bench/coverage/choice-audit.md`);
