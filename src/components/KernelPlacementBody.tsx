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

const S = {
  zoneTitle: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "#e8c04a", margin: "10px 0 4px" },
  row: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-start" },
  slot: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: 6, minWidth: 110, border: "2px dashed #5a596a", borderRadius: 8, background: "#23222b" },
  slotArmed: { borderColor: "#e8c04a", background: "#2f2c1d", cursor: "pointer" },
  slotLabel: { fontSize: 12, fontWeight: 600, color: "#cfcfe0" },
  empty: { fontSize: 12, opacity: 0.6, padding: "30px 6px", textAlign: "center" },
  btn: { padding: "4px 8px", borderRadius: 6, border: "1px solid #6b6a7a", background: "#34333f", color: "#eee", cursor: "pointer", font: "inherit", fontSize: 12 },
  primary: { background: "#7a5cd6", borderColor: "#9a80f0" },
  preview: { margin: "10px 0", padding: "6px 10px", background: "#15141a", border: "1px solid #44434f", borderRadius: 6, fontSize: 14 },
  actions: { display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", alignItems: "center" }
} as const;

function tileWidth(n: number): number { return n <= 3 ? 170 : n <= 5 ? 145 : 120; }

export function PlacementBody({ decision, onAnswer, api, answerRef }: { decision: DecisionView; onAnswer: (id: string, c: Choice) => void; api: CardPreviewApi; answerRef: MutableRefObject<() => void> }) {
  const [p, setP] = useState<PlacementState>(emptyPlacement);
  /** a card picked up (an unplaced card via "Choose a slot", or a placed one) that the next click on a slot will move there */
  const [armed, setArmed] = useState<string | undefined>();
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
      : <button key={id} type="button" style={S.btn} onClick={onClick}>{o.label}</button>;
  };
  const drop = (at: number | undefined) => (e: React.DragEvent) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (byId.has(id)) { if (at === -1) send(id); else place(id, at); } };
  const slots = Math.max(decision.options.length, p.top.length);

  return (
    <>
      <div style={S.zoneTitle}>Cards you looked at ({unplaced.length} not placed yet)</div>
      <div style={S.row} data-testid="place-unplaced" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (byId.has(id)) { setP(unplace(p, id)); setArmed(undefined); } }}>
        {unplaced.map((id) => tile(id, (
          <span style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "stretch", maxWidth: width }}>
            <button type="button" style={{ ...S.btn, ...S.primary }} onClick={() => place(id)}>{putTopLabel(decision, p)}</button>
            {awayLabel ? <button type="button" style={S.btn} onClick={() => send(id)}>{awayLabel}</button> : null}
            <button type="button" style={S.btn} onClick={() => setArmed(armed === id ? undefined : id)}>{armed === id ? "Now click a slot below" : "Choose a slot"}</button>
          </span>
        ), () => place(id), armed === id))}
        {unplaced.length === 0 ? <em style={{ opacity: 0.7 }}>Every card is placed.</em> : null}
      </div>

      <div style={S.zoneTitle}>{stackTitle(decision)}</div>
      <div style={S.row} data-testid="place-stack">
        {Array.from({ length: slots }, (_, i) => {
          const id = p.top[i];
          const clickable = armed !== undefined && (id === undefined || id !== armed);
          return (
            <div key={i} style={{ ...S.slot, ...(clickable ? S.slotArmed : {}) }} data-testid={`slot-${i}`} onDragOver={(e) => e.preventDefault()} onDrop={drop(i)}
              onClick={clickable ? () => place(armed!, Math.min(i, p.top.filter((x) => x !== armed).length)) : undefined}>
              <span style={S.slotLabel}>{i + 1}. {slotLabel(decision, i)}</span>
              {id ? tile(id, <button type="button" style={S.btn} onClick={() => setP(unplace(p, id))}>Take back</button>, () => setArmed(armed === id ? undefined : id), armed === id)
                : <span style={S.empty}>{armed ? "Click to place the chosen card here" : "Empty: click a card above, or drag it here"}</span>}
            </div>
          );
        })}
      </div>

      {away ? (
        <>
          <div style={S.zoneTitle}>{awayTitle(decision)}{away === "bottom" ? " (first = closest to the top of the bottom group)" : ""}</div>
          <div style={{ ...S.row, minHeight: 40 }} data-testid="place-away" onDragOver={(e) => e.preventDefault()} onDrop={drop(-1)}>
            {p.away.map((id) => tile(id, <button type="button" style={S.btn} onClick={() => setP(unplace(p, id))}>Take back</button>, () => setP(unplace(p, id))))}
            {p.away.length === 0 ? <em style={{ opacity: 0.7 }}>{away === "bottom" ? "No card goes to the bottom." : "No card goes to the graveyard."}</em> : null}
          </div>
        </>
      ) : null}

      <div style={S.preview} data-testid="place-preview">{previewLine(decision, p, nameOf)}</div>
      <div style={S.actions}>
        <button type="button" style={S.btn} disabled={p.history.length === 0} onClick={() => { setP(undoPlacement(p)); setArmed(undefined); }}>Undo last placement</button>
        <button type="button" style={S.btn} disabled={p.top.length + p.away.length === 0} onClick={() => { setP(emptyPlacement()); setArmed(undefined); }}>Reset</button>
        <button type="button" style={S.btn} onClick={() => { setP(keepAllAnswer(decision)); setArmed(undefined); }}>Keep all on top in this order</button>
        <button type="button" style={{ ...S.btn, ...S.primary, fontSize: 14 }} disabled={!ready} onClick={() => onAnswer(decision.id, placementChoice(decision, p))}>
          {ready ? "Confirm" : `Confirm (place ${unplaced.length} more card${unplaced.length === 1 ? "" : "s"})`}
        </button>
      </div>
    </>
  );
}
