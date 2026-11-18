// The setup screen ("Page 1: Deck Building"): runtime status tiles, PLAY button, saved-games list and the per-seat deck panels.
// Purely presentational - all state (configs, saved games, startGame ...) lives in AppFlow and arrives as props.
import { useSyncExternalStore } from "react";
import { hostStatusStore } from "@/lib/multiplayer/hostStatusStore";
import { lobbyBlockers } from "@/lib/multiplayer/lobby";
import { LobbyHostPanel } from "@/components/LobbyHostPanel";
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
  // True on /mp/host: offers "Remote friend" seats and blocks PLAY until each has a connected guest.
  multiplayerHost?: boolean;
}

export function SetupScreen({ setupSummary, ollama, xmage, setupMessage, playBlockedByBuild, gameStarting, onStartGame, savedGames, onLoadSavedGame, onDeleteSavedGame, configs, deckLibrary, onBuildDeck, onUpdateConfig, multiplayerHost = false }: SetupScreenProps) {
  const hostState = useSyncExternalStore(hostStatusStore.subscribe, hostStatusStore.get, hostStatusStore.getServer);
  const blockers = multiplayerHost ? lobbyBlockers(configs, hostState.guests) : [];
  return (
    <main className="app-shell">
      <Topbar setupSummary={setupSummary} />
      <section className="status-grid" aria-label="Runtime status">
        <Status label="Ollama" value={ollama.ok ? "Ready" : "Offline"} detail={ollama.message} />
        <Status label="XMage" value={xmage.status.replace("_", " ")} detail={xmage.message} />
        <Status label="Format" value="Commander" detail={multiplayerHost ? "1 to 4 seats (you, friends, optional AI), 40 life, Bracket 3 target." : "One human plus three AI seats, 40 life, Bracket 3 target."} />
        <Status label="Setup" value={setupSummary} detail="Build AI decks from commanders or validate pasted deck lists." />
      </section>
      <section className="setup-board">
        <div className="setup-heading">
          <div>
            <p className="eyebrow">Page 1</p>
            <h2>Deck Building</h2>
            {setupMessage ? <p className="setup-play-message">{setupMessage}</p> : null}
            {blockers.length > 0 ? (
              <p className="setup-play-message">Not ready: {blockers.map((b) => `${configs.find((c) => c.seatId === b.seatId)?.name ?? b.seatId} ${b.reason}`).join("; ")}. Share the room code from the panel at the top.</p>
            ) : null}
          </div>
          <button className="play-button" disabled={playBlockedByBuild || gameStarting || blockers.length > 0} type="button" onClick={onStartGame}>
            {gameStarting ? "Starting..." : "PLAY"}
          </button>
        </div>
        {multiplayerHost ? <LobbyHostPanel configs={configs} guests={hostState.guests} blockers={blockers} onUpdateConfig={onUpdateConfig} /> : null}
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
            <DeckSetupPanel config={config} key={config.seatId} library={deckLibrary} onBuild={onBuildDeck} onUpdate={onUpdateConfig} offerRemote={multiplayerHost} lobbyNote={blockers.find((b) => b.seatId === config.seatId)?.reason} />
          ))}
        </div>
      </section>
    </main>
  );
}
