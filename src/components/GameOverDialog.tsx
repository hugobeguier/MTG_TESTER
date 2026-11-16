// The "Game over" modal shown over the table when the session is complete: winner/loss reasons, Play again / Look at the board / Back to setup.
// Purely presentational - AppFlow decides when to show it and supplies the callbacks.
import type { GameSession } from "@/lib/types";

export function GameOverDialog({ session, gameStarting, setupMessage, onPlayAgain, onDismiss, onBackToSetup }: {
  session: GameSession;
  gameStarting: boolean;
  setupMessage: string | undefined;
  onPlayAgain: () => unknown;
  onDismiss: () => void;
  onBackToSetup: () => void;
}) {
  return (
    <div className="card-inspector-backdrop" role="dialog" aria-modal="true" aria-label="Game over">
      <article className="mana-choice-modal">
        <header>
          <p className="eyebrow">Game over</p>
          <h2>{session.winnerSeatId ? `${session.seats.find((seat) => seat.id === session.winnerSeatId)?.name ?? "A player"} won!` : "The game ended with no winner."}</h2>
        </header>
        <p>{session.seats.filter((seat) => seat.hasLost).map((seat) => `${seat.name}: ${seat.lossReason ?? "lost"}`).join(" · ")}</p>
        {gameStarting ? (
          <p>Dealing new hands. Each AI seat decides its mulligan with its own model (and loads it first), so this can take a minute or two - the board changes when they are done.</p>
        ) : setupMessage ? (
          <p>{setupMessage}</p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="inspector-action" disabled={gameStarting} onClick={() => void onPlayAgain()}>
            {gameStarting ? "Restarting..." : "Play again (same decks)"}
          </button>
          <button type="button" className="inspector-action" onClick={() => onDismiss()}>
            Look at the board
          </button>
          <button type="button" className="inspector-action" onClick={() => onBackToSetup()}>
            Back to setup
          </button>
        </div>
      </article>
    </div>
  );
}
