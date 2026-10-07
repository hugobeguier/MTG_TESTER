// Card backlog: runs every card in data/commander-cards.json through the engine's deterministic parsers, line by line, and writes
// bench/coverage/backlog.md (the most common unrecognised rules-text templates, ranked by how many cards use them) plus
// bench/coverage/backlog-cards.csv (every card with at least one unrecognised line).
//
// "Unrecognised" means NO deterministic parser claims the line. Those cards fall back to the LLM / XMage-grounded path (or nothing), so the
// list is a work queue, not a list of known-broken cards. Recognised does not prove correct either; the real-card-text tests do that.
//
//   npm run backlog
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadCardCatalog } from "../src/lib/cardCatalog";
import { KEYWORD_TABLE } from "../src/lib/keywords";
import { parseRemovalEffect } from "../src/lib/removalSpells";
import { parseZoneEffect } from "../src/lib/zoneEffects";
import { parseSpellExtraEffects } from "../src/lib/spellExtras";
import { parseGenericManaAbilities, parseGenericSacrificeAbilities, parseGenericTapAbilities } from "../src/lib/activatedAbilities";
import { parseConditionalStaticBoosts, parseGroupAnthemBoost, parseGroupKeywordGrant, parseSelfAnthemBoost } from "../src/lib/characteristics";
import { parseEntersWithCounterReplacements } from "../src/lib/oracleClauses";
import { parseCycling } from "../src/lib/cycling";
import { parseFlashbackCost } from "../src/lib/graveyardCasting";
import {
  commonTriggerEffect,
  parseCreateTokenSpecs,
  parseGenericAbilityEffect,
  parseGenericModalEffect,
  parseMassPump,
  parseSimpleDrawEffect,
  parseSimpleLifeChange,
  parseTargetedPump
} from "../src/components/AppFlow";

const EXTRA_KEYWORDS = new Set([
  "equip", "enchant", "kicker", "multikicker", "flashback", "cycling", "landcycling", "plainscycling", "islandcycling", "swampcycling",
  "mountaincycling", "forestcycling", "basic", "living", "read", "myriad", "dethrone", "exalted", "hideaway", "flash", "changeling", "persist",
  "undying", "affinity", "convoke", "delve", "escape", "partner", "companion", "storm", "cascade", "ninjutsu", "unearth", "morph", "megamorph",
  "evolve", "fabricate", "mentor", "afterlife", "amass", "bestow", "crew", "fear", "intimidate", "landwalk", "skulk", "shadow", "horsemanship",
  "soulbond", "flanking", "rampage", "banding", "protection", "split", "improvise", "toxic", "backup", "casualty", "bargain", "offspring", "squad",
  "gift", "prototype", "disturb", "madness", "miracle", "suspend", "rebound", "buyback", "retrace", "replicate", "overload", "surge", "spectacle",
  "emerge", "dash", "evoke", "prowl", "entwine", "escalate", "spree", "cleave", "foretell", "adventure", "aftermath", "embalm", "eternalize",
  "decayed", "training", "riot", "unleash", "bloodthirst", "graft", "modular", "reinforce", "tribute", "devour", "ravenous", "fuse", "level",
  "reconfigure", "transmute", "typecycling", "ascend", "totem", "haunt", "hexproof", "lifelink", "vigilance", "wither", "infect"
]);
const keywordNames = new Set([...KEYWORD_TABLE.map((definition) => definition.name), ...EXTRA_KEYWORDS]);

function stripReminder(line: string): string {
  return line.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

function isKeywordLine(line: string): boolean {
  const parts = line.split(/[,;]\s*/).map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) => {
    const first = part.replace(/^[•*]\s*/, "").split(/[\s{—-]/)[0];
    return keywordNames.has(first) || keywordNames.has(part.split(" ").slice(0, 2).join(" "));
  });
}

// Rules-text shapes the engine handles through inline code rather than a standalone exported parser (calibrated against the four Foundations
// precons, whose every card is known to work).
const KNOWN_HANDLED: RegExp[] = [
  /^\{t\}[^:]*: add /i, // mana abilities
  /^(?:\{[^}]+\}[, ]*)*(?:sacrifice [^:]*)?: add /i,
  /^choose (?:one|two|three|one or more|up to \w+)\b/i, // modal headers (modes are the bullet lines)
  /^[•*]/, // modal bullets
  /\bchoose (?:one|two|one or more)\s*[—-]$/i,
  /\bchoose a (?:creature type|color|basic land type)\b/i,
  /^(?:this|[a-z',-]+) (?:creature|spell|land|permanent|artifact|enchantment) (?:can'?t block|can'?t be countered|can'?t be blocked|can'?t attack)/i,
  /^(?:this|[a-z',-]+) (?:land|artifact|creature|enchantment) enters (?:the battlefield )?(?:tapped|with)/i,
  /\benters(?: the battlefield)? tapped unless\b/i,
  /^as an additional cost to cast this spell\b/i,
  /^(?:equipped|enchanted) (?:creature|land|permanent) (?:gets|has|loses|can'?t|doesn'?t|is)\b/i,
  /^(?:other )?(?:creatures?|[a-z]+s) you control (?:with [^.]+ )?(?:get|have|can'?t)\b/i,
  /^as long as\b/i,
  /^you may (?:look at the top card|play an additional land|cast [^.]* as though they had flash|pay [^.]* rather than pay)/i,
  /^you (?:don'?t lose unspent|can'?t lose the game|can'?t cast)/i,
  /^prevent all combat damage that would be dealt to /i,
  /^[a-z',\- ]+'s power and toughness are each equal to\b/i,
  /^this spell costs \{[^}]+\} less to cast\b/i,
  /^(?:formidable|metalcraft|landfall|pack tactics|lieutenant|raid|constellation|eerie|revolt|delirium|threshold|ferocious|hellbent)\b/i
];

function recognises(cardName: string, rawLine: string, fullText: string): boolean {
  const line = stripReminder(rawLine);
  if (!line) return true;
  if (KNOWN_HANDLED.some((pattern) => pattern.test(line))) return true;
  if (isKeywordLine(line)) return true;
  if (/^\{[^}]+\}.*:/.test(line) || /^[^:]+:/.test(line)) {
    // Activated ability
    if (parseGenericTapAbilities(line).length > 0 || parseGenericManaAbilities(line).length > 0 || parseGenericSacrificeAbilities(line).length > 0) return true;
    const effectText = line.split(":").slice(1).join(":").trim();
    if (effectText && parseGenericAbilityEffect(effectText)) return true;
  }
  if (/enters tapped\.?$|enters the battlefield tapped/i.test(line)) return true;
  if (/costs? \{\d+\} less to cast/i.test(line)) return true;
  if (/^(?:when|whenever|at the beginning)/i.test(line)) {
    if (commonTriggerEffect(line, "clause")) return true;
    if (commonTriggerEffect(line.replace(/^[^,]*,\s*/, ""), "clause")) return true;
  }
  if (commonTriggerEffect(line, "entered") || commonTriggerEffect(line, "died")) return true;
  if (parseRemovalEffect(line) || parseZoneEffect(line) || parseTargetedPump(line) || parseMassPump(line)) return true;
  if (parseSimpleDrawEffect(line) || parseSimpleLifeChange(line) || parseSpellExtraEffects(line).length > 0) return true;
  if (/\bcreates? /i.test(line) && parseCreateTokenSpecs(line).length > 0) return true;
  if (parseGenericModalEffect(fullText, undefined) && /^choose|^•/i.test(line)) return true;
  if (parseSelfAnthemBoost(line) || parseGroupAnthemBoost(line).length > 0 || parseGroupKeywordGrant(line).length > 0 || parseConditionalStaticBoosts(line).length > 0) return true;
  if (parseEntersWithCounterReplacements(line).length > 0) return true;
  if (parseCycling(line) || parseFlashbackCost(line)) return true;
  return false;
}

function template(name: string, line: string): string {
  const short = name.split(",")[0].split(" ")[0];
  return stripReminder(line)
    .replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "~")
    .replace(new RegExp(`\\b${short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), "~")
    .replace(/\b\d+\b/g, "N")
    .replace(/\b(one|two|three|four|five|six|seven)\b/gi, "N")
    .toLowerCase();
}

const catalog = loadCardCatalog() as unknown as { cards?: Array<{ name: string; oracleText?: string; typeLine?: string }> };
const cards = ((catalog as unknown as { byName: Map<string, { name: string; oracleText?: string; typeLine?: string }> }).byName
  ? [...(catalog as unknown as { byName: Map<string, { name: string; oracleText?: string; typeLine?: string }> }).byName.values()]
  : catalog.cards ?? []);

const precon = new Set<string>();
for (const file of ["WretchedRanks", "ReignOfDragons", "TramplesaurusRex", "CallingAllAngels"]) {
  try {
    for (const line of readFileSync(path.join("decks", "foundations", `${file}.txt`), "utf8").split(/\r?\n/)) {
      const match = line.match(/^(?:Commander:\s*)?\d*\s*(.+?)(?:\s+\([A-Z0-9]+\).*)?$/);
      if (match) precon.add(match[1].trim());
    }
  } catch {
    // deck files are optional here
  }
}

const templates = new Map<string, { count: number; examples: string[] }>();
const rows: Array<{ name: string; unhandled: number; total: number; first: string; precon: boolean }> = [];
let fullyRecognised = 0;
let considered = 0;
const seen = new Set<string>();
for (const card of cards) {
  if (!card.oracleText || seen.has(card.name)) continue;
  if (/Token|Emblem|Scheme|Plane\b|Vanguard/.test(card.typeLine ?? "")) continue;
  seen.add(card.name);
  considered += 1;
  const lines = card.oracleText.split("\n").map((line) => line.trim()).filter(Boolean);
  const bad = lines.filter((line) => {
    try {
      return !recognises(card.name, line, card.oracleText!);
    } catch {
      return true;
    }
  });
  if (bad.length === 0) {
    fullyRecognised += 1;
    continue;
  }
  rows.push({ name: card.name, unhandled: bad.length, total: lines.length, first: stripReminder(bad[0]).slice(0, 160), precon: precon.has(card.name) });
  for (const line of bad) {
    const key = template(card.name, line).slice(0, 200);
    const entry = templates.get(key) ?? { count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 3) entry.examples.push(card.name);
    templates.set(key, entry);
  }
}

mkdirSync(path.join("bench", "coverage"), { recursive: true });
const ranked = [...templates.entries()].sort((a, b) => b[1].count - a[1].count);
const md = [
  "# Card backlog (generated by `npm run backlog`)",
  "",
  `Cards checked: ${considered}. Every line recognised by a deterministic parser: ${fullyRecognised} (${((fullyRecognised / considered) * 100).toFixed(1)}%).`,
  `Cards with at least one unrecognised line: ${rows.length}. Distinct unrecognised templates: ${templates.size}.`,
  "",
  "Unrecognised means no deterministic parser claims the line; such cards fall back to the LLM/XMage path. It is a work queue, not a list of broken cards.",
  "Caveat: cards handled by single-card inline code (e.g. Herald's Horn, Rhonas, Cursed Mirror) also show up here, as the precon list below shows, because only shared parsers and a calibrated pattern list are checked. Expect false positives for such one-off handlers.",
  "",
  "## Foundations precon cards still unrecognised",
  "",
  ...(rows.filter((row) => row.precon).length === 0 ? ["None."] : rows.filter((row) => row.precon).map((row) => `- ${row.name}: ${row.first}`)),
  "",
  "## Most common unrecognised templates (one parser per template unlocks all its cards)",
  "",
  ...ranked.slice(0, 200).map(([key, entry]) => `- **${entry.count}** \`${key}\` (e.g. ${entry.examples.join(", ")})`)
].join("\n");
writeFileSync(path.join("bench", "coverage", "backlog.md"), md);
const csv = ["name,unhandled_lines,total_lines,precon,first_unhandled_line", ...rows.sort((a, b) => a.unhandled - b.unhandled || a.name.localeCompare(b.name)).map((row) => `"${row.name.replace(/"/g, '""')}",${row.unhandled},${row.total},${row.precon},"${row.first.replace(/"/g, '""')}"`)].join("\n");
writeFileSync(path.join("bench", "coverage", "backlog-cards.csv"), csv);
console.log(`checked ${considered}; fully recognised ${fullyRecognised}; backlog ${rows.length} cards, ${templates.size} templates -> bench/coverage/`);
