"use client";
// The ordered-placement UI of KernelDecisionDialog for decisions of kind "order_library" (scry, surveil, "put them back in any order"): the cards you looked at,
// numbered slots for the new top of the library ("Next draw (top of library)", "2nd", ...), and the "Bottom of library" / "Graveyard" area. All logic is in
// game/kernelPlacement.ts (tested headless). Clicking an unplaced card puts it on top after the ones already placed, so clicking the cards in the order you want
// to draw them works as "Place Next" did in the legacy game. Drag a card onto a slot, or "Choose a slot" / pick up a placed card and click a slot, to place it exactly.
import { useMemo, useState, type MutableRefObject } from "react";
import type { Choice } from "@/kernel/engine/types";
import type { DecisionView } from "@/kernel/integration/tableState";
import {
  awayName, awayTitle, canConfirmPlacement, emptyPlacement, keepAllAnswer, placementChoice, previewLine, putAwayLabel, putOnTop, putTopLabel, sendAway, slotLabel,
  stackTitle, undoPlacement, unplace, unplacedIds, type PlacementState
} from "./game/kernelPlacement";
import { CardTile, type CardPreviewApi } from "./KernelCardView";

function tileWidth(n: number): number { return n <= 3 ? 170 : n <= 5 ? 145 : 120; }

export function PlacementBody({ decision, onAnswer, api, answerRef }: { decision: DecisionView; onAnswer: (id: string, c: Choice) => void; api: CardPreviewApi; answerRef: MutableRefObject<() => void> }) {
  const [p, setP] = useState<PlacementState>(emptyPlacement);
  /** a card picked up (an unplaced card via "Choose a slot", or a placed one) that the next click on a slot will move there */
  const [armed, setArmed] = useState<string | undefined>();
  const [over, setOver] = useState<number | undefined>(); // the slot a dragged card is over
  const byId = useMemo(() => new Map(decision.options.map((o) => [o.id, o])), [decision]);
  const nameOf = (id: string) => byId.get(id)?.card?.name ?? byId.get(id)?.label ?? id;
  const width = tileWidth(decision.options.length);
  const ready = canConfirmPlacement(decision, p);
  const unplaced = unplacedIds(decision, p);
  const away = awayName(decision);
  const awayLabel = putAwayLabel(decision);
  answerRef.current = () => { if (ready) onAnswer(decision.id, placementChoice(decision, p)); };

  const place = (id: string, at?: number) => { setP(putOnTop(decision, p, id, at)); setArmed(undefined); };
  const send = (id: string) => { setP(sendAway(decision, p, id)); setArmed(undefined); };
  const tile = (id: string, extra: React.ReactNode, onClick: () => void, on = false) => {
    const o = byId.get(id)!;
    return o.card
      ? <div key={id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", id)} data-card-id={id}><CardTile card={o.card} api={api} width={width} on={on} onClick={onClick} extra={extra} /></div>
      : <button key={id} type="button" className="kernel-small" onClick={onClick}>{o.label}</button>;
  };
  const drop = (at: number | undefined) => (e: React.DragEvent) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (byId.has(id)) { if (at === -1) send(id); else place(id, at); } };
  const slots = Math.max(decision.options.length, p.top.length);

  return (
    <>
      <div className="eyebrow">Cards you looked at ({unplaced.length} not placed yet)</div>
      <div className="kernel-grid" data-testid="place-unplaced" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (byId.has(id)) { setP(unplace(p, id)); setArmed(undefined); } }}>
        {unplaced.map((id) => tile(id, (
          <span className="library-look-actions" style={{ maxWidth: width }}>
            <button type="button" className="kernel-small" onClick={() => place(id)}>{putTopLabel(decision, p)}</button>
            {awayLabel ? <button type="button" className="kernel-small" onClick={() => send(id)}>{awayLabel}</button> : null}
            <button type="button" className="kernel-small" onClick={() => setArmed(armed === id ? undefined : id)}>{armed === id ? "Now click a slot below" : "Choose a slot"}</button>
          </span>
        ), () => place(id), armed === id))}
        {unplaced.length === 0 ? <em className="kernel-hint">Every card is placed.</em> : null}
      </div>

      <div className="eyebrow">{stackTitle(decision)}</div>
      <div className="kernel-grid" data-testid="place-stack">
        {Array.from({ length: slots }, (_, i) => {
          const id = p.top[i];
          const clickable = armed !== undefined && (id === undefined || id !== armed);
          return (
            <div key={i} className={`kernel-slot${clickable ? " is-armed" : ""}${over === i ? " is-over" : ""}`} data-testid={`slot-${i}`} onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDragLeave={() => setOver((o) => (o === i ? undefined : o))} onDrop={(e) => { setOver(undefined); drop(i)(e); }}
              role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined} aria-label={clickable ? `Place the chosen card in slot ${i + 1}` : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); place(armed!, Math.min(i, p.top.filter((x) => x !== armed).length)); } } : undefined}
              onClick={clickable ? () => place(armed!, Math.min(i, p.top.filter((x) => x !== armed).length)) : undefined}>
              <span className="kernel-slot-label">{i + 1}. {slotLabel(decision, i)}</span>
              {id ? tile(id, <button type="button" className="kernel-small" onClick={() => setP(unplace(p, id))}>Take back</button>, () => setArmed(armed === id ? undefined : id), armed === id)
                : <span className="kernel-empty">{armed ? "Click to place the chosen card here" : "Empty: click a card above, or drag it here"}</span>}
            </div>
          );
        })}
      </div>

      {away ? (
        <>
          <div className="eyebrow">{awayTitle(decision)}{away === "bottom" ? " (first = closest to the top of the bottom group)" : ""}</div>
          <div className="kernel-grid kernel-away" data-testid="place-away" onDragOver={(e) => e.preventDefault()} onDrop={drop(-1)}>
            {p.away.map((id) => tile(id, <button type="button" className="kernel-small" onClick={() => setP(unplace(p, id))}>Take back</button>, () => setP(unplace(p, id))))}
            {p.away.length === 0 ? <em className="kernel-hint">{away === "bottom" ? "No card goes to the bottom." : "No card goes to the graveyard."}</em> : null}
          </div>
        </>
      ) : null}

      <div className="kernel-preview-line" data-testid="place-preview">{previewLine(decision, p, nameOf)}</div>
      <div className="modal-actions">
        <button type="button" disabled={p.history.length === 0} onClick={() => { setP(undoPlacement(p)); setArmed(undefined); }}>Undo last placement</button>
        <button type="button" disabled={p.top.length + p.away.length === 0} onClick={() => { setP(emptyPlacement()); setArmed(undefined); }}>Reset</button>
        <button type="button" onClick={() => { setP(keepAllAnswer(decision)); setArmed(undefined); }}>Keep all on top in this order</button>
        <button type="button" disabled={!ready} onClick={() => onAnswer(decision.id, placementChoice(decision, p))}>
          {ready ? "Confirm" : `Confirm (place ${unplaced.length} more card${unplaced.length === 1 ? "" : "s"})`}
        </button>
      </div>
    </>
  );
}
