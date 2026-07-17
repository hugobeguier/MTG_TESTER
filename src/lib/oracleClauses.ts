// Splits oracle text into its individual ability clauses (this card data's convention uses "\n"
// between abilities) and isolates which ones actually apply to a given moment — entering the
// battlefield vs. dying vs. an activated-ability cost — so callers don't misread a "dies" trigger
// or an activated ability's cost as something that happens immediately on ETB (or vice versa).
// Shared between the client-side engine (AppFlow.tsx) and the Rules Advisor (rulesAdvisor.ts) so
// both apply the same rule instead of drifting apart.

export function oracleClauses(oracleText: string): string[] {
  return oracleText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function isActivatedAbilityClause(clause: string): boolean {
  if (/^\{[^}]+\}/.test(clause) && clause.includes(":")) return true;
  // Planeswalker loyalty abilities ("+1:", "0:", "−9:") are activated abilities costed in loyalty
  // rather than mana — the same "skip this clause, it isn't a standing trigger" reasoning applies.
  // This matters in practice: a loyalty ability's effect text can itself describe a granted emblem
  // using standard trigger phrasing (e.g. Tezzeret, Artifice Master's −9 grants an emblem with "At
  // the beginning of your end step, ..."), which must not be read as Tezzeret's own always-on
  // trigger just because that phrase appears somewhere in his oracle text.
  if (/^[+\-−]?\d+:/.test(clause)) return true;
  // Equip/Reconfigure print their cost with no colon at all ("Equip {1}", "Equip Dinosaur {3}"),
  // unlike every other activated ability's "cost: effect" templating — without this, that line
  // wasn't recognized as a cost/ability clause by anything, so it slipped straight into ETB-effect
  // text as if it were part of what the permanent does the moment it enters.
  return /^(equip|reconfigure)\b/i.test(clause);
}

export function isDeathTriggerClause(clause: string): boolean {
  return /\b(when|whenever)\b[^.]{0,80}\bdies\b/i.test(clause);
}

// Real oracle text templates every phase-triggered ability ("at the beginning of your upkeep/draw
// step/end step/...", "at the beginning of combat", "at the beginning of each opponent's upkeep")
// with this exact phrase — an ETB trigger always uses "when"/"whenever ~ enters" instead, never
// this wording, so it's a safe, general exclusion rather than a per-phase list.
export function isPhaseTriggerClause(clause: string): boolean {
  return /\bat the beginning of\b/i.test(clause);
}

// A genuine ETB trigger is always phrased with "enters" ("when this creature enters," "whenever a
// creature enters the battlefield under your control," ...). Any other "when/whenever" clause
// (casting a spell, attacking, blocking, another creature dying, gaining life, an opponent drawing,
// ...) describes a standing trigger keyed to some later, unrelated event, not to this permanent's
// own arrival — without this exclusion, a card like Shark Typhoon ("Whenever you cast a noncreature
// spell, create an X/X ... Shark ...") or Soaring Lightbringer ("Whenever Soaring Lightbringer
// attacks, create a 1/1 ... Bird ...") had that recurring trigger read as if it were an ETB effect,
// creating a token the instant the permanent itself entered instead of waiting for the real trigger.
// isDeathTriggerClause above already independently excludes "dies" clauses; this is a broader net
// that also catches attack/cast/block/damage/life-gain/etc. triggers, with harmless overlap.
export function isNonEtbWheneverClause(clause: string): boolean {
  return /\b(when|whenever)\b/i.test(clause) && !/\benters?\b/i.test(clause);
}

// Oracle text with activated-ability, "dies"-triggered, phase-triggered, and other later-event-
// triggered clauses stripped out, so ETB-time parsing (token creation, life/card-draw effects,
// rules-advisor workflow detection) can't misfire on abilities that are actually gated behind a
// later death trigger, a separate activated cost (e.g. Mind Stone's "{1}, {T}, Sacrifice this
// artifact: Draw a card." must not resolve the moment it's cast, and Hangarback Walker's death
// trigger must not fire on ETB), a later phase trigger (Thopter Assembly's "At the beginning of
// your upkeep, ... create five ... Thopter ... tokens" was firing the moment it entered instead of
// waiting for its controller's next upkeep), or a standing non-ETB trigger (see
// isNonEtbWheneverClause above).
export function etbEffectText(oracleText: string): string {
  return oracleClauses(oracleText)
    .filter((clause) => !isActivatedAbilityClause(clause) && !isDeathTriggerClause(clause) && !isPhaseTriggerClause(clause) && !isNonEtbWheneverClause(clause))
    .join(" ");
}

// The inverse: isolates just the "dies"-triggered clause(s), so a permanent's death effect (e.g.
// Solemn Simulacrum's "When this creature dies, you may draw a card.") is parsed from the right
// sentence instead of the whole card (which would otherwise also match its unrelated ETB clause).
export function deathEffectText(oracleText: string): string {
  return oracleClauses(oracleText)
    .filter((clause) => isDeathTriggerClause(clause))
    .join(" ");
}

// A "Choose one/two/three —" header and its bullet-point modes are printed as separate "\n"-
// separated lines in this card data's convention, same as any other pair of independent abilities
// — so a plain oracleClauses() split leaves them as unrelated entries: the header line contains
// the phase-trigger wording ("At the beginning of your end step, choose one —") but no actual
// effect text, and each bullet ("• You gain 1 life.") contains effect text but no phase-trigger
// wording. A per-clause content filter (hasPhaseTrigger, phaseEffectText in AppFlow.tsx) would
// keep the empty header and drop every bullet, or vice versa, either way losing the modal's actual
// effect entirely. This walks the clause list and folds each modal header back together with the
// bullet clauses that immediately follow it into one combined multi-line clause, so a later
// content filter sees (and keeps, or drops) the whole thing as a unit. Clauses with no modal
// header pass through unchanged.
export function mergeModalBulletClauses(clauses: string[]): string[] {
  const merged: string[] = [];
  let i = 0;
  while (i < clauses.length) {
    const clause = clauses[i];
    if (/choose (one|two|three)\s*[—-]\s*$/i.test(clause)) {
      let combined = clause;
      let j = i + 1;
      while (j < clauses.length && /^[••]/.test(clauses[j])) {
        combined += `\n${clauses[j]}`;
        j += 1;
      }
      merged.push(combined);
      i = j;
      continue;
    }
    merged.push(clause);
    i += 1;
  }
  return merged;
}

export interface ModalHeader {
  chooseCount: number;
  modeTexts: string[];
}

// "Choose one/two/three —\n• mode.\n• mode. ..." (Boros Charm, Austere Command, Profane Command,
// ...) — extracts each bullet's own raw text so a caller can independently try its own single-
// effect parsers against each mode, rather than scanning the whole card's oracle text as if it
// were one effect (which would either miss the "choose" semantics entirely or, worse, match a
// mode's wording out of context as if it unconditionally applied). Shared by removalSpells.ts's
// own modal handling and by AppFlow.tsx's generic (non-removal) modal handling, so both recognize
// the same header shapes instead of drifting apart.
export function parseModalHeader(oracleText: string): ModalHeader | undefined {
  const header = oracleText.match(/\bchoose (one|two|three)\s*[—-]\s*/i);
  if (!header || header.index === undefined) return undefined;
  const chooseCount = { one: 1, two: 2, three: 3 }[header[1].toLowerCase() as "one" | "two" | "three"] ?? 1;
  const modeTexts = oracleText
    .slice(header.index + header[0].length)
    .split(/[••]/)
    .map((mode) => mode.trim())
    .filter(Boolean);
  if (modeTexts.length < 2) return undefined;
  return { chooseCount, modeTexts };
}
