"use client";
// One dialog for every decision the kernel asks the human (TableState.decision), driven by the pure view-model in game/kernelDecisionView.ts:
// pick N of the listed options (targets, discards, modes, colours, creature types, search results; with card art and a filter for long lists), yes / no
// (with the cost for "unless you pay"), a number (X with the most you can afford), ordering (up / down), and the three "split an amount" kinds (damage, mana, counters).
// It offers only what the kernel listed and answers through onAnswer(decisionId, choice) with the id it was RENDERED for; give it key={decision.id}.
// Keyboard: Enter confirms when the answer is valid, Escape cancels when the kernel allows it.
// Targets and picks of permanents / players / hand cards are normally clicked on the board (KernelBoardPick); this dialog is the list fallback and the home of everything else.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Choice } from "@/kernel/engine/types";
import type { DecisionOptionView, DecisionView } from "@/kernel/integration/tableState";
import {
  canConfirm, classifyDecision, clampNumber, confirmLabel, defaultDamageSplit, initialOrder, moveItem, numberChoice, numberHint, orderChoice, pickChoice,
  selectionHint, setSplit, splitChoice, splitModel, splitSum, splitValid, toggleSelection, undoLast
} from "./game/kernelDecisionView";
import { pileDestination } from "./game/kernelCardInfo";
import { escapeCancels } from "./game/kernelPlacement";
import { PlacementBody } from "./KernelPlacementBody";
import { CardChip, CardFull, CardPreviewPanel, CardTile, useCardPreview, type CardPreviewApi } from "./KernelCardView";

export interface KernelDecisionDialogProps {
  decision: DecisionView;
  onAnswer: (decisionId: string, choice: Choice) => void;
  /** art of the card the question comes from (the controller looks it up by prompt.source.card) */
  sourceArt?: string;
  /** go back to clicking on the board (offered only for decisions that can be clicked there) */
  onBoard?: () => void;
}

const S = {
  backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  box: { background: "#1c1b22", color: "#eee", border: "1px solid #6b6a7a", borderRadius: 10, padding: 16, maxWidth: 980, width: "100%", maxHeight: "86vh", overflow: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.6)" },
  head: { display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 8 },
  tag: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#e8c04a" },
  title: { margin: "2px 0 4px", fontSize: 18 },
  hint: { margin: "0 0 10px", opacity: 0.8, fontSize: 14 },
  grid: { display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0 12px" },
  opt: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: 6, minWidth: 96, maxWidth: 150, background: "#2a2933", color: "#eee", border: "2px solid #44434f", borderRadius: 8, cursor: "pointer", font: "inherit" },
  optOn: { borderColor: "#5fd08a", background: "#1f3a2b" },
  img: { width: 96, borderRadius: 6 },
  row: { display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", alignItems: "center" },
  btn: { padding: "6px 14px", borderRadius: 6, border: "1px solid #6b6a7a", background: "#34333f", color: "#eee", cursor: "pointer", font: "inherit" },
  primary: { background: "#7a5cd6", borderColor: "#9a80f0" },
  num: { width: 70, padding: 4, font: "inherit" },
  orderRow: { display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", background: "#2a2933", border: "1px solid #44434f", borderRadius: 8, marginBottom: 6 }
} as const;

const COLOR_TINT: Record<string, string> = { W: "#f4efc9", U: "#7fb4ff", B: "#b9a8c9", R: "#ff8f7a", G: "#8fd49a", C: "#cfcfcf" };

function OptionButton({ o, order, on, onClick, api, width, extra }: { o: DecisionOptionView; order?: number; on: boolean; onClick: () => void; api: CardPreviewApi; width: number; extra?: React.ReactNode }) {
  const badge = order !== undefined ? <strong aria-label="order">#{order + 1}</strong> : null;
  if (o.card) return <CardTile card={o.card} api={api} width={width} on={on} onClick={onClick} badge={badge} extra={extra} label={o.label === o.card.name ? undefined : o.label} />;
  const tint = /^[WUBRGC]$/.test(o.id) ? COLOR_TINT[o.id] : undefined;
  return (
    <button type="button" style={{ ...S.opt, ...(on ? S.optOn : {}), ...(tint ? { color: tint } : {}) }} onClick={onClick} aria-pressed={on} title={o.label}>
      <span>{o.label}</span>
      {badge}
    </button>
  );
}

/** how wide the card tiles are: bigger when there are few cards or they are the cards in a library (scry, surveil, look at the top) */
function tileWidth(d: DecisionView): number {
  const cards = d.options.filter((o) => o.card).length;
  return cards <= 3 ? 190 : cards <= 6 ? 160 : cards <= 12 ? 130 : 105;
}

function Split({ decision, onAnswer, api }: { decision: DecisionView; onAnswer: KernelDecisionDialogProps["onAnswer"]; api: CardPreviewApi }) {
  const m = useMemo(() => splitModel(decision), [decision]);
  const [vals, setVals] = useState<Record<string, number>>(() => (decision.kind === "assign_damage" ? defaultDamageSplit(m, decision.amounts?.lethal ?? {}) : {}));
  const sum = splitSum(m, vals);
  const ok = splitValid(m, vals);
  const label = (id: string) => decision.options.find((o) => o.id === id)?.label ?? id;
  const cardOf = (id: string) => decision.options.find((o) => o.id === id)?.card;
  const range = m.total !== undefined ? `${sum} of ${m.total}` : `${sum} (between ${m.min} and ${m.max})`;
  return (
    <>
      <div style={S.grid}>
        {m.ids.map((id) => (
          <label key={id} style={{ ...S.opt, cursor: "default" }}>
            {cardOf(id) ? <CardTile card={cardOf(id)!} api={api} width={96} label={label(id)} /> : <span>{label(id)}</span>}
            {decision.amounts?.lethal[id] && !cardOf(id) ? <span>{`(lethal ${decision.amounts.lethal[id]})`}</span> : null}
            <span style={S.row}>
              <button type="button" style={S.btn} aria-label={`less ${label(id)}`} onClick={() => setVals(setSplit(m, vals, id, (vals[id] ?? 0) - 1))}>-</button>
              <input type="number" min={0} max={m.caps[id]} value={vals[id] ?? 0} style={S.num} onChange={(e) => setVals(setSplit(m, vals, id, Number(e.target.value)))} />
              <button type="button" style={S.btn} aria-label={`more ${label(id)}`} onClick={() => setVals(setSplit(m, vals, id, (vals[id] ?? 0) + 1))}>+</button>
            </span>
          </label>
        ))}
      </div>
      <p style={S.hint}>Assigned {range}</p>
      <div style={S.row}>
        <button type="button" style={{ ...S.btn, ...S.primary }} disabled={!ok} onClick={() => onAnswer(decision.id, splitChoice(m, vals))}>Confirm</button>
      </div>
    </>
  );
}

function Order({ decision, onAnswer, api }: { decision: DecisionView; onAnswer: KernelDecisionDialogProps["onAnswer"]; api: CardPreviewApi }) {
  const [order, setOrder] = useState<string[]>(() => initialOrder(decision));
  const byId = new Map(decision.options.map((o) => [o.id, o]));
  const first = decision.max <= 1;
  return (
    <>
      <p style={S.hint}>{first ? "Pick which one to apply first." : "Put them in the order you want, first at the top."}</p>
      <div>
        {order.map((id, i) => {
          const o = byId.get(id)!;
          return (
            <div key={id} style={S.orderRow}>
              <strong>{i + 1}.</strong>
              {o.card ? <CardChip card={o.card} api={api} thumb={64} /> : null}
              <span style={{ flex: 1 }}>{o.label}</span>
              {first ? <button type="button" style={{ ...S.btn, ...(i === 0 ? S.primary : {}) }} onClick={() => setOrder([id, ...order.filter((x) => x !== id)])}>{i === 0 ? "First" : "Make first"}</button> : (
                <>
                  <button type="button" style={S.btn} disabled={i === 0} aria-label={`move ${o.label} up`} onClick={() => setOrder(moveItem(order, i, i - 1))}>Up</button>
                  <button type="button" style={S.btn} disabled={i === order.length - 1} aria-label={`move ${o.label} down`} onClick={() => setOrder(moveItem(order, i, i + 1))}>Down</button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div style={S.row}><button type="button" style={{ ...S.btn, ...S.primary }} onClick={() => onAnswer(decision.id, orderChoice(decision, order))}>Confirm</button></div>
    </>
  );
}

/** scry / surveil / look-at-top: the listed cards side by side in two piles, "stay on top" and the pile the kernel's text says they move to; click a card (or its button) to move it */
function Piles({ decision, picked, dest, api, width, onToggle }: { decision: DecisionView; picked: string[]; dest: "bottom" | "graveyard" | "top" | "exile" | "hand"; api: CardPreviewApi; width: number; onToggle: (id: string) => void }) {
  const destLabel = dest === "bottom" ? "Put on the bottom of the library" : dest === "graveyard" ? "Put into the graveyard" : dest === "hand" ? "Put into your hand" : dest === "exile" ? "Exile" : "Put on top";
  const topFirst = decision.options.filter((o) => !picked.includes(o.id));
  const moved = decision.options.filter((o) => picked.includes(o.id));
  const pile = (title: string, list: DecisionOptionView[], keep: boolean) => (
    <div style={{ flex: 1, minWidth: 200 }} data-testid={keep ? "pile-top" : "pile-moved"}>
      <div style={S.tag}>{title} ({list.length})</div>
      <div style={S.grid}>
        {list.map((o) => (
          <OptionButton key={o.id} o={o} api={api} width={width} on={!keep} onClick={() => onToggle(o.id)}
            order={keep ? decision.options.findIndex((x) => x.id === o.id) : undefined}
            extra={<button type="button" style={S.btn} onClick={() => onToggle(o.id)}>{keep ? "To " + (dest === "bottom" ? "bottom" : dest) : "Back on top"}</button>} />
        ))}
        {list.length === 0 ? <em style={S.hint}>None</em> : null}
      </div>
    </div>
  );
  return <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>{pile("Stays on top (first is the top card)", topFirst, true)}{pile(destLabel, moved, false)}</div>;
}

export function KernelDecisionDialog({ decision, onAnswer, sourceArt, onBoard }: KernelDecisionDialogProps) {
  const cls = classifyDecision(decision);
  const api = useCardPreview();
  const pile = pileDestination(decision);
  const [picked, setPicked] = useState<string[]>([]);
  const [num, setNum] = useState<number>(Math.max(0, decision.min));
  const [filter, setFilter] = useState("");
  const answerRef = useRef<() => void>(() => undefined);

  const cancel = decision.cancellable ? <button type="button" style={S.btn} onClick={() => onAnswer(decision.id, { cancel: true })}>Cancel</button> : null;

  // Enter confirms, Escape cancels (when the kernel lets the player)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "Escape" && !escapeCancels(decision)) e.preventDefault(); // a rules-required placement (scry / surveil / order) cannot be cancelled
      else if (e.key === "Escape" && decision.cancellable) { e.preventDefault(); onAnswer(decision.id, { cancel: true }); }
      else if (e.key === "Enter" && t?.tagName !== "BUTTON") { e.preventDefault(); answerRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decision, onAnswer]);

  let body: React.ReactNode;
  answerRef.current = () => undefined;
  if (cls.layout === "split") {
    body = <Split decision={decision} onAnswer={onAnswer} api={api} />;
  } else if (cls.layout === "place") {
    body = <PlacementBody decision={decision} onAnswer={onAnswer} api={api} answerRef={answerRef} />;
  } else if (cls.layout === "order") {
    body = <Order decision={decision} onAnswer={onAnswer} api={api} />;
  } else if (cls.layout === "number") {
    answerRef.current = () => onAnswer(decision.id, numberChoice(decision, num));
    body = (
      <>
        <div style={S.grid}>
          <button type="button" style={S.btn} aria-label="less" onClick={() => setNum(clampNumber(decision, num - 1))}>-</button>
          <input type="number" aria-label="number" min={decision.min} max={decision.max} value={num} style={S.num} onChange={(e) => setNum(clampNumber(decision, Number(e.target.value)))} />
          <button type="button" style={S.btn} aria-label="more" onClick={() => setNum(clampNumber(decision, num + 1))}>+</button>
          {decision.max > decision.min ? <input type="range" aria-label="slider" min={decision.min} max={decision.max} value={num} onChange={(e) => setNum(clampNumber(decision, Number(e.target.value)))} /> : null}
          <span style={S.hint}>{numberHint(decision)}</span>
        </div>
        <div style={S.row}>{cancel}<button type="button" style={{ ...S.btn, ...S.primary }} onClick={() => onAnswer(decision.id, numberChoice(decision, num))}>Confirm</button></div>
      </>
    );
  } else if (cls.layout === "yes_no") {
    const pay = decision.kind === "pay_unless";
    body = (
      <div style={S.row}>
        {cancel}
        <button type="button" style={S.btn} onClick={() => onAnswer(decision.id, { yes: false })}>{pay ? "Don't pay" : "No"}</button>
        <button type="button" style={{ ...S.btn, ...S.primary }} onClick={() => onAnswer(decision.id, { yes: true })}>{pay ? "Pay" : "Yes"}</button>
      </div>
    );
  } else {
    const ordering = decision.max > 1;
    const shown = filter.trim() ? decision.options.filter((o) => (o.label + " " + (o.card?.typeLine ?? "") + " " + (o.card?.oracleText ?? "")).toLowerCase().includes(filter.trim().toLowerCase())) : decision.options;
    const ready = canConfirm(decision, picked);
    answerRef.current = () => { if (ready) onAnswer(decision.id, pickChoice(picked)); };
    body = (
      <>
        {decision.options.length > 8 ? <input type="search" aria-label="filter" placeholder="Filter by name, type or text" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...S.num, width: "100%", marginBottom: 6 }} /> : null}
        {pile ? <Piles decision={decision} picked={picked} dest={pile} api={api} width={tileWidth(decision)} onToggle={(id) => setPicked(toggleSelection(decision, picked, id))} /> : null}
        <div style={{ ...S.grid, ...(pile ? { display: "none" } : {}) }}>
          {shown.map((o) => (
            <OptionButton key={o.id} o={o} api={api} width={tileWidth(decision)} on={picked.includes(o.id)} order={ordering && picked.includes(o.id) ? picked.indexOf(o.id) : undefined} onClick={() => setPicked(toggleSelection(decision, picked, o.id))} />
          ))}
          {shown.length === 0 ? <em style={S.hint}>{decision.options.length ? "No option matches the filter." : "Nothing to choose from."}</em> : null}
        </div>
        <p style={S.hint}>
          {selectionHint(decision, picked)}
          {decision.repeatable && picked.length ? <button type="button" style={{ ...S.btn, marginLeft: 8 }} onClick={() => setPicked(undoLast(picked))}>Undo last</button> : null}
        </p>
        <div style={S.row}>
          {onBoard ? <button type="button" style={S.btn} onClick={onBoard}>Pick on the board</button> : null}
          {cancel}
          <button type="button" style={{ ...S.btn, ...S.primary }} disabled={!ready} onClick={() => onAnswer(decision.id, pickChoice(picked))}>{confirmLabel(decision, picked)}</button>
        </div>
      </>
    );
  }
  return (
    <div style={S.backdrop} role="dialog" aria-modal="true" aria-label={decision.title} data-decision-id={decision.id}>
      <div style={S.box}>
        <div style={S.head}>
          {decision.sourceCard ? (
            <div style={{ width: 170, flex: "none" }} data-testid="source-card" {...api.handlers(decision.sourceCard)}><CardFull card={decision.sourceCard} art="normal" showText={false} /></div>
          ) : sourceArt ? <img src={sourceArt} alt={decision.source?.card ?? ""} style={{ width: 120, borderRadius: 6 }} /> : null}
          <div>
            <div style={S.tag}>{decision.source?.card ? `${decision.source.card} - ${cls.label}` : cls.label}</div>
            <h3 style={S.title}>{decision.title}</h3>
            {decision.instruction ? <p style={S.hint}>{decision.instruction}</p> : null}
            {decision.sourceCard ? <p style={{ ...S.hint, whiteSpace: "pre-wrap", fontSize: 12 }} data-testid="source-text"><strong>{decision.sourceCard.name}</strong> {decision.sourceCard.manaCost ?? ""} - {decision.sourceCard.typeLine}{decision.sourceCard.oracleText ? ` ${decision.sourceCard.oracleText}` : ""}</p> : null}
          </div>
        </div>
        {body}
      </div>
      <CardPreviewPanel api={api} />
    </div>
  );
}
