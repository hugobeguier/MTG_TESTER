// Parses WHO a "Whenever <subject> enters / dies" trigger watches, and checks a given permanent against
// it. The older enteredTriggerApplies / deathTriggerApplies in AppFlow.tsx only understand a fixed list
// of type words, so qualifiers they had no concept of silently broke real cards: Champion of the
// Perished ("another Zombie you control enters" — Zombie isn't a type word), Ayara ("Ayara or another
// BLACK creature you control enters" — the source named by its own short name, and a color),
// Headless Rider / Undead Augur ("this creature or another [nontoken] Zombie you control dies"),
// Midnight Reaper / Open the Graves ("a NONTOKEN creature you control dies").
//
// Returns undefined when the clause isn't a shape this parser fully understands, so callers fall back
// to their existing logic instead of guessing.

import { permanentMatchesQualifier } from "./characteristics";
import { hasKeyword } from "./keywords";

export interface WatcherSubjectContext {
  sourceId: string;
  sourceName: string;
  subject: { id: string; typeLine: string; commander?: boolean; token?: boolean; grantedTypes?: string[]; colors?: string[]; power?: string; oracleText?: string };
  // The permanent entering / dying is controlled by the same player who controls the watcher.
  subjectIsControlledBySourceController: boolean;
  // "attacks" only: the player being attacked is the source's controller ("attacks you or a planeswalker
  // you control", Marchesa's Decree).
  defendingPlayerIsSourceController?: boolean;
}

type Control = "you" | "opponent" | "any";

interface SubjectPart {
  // "a creature with power 3 or greater" / "a creature with flying" (Garruk's Packleader, Dragon Tempest).
  minPower?: number;
  keyword?: string;
  self: boolean;
  another: boolean;
  descriptor: string;
  control: Control;
}

const CONTROL_SUFFIXES: Array<{ pattern: RegExp; control: Control }> = [
  { pattern: /\s+you control$/, control: "you" },
  { pattern: /\s+under your control$/, control: "you" },
  { pattern: /\s+(?:an opponent controls|your opponents control|you don'?t control)$/, control: "opponent" }
];

// A descriptor word this parser can evaluate: "nontoken", a color or "non<color>", or a plain noun
// (type or creature subtype). Anything else ("nonland", "noncreature", "legendary" negations, ...) makes
// the whole clause unparseable rather than half-evaluated.
function descriptorIsEvaluable(descriptor: string): boolean {
  return descriptor.split(/\s+/).every((word) => {
    if (/^non/.test(word)) return word === "nontoken" || /^non(?:white|blue|black|red|green)$/.test(word);
    return /^[a-z'-]+$/.test(word);
  });
}

function parsePart(rawPart: string, sourceName: string): SubjectPart | undefined {
  const part = rawPart.trim();
  const shortName = sourceName.toLowerCase().split(",")[0].trim();
  if (/^this\s+[a-z ]+$/.test(part) || part === sourceName.toLowerCase() || part === shortName) {
    return { self: true, another: false, descriptor: "", control: "any" };
  }
  // "your commander" / "a commander you control" (Tome of Legends, Norn's Choirmaster): matched on the card's commander flag.
  if (part === "your commander" || part === "a commander you control") return { self: false, another: false, descriptor: "commander", control: "you" };
  const match = part.match(/^(another|each other|a|an)\s+(.+)$/);
  if (!match) return undefined;
  let rest = match[2].trim();
  let control: Control = "any";
  let minPower: number | undefined;
  let keyword: string | undefined;
  // The "with ..." condition comes LAST in the real wording ("a creature you control with power 3 or greater",
  // "a creature you control with flying") — taken off first so the "you control" before it is still at the end of
  // what's left. The control phrase may also come after it ("... with flying you control"), so it's checked again below.
  const stripConditions = () => {
    const powerCondition = rest.match(/\s+with power (\d+) or greater$/);
    if (powerCondition) {
      minPower = Number.parseInt(powerCondition[1], 10);
      rest = rest.replace(powerCondition[0], "").trim();
    }
    const keywordCondition = rest.match(/\s+with (flying|haste|reach|trample|deathtouch|lifelink|first strike|vigilance|menace|hexproof)$/);
    if (keywordCondition) {
      keyword = keywordCondition[1];
      rest = rest.replace(keywordCondition[0], "").trim();
    }
  };
  const stripControl = () => {
    for (const suffix of CONTROL_SUFFIXES) {
      if (suffix.pattern.test(rest)) {
        rest = rest.replace(suffix.pattern, "").trim();
        control = suffix.control;
        return;
      }
    }
  };
  stripConditions();
  stripControl();
  stripConditions();
  if (!rest || !descriptorIsEvaluable(rest)) return undefined;
  return { self: false, another: match[1] === "another" || match[1] === "each other", descriptor: rest, control, minPower, keyword };
}

// "Whenever this creature or another nontoken Zombie you control dies, ..." for event "dies"; same for
// "enters". `afterVerb` catches the trailing "under your control" of "a land enters under your control".
export function matchWatcherSubject(oracleText: string, event: "enters" | "dies" | "attacks" | "blocks", context: WatcherSubjectContext): boolean | undefined {
  const verb = event;
  let sawClause = false;
  let allParsed = true;
  for (const rawClause of oracleText.split("\n")) {
    // "attacks or blocks" is one trigger watching both events; reduce it to whichever verb is being asked about.
    const clause = rawClause.replace(/\([^)]*\)/g, "").trim().toLowerCase().replace(/\battacks or blocks\b|\benters or attacks\b/, verb);
    const match = clause.match(new RegExp(`\\b(?:when|whenever)\\s+([^,.:]+?)\\s+${verb}\\b([^,.]*)`));
    if (!match) continue;
    sawClause = true;
    // "...with power 3 or greater" contains an "or" that separates nothing.
    // "another Angel or Cleric you control": later list items inherit the first one's determiner.
    let lastDeterminer = "a";
    const parts = match[1]
      .split(/\s+or\s+(?!greater\b|less\b|fewer\b)/)
      .map((part, index) => {
        const determiner = part.trim().match(/^(another|each other|a|an)\s/);
        if (determiner) lastDeterminer = determiner[1];
        else if (index > 0 && !/^this\s/.test(part.trim())) part = `${lastDeterminer} ${part.trim()}`;
        return parsePart(part, context.sourceName);
      });
    if (parts.some((part) => part === undefined)) {
      allParsed = false;
      continue;
    }
    // ...and a trailing "you control" on the last item applies to the whole list.
    const listControl = (parts as SubjectPart[]).find((part) => !part.self && part.control !== "any")?.control;
    if (listControl) for (const part of parts as SubjectPart[]) if (!part.self && part.control === "any") part.control = listControl;
    // "...attacks you or a planeswalker you control": only counts when the defender is the source's controller.
    if (event === "attacks" && /^\s+you\b/.test(match[2]) && context.defendingPlayerIsSourceController !== true) {
      allParsed = allParsed && true;
      continue;
    }
    const trailingControl: Control | undefined =/\bunder your control\b/.test(match[2]) ? "you" : /\bunder an opponent'?s control\b/.test(match[2]) ? "opponent" : undefined;
    for (const part of parts as SubjectPart[]) {
      if (part.self) {
        if (context.subject.id === context.sourceId) return true;
        continue;
      }
      if (part.another && context.subject.id === context.sourceId) continue;
      if (part.descriptor === "commander" ? !context.subject.commander : !permanentMatchesQualifier(context.subject, part.descriptor)) continue;
      if (part.minPower !== undefined && !(Number.parseInt(context.subject.power ?? "", 10) >= part.minPower)) continue;
      if (part.keyword && !hasKeyword(context.subject.oracleText ?? "", part.keyword)) continue;
      const control = part.control !== "any" ? part.control : trailingControl ?? "any";
      if (control === "you" && !context.subjectIsControlledBySourceController) continue;
      if (control === "opponent" && context.subjectIsControlledBySourceController) continue;
      return true;
    }
  }
  if (!sawClause) return undefined;
  return allParsed ? false : undefined;
}
