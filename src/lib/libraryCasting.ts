// "You may cast creature spells with power 4 or greater from the top of your library. If you cast a creature spell this way, it gains haste
// until end of turn." (Thundermane Dragon) — a standing permission on a permanent that lets its controller cast the top card of their library.
export interface LibraryCastPermission {
  grantsHaste: boolean;
}

interface CastableShape {
  typeLine: string;
  power?: string;
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
