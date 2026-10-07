// Printed combat restrictions and combat keywords that are plain rules text: landwalk, "can block only creatures with flying", "attacks each
// combat if able", bushido, "doesn't untap". Pure text readers shared by the engine (AppFlow) and the AI (combatSim / actionScoring).

interface TextCard {
  oracleText: string;
  abilitiesStripped?: boolean;
  typeLine?: string;
  // Aura/Equipment bookkeeping for "enchanted creature doesn't untap".
  id?: string;
  attachedToId?: string;
  goaded?: unknown;
}

const LANDWALK_TYPES = ["plains", "island", "swamp", "mountain", "forest", "desert", "snow"];

function ruleLines(card: TextCard): string[] {
  if (card.abilitiesStripped) return [];
  return (card.oracleText ?? "").split("\n").map((line) => line.replace(/\([^)]*\)/g, "").trim().toLowerCase().replace(/\.$/, ""));
}

// "Swampwalk" (this creature can't be blocked as long as defending player controls a Swamp): the land types it walks.
export function landwalkTypes(card: TextCard): string[] {
  const found: string[] = [];
  for (const line of ruleLines(card)) {
    for (const part of line.split(/[,;]\s*/)) {
      const match = part.trim().match(/^([a-z]+)walk$/);
      if (match && LANDWALK_TYPES.includes(match[1])) found.push(match[1]);
    }
  }
  return found;
}

export function landwalkEvades(attacker: TextCard, defenderBattlefield: Array<{ typeLine: string }> | undefined): boolean {
  if (!defenderBattlefield) return false;
  return landwalkTypes(attacker).some((type) =>
    defenderBattlefield.some((permanent) => permanent.typeLine.toLowerCase().includes("land") && permanent.typeLine.toLowerCase().includes(type === "snow" ? "snow" : type))
  );
}

// "This creature can block only creatures with flying."
export function canBlockOnlyFliers(blocker: TextCard): boolean {
  return ruleLines(blocker).some((line) => /^(?:this creature|[a-z',\- ]+) can block only creatures with flying$/.test(line));
}

// "This creature attacks each combat if able."
export function mustAttackEachCombat(card: TextCard): boolean {
  if (card.goaded) return true;
  return ruleLines(card).some((line) => /^(?:this creature|[a-z',\- ]+) attacks each (?:combat|turn) if able$/.test(line));
}

// "Bushido N": +N/+N until end of turn whenever the creature blocks or becomes blocked.
export function bushidoAmount(card: TextCard): number {
  for (const line of ruleLines(card)) {
    const match = line.match(/^bushido (\d+)$/);
    if (match) return Number.parseInt(match[1], 10);
  }
  return 0;
}

// "This creature doesn't untap during your untap step." and "Enchanted creature doesn't untap during its controller's untap step."
export function cantUntap(card: TextCard & { id: string }, battlefield: TextCard[]): boolean {
  if (ruleLines(card).some((line) => /^(?:this (?:creature|artifact|permanent)|[a-z',\- ]+) doesn'?t untap during your untap step$/.test(line))) return true;
  return battlefield.some((other) => other.attachedToId === card.id && ruleLines(other).some((line) => /^enchanted (?:creature|permanent) doesn'?t untap during its controller'?s untap step$/.test(line)));
}
