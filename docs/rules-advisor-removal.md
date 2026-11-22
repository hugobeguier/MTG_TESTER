# Rules Advisor removal (2026-11-22)

Decision: the LLM "Rules Advisor" never visibly helped in games; the deterministic kernel replaces it
(`src/kernel/engine/README.md`, `docs/kernel-integration-plan.md`).

## 1. Inventory (what existed)

LLM paths (all removed):
- `src/components/game/useRulesAdvisor.ts`: `consultRulesAdvisor` (RuleWorkflow LLM via `/api/rules/check`), `consultPrimitiveActionPlanner` (`/api/rules/primitive-plan`), `consultStaticEffectInterpreter` (`/api/rules/static-effect`), `rulesAdvisorPending` spinner/guard counter.
- `app/api/rules/{check,primitive-plan,static-effect,parse-card,override-card,advisor-log}`.
- `src/lib/rulesAdvisor.ts` `requestRuleWorkflow`; `src/lib/primitiveActionPlan.ts` `requestPrimitiveActionPlan` + system prompt + JSON schema; `src/lib/cardParser.ts` `requestCardParse`, `matchAbilityForEvent`; `src/lib/staticEffects.ts` Ollama attack-tax interpretation.
- `src/lib/agentRuntime.ts`: `ruleWorkflowCache` (localStorage `mtg-rule-workflow-cache-v3`), `primitiveActionPlanCache`, `prewarmRuleWorkflowCache`, `logAdvisorUse` (wrote `advisor-log.jsonl`), `cachedRuleSummariesForCard`.
- Consumers: `priority.ts` agent snapshot `ruledEffects` (and its prompt text in `app/api/agents/action/route.ts`), `oneShotEffects.agentPlannedCastChoices` (+ call in `castTargets.ts`), `useGameSetup` prewarm call, `context.ts` pending counter and cache load, `useGameEffects` pending gates.
- Scripts: `scripts/parse-cards.mjs`, `scripts/override-card.mjs`, `cards:parse`/`cards:override` in package.json.

Kept on purpose (deterministic, used by the engine/tests/kernel):
- `src/lib/rulesAdvisor.ts`: `deterministicRuleWorkflow`, `eventRelevantOracleText`, `RuleWorkflow` (draw/scry/surveil/search classifier; no LLM). File name is legacy.
- `consultRulesAdvisor` / `shouldConsultRulesAdvisor` names, now in `src/components/game/useSpellWorkflows.ts`: deterministic only. Unrecognised text is simply not resolved.
- `deterministicAttackTax` (attack-tax read locally on ETB, no fetch).
- The step schema in `primitiveActionPlan.ts`, `applyPrimitiveActionPlan` / `optional_primitive_plan` resolution (now has no producer; kernel capability notes reference it), `cardParser.ts` row schema, `parsed_cards` table, `xmageGrounding.ts` (static reference), `ollama.ts` (agent decisions).
- UI log label `"Rules advisor"` renamed `"Rules"` (ThreeGameTable filters updated).

## 2. Measurement

Self-play (`src/lib/selfplay/orchestrator.ts`) never called the advisor (headless, deterministic only), so it cannot measure this. The real record is the live-game diagnostic log `advisor-log.jsonl` (git-ignored, 2026-11-16 to 2026-11-21, 121 consultations):
- 94 primitive-plan Ollama calls + 3 rule-workflow Ollama calls; 21 cache replays; 2 failed (fallback).
- 68 distinct (card, event, path) results: 32 declined, 18 returned 0 steps, 12 returned 1-2 primitive steps, 6 were RuleWorkflow answers (draw/look/manual_review).
- The 12 step plans were mostly lands "enters tapped" (Tranquil Thicket, Drowned Catacomb, Prairie Stream, Haunted Mire, Arcane Sanctum, Barren Moor, Thriving Isle, ...) and Charcoal Diamond, which the engine already does deterministically (so the plan was redundant or risked double-applying).
- Plans that could change state and had no deterministic equivalent in the log: Swan Song (counter + Bird token), Binding the Old Gods chapter I (destroy target nonland permanent), Giada (spurious draw_cards), Temporal Mastery / Rootcast Apprenticeship (look/manual_review, mostly noise).
- Several results were wrong or noise 

Conclusion: negligible positive effect, some noise and double-application risk.

## 3. Now unhandled by legacy (kernel will cover)

Cards the advisor was the only resolver for. Kernel status = `cardUnsupported` result for the current drafts (all "implemented", i.e. the kernel engine supports every ability):
Swan Song, Binding the Old Gods (chapter I), Malakir Rebirth, Revitalizing Repast, Agadeem's Awakening, Find // Finality, Immoral Bargain, Moseo, Vein's New Dean, Witch of the Moors (end-step returns), Shadrix Silverquill, The Ozolith, Reluctant Role Model, Cankerbloom, Necroblossom Snarl, Giada, Font of Hope, The Odd Acorn Gang, Temporal Mastery, Rootcast Apprenticeship, Sharding Sphinx. See `data/kernel-drafts/OVERVIEW.md` for the per-deck capability gaps (766 unique cards, 640 fully runnable at generation time).
Generally: any instant/sorcery/trigger whose text no legacy parser recognises now does nothing in the legacy engine instead of getting an LLM plan; the human sees no "manual review" prompt for it.

## 4. Unresolved effects are never silent (2026-11-22)

Decision: the 18 cards that lost advisor behaviour wait for the kernel, but the legacy engine must say so whenever it cannot resolve text.

- Detector: `src/engine/unresolved.ts` `findUnresolvedClauses(card, event)` runs the same deterministic parsers the engine uses (removal, zone, targeted effect, pump, draw/life, tokens, search, counterspell, common triggers, generic abilities/modal, spell extras, the draw/scry/search workflows) over each effect-shaped sentence of the resolving text. Only sentences no parser takes (alone, or joined to the sentence before) are reported, so a multi-step card logs only the unhandled clause. Static abilities, replacement clauses, cost changes, keyword lines, modal headers and "Exile <this spell>" are not judged (the static systems own them).
- Where it fires: spell/ETB resolution (`useStackResolution` -> `reportUnresolved`, whether or not the old advisor consult ran), and `consultRulesAdvisor` for `land_played`, `saga_chapter` and `loyalty_ability` (all in `useSpellWorkflows.ts`). Later-firing triggers of a permanent (combat damage, dies, leaves, end step) are judged once, when it enters. Headless self-play reports through `resolveBareSpellEffect`.
- Output: event log line `Couldn't resolve: <Card> - <clause>` with `detail: "Unresolved"` (visible to all players via the normal snapshot; only the resolving card is named), and a record in `session.unresolvedEffects`. One line per card object + clause (`recordUnresolved` dedupes), nothing thrown.
- Disk (dev only): the host/solo client posts each new record (`useUnresolvedPoster`) to `POST /api/dev/unresolved`, which validates tightly, dedupes per game+card+clause, rate-limits and appends to `data/observer/live-unresolved.jsonl`. Off in production or with `MTG_UNRESOLVED_LOG=0`. Shared sink: `src/lib/unresolvedLog.ts` (+ `unresolvedLogFile.ts`), `engine: "legacy" | "kernel"` so the kernel can log unsupported capabilities the same way.
- Reports: `npm run unresolved:report [-- extra.jsonl]` writes `data/observer/UNRESOLVED.md` (card, clause, times, first/last seen, decks, kernel runnable). `npm run kernel:observe` prints "legacy unresolved effects by card" and writes `legacy-unresolved.jsonl` in its output dir.
- Limits: judged by text, not by what the engine actually did, so (a) a trigger whose effect parses but whose condition has no finder is not reported (Sharding Sphinx), (b) some later-firing triggers handled by their own finders can be over-reported (about 11% of the 766 kernel-draft cards flag at least one clause; most are genuine gaps). Checked against the catalog: Agadeem's Awakening, Immoral Bargain, Shadrix Silverquill, The Ozolith, Reluctant Role Model and Necroblossom Snarl log; Swan Song (counterspell parser handles the Bird), Find // Finality, Malakir Rebirth, Revitalizing Repast, Moseo, Cankerbloom, Temporal Mastery, Rootcast Apprenticeship, Binding the Old Gods (removal parser) and Sharding Sphinx are recognised by current legacy parsers and log nothing; Giada and The Odd Acorn Gang are static (Odd Acorn's quoted ability grant logs).
