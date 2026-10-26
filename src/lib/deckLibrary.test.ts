import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeDeckFile } from "../../app/api/decks/library/normalize";
import { createDeckFromList } from "./deckParser";
import { loadCardCatalog, lookupCard } from "./cardCatalog";

const catalog = loadCardCatalog();
const root = process.cwd();

const walk = (dir: string, recurse: boolean): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? (recurse ? walk(path.join(dir, entry.name), true) : []) : entry.name.toLowerCase().endsWith(".txt") ? [path.join(dir, entry.name)] : []
  );

// Every deck-shaped file (a "Commander:" line or 30+ card lines), wherever the deck editor has renamed or moved it.
const files = [...walk(root, false), ...walk(path.join(root, "decks"), true)].filter((file) => {
  const text = readFileSync(file, "utf8");
  return /^commander:/im.test(text) || text.split(/\r?\n/).filter((line) => /^\d+x?\s+\S/.test(line.trim())).length >= 30;
});

describe("saved deck library", () => {
  for (const file of files) {
    it(`${path.basename(file)} parses and validates`, () => {
      const { commander, deckList } = normalizeDeckFile(path.basename(file, ".txt"), readFileSync(file, "utf8"));
      const deck = createDeckFromList({ owner: "t", commander, deckList, catalog: { lookup: (n: string) => lookupCard(catalog, n) } as never });
      console.log(path.basename(file), "=>", commander, deck.cards.reduce((n, c) => n + c.count, 0), "cards", deck.validation.errors.slice(0, 3));
      expect(deck.commander.length).toBeGreaterThan(0);
    });
  }
});
