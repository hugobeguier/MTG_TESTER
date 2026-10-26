// Shared by scripts/card-backlog.ts and the per-deck coverage test: does ANY deterministic parser claim this oracle line? (Moved out of the script.)
import { loadCardCatalog } from "@/lib/cardCatalog";
import { KEYWORD_TABLE } from "@/lib/keywords";
import { parseRemovalEffect } from "@/lib/removalSpells";
import { parseZoneEffect } from "@/lib/zoneEffects";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
import { parseGenericManaAbilities, parseGenericSacrificeAbilities, parseGenericTapAbilities } from "@/lib/activatedAbilities";
import { parseConditionalStaticBoosts, parseGroupAnthemBoost, parseGroupKeywordGrant, parseSelfAnthemBoost } from "@/lib/characteristics";
import { parseEntersWithCounterReplacements } from "@/lib/oracleClauses";
import { parseCycling } from "@/lib/cycling";
import { parseFlashbackCost } from "@/lib/graveyardCasting";
import {
  commonTriggerEffect,
  parseCreateTokenSpecs,
  parseGenericAbilityEffect,
  parseGenericModalEffect,
  parseMassPump,
  parseSimpleDrawEffect,
  parseSimpleLifeChange,
  parseTargetedPump
} from "./AppFlow";

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

export function stripReminder(line: string): string {
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

export function recognises(cardName: string, rawLine: string, fullText: string): boolean {
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

