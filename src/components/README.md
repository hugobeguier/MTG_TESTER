# src/components map

* `AppFlow.tsx` - the `AppFlow()` component: game state, handlers, turn loop, stack/priority. Also re-exports engine symbols that tests import.
* `SetupScreen.tsx` - setup-screen JSX (status tiles, PLAY, saved games list, per-seat deck panels). Props only.
* `GameOverDialog.tsx` - "Game over" modal. Props only.
* `DeckSetup.tsx` - `DeckSetupPanel`, `Topbar`, `Status`, `SeatConfig`/`SavedDeck`, deck validation and `applyDeckToSeat`.
* `ThreeGameTable.tsx`, `PlayerBoard.tsx`, `GameTable.tsx`, `VisualCard.tsx`, `ZoneSummary.tsx` - the in-game table UI.
* `viewModels.ts` - `ruleChoiceView` / `blockChoiceView` (what choice dialogs show).
* `hooks/usePriorityStopSettings.ts` - state: human priority-stop settings (persisted); returns `{priorityStopSettings, updatePriorityStopSettings}`.
* `hooks/useDeckLibrary.ts` - state: per-seat `configs`, `deckLibrary` (fetched from /api/decks/library), `defaultDecksApplied` ref.
* `hooks/useSavedGames.ts` - state: `savedGames` list (refetched from /api/saves when `mode === "setup"`).

Hooks must be called at the same position in `AppFlow()` they were extracted from (React effect order). Engine/rules code lives in `src/engine/`.
