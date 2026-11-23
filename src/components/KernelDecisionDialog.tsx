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

/** how wide the card tiles are: bigger when there are few cards or they are the cards in a library (scry, surveil, look at the top) */
function tileWidth(d: DecisionView): number {
  const cards = d.options.filter((o) => o.card).length;
  return cards <= 3 ? 190 : cards <= 6 ? 160 : cards <= 12 ? 130 : 105;
}

type AnswerRef = React.MutableRefObject<() => void>;

function OptionButton({ o, order, on, onClick, api, width, extra }: { o: DecisionOptionView; order?: number; on: boolean; onClick: () => void; api: CardPreviewApi; width: number; extra?: React.ReactNode }) {
  const badge = order !== undefined ? <strong aria-label="order">#{order + 1}</strong> : null;
  if (o.card) return <CardTile card={o.card} api={api} width={width} on={on} onClick={onClick} badge={badge} extra={extra} label={o.label === o.card.name ? undefined : o.label} />;
  // colours use the legacy mana buttons; every other plain option is a legacy card-pick cell
  const mana = /^[WUBRGC]$/.test(o.id);
  return (
    <button type="button" className={mana ? `mana-choice-button mana-${o.id.toLowerCase()}${on ? " selected" : ""}` : `card-pick${on ? " selected" : ""}`} onClick={onClick} aria-pressed={on} title={o.label}>
      <span className="card-pick-name">{on && !mana ? "✓ " : ""}{o.label}</span>
      {badge}
    </button>
  );
}

function Split({ decision, onAnswer, api, answerRef }: { decision: DecisionView; onAnswer: KernelDecisionDialogProps["onAnswer"]; api: CardPreviewApi; answerRef: AnswerRef }) {
  const m = useMemo(() => splitModel(decision), [decision]);
  const [vals, setVals] = useState<Record<string, number>>(() => (decision.kind === "assign_damage" ? defaultDamageSplit(m, decision.amounts?.lethal ?? {}) : {}));
  const sum = splitSum(m, vals);
  const ok = splitValid(m, vals);
  answerRef.current = () => { if (ok) onAnswer(decision.id, splitChoice(m, vals)); };
  const label = (id: string) => decision.options.find((o) => o.id === id)?.label ?? id;
  const cardOf = (id: string) => decision.options.find((o) => o.id === id)?.card;
  const range = m.total !== undefined ? `${sum} of ${m.total}` : `${sum} (between ${m.min} and ${m.max})`;
  return (
    <>
      <div className="kernel-grid kernel-scroll">
        {m.ids.map((id) => (
          <div key={id} className="library-search-card kernel-split-row">
            {cardOf(id) ? <CardTile card={cardOf(id)!} api={api} width={96} label={label(id)} /> : <strong>{label(id)}</strong>}
            {decision.amounts?.lethal[id] && !cardOf(id) ? <span>{`(lethal ${decision.amounts.lethal[id]})`}</span> : null}
            <span className="kernel-num-row">
              <button type="button" className="kernel-small" aria-label={`less ${label(id)}`} onClick={() => setVals(setSplit(m, vals, id, (vals[id] ?? 0) - 1))}>-</button>
              <input type="number" className="kernel-num" aria-label={`amount for ${label(id)}`} min={0} max={m.caps[id]} value={vals[id] ?? 0} onChange={(e) => setVals(setSplit(m, vals, id, Number(e.target.value)))} />
              <button type="button" className="kernel-small" aria-label={`more ${label(id)}`} onClick={() => setVals(setSplit(m, vals, id, (vals[id] ?? 0) + 1))}>+</button>
            </span>
          </div>
        ))}
      </div>
      <p className="kernel-hint">Assigned {range}</p>
      <div className="modal-actions">
        <button type="button" disabled={!ok} onClick={() => onAnswer(decision.id, splitChoice(m, vals))}>Confirm</button>
      </div>
    </>
  );
}

/** order_triggers / order_replacements: the same drag-to-slot behaviour as the library placement, for a list that is already complete (every entry has a slot, the kernel's order is the start).
 *  Drag an entry onto a slot to put it there, or use its Up / Down buttons; when only the first one matters (max 1) drag it to the top or press "Make first". */
function Order({ decision, onAnswer, api, answerRef }: { decision: DecisionView; onAnswer: KernelDecisionDialogProps["onAnswer"]; api: CardPreviewApi; answerRef: AnswerRef }) {
  const [order, setOrder] = useState<string[]>(() => initialOrder(decision));
  const [over, setOver] = useState<number | undefined>();
  const byId = new Map(decision.options.map((o) => [o.id, o]));
  const first = decision.max <= 1;
  const start = initialOrder(decision);
  const changed = order.some((id, i) => id !== start[i]);
  answerRef.current = () => onAnswer(decision.id, orderChoice(decision, order));
  const dropAt = (i: number) => (e: React.DragEvent) => {
    e.preventDefault(); setOver(undefined);
    const from = order.indexOf(e.dataTransfer.getData("text/plain"));
    if (from >= 0) setOrder(moveItem(order, from, i));
  };
  return (
    <>
      <p className="kernel-hint">{first ? "Drag the one to apply first to the top slot, or press Make first." : "Drag the entries into the order you want (first at the top), or use Up / Down."}</p>
      <div className="kernel-order-list" data-testid="order-list">
        {order.map((id, i) => {
          const o = byId.get(id)!;
          return (
            <div key={id} className={`kernel-order-row${over === i ? " is-over" : ""}`} data-testid={`order-slot-${i}`} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", id)}
              onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDragLeave={() => setOver((x) => (x === i ? undefined : x))} onDrop={dropAt(i)}>
              <strong>{i + 1}.</strong>
              {o.card ? <CardChip card={o.card} api={api} thumb={64} /> : null}
              <span className="kernel-order-label">{o.label}</span>
              {first ? <button type="button" className="kernel-small" onClick={() => setOrder([id, ...order.filter((x) => x !== id)])}>{i === 0 ? "First" : "Make first"}</button> : (
                <>
                  <button type="button" className="kernel-small" disabled={i === 0} aria-label={`move ${o.label} up`} onClick={() => setOrder(moveItem(order, i, i - 1))}>Up</button>
                  <button type="button" className="kernel-small" disabled={i === order.length - 1} aria-label={`move ${o.label} down`} onClick={() => setOrder(moveItem(order, i, i + 1))}>Down</button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="modal-actions">
        <button type="button" disabled={!changed} onClick={() => setOrder(start)}>Reset</button>
        <button type="button" onClick={() => onAnswer(decision.id, orderChoice(decision, order))}>Confirm</button>
      </div>
    </>
  );
}

/** scry / surveil / look-at-top: the listed cards side by side in two piles, "stay on top" and the pile the kernel's text says they move to; click a card (or its button) or drag it to the other pile to move it */
function Piles({ decision, picked, dest, api, width, onToggle }: { decision: DecisionView; picked: string[]; dest: "bottom" | "graveyard" | "top" | "exile" | "hand"; api: CardPreviewApi; width: number; onToggle: (id: string) => void }) {
  const destLabel = dest === "bottom" ? "Put on the bottom of the library" : dest === "graveyard" ? "Put into the graveyard" : dest === "hand" ? "Put into your hand" : dest === "exile" ? "Exile" : "Put on top";
  const topFirst = decision.options.filter((o) => !picked.includes(o.id));
  const moved = decision.options.filter((o) => picked.includes(o.id));
  const pile = (title: string, list: DecisionOptionView[], keep: boolean) => (
    <div className="kernel-pile" data-testid={keep ? "pile-top" : "pile-moved"} onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (decision.options.some((o) => o.id === id) && picked.includes(id) === keep) onToggle(id); }}>
      <div className="eyebrow">{title} ({list.length})</div>
      <div className="kernel-grid">
        {list.map((o) => (
          <div key={o.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", o.id)}>
            <OptionButton o={o} api={api} width={width} on={!keep} onClick={() => onToggle(o.id)}
              order={keep ? decision.options.findIndex((x) => x.id === o.id) : undefined}
              extra={<button type="button" className="kernel-small" onClick={() => onToggle(o.id)}>{keep ? "To " + (dest === "bottom" ? "bottom" : dest) : "Back on top"}</button>} />
          </div>
        ))}
        {list.length === 0 ? <em className="kernel-hint">None</em> : null}
      </div>
    </div>
  );
  return <div className="kernel-piles">{pile("Stays on top (first is the top card)", topFirst, true)}{pile(destLabel, moved, false)}</div>;
}

export function KernelDecisionDialog({ decision, onAnswer, sourceArt, onBoard }: KernelDecisionDialogProps) {
  const cls = classifyDecision(decision);
  const api = useCardPreview();
  const pile = pileDestination(decision);
  const [picked, setPicked] = useState<string[]>([]);
  const [num, setNum] = useState<number>(Math.max(0, decision.min));
  const [filter, setFilter] = useState("");
  const answerRef = useRef<() => void>(() => undefined);
  const boxRef = useRef<HTMLElement>(null);
  useEffect(() => { boxRef.current?.focus({ preventScroll: true }); }, []); // keyboard users start inside the dialog

  const cancel = decision.cancellable ? <button type="button" onClick={() => onAnswer(decision.id, { cancel: true })}>Cancel</button> : null;

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
    body = <Split decision={decision} onAnswer={onAnswer} api={api} answerRef={answerRef} />;
  } else if (cls.layout === "place") {
    body = <PlacementBody decision={decision} onAnswer={onAnswer} api={api} answerRef={answerRef} />;
  } else if (cls.layout === "order") {
    body = <Order decision={decision} onAnswer={onAnswer} api={api} answerRef={answerRef} />;
  } else if (cls.layout === "number") {
    answerRef.current = () => onAnswer(decision.id, numberChoice(decision, num));
    body = (
      <>
        <div className="kernel-num-row">
          <button type="button" className="kernel-small" aria-label="less" onClick={() => setNum(clampNumber(decision, num - 1))}>-</button>
          <input type="number" aria-label="number" min={decision.min} max={decision.max} value={num} className="kernel-num" onChange={(e) => setNum(clampNumber(decision, Number(e.target.value)))} />
          <button type="button" className="kernel-small" aria-label="more" onClick={() => setNum(clampNumber(decision, num + 1))}>+</button>
          {decision.max > decision.min ? <input type="range" aria-label="slider" min={decision.min} max={decision.max} value={num} onChange={(e) => setNum(clampNumber(decision, Number(e.target.value)))} /> : null}
          <span className="kernel-hint">{numberHint(decision)}</span>
        </div>
        <div className="modal-actions">{cancel}<button type="button" onClick={() => onAnswer(decision.id, numberChoice(decision, num))}>Confirm</button></div>
      </>
    );
  } else if (cls.layout === "yes_no") {
    const pay = decision.kind === "pay_unless";
    body = (
      <div className="modal-actions">
        {cancel}
        <button type="button" onClick={() => onAnswer(decision.id, { yes: false })}>{pay ? "Don't pay" : "No"}</button>
        <button type="button" onClick={() => onAnswer(decision.id, { yes: true })}>{pay ? "Pay" : "Yes"}</button>
      </div>
    );
  } else {
    const ordering = decision.max > 1;
    const shown = filter.trim() ? decision.options.filter((o) => (o.label + " " + (o.card?.typeLine ?? "") + " " + (o.card?.oracleText ?? "")).toLowerCase().includes(filter.trim().toLowerCase())) : decision.options;
    const ready = canConfirm(decision, picked);
    answerRef.current = () => { if (ready) onAnswer(decision.id, pickChoice(picked)); };
    body = (
      <>
        {decision.options.length > 8 ? <input type="search" aria-label="filter" placeholder="Filter by name, type or text" value={filter} onChange={(e) => setFilter(e.target.value)} /> : null}
        {pile ? <Piles decision={decision} picked={picked} dest={pile} api={api} width={tileWidth(decision)} onToggle={(id) => setPicked(toggleSelection(decision, picked, id))} /> : null}
        <div className="kernel-grid kernel-scroll" hidden={!!pile}>
          {shown.map((o) => (
            <OptionButton key={o.id} o={o} api={api} width={tileWidth(decision)} on={picked.includes(o.id)} order={ordering && picked.includes(o.id) ? picked.indexOf(o.id) : undefined} onClick={() => setPicked(toggleSelection(decision, picked, o.id))} />
          ))}
          {shown.length === 0 ? <em className="kernel-hint">{decision.options.length ? "No option matches the filter." : "Nothing to choose from."}</em> : null}
        </div>
        <p className="kernel-hint">
          {selectionHint(decision, picked)}
          {decision.repeatable && picked.length ? <button type="button" className="kernel-small" onClick={() => setPicked(undoLast(picked))}>Undo last</button> : null}
        </p>
        <div className="modal-actions">
          {onBoard ? <button type="button" onClick={onBoard}>Pick on the board</button> : null}
          {cancel}
          <button type="button" disabled={!ready} onClick={() => onAnswer(decision.id, pickChoice(picked))}>{confirmLabel(decision, picked)}</button>
        </div>
      </>
    );
  }
  return (
    <div className="card-inspector-backdrop kernel-layer" role="dialog" aria-modal="true" aria-label={decision.title} data-decision-id={decision.id}>
      <article className="library-look-modal kernel-dialog" ref={boxRef} tabIndex={-1}>
        <header className="kernel-head">
          {decision.sourceCard ? (
            <div className="kernel-head-card" data-testid="source-card" {...api.handlers(decision.sourceCard)}><CardFull card={decision.sourceCard} art="normal" showText={false} /></div>
          ) : sourceArt ? <img className="kernel-head-card" src={sourceArt} alt={decision.source?.card ?? ""} /> : null}
          <div>
            <p className="eyebrow">{decision.source?.card ? `${decision.source.card} - ${cls.label}` : cls.label}</p>
            <h2>{decision.title}</h2>
            {decision.instruction ? <p className="kernel-hint">{decision.instruction}</p> : null}
            {decision.sourceCard ? <p className="kernel-source-text" data-testid="source-text"><strong>{decision.sourceCard.name}</strong> {decision.sourceCard.manaCost ?? ""} - {decision.sourceCard.typeLine}{decision.sourceCard.oracleText ? ` ${decision.sourceCard.oracleText}` : ""}</p> : null}
          </div>
        </header>
        {body}
      </article>
      <CardPreviewPanel api={api} />
    </div>
  );
}
