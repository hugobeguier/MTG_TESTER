"use client";
// Card display pieces for kernel-mode decisions: a card TILE (art, or name / type / rules text when there is no art), the enlarged FULL card (large art plus
// name, cost, type line, rules text, P/T, counters), and a hover / focus / click preview that works for cards in ANY zone (library, graveyard, exile, stack,
// revealed), because it only needs the VisibleCard the kernel put on the option. Pure data helpers are in game/kernelCardInfo.ts.
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import type { VisibleCard } from "@/lib/types";
import { RoomArt } from "./RoomDoorLocks";
import { listedPreviewCard } from "./boardPreview";
import { cardImageUrl, cardInfo, cardSummary, type ImageSize } from "./game/kernelCardInfo";


export interface CardPreviewApi {
  card: VisibleCard | undefined;
  /** spread on anything that shows `card`: mouse hover and keyboard focus show the full card, leaving hides it (unless pinned) */
  handlers: (card: VisibleCard) => { onMouseEnter: () => void; onMouseLeave: () => void; onFocus: () => void; onBlur: () => void };
  /** click toggles the preview staying open (touch screens, reading at leisure) */
  togglePin: (card: VisibleCard) => void;
  pinned: boolean;
  close: () => void;
}

export function useCardPreview(): CardPreviewApi {
  const [hover, setHover] = useState<VisibleCard | undefined>();
  const [pin, setPin] = useState<VisibleCard | undefined>();
  const handlers = useCallback((card: VisibleCard) => {
    const shown = listedPreviewCard(card);
    const on = () => setHover(shown), off = () => setHover((h) => (h?.id === card.id ? undefined : h));
    return { onMouseEnter: on, onMouseLeave: off, onFocus: on, onBlur: off };
  }, []);
  const togglePin = useCallback((card: VisibleCard) => setPin((p) => (p?.id === card.id ? undefined : listedPreviewCard(card))), []);
  const close = useCallback(() => { setPin(undefined); setHover(undefined); }, []);
  return { card: hover ?? pin, handlers, togglePin, pinned: !!pin && (!hover || hover.id === pin.id), close };
}

/** the full card: large art, and under it name, cost, type line, rules text, P/T, counters (the text is also what shows when the art is missing or fails to load) */
export function CardFull({ card, art = "large", showText = true }: { card: VisibleCard; art?: ImageSize; showText?: boolean }) {
  const i = cardInfo(card, art);
  const [failed, setFailed] = useState<string | undefined>();
  const img = i.imageUrl && failed !== i.imageUrl ? i.imageUrl : undefined;
  return (
    <div data-testid="card-full" aria-label={card.name}>
      {img ? <RoomArt card={card} block><img src={img} alt={card.name} onError={() => setFailed(img)} style={{ width: "100%", borderRadius: 12, display: "block" }} /></RoomArt> : null}
      {showText || !img ? (
        <div style={{ marginTop: img ? 6 : 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>{i.name}</strong><span>{i.manaCost ?? ""}</span></div>
          <div style={{ opacity: 0.8 }}>{i.typeLine}</div>
          {i.oracleText ? <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{i.oracleText}</div> : null}
          {i.stats ? <div style={{ marginTop: 4 }}><strong>{i.stats}</strong></div> : null}
          {i.counters ? <div style={{ marginTop: 2, opacity: 0.8 }}>Counters: {i.counters}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** the floating enlarged card; render once per dialog, driven by useCardPreview */
export function CardPreviewPanel({ api }: { api: CardPreviewApi }) {
  if (!api.card) return null;
  return (
    <div className={`kernel-preview${api.pinned ? "" : " is-hover"}`} role="img" aria-label={`Enlarged ${api.card.name}`} data-testid="card-preview" onClick={api.close}>
      <CardFull card={api.card} />
    </div>
  );
}

/** a card as a tile: art (or the text fallback), the name under it, optional badge; the tile is a button when onClick is given */
export function CardTile({ card, api, width = 110, on = false, onClick, badge, label, disabled, extra, ariaPressed }: {
  card: VisibleCard; api: CardPreviewApi; width?: number; on?: boolean; onClick?: () => void; badge?: ReactNode; label?: string; disabled?: boolean; extra?: ReactNode; ariaPressed?: boolean;
}) {
  const i = cardInfo(card, width > 150 ? "large" : "normal");
  const [failed, setFailed] = useState(false);
  const art = i.imageUrl && !failed ? i.imageUrl : undefined;
  const body = (
    <>
      {art ? <RoomArt card={card} block><img className="card-thumb" src={art} alt={card.name} onError={() => setFailed(true)} style={{ width, borderRadius: Math.max(4, width / 18), display: "block" }} /></RoomArt>
        : <div className="card-thumb-fallback" style={{ width, minHeight: width * 1.4 }}><strong>{i.name}</strong> {i.manaCost}<div className="card-pick-detail">{i.typeLine}</div><div className="card-oracle">{i.oracleText}</div>{i.stats ? <strong>{i.stats}</strong> : null}</div>}
      <span className="card-pick-name" style={{ maxWidth: width }}>{label ?? card.name}</span>
      {badge}
    </>
  );
  return (
    <div className="kernel-tile" {...api.handlers(card)}>
      {onClick ? (
        <button type="button" className={`card-pick${on ? " selected" : ""}`} onClick={onClick} disabled={disabled} aria-pressed={ariaPressed ?? on} title={cardSummary(card)}>{body}</button>
      ) : (
        <div className={`card-pick${on ? " selected" : ""}`} style={{ cursor: "zoom-in" }} tabIndex={0} title={cardSummary(card)} onClick={() => api.togglePin(card)}>{body}</div>
      )}
      {extra}
      <button type="button" aria-label={`Enlarge ${card.name}`} className="kernel-link" onClick={() => api.togglePin(card)}>enlarge</button>
    </div>
  );
}

/** a compact card line (thumbnail + name + type) for lists: log lines, order rows, stack rows */
export function CardChip({ card, api, thumb = 36 }: { card: VisibleCard; api: CardPreviewApi; thumb?: number }) {
  const url = cardImageUrl(card, "small");
  return (
    <span className="kernel-chip" {...api.handlers(card)} title={cardSummary(card)}>
      {url ? <img src={url} alt="" style={{ width: thumb, borderRadius: 4 }} /> : null}
      <span>{card.name}</span>
    </span>
  );
}
