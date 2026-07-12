import type { PlayerSeat, VisibleCard } from "@/lib/types";
import { VisualCard } from "./VisualCard";

export function PlayerBoard({
  seat,
  active = false,
  perspective = "opponent",
  tableSlot,
  selectedCardId,
  onSelectHandCard,
  onInspectCard,
  onDrawCard,
  onPlayCard
}: {
  seat: PlayerSeat;
  active?: boolean;
  perspective?: "human" | "opponent";
  tableSlot?: "agent-one" | "agent-two" | "agent-three" | "human";
  selectedCardId?: string;
  onSelectHandCard?: (card: VisibleCard) => void;
  onInspectCard?: (card: VisibleCard) => void;
  onDrawCard?: (seatId: string) => void;
  onPlayCard?: (seatId: string, cardId: string) => void;
}) {
  const commanderDamage = Object.values(seat.commanderDamage).reduce((sum, damage) => sum + damage, 0);

  return (
    <section className={`player-board ${active ? "is-active" : ""} ${perspective === "human" ? "is-human" : ""} ${tableSlot ? `slot-${tableSlot}` : ""}`}>
      <header className="player-board-header">
        <div>
          <p className="eyebrow">{seat.kind === "human" ? "Human player" : `${seat.agentName} agent`}</p>
          <h2>{seat.name}</h2>
        </div>
        <div className="life-cluster">
          <strong>{seat.life}</strong>
          <span>Life</span>
        </div>
      </header>

      <div className="tabletop-zones" aria-label={`${seat.name} zones`}>
        <CardPile label="Deck" count={seat.zones.library} onClick={perspective === "human" ? () => onDrawCard?.(seat.id) : undefined} />
        <CardPile label="Hand" count={seat.zones.hand} />
        <CardPile label="Grave" count={seat.zones.graveyard} />
        <CardPile label="Exile" count={seat.zones.exile} />
      </div>

      {commanderDamage ? <div className="commander-damage">{commanderDamage} commander damage</div> : null}

      <div className="playmat">
        <div className="command-slot">
          {seat.board.commander ? <VisualCard card={seat.board.commander} compact onClick={onInspectCard} tabletop /> : <CardPile label="Command" count={seat.zones.command} />}
        </div>
        <div className="battlefield-row" aria-label={`${seat.name} battlefield`}>
          {seat.board.battlefield.length > 0 ? (
            seat.board.battlefield.map((card) => <VisualCard card={card} key={card.id} compact onClick={onInspectCard} tabletop />)
          ) : (
            <p className="empty-zone">Play cards here</p>
          )}
        </div>
      </div>

      {perspective === "human" ? (
        <div className="hand-zone" aria-label="Your hand">
          <div className="hand-heading">
            <span>Your hand</span>
            <button type="button" onClick={() => onDrawCard?.(seat.id)}>Draw</button>
          </div>
          <div className="hand-row">
            {seat.board.hand.map((card) => (
              <VisualCard
                card={card}
                compact
                key={card.id}
                onClick={(clicked) => {
                  onSelectHandCard?.(clicked);
                  onInspectCard?.(clicked);
                }}
                selected={selectedCardId === card.id}
                tabletop
              />
            ))}
          </div>
          <button
            className="play-selected"
            disabled={!selectedCardId}
            type="button"
            onClick={() => selectedCardId && onPlayCard?.(seat.id, selectedCardId)}
          >
            Play Selected Card
          </button>
        </div>
      ) : null}
    </section>
  );
}

function CardPile({ label, count, onClick }: { label: string; count: number; onClick?: () => void }) {
  return (
    <button className="card-pile" disabled={!onClick} aria-label={`${label}: ${count}`} onClick={onClick} type="button">
      <div className="card-back" />
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}
