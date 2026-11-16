// The setup screen ("Page 1: Deck Building"): runtime status tiles, PLAY button, saved-games list and the per-seat deck panels.
// Purely presentational - all state (configs, saved games, startGame ...) lives in AppFlow and arrives as props.
import type { GameSession } from "@/lib/types";
import type { SavedGameSummary } from "@/lib/saveGame";
import { SAVE_FORMAT_VERSION } from "@/lib/saveGame";
import { DeckSetupPanel, Status, Topbar, type SavedDeck, type SeatConfig } from "@/components/DeckSetup";

export interface SetupScreenProps {
  setupSummary: string;
  ollama: { ok: boolean; message: string; models?: string[] };
  xmage: GameSession["xmage"];
  setupMessage: string | undefined;
  playBlockedByBuild: boolean;
  gameStarting: boolean;
  onStartGame: () => unknown;
  savedGames: SavedGameSummary[];
  onLoadSavedGame: (id: string) => unknown;
  onDeleteSavedGame: (id: string) => unknown;
  configs: SeatConfig[];
  deckLibrary: SavedDeck[];
  onBuildDeck: (config: SeatConfig) => void | Promise<void>;
  onUpdateConfig: (seatId: string, patch: Partial<SeatConfig>) => void;
}

export function SetupScreen({ setupSummary, ollama, xmage, setupMessage, playBlockedByBuild, gameStarting, onStartGame, savedGames, onLoadSavedGame, onDeleteSavedGame, configs, deckLibrary, onBuildDeck, onUpdateConfig }: SetupScreenProps) {
  return (
    <main className="app-shell">
      <Topbar setupSummary={setupSummary} />
      <section className="status-grid" aria-label="Runtime status">
        <Status label="Ollama" value={ollama.ok ? "Ready" : "Offline"} detail={ollama.message} />
        <Status label="XMage" value={xmage.status.replace("_", " ")} detail={xmage.message} />
        <Status label="Format" value="Commander" detail="One human plus three AI seats, 40 life, Bracket 3 target." />
        <Status label="Setup" value={setupSummary} detail="Build AI decks from commanders or validate pasted deck lists." />
      </section>
      <section className="setup-board">
        <div className="setup-heading">
          <div>
            <p className="eyebrow">Page 1</p>
            <h2>Deck Building</h2>
            {setupMessage ? <p className="setup-play-message">{setupMessage}</p> : null}
          </div>
          <button className="play-button" disabled={playBlockedByBuild || gameStarting} type="button" onClick={onStartGame}>
            {gameStarting ? "Starting..." : "PLAY"}
          </button>
        </div>
        {savedGames.length > 0 ? (
          <div className="saved-games-panel">
            <h3>Saved games</h3>
            <ul>
              {savedGames.map((save) => (
                <li key={save.id} className="saved-games-row">
                  <div>
                    <strong>{save.name}</strong>
                    <span>
                      {save.summary} · saved {new Date(save.savedAt).toLocaleString()}
                      {save.formatVersion !== SAVE_FORMAT_VERSION ? " · incompatible save" : ""}
                    </span>
                  </div>
                  <div className="saved-games-row-actions">
                    <button type="button" disabled={save.formatVersion !== SAVE_FORMAT_VERSION} onClick={() => onLoadSavedGame(save.id)}>
                      Load
                    </button>
                    <button type="button" onClick={() => onDeleteSavedGame(save.id)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p>
          <a href="/decks">Create or edit decks</a>
        </p>
        <div className="setup-grid">
          {configs.map((config) => (
            <DeckSetupPanel config={config} key={config.seatId} library={deckLibrary} onBuild={onBuildDeck} onUpdate={onUpdateConfig} />
          ))}
        </div>
      </section>
    </main>
  );
}
