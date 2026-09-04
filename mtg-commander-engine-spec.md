# MTG Commander Multi-Agent Game — Implementation Spec

## Goal
Build a web app simulating a 4-player Commander game: 3 LLM agents + 1 human, with a deterministic rules engine as the source of truth and an LLM-based "Ruler" layer only for card-text interpretation. The rules engine must never hallucinate; the LLM must never be in the critical path for state-based actions or trigger detection.

---

## Architecture Overview

```
┌─────────────┐   WebSocket    ┌──────────────────┐
│ Human Client │◄──────────────►│                  │
└─────────────┘                │                  │
┌─────────────┐                │   Game Server     │
│ Agent Client │◄──────────────►│  (authoritative   │
│  (Player A)  │                │   state owner)    │
└─────────────┘                │                  │
┌─────────────┐                │  - Event Bus      │
│ Agent Client │◄──────────────►│  - Trigger Matcher│
│  (Player B)  │                │  - SBA Checker    │
└─────────────┘                │  - Priority/Stack  │
                                └────────┬─────────┘
                                         │
                                ┌────────▼─────────┐
                                │  Ruler LLM Service │
                                │  (trigger resolve, │
                                │   card parse cache)│
                                └───────────────────┘
```

Core principle: **deterministic engine owns state and event routing; LLM is invoked only for (a) one-time card parsing and (b) resolving the effect of a confirmed trigger/spell into engine calls.**

---

## Phase 1: Card Parsing Pipeline (offline / cached, NOT runtime)

**Purpose:** Convert oracle text into structured data exactly once per card, so runtime never needs an LLM to "read" a card.

1. Pull card data from the Scryfall bulk API (oracle text, mana cost, types, etc.).
2. Define an **Effect DSL** — a fixed vocabulary of ~40-60 primitive effect types covering the bulk of Commander staples: `DRAW`, `DRAIN`, `DAMAGE`, `DESTROY`, `EXILE`, `COUNTER_ADD`, `COUNTER_REMOVE`, `TAP`, `UNTAP`, `SEARCH_LIBRARY`, `RETURN_TO_HAND`, `RETURN_TO_BATTLEFIELD`, `SACRIFICE`, `MILL`, `TOKEN_CREATE`, `GAIN_LIFE`, `LOSE_LIFE`, `COPY_SPELL`, `MODIFY_PT`, `GRANT_KEYWORD`, etc.
3. Define a **Trigger Descriptor schema** (see below).
4. Build a parser service: `parse_card(oracle_text) -> TriggerDescriptor[] + StaticAbility[] + ActivatedAbility[]`, backed by an LLM call with strict structured-output enforcement (JSON schema validation, retry-on-invalid).
5. Persist results in a `parsed_cards` table/store keyed by Scryfall oracle ID. Parse lazily — only when a card is added to a deck for the first time — and cache forever.
6. Provide a manual override/correction path: allow a human to hand-edit a card's cached JSON if the parser got it wrong (important for popular Commander staples — correct once, benefits every future game).
7. Cards whose text can't be cleanly expressed in the DSL get a `fallback: true` flag — these route to a **live LLM resolution call** at trigger time instead of using cached DSL steps (see Phase 3).

### Trigger Descriptor schema (example)
```json
{
  "card_oracle_id": "...",
  "name": "Blood Artist",
  "triggers": [
    {
      "id": "blood_artist_1",
      "event": "CREATURE_DIED",
      "scope": "ANY",
      "condition": null,
      "effect_dsl": [
        { "op": "DRAIN", "amount": 1, "target": "controller_choice: opponent_or_self_gain" }
      ],
      "fallback": false
    }
  ],
  "static_abilities": [],
  "activated_abilities": []
}
```

---

## Phase 1a: Offline Bulk Parsing Script (build this first, run it as a standalone job)

**Purpose:** A standalone batch script — separate from the live game server — that pulls all Scryfall cards and populates the `parsed_cards` cache using the Claude API. This is a data-processing job, not a runtime component. Claude Code should build and run this as its own CLI script/service.

### Requirements

1. **Data source**: Download Scryfall's "oracle_cards" bulk data file (one JSON file, updated daily, no auth required). Cache it locally; don't re-download on every run.

2. **Skip vanilla cards**: Before calling the LLM, filter out cards with empty/no rules text (plain vanilla creatures, basic lands) — mark them as `parsed: true, triggers: [], static_abilities: [], activated_abilities: []` with zero API calls. This should eliminate a large fraction of the 30k+ cards immediately.

3. **Skip already-parsed cards**: Check the `parsed_cards` cache (keyed by Scryfall `oracle_id`) before calling the LLM. Support incremental/resumable runs — the script should be safely re-runnable after a crash or interruption and pick up where it left off, never re-parsing cards already cached.

4. **LLM parsing call**:
   - Use the Claude API (Messages endpoint) with tool use / structured output enforced — the model must return JSON matching the Effect DSL + Trigger Descriptor schema defined in Phase 1, not free text.
   - Input per call: card name, oracle text, mana cost, type line, power/toughness if applicable.
   - Provide the DSL vocabulary (the ~40-60 primitive effect types) directly in the system prompt so the model only emits ops from that fixed set.
   - If a card's text doesn't map cleanly onto the DSL, the model should set `"fallback": true` on that trigger/ability rather than forcing a bad mapping.

5. **Concurrency and rate limiting**:
   - Process cards with bounded concurrency (configurable, e.g. 5-10 concurrent requests), not fully serial and not unbounded parallel.
   - Implement exponential backoff on rate-limit/5xx errors.
   - Add a small delay/queue between batches to stay under API rate limits.

6. **Validation and retry**:
   - Validate every LLM response against the JSON schema before accepting it.
   - On invalid/malformed JSON: retry once with an error-correction prompt that includes the validation error.
   - On repeated failure (e.g. 2 failed attempts): mark the card `parse_status: "failed"` with the error logged, and continue the batch rather than halting the whole run.

7. **Progress and logging**:
   - Log progress periodically (e.g. every 100 cards): total processed, skipped-vanilla, cached-hit, newly-parsed, failed.
   - Write failures to a separate `failed_cards.log` (oracle_id, name, error) for manual review/re-run later.
   - Support a `--dry-run` flag that processes a small sample (e.g. 20 cards) without writing to the cache, for prompt-tuning before a full run.

8. **Storage**:
   - Write results to whatever store Phase 1 specifies (Postgres table or JSON files during early dev), keyed by `oracle_id`.
   - Include a `source: "llm_parsed"` vs `source: "manual_override"` field so manually corrected cards (see Phase 1, point 6) are never overwritten by a re-run of the bulk parser.

9. **Cost/scope control**:
   - Default to parsing only a curated Commander-legal subset first (e.g. cards legal in Commander per Scryfall's legality field), not the entire 30k+ card pool, to keep initial cost and runtime manageable.
   - Provide a `--full` flag to run against the entire bulk dataset once the curated subset is validated.
   - Provide a `--set <set_code>` or `--sample <n>` flag for targeted/small test runs.

10. **Match-scoped pre-parsing (deck-building step)**:
    - Since decks are built by the agents before a match starts, run the parser against only the cards actually in the four decks for that match (~400 cards total across a 4-player Commander pod, not the full card pool).
    - Trigger this as a pre-match step: once deck lists are finalized, diff against the `parsed_cards` cache, and parse only the cards not already cached (first match ever will parse close to 400 cards; every match after that reuses whatever's already cached, so the marginal cost shrinks over time as your cache grows).
    - This makes the Ruler LLM's runtime working set small and match-specific — it only ever needs to reason about (or hold in context, if relevant) the ~400 cards actually in play, not the full 30k+ pool.
    - Block match start until pre-parsing for that match's decks completes (or fails-and-flags any unparseable cards for review) — don't let a match begin with a parsed_cards gap for a card that's about to be drawn.

### Suggested script structure
```
scripts/
  parse_cards.py (or .ts)
    - fetch_bulk_data()          # download + cache Scryfall JSON
    - filter_candidates(cards)   # skip vanilla, skip already-cached
    - parse_card(card) -> dict   # single LLM call + validation + retry
    - run_batch(cards, concurrency, dry_run)
    - main()                     # CLI arg parsing: --full, --set, --sample, --dry-run
  dsl_schema.json                # the Effect DSL + Trigger Descriptor JSON schema
  failed_cards.log
```

### CLI usage examples (target behavior)
```
python parse_cards.py --sample 20 --dry-run
python parse_cards.py --set commander_legal
python parse_cards.py --full
python parse_cards.py --retry-failed
python parse_cards.py --decklists match_123_decks.json   # pre-match scoped parse, ~400 cards
```

---

## Phase 2: Runtime Event Bus + Deterministic Trigger Matching (NO LLM)

**Purpose:** Detect which triggers fire, with zero LLM involvement and zero risk of a missed/hallucinated trigger.

1. Every state mutation in the engine emits a typed event onto an internal event bus: `ZONE_CHANGE`, `CREATURE_DIED`, `DAMAGE_DEALT`, `SPELL_CAST`, `LIFE_CHANGED`, `PERMANENT_ENTERED`, `PERMANENT_LEFT`, `COMBAT_DAMAGE`, `ATTACK_DECLARED`, `PHASE_CHANGED`, `TURN_STARTED`, etc.
2. A deterministic **Trigger Matcher** subscribes to all events. For every permanent currently on the battlefield (plus applicable non-battlefield sources — e.g. some triggers work from graveyard/exile), it checks the permanent's cached `triggers[]` against the event type + condition.
3. Matches are queued onto the stack **in APNAP order** (active player's triggers first, then each other player in turn order) — this ordering logic is hardcoded, never left to the LLM.
4. This layer must run correctly with zero external calls — it's pure state + cached data lookups, so it's fast and testable with unit tests per event type.

---

## Phase 3: Trigger/Spell Resolution (LLM only when the DSL needs interpreting)

**Purpose:** Turn a triggered ability or resolving spell into concrete engine function calls.

1. When something on the stack resolves:
   - If `fallback == false`, execute the cached `effect_dsl` steps directly via engine calls — **no LLM call needed at all** for the common case.
   - If `fallback == true`, or the effect has runtime-dependent choices too complex for static DSL (e.g. "target creature," "up to X targets," conditional text depending on board state), call the Ruler LLM with: the oracle text, the DSL parse (if any), and current game state relevant to the trigger. The LLM must respond via **function calling only** — a fixed, schema-validated set of engine functions — never free text.
2. If the ability requires a player decision (may-abilities, choosing a mode, choosing targets), the engine pauses and requests input from the specific player/agent client — this is a player decision, not something the Ruler LLM decides on the player's behalf.
3. Every engine call the LLM proposes is validated against current legal-state before execution (e.g. can't target something not on the battlefield, can't draw from an empty library without triggering the correct loss condition instead).
4. Log every (oracle_text → engine_calls) pair for auditability and debugging.

---

## Phase 3a: XMage as a static reference corpus for declined cases (future direction, not yet built)

**Origin:** this project's docs originally named XMage (an open-source, mature Java MTG implementation) as the intended rules authority (`docs/mtg/commander-rules.md`, `docs/xmage-bridge.md`), with a bridge scaffold (`src/lib/xmageBridge.ts`) meant to front a live XMage server. That bridge was never finished — XMage's client-server protocol is built around its own desktop client and its own bot AI, not a clean "submit action, get JSON state" API, so standing it up as the live, state-owning rules authority is a real integration project (a JVM process to manage, a full state/event model to translate), not a drop-in swap for the engine actually built out since (`rulesAdvisor.ts`, `oracleClauses.ts`, `staticEffects.ts`, `activatedAbilities.ts`, the primitive-DSL/parsed-cards cache in `cardParser.ts`/`cardDb.ts`).

**The idea worth keeping:** don't run XMage live at all — instead, treat XMage's own per-card implementations (it's one hand-written Java class per card in their open-source repo, encoding the exact rules logic for that card) as a static, indexable reference corpus. When the Ruler LLM would otherwise `declined: true` a card or ability (the existing escape hatch in `cardParser.ts`'s whole-card parser and `primitiveActionPlan.ts`'s per-event fallback — both already refuse to guess rather than emit a wrong action), look up that card's XMage source by name/oracle_id and feed it to the LLM as grounding context before it decides whether to emit primitive steps or still decline.

Why this is worth doing later rather than the live-bridge version:
- No live XMage process, no bridge server, no state/event translation — just an indexed lookup against a source tree, matched the same way `cardDb.ts` already keys cards (name → oracle_id).
- Slots directly into the `declined` path that already exists everywhere in the fallback pipeline, rather than requiring new plumbing.
- Only helps on cards XMage has actually implemented (comprehensive, but not literally every Scryfall card) — a card with no XMage source just falls through to today's plain-declined behavior, so this can only improve coverage, never regress it.

Not scoped or started — revisit once the parsed_cards cache and its runtime wiring (Phase 3) have enough real-world mileage to show which declined cards would actually benefit most.

---

## Phase 4: State-Based Actions (SBAs) — fully deterministic, engine-only

Checked after every priority pass, no LLM involvement, ever:
- Creature with toughness ≤ 0 → dies
- Player at life ≤ 0 → loses
- Player attempted to draw from empty library → loses (or per house rule)
- Legend rule, aura/equipment attachment legality, +1/+1 and -1/-1 counter annihilation, etc.

These must execute synchronously and instantly — never gated on an async LLM call.

---

## Phase 5: Player/Agent Interaction Layer

1. Engine exposes a **legal-actions endpoint**: given current state + player, return the list of legal actions (cast spell X, activate ability Y, pass priority, declare attacker Z, etc.). Both human and agent clients choose only from this list — no freeform action text ever reaches the engine directly.
2. Agent clients (Players A/B/C) are separate services: receive `(game_state_view, legal_actions)`, call their own LLM with a decision-making prompt, return a chosen action (structured, validated against the legal-actions list before executing).
3. `game_state_view` must respect hidden information — agents only see their own hand/library contents, public zones, and what's revealed.
4. Human client: React frontend, WebSocket-driven state sync, battlefield/stack visualization, priority prompts, action picker UI.

---

## Phase 5a: Priority-Stop Evaluation (avoid prompting/calling every player on every event)

**Problem:** Naively asking every player "do you want priority?" on every single stack event is both a bad human UX (constant interruption for actions with no valid response) and expensive for AI agents (an LLM call at every priority window, even when there's nothing they could do).

**Fix:** Only prompt/invoke a player when they could actually act, and let each player configure when they want to be interrupted.

### 1. Auto-pass when there's no legal instant-speed action
Every time priority would pass to a player, run the existing legal-actions check (Phase 5) filtered to instant-speed-only actions: instants, flash-cast permanents, activated abilities usable at instant speed, abilities with alternative/free costs. If this filtered list is empty, auto-pass for that player silently — no prompt, no LLM call, no missed decision, since there was genuinely nothing legal to do. This should eliminate the large majority of priority windows.

### 2. Per-player configurable stop conditions (human)
When a player *does* have a legal instant-speed action, whether to actually interrupt them depends on a stored preference object, e.g.:
```json
{
  "player_id": "human_1",
  "stop_on": {
    "any_legal_response": false,
    "opponent_casts_spell": true,
    "my_permanent_targeted": true,
    "my_creature_would_die": true,
    "life_total_changed": false,
    "hold_priority_once": false
  }
}
```
- `hold_priority_once` is a one-shot flag (the "I want to respond to the next thing" checkbox) — set per-stack-object, cleared automatically after the next priority window resolves, rather than a permanent setting.
- The engine checks `stop_on` against the current event type before deciding to prompt vs. auto-pass.
- Default settings should stop on anything targeting the player or their permanents at minimum, to avoid ever silently letting something bad resolve unresponded.

### 3. Agent equivalent: cheap pre-filter before the LLM call
Apply the same auto-pass filter to AI agent clients — never call an agent's decision LLM if their instant-speed legal-actions list is empty. When it's non-empty, optionally run a cheap heuristic pre-check (e.g. "does this event target my permanents / would it kill my creature / is it a mass-effect spell") before invoking the full LLM decision call, so agents aren't burning tokens evaluating irrelevant board changes.

### 4. Where this sits in the flow
This slots in as a filter step between "state changed → whose priority is it" (existing Phase 2/5 logic) and "prompt that client for a decision" — it doesn't require new stack/priority mechanics, just a gate in front of the existing prompt/LLM-call step.

---

## Phase 5b: Rules Agent Role — Referee, Not Advisor

**Design decision:** The rules/legal agent's job is legality and state-keeping only. It must not suggest, recommend, or evaluate moves for playing agents — that responsibility belongs entirely to each playing agent's own reasoning.

**Why this matters:** Blending "what's legal" with "what's good" makes the rules agent's output harder to trust (rules correctness gets tangled up with strategic opinion) and stops playing agents from developing independent judgment, since they end up anchored to whatever the rules agent suggested rather than reasoning from the board state themselves.

### Rules agent responsibilities (keep)
1. `get_legal_actions(player, state) -> Action[]` — returns only what's legal, never ranked or annotated with "best" choices.
2. `validate_action(action, state) -> bool | error` — accepts or rejects a proposed action from a playing agent; never silently modifies or "corrects" it.
3. `apply_action(action, state) -> new_state` — the only component that mutates game state, once an action is confirmed legal (zone changes, life totals, stack resolution, SBA checks per Phase 4).
4. Trigger detection and DSL/fallback resolution per Phases 2–3.

### Rules agent responsibilities (remove/exclude)
- No "you should do X" language or recommended-action output.
- No move evaluation, scoring, or strategic commentary in its response to a playing agent.
- No default action selection on a playing agent's behalf.

### Playing agent responsibilities (expand)
1. Call `get_legal_actions()` to get the legal set for the current decision.
2. Reason independently using its own context (board state, action log/history, hand, its own strategic priorities) to choose an action from that set.
3. Submit the chosen action to `validate_action()` — if rejected, the agent must choose again from the legal set, not be told what to pick instead.

### Optional: separate hint/debug channel
If a "suggest a move" capability is still useful for tuning/debugging agent quality, implement it as a clearly separate, optional service the playing agent can choose to consult — never bundled into the referee's legality responses, so "referee" doesn't quietly become "advisor" again through a side door.

---

## Suggested Tech Stack
- **Server**: Node.js or Python (FastAPI), authoritative game state in memory + persisted snapshots for replay/debug.
- **Transport**: WebSocket for state broadcast + action submission.
- **Card data**: Scryfall bulk data API for oracle text/metadata.
- **Parsed card cache**: Postgres or similar, keyed by Scryfall oracle ID.
- **LLM calls**: Claude via API with strict tool/function-calling schemas for both the parser (Phase 1) and the Ruler resolution service (Phase 3).
- **Frontend**: React, Tailwind, WebSocket client.

---

## Build Order (milestones)

1. Core engine: zones, turn structure, priority passing, stack (no triggers yet) — playable with only manual/no-ability cards (vanilla creatures, basic lands).
2. Event bus + SBA checker — get life loss / creature death working deterministically.
3. Build the Phase 1a bulk parsing script and run it in `--dry-run`/`--sample` mode against ~50-100 iconic Commander cards — validate DSL coverage and spot-check output before scaling up.
4. Deterministic trigger matcher (Phase 2) wired to the event bus.
5. Trigger resolution executor for DSL effects (no LLM) — most common effects working end-to-end.
6. Ruler LLM fallback resolution (Phase 3) for `fallback: true` cards.
7. Legal-actions endpoint + human WebSocket client, including Phase 5a priority-stop evaluation (auto-pass filter + configurable stop conditions) so priority windows don't interrupt players unnecessarily.
8. Agent client service + decision-making LLM prompt, following the Phase 5b referee-not-advisor split — playing agents reason independently over `get_legal_actions()` output rather than consuming ranked/suggested moves from the rules agent.
9. Expand parsed card pool toward full Commander legal card pool, lazily, as decks are built.
10. Combat, targeting UI, and stack-interaction polish for the human player.

---

## Key Invariants (do not violate)
- LLM never decides SBAs.
- LLM never decides trigger *ordering* (APNAP is hardcoded).
- LLM never executes engine mutations directly — it only proposes function calls, which are validated before execution.
- Trigger *detection* is always a deterministic cache lookup against the event bus, never a live "scan the board" LLM call.
- Every LLM-produced engine call is logged with its source oracle text for debuggability.
- The rules agent never recommends, ranks, or evaluates actions — it only reports legality and applies confirmed actions (Phase 5b). Strategic reasoning belongs entirely to playing agents.
