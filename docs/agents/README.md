# Reviewing agent play

This folder's `system.md` is the agent prompt contract (it is sent to the LLM), so notes for the human live here instead.

- `npm run agent:mistakes -- --games=60 --seed=1` runs headless self-play (deterministic per seed) and ranks "wasteful play": pointless sacrifices, wasted removal, spells with no effect, suicide attacks and so on, with example game states and health metrics. Report: `bench/mistakes/latest.md` (gitignored), or `docs/agents/mistakes/<label>.md` with `--label=name`. `--pool=legacy` uses the 2-seat Meren/UrDragon/Saheeli/Aminatou pairings, `--unguarded` ignores the play guards to show what they currently prevent.
- When you see an agent do something dumb in a real game, add a row to `docs/agents/real-game-mistakes.md`. A row with a fixture name becomes a regression test (`src/lib/selfplay/mistakeScenarios.ts`, checked by `npx vitest run`).
- `docs/agents/mistakes/` holds the committed baseline-vs-after reports for the guards added with the detector.
