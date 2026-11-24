# Triage protocol for failing card specs

Input: a run of `npm run kernel:spec` (console, or `data/kernel-specs/_results/<timestamp>.md`) with FAIL / UNSUPPORTED / SPEC ERROR scenarios. Output: every failure resolved to one of **SPEC wrong**, **DRAFT wrong**, **ENGINE wrong**, fixed in the kernel (never by loosening a correct spec), and the spec promoted to `status: "accepted"` once green.

The user cares only about the kernel (`src/kernel/**`, `data/kernel-drafts/**`): do not fix the legacy engine.

## Step 0: SPEC ERROR

The file is malformed or refers to something that does not exist in its own setup. Fix the spec (the message names the path in the file or the reference). Not a card problem.

## Step 1: is the SPEC right?

For each FAIL read, in this order:

1. `why` of the failed expectation and the card's oracle text (`data/cards.db`, read it yourself). Does the oracle text (or the cited CR section, looked up in the Comprehensive Rules, not from memory) really require the expected value?
2. Is the **setup** what the scenario claims (zones, who is active, mana available, summoning sickness, a library that exists)? Is the **script** a legal way to do it (priority: the caster keeps priority after casting, so an opponent's response needs a `pass` first; sorcery timing; an `unlockDoor`/`tapForMana` before the spell)?
3. Is the expectation too strict in a way the rules do not demand (an order the rules leave free, e.g. the order of simultaneous triggers; a decision the rules allow the engine to skip)?

- If the spec is wrong: fix the spec, cite the oracle clause / CR in the commit or report, re-run. Do not touch the kernel.
- If the spec is right: go on. **Never weaken a correct expectation to turn it green.**

## Step 2: DRAFT or ENGINE?

A kernel card = the **draft** (`data/kernel-drafts/<deck>/<slug>.json`, the card text as schema JSON) run by the **engine** (`src/kernel/engine/**`). Find which one is wrong:

1. Run with `--verbose` and read the action log and the last events. They show what the engine did.
2. Read the draft of that card and compare it **clause by clause** with the oracle text:
   - a clause missing, a wrong number / filter / controller scope / trigger event, a step in the wrong order, an `optional` that prompts twice, a missing `interveningIf`, a wrong zone, `who: "opponent"` where the text says each opponent, a static that lacks `zone` or "while on the battlefield";
   - `UNSUPPORTED` with an `unresolved` message names the construct (`step:...`, `field:...`, `trigger:...`): it is a missing engine capability (or a draft using a construct the engine does not know).
   If the draft does not say what the oracle text says: **DRAFT wrong**. Fix the draft, then run `npm run kernel:validate-drafts` and `npm run kernel:check-copies` (a card must have identical JSON in every deck dir; the check lists them) and `npm run kernel:bundle-drafts` if the game reads packs (`public/kernel-packs` must not be older than the drafts: `src/kernel/integration/packfresh.test.ts`).
3. If the draft says what the oracle text says and the engine does something else: **ENGINE wrong**. Find the rule in the engine (the README in `src/kernel/engine/` maps files to rules: layers.ts, replacements.ts, steps.ts, resolve.ts ...), fix it **generally** (the rule, not the one card), keep it deterministic, and add a focused engine test next to the existing ones (not only the spec).
4. Both can be wrong; fix both. A missing engine capability for an otherwise correct draft: implement it in the kernel (the user wants abilities implemented, not declined).

Rules of thumb:
- A scenario that the engine runs with an `unresolved` event is never "PASS with a caveat": it is UNSUPPORTED until the construct is implemented.
- A decision asked twice for a single "may", or asked to the wrong player, is a draft / engine bug even if the end state is right (the final `pending` rule of the runner flags it).
- A bug in one card usually means a rule bug: after the fix, search the other cards that use the same construct (grep the drafts for the same step / trigger / replacement kind) and write one scenario for a second card.

## Step 3: close the loop

1. Re-run the card: `npm run kernel:spec -- --card "<Card>"` until every scenario is PASS.
2. A genuine bug you decide **not** to fix now: keep the scenario unchanged, add `"knownFailure": "ENGINE BUG: <one precise sentence>"` (or `DRAFT BUG:`). It stays visible in every run and in the wrapper (green while failing, red when it starts passing).
3. Set `"status": "accepted"` in the spec file when every scenario is PASS or known-failure with a documented reason. Accepted files run in `npx vitest run src/kernel/spec`.
4. Run the wider suites touched by the fix: `npx vitest run src/kernel`, then `npx tsc --noEmit`. Check changed files for stray `\x08` characters if you edited regexes.
5. Report per card: failures found, verdict (SPEC / DRAFT / ENGINE) with the oracle or CR citation, what was changed, what is left (known failures).

## Verdict cheat sheet

| symptom | usual verdict |
|---|---|
| expectation about a number / zone / counter that the oracle text does not support | SPEC |
| scenario script refused with `not_your_priority` / `wrong_timing` / `cannot_pay` that the rules explain | SPEC (script) |
| a trigger never goes on the stack / goes on for the wrong player | DRAFT (trigger scope) first, then ENGINE |
| the effect happens twice, to the wrong player, or one clause is missing | DRAFT |
| effective power / types / abilities wrong after an Aura / static / counter | ENGINE (layers) unless the draft's static is wrong |
| replacement applies when it should not (lost abilities, wrong controller), or ordering ignored | ENGINE (replacements) |
| `UNSUPPORTED: unresolved step:...` | ENGINE capability missing (or draft construct) |
| a choice asked twice / to nobody / with options the rules do not allow | DRAFT, then ENGINE |
| `no kernel draft for X` | DRAFT missing: write it (kernel drafting process), then re-run |
