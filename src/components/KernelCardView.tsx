"use client";
// Card display pieces for kernel-mode decisions: a card TILE (art, or name / type / rules text when there is no art), the enlarged FULL card (large art plus
// name, cost, type line, rules text, P/T, counters), and a hover / focus / click preview that works for cards in ANY zone (library, graveyard, exile, stack,
// revealed), because it only needs the VisibleCard the kernel put on the option. Pure data helpers are in game/kernelCardInfo.ts.
import { useCallback, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { VisibleCard } from "@/lib/types";
import { listedPreviewCard } from "./boardPreview";
import { cardImageUrl, cardInfo, cardSummary, type ImageSize } from "./game/kernelCardInfo";

const C = {
  tile: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: 6, background: "#2a2933", color: "#eee", border: "2px solid #44434f", borderRadius: 8, cursor: "pointer", font: "inherit", textAlign: "center" },
  on: { borderColor: "#5fd08a", background: "#1f3a2b" },
  text: { width: "100%", minHeight: 120, padding: 6, boxSizing: "border-box", background: "#15141a", border: "1px solid #44434f", borderRadius: 6, fontSize: 11, textAlign: "left", overflow: "hidden" },
  preview: { position: "fixed", right: 16, top: "50%", transform: "translateY(-50%)", width: "min(330px, 30vw)", maxHeight: "92vh", overflow: "auto", zIndex: 90, background: "#101014", border: "1px solid #8a89a0", borderRadius: 12, boxShadow: "0 12px 36px rgba(0,0,0,0.7)", padding: 8, color: "#eee", fontSize: 13 }
} as const satisfies Record<string, CSSProperties>;

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
      {img ? <img src={img} alt={card.name} onError={() => setFailed(img)} style={{ width: "100%", borderRadius: 12, display: "block" }} /> : null}
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
    <div style={{ ...C.preview, pointerEvents: api.pinned ? "auto" : "none" }} role="img" aria-label={`Enlarged ${api.card.name}`} data-testid="card-preview" onClick={api.close}>
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
      {art ? <img src={art} alt={card.name} onError={() => setFailed(true)} style={{ width, borderRadius: Math.max(4, width / 18), display: "block" }} />
        : <div style={{ ...C.text, width, minHeight: width * 1.2 }}><strong>{i.name}</strong> {i.manaCost}<div style={{ opacity: 0.8 }}>{i.typeLine}</div><div>{i.oracleText}</div>{i.stats ? <strong>{i.stats}</strong> : null}</div>}
      <span style={{ maxWidth: width }}>{label ?? card.name}</span>
      {badge}
    </>
  );
  const style = { ...C.tile, ...(on ? C.on : {}), ...(disabled ? { opacity: 0.5, cursor: "default" } : {}) };
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }} {...api.handlers(card)}>
      {onClick ? (
        <button type="button" style={style} onClick={onClick} disabled={disabled} aria-pressed={ariaPressed ?? on} title={cardSummary(card)}>{body}</button>
      ) : (
        <div style={{ ...style, cursor: "zoom-in" }} tabIndex={0} title={cardSummary(card)} onClick={() => api.togglePin(card)}>{body}</div>
      )}
      {extra}
      <button type="button" aria-label={`Enlarge ${card.name}`} style={{ font: "inherit", fontSize: 11, background: "none", border: "none", color: "#9fb4ff", cursor: "zoom-in", padding: 0 }} onClick={() => api.togglePin(card)}>enlarge</button>
    </div>
  );
}

/** a compact card line (thumbnail + name + type) for lists: log lines, order rows, stack rows */
export function CardChip({ card, api, thumb = 36 }: { card: VisibleCard; api: CardPreviewApi; thumb?: number }) {
  const url = cardImageUrl(card, "small");
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} {...api.handlers(card)} title={cardSummary(card)}>
      {url ? <img src={url} alt="" style={{ width: thumb, borderRadius: 4 }} /> : null}
      <span>{card.name}</span>
    </span>
  );
}
