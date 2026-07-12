import type { VisibleCard } from "@/lib/types";

const COLOR_LABELS: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green"
};

export function VisualCard({
  card,
  compact = false,
  tabletop = false,
  selected = false,
  onClick
}: {
  card: VisibleCard;
  compact?: boolean;
  tabletop?: boolean;
  selected?: boolean;
  onClick?: (card: VisibleCard) => void;
}) {
  const colorClass = card.colors.length === 0 ? "card-colorless" : `card-${card.colors[0].toLowerCase()}`;
  const counters = card.counters?.map((counter) => `${counter.count} ${counter.kind}`).join(", ");

  return (
    <article
      className={`visual-card ${colorClass} ${card.tapped ? "is-tapped" : ""} ${compact ? "is-compact" : ""} ${tabletop ? "is-tabletop" : ""}`}
      tabIndex={0}
      title={`${card.name}\n${card.typeLine}\n${card.oracleText}`}
      aria-pressed={selected}
      onClick={() => onClick?.(card)}
    >
      <header className="visual-card-header">
        <strong>{card.name}</strong>
        <span>{card.manaValue}</span>
      </header>
      <p className="type-line">{card.typeLine}</p>
      <p className="oracle-text">{card.oracleText}</p>
      <footer className="visual-card-footer">
        <div className="badges" aria-label={`${card.name} state`}>
          {card.commander ? <span>Commander</span> : null}
          {card.tapped ? <span>Tapped</span> : null}
          {card.summoningSick ? <span>Sick</span> : null}
          {card.attacking ? <span>Attacking</span> : null}
          {card.blocking ? <span>Blocking</span> : null}
          {counters ? <span>{counters}</span> : null}
          <span>{card.role}</span>
        </div>
        {card.power && card.toughness ? <strong className="pt">{card.power}/{card.toughness}</strong> : null}
      </footer>
      <span className="sr-only">
        {card.colors.map((color) => COLOR_LABELS[color] ?? color).join(", ") || "Colorless"}
      </span>
    </article>
  );
}
