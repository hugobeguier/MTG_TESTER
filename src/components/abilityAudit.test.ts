// The strict ability audit as a ratchet. Every deck under decks/ is audited; the set of abilities no engine system models must equal KNOWN_GAPS below.
//   - A card added to a deck with a NEW gap fails this test: implement it (and add a real-text test), or add it here with a reason.
//   - A gap that gets fixed must be removed from KNOWN_GAPS (the test also fails when a listed gap no longer exists), so the list only ever shrinks.
// Run `npm run audit:abilities` for the full per-deck report.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { auditCard } from "./abilityAudit";

// "Card: start of the ability line" for every activated ability, ability grant or ward cost the engine does not yet carry out.
const KNOWN_GAPS = [
  "Eiganjo, Seat of the Empire: Channel — {2}{W}, Discard this card: It deals 4", // (c) channel (hand-zone activation) with a cost reduction and an attacking/blocking target
  "Gix, Yawgmoth Praetor: {4}{B}{B}{B}, Discard X cards: Exile the top X", // (c) discard-X cost, exile top X of an opponent's library and play from among them
  "Hall of Heliod's Generosity: {1}{W}, {T}: Put target enchantment card from", // (c) needs a new 'graveyard card on top of library' zone effect
  "Hopeful Initiate: {2}{W}, Remove two +1/+1 counters from among creatures", // (c) counters removed 'from among creatures you control' (multi-permanent cost)
  "Jarad, Golgari Lich Lord: Sacrifice a Swamp and a Forest: Return this card", // (c) graveyard-zone activation with a two-land sacrifice cost
  "Master Transmuter: {U}, {T}, Return an artifact you control to its owner's", // (c) bounce-an-artifact cost plus put-from-hand-onto-battlefield choice
  "Priest of Forgotten Gods: {T}, Sacrifice two other creatures: Any number of", // (c) sacrifice-two cost with any-number-of-players targeting
  "Retribution of the Ancients: {B}, Remove X +1/+1 counters from among creatures", // (c) X counters removed from among creatures, -X/-X to a target
  "Tamiyo's Logbook: {5}{U}, {T}: Draw a card. This ability costs {1} less to activate", // (c) ability cost reduction per other artifact
  // From the decks moved from the repo root into decks/custom (Aminatou, Lathliss, Meren, Saheeli, The Ur Dragon):
  "Callaphe, Beloved of the Sea: Creatures and enchantments you control have \"Spells your opponents cast that tar", // (c) granted tax on spells that target a permanent
  "Estrid's Invocation: You may have this enchantment enter as a copy of an enchantment you control, exc", // (c) enter-as-copy replacement with an upkeep trigger granted to the copy
  "Dauthi Voidwalker: {T}, Sacrifice this creature: Choose an exiled card an opponent owns with a void", // (c) void-counter exile tracking and play-from-exile
  "Takenuma, Abandoned Mire: Channel — {3}{B}, Discard this card: Mill three cards, then return a creature or", // (c) channel with mill-then-return
  "Spymaster's Vault: {B}, {T}: Target creature you control connives X, where X is the number of creat", // (c) connive X where X counts creature deaths this turn
  "Shifting Woodland: Delirium — {2}{G}{G}: This land becomes a copy of target permanent card in your ", // (c) becomes a copy of a graveyard card, delirium-gated
  "Susur Secundi, Void Altar: 12+ | {1}{B}, {T}, Pay 2 life, Sacrifice a creature: Draw cards equal to the sac", // (c) level-up style 12+ block, sorcery-speed sacrifice draw
  "Boseiju, Who Endures: Channel — {1}{G}, Discard this card: Destroy target artifact, enchantment, or no", // (c) channel plus opponent's optional search
  "Ramos, Dragon Engine: Remove five +1/+1 counters from Ramos: Add {W}{W}{U}{U}{B}{B}{R}{R}{G}{G}. Activ", // (c) ten-colored-mana burst into the pool for removing five counters (needs a pool-add mana path)
  "Crucible of the Spirit Dragon: {1}, {T}: Put a storage counter on this land.", // (c) storage counters are only useful with its Dragon-restricted X mana ability
  "Scavenger Regent // Exude Toxin: Ward—Discard a card.", // (c) ward-discard needs the ward payment flow extended
  "Mistrise Village: {U}, {T}: The next spell you cast this turn can't be countered.", // (c) 'next spell can't be countered' flag
  "Three Tree City: {2}, {T}: Choose a color. Add an amount of mana of that color equal to the numbe" // (c) choose-a-color mana scaled by a chosen creature type
];

function deckFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? deckFiles(full) : full.endsWith(".txt") ? [full] : [];
  });
}

function deckCardNames(file: string): string[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/^(Commander:\s*)?\d*\s*/, "").replace(/\s+\([A-Z0-9]+\).*$/, "").trim())
    .filter((line) => line && !/^(commander|deck|sideboard|companion)\b/i.test(line));
}

describe("strict ability audit", () => {
  const catalog = loadCardCatalog();
  const card = (name: string) => lookupCard(catalog, name) as { name: string; typeLine?: string; oracleText?: string } | undefined;

  it("models the abilities that were once silently missing (Fiend Artisan's X search, Ygra's granted ability and ward, Cankerbloom)", () => {
    for (const name of ["Fiend Artisan", "Ygra, Eater of All", "Cankerbloom", "Viscera Seer", "Spore Frog"]) {
      const found = card(name);
      if (!found) continue;
      const gaps = auditCard(found).filter((finding) => !finding.modelled);
      expect(gaps, `${name}: ${gaps.map((gap) => gap.line).join(" | ")}`).toEqual([]);
    }
  });

  it("flags an activated ability and a ward cost the engine cannot carry out", () => {
    const flagged = auditCard({ name: "Test Card", typeLine: "Creature", oracleText: "Ward—Discard a card.\n{3}, {T}: Exile the top card of each opponent's library face down." });
    expect(flagged.filter((finding) => !finding.modelled).map((finding) => finding.kind).sort()).toEqual(["activated", "ward"]);
  });

  it("every deck's unmodelled abilities are exactly the known gaps (a new gap fails; a fixed gap must leave the list)", () => {
    const found = new Set<string>();
    for (const file of deckFiles("decks")) {
      for (const name of new Set(deckCardNames(file))) {
        const entry = card(name);
        if (!entry) continue;
        for (const finding of auditCard(entry)) {
          if (!finding.modelled) found.add(`${finding.card}: ${finding.line.slice(0, 80)}`);
        }
      }
    }
    const unexpected = [...found].filter((gap) => !KNOWN_GAPS.some((known) => gap.startsWith(known)));
    const fixed = KNOWN_GAPS.filter((known) => ![...found].some((gap) => gap.startsWith(known)));
    expect(unexpected, "new unmodelled abilities (implement them or add them to KNOWN_GAPS with a reason)").toEqual([]);
    expect(fixed, "listed gaps that no longer exist (remove them from KNOWN_GAPS)").toEqual([]);
  });
});
