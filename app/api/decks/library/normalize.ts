import { commanderFromDeckList } from "@/lib/precons";

// A deck file without a "Commander:" line (Lathliss, Dragon Queen.txt; Aminatou 100 cards.txt) gets one
// prepended, so the deck parser marks the right card as the commander. The commander is the card
// named like the file: if that card is in the list it is moved to the Commander line, otherwise the
// file is a 99-card list and the file name itself is the commander. A trailing "SIDEBOARD:" section is
// dropped, since the deck parser would otherwise count those cards into the deck.
export function normalizeDeckFile(fileBase: string, text: string): { commander: string; deckList: string } {
  const trimmed = text.replace(/^﻿/, "").trim();
  const sideboardAt = trimmed.search(/^\s*sideboard\b.*$/im);
  const deckList = (sideboardAt >= 0 ? trimmed.slice(0, sideboardAt) : trimmed).trim();
  const existing = commanderFromDeckList(deckList);
  if (existing) return { commander: existing, deckList };

  const stripSet = (line: string) => line.replace(/^\d+x?\s+/, "").replace(/\s+\([A-Za-z0-9]+\)\s*\S*(\s+\*\w+\*)?\s*$/, "").trim();
  const lines = deckList.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const names = lines.map(stripSet);
  const fileKey = fileBase.replace(/\s*\d+\s*cards?\s*$/i, "").trim();
  const lower = fileKey.toLowerCase();
  const index = names.findIndex((name) => name.toLowerCase() === lower || name.toLowerCase().startsWith(`${lower},`) || name.toLowerCase().startsWith(`${lower} `));
  if (index < 0) return { commander: fileKey, deckList: [`Commander: ${fileKey}`, ...lines].join("\n") };
  const commander = names[index];
  return { commander, deckList: [`Commander: ${commander}`, ...lines.filter((_, i) => i !== index)].join("\n") };
}
