import type { GameEvent, GameSession, VisibleCard } from "@/lib/types";
import { PlayerBoard } from "./PlayerBoard";

export function GameTable({
  session,
  prioritySeatId,
  onAdvanceTurn,
  onPassPriority,
  onRespond,
  selectedCardId,
  onSelectHandCard,
  inspectedCard,
  onInspectCard,
  onDrawCard,
  onPlayCard,
  gameStage = "playing",
  humanMulligans = 0,
  onKeepHand,
  onMulligan
}: {
  session: GameSession;
  prioritySeatId?: string;
  onAdvanceTurn?: () => void;
  onPassPriority?: () => void;
  onRespond?: () => void;
  selectedCardId?: string;
  onSelectHandCard?: (card: VisibleCard) => void;
  inspectedCard?: VisibleCard;
  onInspectCard?: (card: VisibleCard) => void;
  onDrawCard?: (seatId: string) => void;
  onPlayCard?: (seatId: string, cardId: string) => void;
  gameStage?: "mulligan" | "playing";
  humanMulligans?: number;
  onKeepHand?: () => void;
  onMulligan?: () => void;
}) {
  const human = session.seats.find((seat) => seat.kind === "human") ?? session.seats[0];
  const [agentOne, agentTwo, agentThree] = session.seats.filter((seat) => seat.id !== human.id);
  const latest = session.events[0];
  const prioritySeat = session.seats.find((seat) => seat.id === prioritySeatId);
  const humanHasPriority = prioritySeatId === human.id;

  return (
    <section className="game-table" aria-label="Commander battlefield">
      {agentOne ? <PlayerBoard seat={agentOne} active={session.activePlayerId === agentOne.id} onInspectCard={onInspectCard} tableSlot="agent-one" /> : null}
      {agentTwo ? <PlayerBoard seat={agentTwo} active={session.activePlayerId === agentTwo.id} onInspectCard={onInspectCard} tableSlot="agent-two" /> : null}
      {agentThree ? <PlayerBoard seat={agentThree} active={session.activePlayerId === agentThree.id} onInspectCard={onInspectCard} tableSlot="agent-three" /> : null}
      <PlayerBoard
        seat={human}
        active={session.activePlayerId === human.id}
        onDrawCard={onDrawCard}
        onPlayCard={onPlayCard}
        onInspectCard={onInspectCard}
        onSelectHandCard={onSelectHandCard}
        perspective="human"
        selectedCardId={selectedCardId}
        tableSlot="human"
      />

      <article className="center-control">
        <p className="eyebrow">Turn {session.turn}</p>
        <h2>{session.seats.find((seat) => seat.id === session.activePlayerId)?.name ?? "Active player"}</h2>
        <p className="phase-pill">{session.phase}</p>

        {gameStage === "mulligan" ? (
          <div className="mulligan-panel">
            <strong>{human.board.hand.length} cards</strong>
            <p>{humanMulligans <= 1 ? "You may keep 7. First mulligan is free." : `If you keep, you keep ${Math.max(1, 8 - humanMulligans)}.`}</p>
            <button type="button" onClick={onKeepHand}>Keep</button>
            <button type="button" onClick={onMulligan}>Mulligan</button>
          </div>
        ) : (
          <>
            <div className="life-controls" aria-label="Life total controls preview">
              <button type="button" disabled>+</button>
              <strong>{human.life}</strong>
              <button type="button" disabled>-</button>
            </div>

            <div className="priority-actions">
              <button type="button" onClick={onPassPriority} disabled={!humanHasPriority}>
                Pass Priority
              </button>
              <button type="button" onClick={onRespond} disabled={!humanHasPriority}>
                Respond
              </button>
              <button type="button" onClick={onAdvanceTurn}>
                Next Turn
              </button>
            </div>
          </>
        )}

        <p className="stack-chip">Stack: empty</p>
        {inspectedCard ? (
          <div className="card-detail-panel">
            <strong>{inspectedCard.name}</strong>
            <span>{inspectedCard.typeLine}</span>
            <p>{inspectedCard.oracleText}</p>
            {inspectedCard.power && inspectedCard.toughness ? <small>{inspectedCard.power}/{inspectedCard.toughness}</small> : null}
          </div>
        ) : (
          <p className="card-detail-empty">Click a card to read it.</p>
        )}
        {latest ? <EventSummary event={latest} /> : null}
      </article>
    </section>
  );
}

function EventSummary({ event }: { event: GameEvent }) {
  return (
    <div className="event-chip">
      <p>{event.message}</p>
    </div>
  );
}
