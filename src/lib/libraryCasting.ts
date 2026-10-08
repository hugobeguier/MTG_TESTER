// "You may cast creature spells with power 4 or greater from the top of your library. If you cast a creature spell this way, it gains haste
// until end of turn." (Thundermane Dragon) — a standing permission on a permanent that lets its controller cast the top card of their library.
export interface LibraryCastPermission {
  grantsHaste: boolean;
}

interface CastableShape {
  typeLine: string;
  power?: string;
  colors?: string[];
}

interface PermissionSource {
  oracleText: string;
  abilitiesStripped?: boolean;
}

export function libraryTopCastPermission(card: CastableShape, battlefield: PermissionSource[]): LibraryCastPermission | undefined {
  if (card.typeLine.includes("Land")) return undefined;
  for (const source of battlefield) {
    if (source.abilitiesStripped) continue;
    for (const line of source.oracleText.split("\n")) {
      // "You may play lands and cast spells from the top of your library." (One with the Multiverse): any spell. (Lands are not offered here.)
      if (/^you may (?:play lands and )?cast spells from the top of your library\b/i.test(line)) return { grantsHaste: false };
      // "You may cast artifact spells and colorless spells from the top of your library." (Mystic Forge)
      if (/^you may cast artifact spells and colorless spells from the top of your library\b/i.test(line)) {
        if (card.typeLine.includes("Artifact") || !card.colors || card.colors.length === 0) return { grantsHaste: false };
        continue;
      }
      const match = line.match(/^you may cast ([a-z]+) spells(?: with power (\d+) or greater)? from the top of your library\./i);
      if (!match) continue;
      const type = match[1].toLowerCase();
      if (!card.typeLine.toLowerCase().includes(type)) continue;
      if (match[2] !== undefined && !(Number.parseInt(card.power ?? "", 10) >= Number.parseInt(match[2], 10))) continue;
      return { grantsHaste: /it gains haste until end of turn/i.test(source.oracleText) };
    }
  }
  return undefined;
}
