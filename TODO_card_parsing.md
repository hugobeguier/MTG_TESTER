# Card parsing to-do (deck cards only)

Scope: the 766 unique cards (commanders and basic lands included) across the 13 decks in `decks/custom` and `decks/foundations`. Not the 30k-card catalog. (An earlier count of 399 was wrong.)
Audit (`npm run audit:deck-cards`, `bench/coverage/deck-card-audit.md`): 12 verified-candidate, 615 suspect, 66 declined, 60 failed, 13 missing. "ok" in `parsed_cards` does not mean correct (see Sphinx's Insight).

## Phase 0 - Decide the target format (before parsing anything)
- [ ] Write the schema spec for a "correct" card: what the kernel needs per ability.
- [ ] Add the missing concepts to `AbilitySchema` / `PrimitiveActionStepSchema` (`src/lib/cardParser.ts:42`, `src/lib/primitiveActionPlan.ts:84`):
  - [ ] `timing`: when it may be cast/activated (sorcery speed, flash, "only during your turn", "only before attackers", etc.)
  - [ ] `condition` as structured data, not free text, with a `when` field: `on_cast` / `on_resolution` / `on_trigger` / `static`.
        Sphinx's Insight = `{check: "cast_during", phase: "main"}` on the life_change step, so it does not read as unconditional.
  - [ ] `modes`: "choose one / one or more", with the count and the options.
  - [ ] `targets`: count, restrictions, "up to", "another", controller filters.
  - [ ] `costs` as a structured list (mana, tap, sacrifice, discard, life, exile from graveyard), not a string.
  - [ ] `replacement_effect` and `prevention_effect` kinds, with the event they replace.
  - [ ] Additional/alternative costs (kicker, flashback, escape, miracle, channel, cycling) as first-class fields.
  - [ ] Intervening-if on triggers, "may" vs mandatory, duration ("until end of turn", "for as long as").
  - [ ] Mana abilities flagged separately (they don't use the stack).
- [ ] Add a validator that rejects "ok" rows whose `text` contains a clause no step or condition accounts for.
      This is what would have caught Sphinx's Insight.

## Phase 0b - Player prompts (part of the schema, not an afterthought)
- [ ] Every point where a player must decide (choose target, mode, X, order, pay optional cost, "may", discard, sacrifice, miracle/cast-now) carries a prompt in the card JSON: `prompt.title`, `prompt.instruction` (plain English: what to pick, how many, from where), and the card/ability it comes from.
- [ ] The kernel's pending-decision object includes that prompt, the legal options and the min/max count, so the UI only renders it and never has to guess.
- [ ] Prompts are generated from the structured fields (e.g. "Choose up to two target creatures you don't control"), not free LLM text, so they are consistent and correct.
- [ ] The validator checks that every choice in a card has a prompt; the approval step shows the prompt next to the oracle text.
- [ ] Phrasing rules: say who decides, what, how many, from which zone, and why ("Sphinx's Insight: ..."). Reuse the existing prompt UI components where possible.

## Phase 1 - Build the audit tooling
- [ ] Script: list the 399 deck cards from the deck files (reuse the `route.ts` loader logic) and write the list to a file.
- [ ] Script: per card, split the oracle text into clauses and check each one is covered by a step/condition/timing field. Output covered / uncovered per clause.
- [ ] Triage report: for each of the 399 cards, one of `verified`, `suspect`, `declined`, `failed`, `missing`.
- [ ] Heuristic flags for "ok but probably wrong": text contains "if", "only", "unless", "during", "Addendum", "instead", "as long as", "choose", "each", "that many" but `condition` is empty or `steps` is shorter than the sentence count.

## Phase 2 - Fix the known-bad rows first
- [ ] 11 cards with no row: parse them.
- [ ] 25 failed: retry, or hand-write via `scripts/override-card.mjs` (`manual_override`).
- [ ] 42 declined: decide per card whether the new schema can express them; if yes, write them by hand.
- [ ] Sphinx's Insight as the first test case end to end (draw 2, gain 2 only if cast in main phase).

## Phase 3 - Review the 321 "ok" cards
- [ ] Re-parse or review every `suspect` card from the Phase 1 report.
- [ ] Hand-review the rest in batches of ~25 per deck, against Scryfall oracle text.
- [ ] Cards with per-ability `declined: true` inside an "ok" row: list them and resolve.
- [ ] For hand-written overrides, prefer `manual_override` over LLM re-runs for anything complex (a 7B model produced the Sphinx's Insight row).

## Phase 4 - Lock it in
- [ ] Golden test per deck card: expected parsed JSON checked into the repo, so regressions fail CI.
- [ ] Coverage gate: a deck can't be marked "playable" unless all its cards are `verified`.
- [ ] Replace the hand-written engine parsers (`src/engine/*`, `src/lib/oracleClauses.ts`) with the kernel reading the parsed data. Inventory what they encode first so no rule is lost (see the cross-system propagation rule: Rules Advisor and interpreters too).
- [ ] Migrate per deck, with the old path kept behind a flag until that deck's golden tests pass.

## Kernel requirements found while playing (user, 2026-11-20)
- [ ] Zone-correct choices: every "choose a card from your hand/graveyard/..." candidate list comes from the right zone at that moment. A spell being cast is on the stack, so it is never a legal discard (Ledger Shredder connive bug).
- [ ] Action authorization: every action sent to the kernel carries the acting player, and the kernel/server rejects actions that player may not take (e.g. guests using host-only test tools to pull cards from graveyard, library or exile). Test tools only in a visible test mode, host only.
- [ ] Modes: min/max, `repeatable` ("choose three, may choose the same mode more than once"), done in the schema.
- [ ] Loop guard: cap events per priority pass; mandatory infinite loop -> draw, optional loop -> player names an iteration count.

## Phase 5 - Kernel (only after the above)
- [ ] Define the kernel API: `resolve(gameState, action{card, player, phase, inResponseTo}) -> {outcome, newState}`.
- [ ] Route one deck through the kernel using only the parsed data, then widen to the rest.

- [ ] Retire the Rules Advisor AI (`src/components/game/useRulesAdvisor.ts`, `/api/rules/primitive-plan` and related): the kernel replaces it. Do this per deck after that deck's golden tests pass, not before, so nothing is left with no rules source. Remove its prompts and the live-Ollama planner fallback too.

## Open questions
- Should the 30k-card catalog stay on the old schema, or be migrated lazily (only when a card enters a deck)?

## Decisions (user, 2026-11-19)
- The kernel handles everything and replaces the hand-written engine parsers, so one source of truth decides what happens next.
- If a card has an ability the kernel/engine can't do yet, still parse it fully into the schema and mark it `implementation: "needed"` (with a `needs` list naming the missing capability). The JSON stays kernel-ready; the kernel work is tracked separately from the parsing work.
- Kernel `resolve` returns a pending decision (e.g. "choose a target") instead of calling the UI.
- The user is consulted on complex cards (modal, replacement effects, odd wording), not just spot-checks.
- New parses are an LLM draft that the user approves (with the validator as a first gate), not a straight LLM write to the DB.
