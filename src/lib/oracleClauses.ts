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
  if (/^(equip|reconfigure)\b/i.test(clause)) return true;
  // General case (rule 602.1a): every activated ability is templated "Cost: Effect.", with a colon,
  // even when its cost is spelled out in plain English rather than mana/tap symbols — Sakura-Tribe
  // Elder's "Sacrifice Sakura-Tribe Elder: Search your library for a basic land card, put it onto
  // the battlefield tapped, then shuffle." has no leading {..}, no loyalty number, and isn't equip/
  // reconfigure, so the three checks above all missed it — reproduced live: the clause leaked
  // straight into etbEffectText and got read as something that happens automatically and for free
  // the instant the creature resolves, on top of (not instead of) its real, separately-costed
  // activation later. Real Magic's templating is consistent enough to lean on directly here:
  // triggered abilities are always phrased "When/Whenever/At ~, ..." with no colon; a colon
  // anywhere in a clause that ISN'T one of those is, in practice, always an activated ability's
  // cost/effect divider.
  const colonIndex = clause.indexOf(":");
  if (colonIndex === -1) return false;
  const preColon = clause.slice(0, colonIndex);
  // "DoorName: Ability text." (Secret Arcade // Dusty Parlor and the same templating on every
  // other Room card) prefixes EVERY door's ability — including a genuine triggered one like "Dusty
  // Parlor: Whenever you cast an enchantment spell, ..." — with the door's own name before a
  // colon, which otherwise reads exactly like an activated ability's "cost: effect" divider (the
  // door name has no when/whenever/at-the-beginning of its own for the check below to catch).
  // Reproduced live: Dusty Parlor's cast trigger never fired even fully unlocked, because this
  // whole clause got misread as an uncosted activated ability and excluded from trigger scanning
  // everywhere. A real cost always contains a mana symbol, a tap symbol, or a cost verb (tap/
  // sacrifice/discard/pay/exile); a door name never does — so a short, all-capitalized, cost-free
  // phrase before the colon is read as a label instead, and the same check re-runs against
  // whatever follows it rather than stopping at the label's own colon.
  const looksLikeCostFreeLabel =
    /^[A-Z][a-zA-Z'-]*(?:\s+[A-Z][a-zA-Z'-]*){0,3}$/.test(preColon) && !/\{|\btap\b|\bsacrifice\b|\bdiscard\b|\bpay\b|\bexile\b/i.test(preColon);
  if (looksLikeCostFreeLabel) return isActivatedAbilityClause(clause.slice(colonIndex + 1).trim());
  return !/\b(when|whenever|at the beginning)\b/i.test(preColon);
}

export function isDeathTriggerClause(clause: string): boolean {
  return /\b(when|whenever)\b[^.]{0,80}\bdies\b/i.test(clause);
}

// "Whenever a creature you control deals combat damage to a player, ..." (Toski, Bearer of
// Secrets, and the same standard templating on plenty of other cards) — isolated the same way
// isDeathTriggerClause isolates a "dies" clause, so this specific event-driven trigger can be
// parsed from just its own sentence instead of a whole card's oracle text (which might otherwise
// contain an unrelated clause that happens to match some other commonTriggerEffect pattern first).
export function isCombatDamageToPlayerClause(clause: string): boolean {
  return /\b(when|whenever)\b[^.]{0,80}\bdeals combat damage to a player\b/i.test(clause);
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

// "You get an emblem with '...'" (planeswalker ultimates mostly — Tezzeret, Artifice Master's -9,
// Nissa/Karn/Chandra's ultimates, ...). Only the quoted rules text is captured; everything else in
// the granting ability's own text (the "You get an emblem with" wrapper itself, any surrounding
// mode text) is irrelevant once the emblem exists — from then on it only ever acts through its own
// captured text, same as a permanent acts through its own oracleText.
export function parseEmblemGrant(oracleText: string): { text: string } | undefined {
  const match = oracleText.match(/you get an emblem with\s+"([^"]+)"/i);
  return match ? { text: match[1] } : undefined;
}

// "As an additional cost to cast this spell, sacrifice a creature." (Village Rites, Altar's Reap,
// Costly Plunder, ...) — rule 601.2h: this is paid immediately when casting, from the caster's own
// battlefield, not part of the spell's resolution effect that follows it. Scoped to the single-
// creature "sacrifice a/an creature" shape, the overwhelmingly common real-world form of this cost;
// a numbered/multi-permanent or non-creature ("sacrifice an artifact/land/permanent") variant isn't
// recognized here.
export function parseAdditionalSacrificeCost(oracleText: string): { count: number } | undefined {
  const match = oracleText.toLowerCase().match(/as an additional cost to cast this spell,\s*sacrifice (a|an|two|three)\s+creatures?\b/);
  if (!match) return undefined;
  const count = match[1] === "two" ? 2 : match[1] === "three" ? 3 : 1;
  return { count };
}

// The inverse: isolates just the "dies"-triggered clause(s), so a permanent's death effect (e.g.
// Solemn Simulacrum's "When this creature dies, you may draw a card.") is parsed from the right
// sentence instead of the whole card (which would otherwise also match its unrelated ETB clause).
export function deathEffectText(oracleText: string): string {
  return oracleClauses(oracleText)
    .filter((clause) => isDeathTriggerClause(clause))
    .join(" ");
}

// Same idea, isolating just the "deals combat damage to a player" clause(s) — see
// isCombatDamageToPlayerClause's own comment.
export function combatDamageToPlayerEffectText(oracleText: string): string {
  return oracleClauses(oracleText)
    .filter((clause) => isCombatDamageToPlayerClause(clause))
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

// "Evolving Wilds/Terramorphic Expanse/Wayfarer's Bauble-style" search-a-basic-land-and-sacrifice
// ability recognizer — shared between AppFlow.tsx (which resolves the ability) and
// ThreeGameTable.tsx (which decides whether to show its activate button). This used to be defined
// independently in both files; ThreeGameTable.tsx's copy never got the "put THAT CARD onto the
// battlefield tapped" alternative added alongside "put IT onto the battlefield tapped" (Wayfarer's
// Bauble is worded the former way), so its button silently never appeared for that card at all —
// reproduced live, reported as "can't activate despite having the mana," when the real cause had
// nothing to do with mana; the button just never rendered. A single shared definition here means
// the two files can no longer drift apart on which cards this recognizes.
export function isBasicLandFetchAbility(card: { oracleText: string }): boolean {
  const text = card.oracleText.toLowerCase();
  return (
    text.includes("search your library for a basic land card") &&
    (text.includes("put it onto the battlefield tapped") || text.includes("put that card onto the battlefield tapped")) &&
    text.includes("sacrifice")
  );
}

// Not every basic-land-fetch ability actually costs {T} — Sakura-Tribe Elder's is plain "Sacrifice
// this creature:" with no tap at all (that's the whole point of the card: block, then still get
// its ramp the same turn), unlike Evolving Wilds' "{T}, Sacrifice this land:". Gating on
// card.tapped/summoning sickness unconditionally for every basic-land-fetch source — as if they all
// cost {T} — wrongly blocked Sakura-Tribe Elder's ability the instant it was already tapped (e.g.
// from blocking) or still summoning sick, neither of which rule 302.6 actually restricts when the
// cost has no {T}/{Q} in it.
export function basicLandFetchCostRequiresTap(card: { oracleText: string }): boolean {
  const clause = card.oracleText.split("\n").find((line) => /search your library for a basic land card/i.test(line));
  const costPortion = clause?.split(":")[0] ?? "";
  return /\{t\}/i.test(costPortion);
}

// Blightsteel Colossus / Emrakul, the Aeons Torn-style graveyard replacement: "If ~ would be put
// into a graveyard from anywhere, reveal ~ and shuffle it into its owner's library instead." This
// is a replacement effect (rule 614), not a triggered ability — the card never actually sits in a
// graveyard at all; the move is redirected before it happens. The bounded [\s\S]{0,80}? skips over
// the card's own name (which appears a second time mid-clause, e.g. "reveal Blightsteel Colossus
// and") without hardcoding it, so this recognizes any card printed with the same template.
export function hasGraveyardShuffleReplacement(oracleText: string): boolean {
  return /would be put into a graveyard from anywhere,\s*reveal\b[\s\S]{0,80}?\band shuffle it into its owner'?s library instead\b/i.test(
    oracleText
  );
}

// "Whenever ~ attacks, add X mana in any combination of colors, where X is the total power of
// attacking creatures. Spend this mana only to cast spells. Until end of turn, you don't lose this
// mana as steps and phases end." (Klauth, Unrivaled Ancient — verified via the card data; not a mana
// ability at all despite the "add mana" wording, since it's triggered off an event and uses the
// stack, rule 605.1a). The bounded [\s\S]{0,40}? skips over the card's own name between "whenever"
// and "attacks," without hardcoding it, so this recognizes any card printed with the same template.
export function isAttackTriggerAddManaClause(oracleText: string): boolean {
  return /\bwhenever\b[\s\S]{0,40}?\battacks,\s*add x mana in any combination of colors,\s*where x is the total power of attacking creatures\.\s*spend this mana only to cast spells\.\s*until end of turn,\s*you don'?t lose this mana as steps and phases end\.?/i.test(
    oracleText
  );
}

// Evolving Wilds/Terramorphic Expanse cost only {T}, Sacrifice (no generic mana at all), which is
// the only shape this whole basic-land-fetch system originally modeled — every affordability check
// and every actual resolution path for it paid {T}+sacrifice and nothing else, with no generic-mana
// component anywhere. Wayfarer's Bauble's real cost is "{2}, {T}, Sacrifice this artifact: ...", so
// it was being let through both as always-legal-to-activate and as free-to-activate, silently
// dropping its {2} entirely — reproduced live alongside the isBasicLandFetchAbility button-visibility
// bug above. Sums the {N} generic-mana symbols in the cost portion (before the colon), same pattern
// basicLandFetchCostRequiresTap already uses to isolate that portion.
export function basicLandFetchManaCost(card: { oracleText: string }): number {
  const clause = card.oracleText.split("\n").find((line) => /search your library for a basic land card/i.test(line));
  const costPortion = clause?.split(":")[0] ?? "";
  const manaSymbols = costPortion.match(/\{(\d+)\}/g) ?? [];
  return manaSymbols.reduce((total, symbol) => total + (Number.parseInt(symbol.replace(/[{}]/g, ""), 10) || 0), 0);
}
