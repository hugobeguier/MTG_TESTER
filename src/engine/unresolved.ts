// "Never fail silently": when the legacy engine meets spell/ability/trigger text that no deterministic parser recognises (or only part of it),
// the resolution points report the unrecognised clause here. recordUnresolved writes a "Couldn't resolve: <Card> - <clause>" line in the game's
// event log (detail "Unresolved", so it is findable and shown to every player through the normal snapshot) and appends a dev-side record to
// session.unresolvedEffects (counted by the observer/self-play, posted to disk by the multiplayer host/solo client).
// Only the card being resolved is ever named, so no private-zone card name can leak.
import type { GameEvent, GameSession, UnresolvedEffectRecord, VisibleCard } from "@/lib/types";
import { etbEffectClauses, isActivatedAbilityClause, mergeModalBulletClauses, oracleClauses, parseModalHeader } from "@/lib/oracleClauses";
import { deterministicRuleWorkflow } from "@/lib/rulesAdvisor";
import { parseCounterSpellAbility, parseDelayedUpkeepDraws } from "@/lib/counterSpells";
import { parseRemovalEffect } from "@/lib/removalSpells";
import { parseZoneEffect } from "@/lib/zoneEffects";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
import { parseTargetedEffect } from "@/lib/targetedEffects";
import { parseSearchLibraryEffectText } from "@/lib/activatedAbilities";
import { hasChooseCreatureTypeEtb, parseChooseColorEtb } from "@/lib/characteristics";
import { parseCreateTokenSpecs } from "@/engine/tokens";
import { commonTriggerEffect } from "@/engine/triggers";
import { exploreCount, grantsExtraTurn } from "@/engine/etb";
import { parseEtbZoneEffect, parseEachPlayerSacrificeEffect, parseMassBounceEffect, parseMassPump, parsePunisherChoiceEffect, parseSimpleDrawEffect, parseSimpleLifeChange, isLivingDeathEffect } from "@/engine/oneShotEffects";
import { parseGenericAbilityEffect } from "@/engine/abilities";
import { parseGenericModalEffect, parseTargetedPump } from "@/engine/effects";

export type UnresolvedAbilityKind = "spell" | "etb" | "trigger" | "saga_chapter" | "loyalty_ability";

// Events whose text this module judges. Death/leave/graveyard/phase events have their own trigger systems and are deliberately not judged here.
const JUDGED_EVENTS = new Set(["spell_resolved_to_battlefield", "spell_resolved_to_graveyard", "land_played", "saga_chapter", "loyalty_ability"]);

function stripReminder(text: string): string {
  return text.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

// True when some deterministic parser in the legacy engine would take this effect text.
function effectRecognised(text: string, card: VisibleCard, event: string): boolean {
  const t = stripReminder(text).replace(/^(?:[IVX]+(?:\s*,\s*[IVX]+)*)\s*[—-]\s*/, "").replace(/^[+\-−]?\d+:\s*/, "").trim();
  if (!t) return true;
  // "Exile <this spell>." is done by the casting step itself (casting.ts: the spell exiles instead of going to the graveyard).
  if (t.toLowerCase().replace(/[.]$/, "") === `exile ${card.name.toLowerCase()}` || /^exile this spell\.?$/i.test(t)) return true;
  const checks: Array<() => unknown> = [
    () => parseRemovalEffect(t),
    () => parseZoneEffect(t),
    () => parseEtbZoneEffect(t),
    () => parseTargetedEffect(t),
    () => parseTargetedPump(t),
    () => parseMassPump(t),
    () => parseMassBounceEffect(t),
    () => parseSimpleDrawEffect(t),
    () => parseSimpleLifeChange(t),
    () => parsePunisherChoiceEffect(t),
    () => parseEachPlayerSacrificeEffect(t),
    () => parseSearchLibraryEffectText(t),
    () => parseSpellExtraEffects(t).length > 0,
    () => parseCreateTokenSpecs(t).length > 0,
    () => parseCounterSpellAbility(t),
    () => parseDelayedUpkeepDraws(t),
    () => commonTriggerEffect(t, "clause"),
    () => commonTriggerEffect(t, "entered"),
    () => parseGenericAbilityEffect(t),
    () => parseModalHeader(t) && parseGenericModalEffect(t, undefined),
    () => isLivingDeathEffect(t),
    () => grantsExtraTurn(t),
    () => exploreCount(t),
    () => hasChooseCreatureTypeEtb(t),
    () => parseChooseColorEtb(t),
    () => deterministicRuleWorkflow({ event, actorName: "", sourceCard: { ...card, oracleText: t }, battlefield: [], hand: [], graveyard: [], exile: [], libraryPreview: [] })?.workflow
  ];
  return checks.some((check) => {
    const result = safe(check);
    return Boolean(result) && result !== "none";
  });
}

function sentences(clause: string): string[] {
  // A quoted granted ability ("Squirrels you control have "{T}: Target Squirrel gets +2/+2. Activate only as a sorcery."") stays one unit.
  if (clause.includes('"')) return [clause.trim()];
  return clause
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const KEYWORDS = new Set(
  "flying first strike double deathtouch haste hexproof indestructible lifelink menace reach trample vigilance defender flash ward prowess skulk shroud intimidate fear infect wither undying persist cascade convoke delve storm affinity changeling devoid ninjutsu riot partner kicker cycling equip fabricate toxic exalted flanking bushido landwalk".split(" ")
);
function isKeywordLine(text: string): boolean {
  const words = text.replace(/[.,;]/g, " ").toLowerCase().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => KEYWORDS.has(w) || /^\{?[\dxwubrgc/]+\}?$/.test(w));
}
// Text that is a mode-selection header or a timing/restriction rider, never an effect of its own.
const NON_EFFECT_SENTENCE = /^(?:you may )?choose (?:one|two|three|four|any number|up to)\b|^you may choose the same mode|^each mode must target|^activate (?:only|no more)|^this ability triggers only|^as an additional cost to cast this spell|^if you don't, /i;
const EFFECT_VERBS = new Set(
  "add attach become choose counter create deal destroy discard distribute double draw exchange exile fight gain get give investigate look lose mill move pay populate proliferate put regenerate remove return reveal roll sacrifice scry search shuffle surveil take tap transform untap vote".split(" ")
);
// Only effect-shaped sentences (an imperative, or "<subject> <verb>") are judged: static abilities, replacement clauses, cost changes and keyword-with-cost lines
// belong to the static systems, not to resolution, and judging them here would flood the log.
const STATIC_START = /^(?:flashback|cycling|basic landcycling|landcycling|outlast|gift|enchant|equip|kicker|multikicker|ninjutsu|prototype|will of the council|ward|you may cast|you may pay|this spell can't|this land enters|this creature enters|as long as|[a-z' ]+ can't |[a-z' ,]+ can be your commander)/i;
function isEffectShaped(sentence: string): boolean {
  const text = sentence.replace(/^[•\s]+/, "").trim();
  if (STATIC_START.test(text)) return false;
  // A quoted granted ability (... have "{T}: ...") is an unhandled ability grant, effect-shaped by definition.
  if (/\b(?:have|has|gains?) "/i.test(text)) return true;
  const rest = text.replace(/^(?:you may |you |each (?:other )?(?:player|opponent) |target (?:player|opponent) |that player |its controller |they |up to \w+ target [a-z ]+ )/i, "");
  const first = rest.split(/[\s,]/)[0].toLowerCase();
  return EFFECT_VERBS.has(first) || EFFECT_VERBS.has(first.replace(/(?:es|s)$/, "")) || EFFECT_VERBS.has(first.replace(/s$/, ""));
}
const ENTERS_TAPPED = /^(?:this|that) [a-z]+ enters (?:the battlefield )?tapped\.?$/i;

// One clause (a line of oracle text): names only the parts nothing recognised.
function unresolvedInClause(clause: string, card: VisibleCard, event: string): string[] {
  let cleaned = stripReminder(clause);
  // MDFC faces print "<Face name>: <text>"; a cost-style "{T}: ..." never starts with a capital word.
  cleaned = cleaned.replace(/^[A-Z][A-Za-z',-]*(?: [A-Za-z',-]+){0,5}: (?=[A-Z])/, "");
  if (!cleaned || isKeywordLine(cleaned) || ENTERS_TAPPED.test(cleaned)) return [];
  const afterCondition = cleaned.replace(/^(?:when|whenever|at the beginning of)\b[^,]*,\s*/i, "").replace(/^[A-Z][a-z]+ [—-] /, "").replace(/^as [^,]+ enters,\s*/i, "").replace(/^if [^,]+,\s*/i, "");
  const wholeRecognised = effectRecognised(cleaned, card, event) || effectRecognised(afterCondition, card, event);
  // A parser taking a clause's first sentence must not hide an unrelated second one: when the whole clause is recognised, still look for sentences
  // nothing takes alone (or joined to the one before). Modal and quoted clauses are taken as a unit.
  if (wholeRecognised && (afterCondition.includes("•") || cleaned.includes('"'))) return [];
  if (afterCondition.includes("•")) {
    // Modal: the header is only a selector; each bullet is judged on its own.
    const [, ...bullets] = afterCondition.split("•");
    return bullets.map((b) => b.trim()).filter((b) => b && isEffectShaped(b) && !effectRecognised(b, card, event)).map((b) => `• ${b}`);
  }
  const parts = sentences(afterCondition).filter((s) => !NON_EFFECT_SENTENCE.test(s) && isEffectShaped(s));
  if (parts.length <= 1) return !wholeRecognised && parts.length === 1 && !effectRecognised(parts[0], card, event) ? [cleaned] : [];
  return parts.filter((s, i) => {
    if (effectRecognised(s, card, event)) return false;
    // A continuation ("Then ...", "Its controller ...") is recognised together with the sentence before it.
    if (i > 0 && effectRecognised(`${parts[i - 1]} ${s}`, card, event) && (!wholeRecognised || /^(?:then|its controller|that player)\b/i.test(s))) return false;
    return true;
  });
}

const TRIGGER_START = /^(?:when|whenever|at the beginning of)\b/i;
const ABILITY_WORD_TRIGGER = /^[A-Z][a-z]+ [—-] (?:at the beginning|when|whenever)\b/;

function isTriggerClause(clause: string): boolean {
  return TRIGGER_START.test(clause) || ABILITY_WORD_TRIGGER.test(clause);
}

/** The clauses of `card` the legacy engine cannot apply for `event`. Empty when everything was recognised (or the event is not judged). */
export function findUnresolvedClauses(card: VisibleCard, event: string): Array<{ kind: UnresolvedAbilityKind; clause: string }> {
  if (!JUDGED_EVENTS.has(event) || !card.oracleText?.trim()) return [];
  const out: Array<{ kind: UnresolvedAbilityKind; clause: string }> = [];
  const push = (kind: UnresolvedAbilityKind, clause: string) => {
    if (!out.some((o) => o.clause === clause)) out.push({ kind, clause });
  };
  if (event === "saga_chapter" || event === "loyalty_ability") {
    for (const clause of unresolvedInClause(card.oracleText, card, event)) push(event === "saga_chapter" ? "saga_chapter" : "loyalty_ability", clause);
    return out;
  }
  const own = etbEffectClauses(card.oracleText);
  const instantOrSorcery = /\b(?:Instant|Sorcery)\b/.test(card.typeLine);
  for (const raw of own) for (const clause of unresolvedInClause(raw, card, event)) push(instantOrSorcery ? "spell" : "etb", clause);
  // Triggered abilities that fire later (combat damage, end step, leaves the battlefield, ...) are judged once, when the permanent enters.
  if (event === "spell_resolved_to_battlefield" || event === "land_played") {
    const ownSet = new Set(own.map(stripReminder));
    for (const raw of mergeModalBulletClauses(oracleClauses(card.oracleText))) {
      if (isActivatedAbilityClause(raw) || !isTriggerClause(raw) || ownSet.has(stripReminder(raw))) continue;
      for (const clause of unresolvedInClause(raw, card, event)) push("trigger", clause);
    }
  }
  return out;
}

export function unresolvedMessage(cardName: string, clause: string): string {
  return `Couldn't resolve: ${cardName} - ${clause}`;
}

/** Pure session transformer: logs once per card object + clause and records it. Never throws. */
export function recordUnresolved(session: GameSession, seatId: string, card: Pick<VisibleCard, "id" | "name">, clause: string, kind: string): GameSession {
  try {
    const key = `${card.id}\u0001${clause}`;
    const existing = session.unresolvedEffects ?? [];
    if (existing.some((entry) => entry.key === key)) return session;
    const seat = session.seats.find((s) => s.id === seatId);
    const record: UnresolvedEffectRecord = {
      key,
      cardName: card.name,
      clause,
      abilityKind: kind,
      engine: "legacy",
      decks: session.seats.map((s) => s.deck?.name).filter((n): n is string => Boolean(n)),
      turn: session.turn,
      phase: session.phase,
      seatKind: seat?.kind === "human" ? "human" : "agent",
      at: new Date().toISOString(),
      gameId: session.id
    };
    const event: GameEvent = { id: crypto.randomUUID(), at: record.at, seatId, message: unresolvedMessage(card.name, clause), detail: "Unresolved" };
    return { ...session, events: [event, ...session.events], unresolvedEffects: [...existing, record] };
  } catch {
    return session;
  }
}

/** Judge `card` for `event` and record every unresolved clause. */
export function reportUnresolvedForCard(session: GameSession, seatId: string, card: VisibleCard, event: string): GameSession {
  let next = session;
  for (const { kind, clause } of safe(() => findUnresolvedClauses(card, event)) ?? []) next = recordUnresolved(next, seatId, card, clause, kind);
  return next;
}
