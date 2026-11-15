// Strict per-card ability audit. Unlike clauseCoverage.recognises ("does ANY parser claim this line?", which passed Fiend Artisan's whole activated
// ability and Ygra's granted ability without the engine ever carrying them out), each finding here names the SPECIFIC system that offers or applies
// the ability, and a line no such system covers is reported as unmodelled. It checks three kinds of line:
//   - activated abilities ("{cost}: effect"): offered by the sacrifice / tap / untap / generic parsers, the mana system, graveyard, land-fetch or manland code
//   - static grants of an ability to other permanents (`have "..."`): Ygra, Insidious Roots
//   - ward costs: only {N}, pay N life, and sacrifice a Food are paid by the engine
// Triggered abilities are NOT covered here yet (see scripts/card-backlog.ts for the loose check).
import { isBasicLandFetchAbility, isActivatedAbilityClause, oracleClauses } from "@/lib/oracleClauses";
import { parseGenericManaAbilities, parseGenericSacrificeAbilities, parseGenericTapAbilities, parseManlandAnimation, parseSelfUntapAbilities } from "@/lib/activatedAbilities";
import { parseGraveyardReturnAbility } from "@/lib/graveyardAbilities";
import { parseGroupManaAbilityGrant } from "@/lib/characteristics";
import { parseOtherCreaturesGrant, parseTypeGrantEffects } from "@/lib/typeGrants";
import type { PlayerSeat, VisibleCard } from "@/lib/types";
import { legalMainPhaseActions, manaChoicesForCard } from "./AppFlow";
import type { GameSession } from "@/lib/types";

export interface AuditFinding {
  card: string;
  line: string;
  kind: "activated" | "static_grant" | "ward";
  modelled: boolean;
  // The system that handles it (when modelled).
  by?: string;
}

export interface AuditableCard {
  name: string;
  typeLine?: string;
  oracleText?: string;
  producedMana?: string[];
}

// Keyword-ability families with their own, separately tested systems: they are not audited as generic activated abilities.
const OWN_SYSTEM = /^(?:[+\-−]?\d+:|equip\b|reconfigure\b|[a-z]*cycling\b|unlock\b)/i;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function sharesPrefix(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  const n = Math.min(40, x.length, y.length);
  return n >= 12 && x.slice(0, n) === y.slice(0, n);
}

// Stub seats so the mana system can say which colors a mana source makes: the seat controls enough lands for "five or more lands" conditions and
// an opponent has lands of other colors for "a land an opponent controls could produce" (Exotic Orchard).
function stubLand(id: string, name: string, color: string): VisibleCard {
  return { id, name, typeLine: `Basic Land — ${name}`, oracleText: `{T}: Add {${color}}.`, manaValue: 0, colors: [], role: "land", zone: "battlefield", producedMana: [color] } as unknown as VisibleCard;
}

function stubSeat(): PlayerSeat {
  const lands = [stubLand("s1", "Swamp", "B"), stubLand("s2", "Forest", "G"), stubLand("s3", "Swamp", "B"), stubLand("s4", "Forest", "G"), stubLand("s5", "Swamp", "B"), stubLand("s6", "Forest", "G")];
  return {
    id: "audit",
    name: "Audit",
    kind: "agent",
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: lands.length, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield: lands, graveyard: [], commander: { id: "cmd", name: "Commander", typeLine: "Legendary Creature", oracleText: "", manaValue: 4, colors: ["B", "G"], colorIdentity: ["B", "G"], zone: "command" } as VisibleCard }
  } as unknown as PlayerSeat;
}

function stubOpponent(): PlayerSeat {
  const lands = [stubLand("o1", "Mountain", "R"), stubLand("o2", "Island", "U")];
  return { id: "audit-opp", name: "Opponent", kind: "agent", life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: 2, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield: lands, graveyard: [] } } as unknown as PlayerSeat;
}

// How many activated abilities of this card the engine actually OFFERS (as actions) on a well-stocked board: untapped lands of every color, creatures,
// artifacts and enchantments to sacrifice or target, a full graveyard, hand and library. The strongest check there is that an ability is carried out.
function engineOfferedAbilityCount(card: AuditableCard): number {
  let n = 0;
  const filler = (name: string, typeLine: string, extra: Partial<VisibleCard> = {}): VisibleCard =>
    ({ id: `f${n++}`, name, typeLine, oracleText: "", manaValue: 2, colors: [], role: "permanent", zone: "battlefield", summoningSick: false, power: typeLine.includes("Creature") ? "2" : undefined, toughness: typeLine.includes("Creature") ? "2" : undefined, ...extra }) as VisibleCard;
  const land = (name: string, color: string) => filler(name, `Basic Land — ${name}`, { role: "land", manaValue: 0, producedMana: [color], oracleText: `{T}: Add {${color}}.` });
  const source = { id: "audit-source", manaValue: 3, colors: [], role: "permanent", zone: "battlefield", summoningSick: false, tapped: false, producedMana: card.producedMana, name: card.name, typeLine: card.typeLine ?? "", oracleText: card.oracleText ?? "" } as VisibleCard;
  const battlefield = [
    source,
    land("Plains", "W"), land("Island", "U"), land("Swamp", "B"), land("Mountain", "R"), land("Forest", "G"), land("Forest", "G"), land("Swamp", "B"),
    filler("Bears A", "Creature — Bear"), filler("Bears B", "Creature — Bear"), filler("Bears C", "Creature — Bear"), filler("Bears D", "Creature — Bear"),
    filler("Trinket A", "Artifact"), filler("Trinket B", "Artifact"), filler("Aura Stone", "Enchantment"), filler("Food", "Artifact — Food")
  ];
  const graveyard = [filler("Dead Bear", "Creature — Bear", { zone: "graveyard" }), filler("Dead Bear Two", "Creature — Bear", { zone: "graveyard" }), filler("Dead Relic", "Artifact", { zone: "graveyard" }), filler("Dead Charm", "Enchantment", { zone: "graveyard" })];
  const hand = [filler("Spare A", "Creature — Bear", { zone: "hand" }), filler("Spare B", "Instant", { zone: "hand" })];
  const library = Array.from({ length: 12 }, (_, index) => filler(index % 3 === 0 ? "Forest" : `Library Bear ${index}`, index % 3 === 0 ? "Basic Land — Forest" : "Creature — Bear", { zone: "library", manaValue: index % 6 }));
  const me = { id: "a", name: "A", kind: "human", life: 40, commanderDamage: {}, zones: { library: library.length, hand: hand.length, battlefield: battlefield.length, graveyard: graveyard.length, exile: 0, command: 0 }, board: { hand, battlefield, graveyard }, library } as unknown as PlayerSeat;
  const them = { id: "b", name: "B", kind: "agent", life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: 4, graveyard: 1, exile: 0, command: 0 }, board: { hand: [], battlefield: [filler("Their Bear", "Creature — Bear"), filler("Their Relic", "Artifact"), filler("Their Charm", "Enchantment"), filler("Their Hound", "Creature — Dog")], graveyard: [filler("Their Dead", "Creature — Bear", { zone: "graveyard" })] }, library: [] } as unknown as PlayerSeat;
  const session = { id: "audit", createdAt: "", status: "playing", phase: "precombat main phase", turn: 6, xmage: { enabled: false, status: "not_configured", message: "" }, seats: [me, them], events: [] } as unknown as GameSession;
  try {
    const kinds = new Set(["generic_sacrifice", "generic_tap", "self_untap", "generic_mana", "myriad_landscape", "animate_manland", "basic_land_fetch"]);
    return legalMainPhaseActions(me, true, "a", 6, new Set(), session).filter((action) => action.cardId === "audit-source" && action.actionType === "activate_ability" && action.abilityKind !== undefined && kinds.has(action.abilityKind)).length;
  } catch {
    return 0;
  }
}

function activatedModelledBy(card: AuditableCard, clause: string): string | undefined {
  const text = card.oracleText ?? "";
  // The sacrifice parser reads "Sacrifice <this card's own name>:" as "Sacrifice this creature:", so compare against that form too.
  const selfNormalized = clause.replace(/(\b[Ss]acrifice\s+)[A-Z][\w'’,.-]*(?:\s+[A-Z][\w'’,.-]*)*(\s*:)/, "$1this creature$2");
  const claims = (list: Array<{ clause?: string }>) => list.some((ability) => ability.clause && (sharesPrefix(ability.clause, clause) || sharesPrefix(ability.clause, selfNormalized)));
  if (claims(parseGenericSacrificeAbilities(text))) return "sacrifice ability parser";
  if (claims(parseGenericTapAbilities(text))) return "tap ability parser";
  if (claims(parseSelfUntapAbilities(text) as Array<{ clause?: string }>)) return "self-untap parser";
  if (claims(parseGenericManaAbilities(text))) return "generic ability parser";
  if (/:\s*add\b/i.test(clause)) {
    const asCard = { id: "audit-card", name: card.name, typeLine: card.typeLine ?? "", oracleText: text, manaValue: 0, colors: [], zone: "battlefield", producedMana: card.producedMana, chosenColor: "W" } as unknown as VisibleCard;
    const seat = stubSeat();
    if (manaChoicesForCard(asCard, seat, [seat, stubOpponent()]).length > 0) return "mana system";
  }
  if (/graveyard/i.test(clause) && parseGraveyardReturnAbility(text)) return "graveyard return ability";
  if (/search your library for a basic/i.test(clause) && isBasicLandFetchAbility({ oracleText: text })) return "basic land fetch";
  if (/\bbecomes?\b/i.test(clause) && parseManlandAnimation(text)) return "manland animation";
  return undefined;
}

export function auditCard(card: AuditableCard): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const text = card.oracleText ?? "";
  for (const raw of oracleClauses(text)) {
    const clause = raw.replace(/\s*\([^)]*\)/g, "").trim();
    if (!clause) continue;
    // Double-faced and split cards print the face name before a line ("Growing Rites of Itlimoc: When ... enters", "Itlimoc, Cradle of the Sun:"): not abilities.
    const faceNames = card.name.split("//").map((face) => face.trim().toLowerCase());
    if (faceNames.some((face) => clause.toLowerCase().startsWith(face + ":")) && !/^[^:]*:\s*\{/.test(clause)) continue;
    // Lieutenant (Tyrant's Familiar): a conditional static grant to itself, covered by its own real-text test, not an ability granted to others.
    if (/^lieutenant\s*[—-]/i.test(clause)) continue;

    // Ward: only the costs the engine actually pays.
    const ward = clause.match(/^ward\b\s*(.*)$/i);
    if (ward) {
      const cost = ward[1].trim();
      const supported = /^\{\d+\}$/.test(cost) || /^[—-]\s*pay \d+ life\b/i.test(cost) || /^[—-]\s*sacrifice an? food\b/i.test(cost);
      findings.push({ card: card.name, line: clause, kind: "ward", modelled: supported, by: supported ? "ward payment" : undefined });
      continue;
    }

    // A static ability that gives other permanents an ability ("... have "{2}, {T}, Sacrifice this permanent: ...""): Ygra, Insidious Roots.
    if (/\b(?:have|has|gains?)\s+"[^"]+"/i.test(clause) && !/\bcreate\b/i.test(clause) && !/^(?:when|whenever|at the beginning)\b/i.test(clause)) {
      const by = parseOtherCreaturesGrant(clause)
        ? "other-creatures grant"
        : parseGroupManaAbilityGrant(text).length > 0
          ? "group mana-ability grant"
          : parseTypeGrantEffects(clause).length > 0
            ? "type grant"
            : undefined;
      findings.push({ card: card.name, line: clause, kind: "static_grant", modelled: by !== undefined, by });
      continue;
    }

    // An activated ability of the card itself.
    if (isActivatedAbilityClause(clause) && !OWN_SYSTEM.test(clause)) {
      const by = activatedModelledBy(card, clause);
      findings.push({ card: card.name, line: clause, kind: "activated", modelled: by !== undefined, by });
    }
  }
  const offered = engineOfferedAbilityCount(card);
  const unmodelled = findings.filter((finding) => finding.kind === "activated" && !finding.modelled);
  const activatedTotal = findings.filter((finding) => finding.kind === "activated" && !/:\s*add\b/i.test(finding.line)).length;
  const parserModelled = findings.filter((finding) => finding.kind === "activated" && finding.modelled && !/:\s*add\b/i.test(finding.line)).length;
  // The engine offers more abilities than the parsers claimed: credit that many of the unmodelled lines to the engine.
  let credit = Math.min(unmodelled.length, Math.max(0, Math.min(offered, activatedTotal) - parserModelled));
  for (const finding of unmodelled) {
    if (credit <= 0) break;
    finding.modelled = true;
    finding.by = "engine offers it";
    credit -= 1;
  }
  return findings;
}
