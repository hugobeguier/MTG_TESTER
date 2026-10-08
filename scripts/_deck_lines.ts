// Throwaway: for each card in the given deck files, which oracle lines does NO deterministic parser claim?
import { readFileSync } from "node:fs";
import { loadCardCatalog, lookupCard } from "../src/lib/cardCatalog";
import { parseRemovalEffect } from "../src/lib/removalSpells";
import { parseZoneEffect } from "../src/lib/zoneEffects";
import { parseSpellExtraEffects } from "../src/lib/spellExtras";
import { parseGenericTapAbilities, parseGenericSacrificeAbilities, parseGenericManaAbilities } from "../src/lib/activatedAbilities";
import { castStructure, commonTriggerEffect, parseGenericAbilityEffect, parseGenericModalEffect, parseTargetedPump, parseSimpleDrawEffect, parseSimpleLifeChange } from "../src/components/AppFlow";

const catalog = loadCardCatalog();
const appFlow = readFileSync("src/components/AppFlow.tsx", "utf8").toLowerCase();
const strip = (l: string) => l.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
const keywordOnly = (l: string) => /^(?:[a-z ]+?(?: \{[^}]+\}| \d+| [a-z]+ from [a-z]+)?)(?:, [a-z ]+)*$/i.test(l) && l.length < 60 && !/[.:]/.test(l) && !/\b(?:target|you|your|creature|whenever|when|at the)\b/i.test(l);

for (const file of process.argv.slice(2).filter((a) => a.endsWith(".txt"))) {
  const names = [...new Set(readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => /^\d+\s/.test(l)).map((l) => l.replace(/^\d+\s+/, "").replace(/\s+\(.*$/, "").replace(/\s+\*.*$/, "").trim()))];
  console.log(`\n##### ${file}`);
  for (const name of names) {
    const card = lookupCard(catalog, name) as { name: string; typeLine: string; oracleText: string } | undefined;
    if (!card || /Basic Land/.test(card.typeLine)) continue;
    const isSpell = /Instant|Sorcery/.test(card.typeLine);
    const named = appFlow.includes(card.name.split(" // ")[0].toLowerCase().replace(/^the /, ""));
    const bad: string[] = [];
    for (const raw of card.oracleText.split("\n")) {
      const line = strip(raw);
      if (!line || keywordOnly(line)) continue;
      if (/: Add /.test(line) || /^Miracle /.test(line) || /enters tapped/.test(line)) continue;
      const triggered = /^(?:when|whenever|at the beginning)/i.test(line);
      const activated = !triggered && /^[^"]*?:\s/.test(line);
      const effectText = activated ? line.split(/:\s(.+)/)[1] ?? line : line;
      let ok = false;
      if (activated) {
        ok = Boolean(parseGenericAbilityEffect(effectText) || parseGenericTapAbilities(line)[0] || parseGenericSacrificeAbilities(line)[0] || parseGenericManaAbilities(line)[0] || parseRemovalEffect(effectText) || parseZoneEffect(effectText) || parseTargetedPump(effectText));
      } else if (triggered) {
        const body = line.replace(/^[^,]*,\s*/, "").replace(/^if [^,]*,\s*/i, "");
        ok = Boolean(
          commonTriggerEffect(line, "clause") || commonTriggerEffect(body, "clause") || parseRemovalEffect(body) || parseZoneEffect(body) || parseSpellExtraEffects(body).length ||
            parseTargetedPump(body) || parseSimpleDrawEffect(body) || parseSimpleLifeChange(body) || parseGenericModalEffect(line, undefined)
        );
      } else if (isSpell) {
        ok = Boolean(castStructure(card as never) || parseRemovalEffect(effectText) || parseZoneEffect(effectText) || parseSpellExtraEffects(effectText).length || parseSimpleDrawEffect(effectText) || parseSimpleLifeChange(effectText) || commonTriggerEffect(effectText, "clause") || parseGenericModalEffect(card.oracleText, undefined) || parseTargetedPump(effectText));
      } else {
        continue; // static line: cannot be judged here
      }
      if (!ok) bad.push(line.slice(0, 110));
    }
    if (bad.length > 0) console.log(`${card.name}${named ? " [named in engine]" : ""}\n   ` + bad.join("\n   "));
  }
}
