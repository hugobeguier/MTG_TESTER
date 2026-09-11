// mtg-commander-engine-spec.md's Phase 3a, lookup/grounding half: shared between cardParser.ts's
// offline bulk parser and primitiveActionPlan.ts's live per-event fallback, both of which look up a
// card's XMage reference implementation (src/lib/cardDb.ts's xmage_cards table, populated by
// scripts/ingest-xmage-cards.mjs) and, when one exists, hand it to the LLM as extra grounding
// context before it decides whether to emit steps or decline. Kept as its own module (rather than
// duplicated per caller, or folded into cardDb.ts) since both callers need the EXACT same
// truncation/formatting and prompt wording — drifting copies would mean one caller's grounding
// silently reads differently from the other's for no real reason.

import type { XMageCardRow } from "./cardDb";

// p99 of the ingested corpus (32,270 files, measured 2026-09-11) is ~6.5 KB; the rare outlier goes
// up to ~35 KB. Capped well above p99 so the overwhelming majority of real cards are never
// truncated at all, while still bounding how much of a small local model's limited context budget
// one grounding lookup can consume.
const MAX_SOURCE_CHARS = 6000;

// The model must not treat this as instructions to follow or copy Java-isms from — it's read-only
// grounding for understanding what the card actually does, still translated through this engine's
// own fixed vocabulary exactly as the rest of the system prompt already requires.
export function xmageReferenceBlurb(row: XMageCardRow): string {
  const truncated = row.source.length > MAX_SOURCE_CHARS;
  const source = truncated ? `${row.source.slice(0, MAX_SOURCE_CHARS)}\n// ... (truncated)` : row.source;
  return [
    "Reference only — from a DIFFERENT, independent open-source Magic engine (XMage, magefree/mage,",
    `file ${row.filePath}), NOT this engine. It correctly encodes this exact card's real rules`,
    "behavior in Java, which may help you understand what the card actually does if the plain oracle",
    "text above was ambiguous or its shape was unfamiliar. Do NOT copy Java syntax, class names, or",
    "any concept outside this system's own fixed vocabulary into your answer — still respond using",
    "ONLY that vocabulary, and still decline if the card's real effect (now hopefully clearer) still",
    "doesn't map onto it. Reference source:",
    "```java",
    source,
    "```"
  ].join("\n");
}
