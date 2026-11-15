// Strict ability audit over every deck in decks/: lists each activated ability, ability grant and ward cost that no specific engine system models.
// Unlike `npm run backlog` (does ANY parser claim the line?), this names the system that handles each ability, so a card like Fiend Artisan or Ygra
// shows up as a gap until the engine really carries it out.
//
//   npm run audit:abilities            (every deck)
//   npm run audit:abilities -- Meren   (only deck files whose name contains "Meren")
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { loadCardCatalog, lookupCard } from "../src/lib/cardCatalog";
import { auditCard } from "../src/components/abilityAudit";

function deckFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? deckFiles(full) : full.endsWith(".txt") ? [full] : [];
  });
}

export function deckCardNames(file: string): string[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/^(Commander:\s*)?\d*\s*/, "").replace(/\s+\([A-Z0-9]+\).*$/, "").trim())
    .filter((line) => line && !/^(commander|deck|sideboard|companion)\b/i.test(line));
}

const filter = process.argv.slice(2).join(" ").toLowerCase();
const catalog = loadCardCatalog();
let totalCards = 0;
let totalGaps = 0;
for (const file of deckFiles("decks")) {
  if (filter && !file.toLowerCase().includes(filter)) continue;
  const gaps: string[] = [];
  const names = new Set(deckCardNames(file));
  let found = 0;
  for (const name of names) {
    const card = lookupCard(catalog, name) as { name: string; typeLine?: string; oracleText?: string; producedMana?: string[] } | undefined;
    if (!card) continue;
    found += 1;
    for (const finding of auditCard(card)) {
      if (!finding.modelled) gaps.push(`  [${finding.kind}] ${finding.card}: ${finding.line.slice(0, 130)}`);
    }
  }
  totalCards += found;
  totalGaps += gaps.length;
  console.log(`\n${path.basename(file)}: ${found} cards, ${gaps.length} unmodelled`);
  for (const gap of gaps) console.log(gap);
}
console.log(`\n${totalCards} cards audited, ${totalGaps} unmodelled abilities.`);
