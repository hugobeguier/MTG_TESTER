"use client";
// One generic dialog for every decision the kernel asks the human (TableState.decision): pick N of the listed options (targets, discards, modes, colours,
// creature types, ordering), yes / no, a number (X), and the three "split an amount" kinds (damage, mana, counters). It offers only what the kernel listed and
// answers through onAnswer(decisionId, choice) with the id it was RENDERED for; give it key={decision.id} so a new decision starts with a clean state.
// (Clicking highlighted cards on the board for targets is a later refinement: object options show their card art here.)
import { useState } from "react";
import type { Choice } from "@/kernel/engine/types";
import type { DecisionOptionView, DecisionView } from "@/kernel/integration/tableState";

export interface KernelDecisionDialogProps {
  decision: DecisionView;
  onAnswer: (decisionId: string, choice: Choice) => void;
}

const S = {
  backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  box: { background: "#1c1b22", color: "#eee", border: "1px solid #6b6a7a", borderRadius: 10, padding: 16, maxWidth: 760, width: "100%", maxHeight: "86vh", overflow: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.6)" },
  title: { margin: "0 0 4px", fontSize: 18 },
  hint: { margin: "0 0 12px", opacity: 0.8, fontSize: 14 },
  grid: { display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0 12px" },
  opt: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: 6, minWidth: 96, maxWidth: 150, background: "#2a2933", color: "#eee", border: "2px solid #44434f", borderRadius: 8, cursor: "pointer", font: "inherit" },
  optOn: { borderColor: "#e8c04a", background: "#3b3624" },
  img: { width: 96, borderRadius: 6 },
  row: { display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" },
  btn: { padding: "6px 14px", borderRadius: 6, border: "1px solid #6b6a7a", background: "#34333f", color: "#eee", cursor: "pointer", font: "inherit" },
  primary: { background: "#7a5cd6", borderColor: "#9a80f0" },
  num: { width: 70, padding: 4, font: "inherit" }
} as const;

function art(o: DecisionOptionView): string | undefined { return o.card?.imageUris?.small ?? o.card?.imageUris?.normal; }

function OptionButton({ o, order, on, onClick }: { o: DecisionOptionView; order?: number; on: boolean; onClick: () => void }) {
  const src = art(o);
  return (
    <button type="button" style={{ ...S.opt, ...(on ? S.optOn : {}) }} onClick={onClick} aria-pressed={on} title={o.card?.oracleText || o.label}>
      {src ? <img src={src} alt={o.card?.name ?? o.label} style={S.img} /> : null}
      <span>{o.label}</span>
      {order !== undefined ? <strong aria-label="order">#{order + 1}</strong> : null}
    </button>
  );
}

/** numbers keyed by id: damage recipients, mana colours, counter kinds */
function Split({ decision, onAnswer }: KernelDecisionDialogProps) {
  const ids = decision.kind === "assign_damage" ? Object.keys(decision.amounts?.lethal ?? {}).length ? Object.keys(decision.amounts!.lethal) : decision.options.map((o) => o.id)
    : decision.kind === "assign_mana" ? decision.mana?.colors ?? [] : Object.keys(decision.counters?.available ?? {});
  const [vals, setVals] = useState<Record<string, number>>({});
  const sum = ids.reduce((n, id) => n + (vals[id] ?? 0), 0);
  const total = decision.kind === "assign_damage" ? decision.amounts?.total : decision.kind === "assign_mana" ? decision.mana?.total : undefined;
  const ok = total !== undefined ? sum === total : sum >= (decision.counters?.min ?? decision.min) && sum <= (decision.counters?.max ?? decision.max);
  const label = (id: string) => decision.options.find((o) => o.id === id)?.label ?? id;
  return (
    <>
      <div style={S.grid}>
        {ids.map((id) => (
          <label key={id} style={{ ...S.opt, cursor: "default" }}>
            <span>{label(id)}{decision.amounts?.lethal[id] ? ` (lethal ${decision.amounts.lethal[id]})` : ""}</span>
            <input type="number" min={0} max={decision.counters?.available[id] ?? total ?? 99} value={vals[id] ?? 0} style={S.num} onChange={(e) => setVals({ ...vals, [id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          </label>
        ))}
      </div>
      <p style={S.hint}>Assigned {sum}{total !== undefined ? ` of ${total}` : ` (between ${decision.counters?.min ?? decision.min} and ${decision.counters?.max ?? decision.max})`}</p>
      <div style={S.row}>
        <button type="button" style={{ ...S.btn, ...S.primary }} disabled={!ok} onClick={() => onAnswer(decision.id, { assign: Object.fromEntries(ids.filter((id) => (vals[id] ?? 0) > 0).map((id) => [id, vals[id]])) })}>Confirm</button>
      </div>
    </>
  );
}

export function KernelDecisionDialog({ decision, onAnswer }: KernelDecisionDialogProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [num, setNum] = useState<number>(Math.max(0, decision.min));
  const header = (
    <>
      <h3 style={S.title}>{decision.title}</h3>
      {decision.instruction ? <p style={S.hint}>{decision.instruction}</p> : null}
    </>
  );
  const cancel = decision.cancellable ? <button type="button" style={S.btn} onClick={() => onAnswer(decision.id, { cancel: true })}>Cancel</button> : null;
  let body: React.ReactNode;
  if (decision.kind === "assign_damage" || decision.kind === "assign_mana" || decision.kind === "assign_counters") {
    body = <Split decision={decision} onAnswer={onAnswer} />;
  } else if (decision.numeric) {
    body = (
      <>
        <div style={S.grid}><input type="number" aria-label="number" min={decision.min} max={decision.max} value={num} style={S.num} onChange={(e) => setNum(Math.min(decision.max, Math.max(decision.min, Math.floor(Number(e.target.value) || 0))))} /> <span style={S.hint}>({decision.min} to {decision.max})</span></div>
        <div style={S.row}>{cancel}<button type="button" style={{ ...S.btn, ...S.primary }} onClick={() => onAnswer(decision.id, { number: num })}>Confirm</button></div>
      </>
    );
  } else if (decision.kind === "choose_yes_no" || decision.kind === "pay_unless") {
    body = (
      <div style={S.row}>
        {cancel}
        <button type="button" style={S.btn} onClick={() => onAnswer(decision.id, { yes: false })}>{decision.kind === "pay_unless" ? "Don't pay" : "No"}</button>
        <button type="button" style={{ ...S.btn, ...S.primary }} onClick={() => onAnswer(decision.id, { yes: true })}>{decision.kind === "pay_unless" ? "Pay" : "Yes"}</button>
      </div>
    );
  } else {
    const ordering = decision.kind === "order_triggers" || decision.kind === "order_replacements";
    const toggle = (id: string) => {
      if (decision.repeatable) { setPicked(picked.length < decision.max ? [...picked, id] : picked); return; }
      if (picked.includes(id)) setPicked(picked.filter((x) => x !== id));
      else setPicked(decision.max === 1 ? [id] : picked.length < decision.max ? [...picked, id] : picked);
    };
    const ready = picked.length >= decision.min && picked.length <= decision.max;
    body = (
      <>
        <div style={S.grid}>
          {decision.options.map((o) => (
            <OptionButton key={o.id} o={o} on={picked.includes(o.id)} order={ordering || decision.max > 1 ? (picked.includes(o.id) ? picked.indexOf(o.id) : undefined) : undefined} onClick={() => toggle(o.id)} />
          ))}
        </div>
        <p style={S.hint}>Selected {picked.length} (choose {decision.min === decision.max ? decision.min : `${decision.min} to ${decision.max}`}){decision.repeatable && picked.length ? <button type="button" style={{ ...S.btn, marginLeft: 8 }} onClick={() => setPicked(picked.slice(0, -1))}>Undo last</button> : null}</p>
        <div style={S.row}>
          {cancel}
          <button type="button" style={{ ...S.btn, ...S.primary }} disabled={!ready} onClick={() => onAnswer(decision.id, { ids: picked })}>{decision.min === 0 && picked.length === 0 ? "None" : "Confirm"}</button>
        </div>
      </>
    );
  }
  return (
    <div style={S.backdrop} role="dialog" aria-modal="true" aria-label={decision.title} data-decision-id={decision.id}>
      <div style={S.box}>{header}{body}</div>
    </div>
  );
}
