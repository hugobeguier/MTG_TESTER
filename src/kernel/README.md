# src/kernel (card schema v2 tooling, Phase 0 / 0b / 1-validator)

New code only; nothing in the engine, AppFlow, DB or existing parsers imports it. Spec: `docs/card-schema-spec.md`.

| file | role |
|---|---|
| `schema.ts` | zod schema for v2 cards (conditions with `when`, Quantity, ObjectFilter, targets, modes, costs, cast options, triggers, replacements, statics, durations, mana). Adds `implementation`/`needs` per ability, `review.status` draft/approved, and `prompt` on every decision point (`xPrompt` for X). Steps = existing 20 kinds + new ones, passthrough so v1 steps stay valid. |
| `capabilities.ts` | registry of what the kernel supports today (20 step kinds, a few predicates, trigger events) and `computeImplementation(card)` which fills `implementation`/`needs`. A test checks the 20 kinds against `src/lib/primitiveActionPlan.ts`. |
| `prompts.ts` | deterministic English: `describeFilter/Quantity/Predicate/Step/Target/Cost`, `promptFor*`, and `generatePrompts(card, name)` which fills every missing prompt from structured fields. |
| `liftV1.ts` | `liftV1Card(v1Abilities)`: v1 -> v2. Free-text condition -> `{unsupported}` predicate, cost string -> atoms, `targetType` -> synthesized `targets[]`, `Add {` activated -> `kind:"mana"`. Rows stay `draft`. |
| `validator.ts` | `validateCard(card, oracle, name) -> {ok, issues[]}` and `renderForApproval(card, name)`. |
| `fixtures/examples.ts` | the 16 worked examples from the spec section 3. |
| `kernel.test.ts` | vitest (`npx vitest run src/kernel`). |

Pipeline for a draft: LLM/hand JSON -> `generatePrompts` -> `computeImplementation` -> `validateCard` -> `renderForApproval` for the human.

## Validator rules (error codes)
`SCHEMA`, `LINE_UNCLAIMED` (oracle line no ability owns), `CLAUSE_UNCOVERED` (see src below), `LEXEME_UNBACKED` (if/unless/only/during/instead/would/may/up to/another/target/each/duration/X/trigger/cost words/cast-option keywords need a matching field), `MODE_MISMATCH`, `LITERAL_MISMATCH` (numbers and mana symbols), `PROMPT_MISSING`, `STRUCT_*`, `EMPTY_ABILITY`, `UNSUPPORTED_NODE`, `DECLINED_ABILITY`. Warnings: `CLAUSE_COUNT`, `TEXT_NOT_IN_ORACLE`, `IMPLEMENTATION_MISSING/STALE`. `implementation:"needed"` is never an error.

`src` semantics: sentences of an ability's `text` are numbered 0..n. If any node in an ability carries `src`/`srcs`, every sentence must be covered (strict) and lexemes are checked against that sentence's nodes only; otherwise (lenient) lexemes are checked ability-wide and `CLAUSE_COUNT` warns when sentences exceed steps. False positives: `review.ignore: [{lexeme, reason}]`.

## Deviations from the spec
- `review.status` is `draft | approved` (per task), not `verified`.
- Literal cross-check runs at card level (all numbers/symbols in oracle vs all in JSON), numbers as presence (oracle to JSON) plus multiset (JSON effect numbers other than 0/1 to oracle); mana symbols as sets.
- `src` is optional (spec examples omit it); `srcs` added on abilities/steps to cover header/else sentences.
- `StaticSpec.grantAbility` is a loose record (avoids a recursive type); `TriggerSpec.subject` also accepts ObjRef ("equipped").
- Spec GAPs adopted: `ObjectFilter.anyOf/hasBasicLandType/zone:"any"/controllerDealtDamageBy`, `unlessPay.x`, `rewrite_enchant`, `tokenKeywords` (passthrough). Linked-ability X payload is not modelled.
- Spec fixes in fixtures: Dauthi/Chatterfang/Skullclamp etc. use real oracle text; Animate Dead's delayed sacrifice targets `enchanted` (no `choose` step); Sidisi/Dauthi add their keyword lines; Boseiju/Meren gain `src`/`srcs` to show strict mode.
- Capabilities: no cast option kind and no cost atom besides mana/tap counts as supported (the legacy engine does some of these; the kernel does not yet).
- Not covered: planeswalker loyalty costs (no Cost atom in the spec), the "ordering" prompt for replacement effects (kernel-time).

## Decided vocabulary additions (Keen Engineering pilot)
`TriggerSpec.batch` (one-or-more triggers), ObjRef `linked_exile` + step flag `linkExile` (Duplicant), `StaticSpec.modify` `mustAttack` / `copySubtypesOf` (plus earlier `setBasePT`, `addTypes`, `attackTax`), `ObjectFilter.colored`, Quantity `commander_colors`, ManaSpec `commanderIdentity`. Monarch stays a scripted marker (the game engine covers it).
`computeImplementation` now also flags step fields the legacy executor lacks (`field:<kind>.<name>`, list in `LEGACY_STEP_FIELDS`), `trigger:batch`, `ref:linked_exile`, `filter:colored`, and crew/improvise keywords.

## Consolidated pass
See `SCHEMA_CHANGELOG.md` for every field, validator rule and renderer change added after the pilot (alsoOn, chosen options, loyalty costs, oracleOverride, --prune, ...).
