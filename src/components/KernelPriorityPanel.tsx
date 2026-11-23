"use client";
// "Your priority" panel of the kernel table (phase 6): shown while the human holds priority at a stop. It says why the game stopped, lists what the kernel says can be
// done right now (castable hand cards with every way of casting: flashback / alternative costs / kicker is asked next; morph; prepared; abilities; land drops) and
// has the Pass button, so a window can always be answered even when the legacy table's own buttons are not shown for it.
import type { KernelGameController } from "./game/kernelController";

const box = { position: "fixed", left: 180, bottom: 130, zIndex: 45, width: 300, maxHeight: "46vh", overflow: "auto", background: "#1c1b22ee", color: "#eee", border: "1px solid #6b6a7a", borderRadius: 10, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13 } as const;
const btn = { padding: "4px 8px", borderRadius: 6, border: "1px solid #6b6a7a", background: "#34333f", color: "#eee", cursor: "pointer", font: "inherit", textAlign: "left" } as const;
const cast = { ...btn, borderColor: "#5fd08a", background: "#1f3a2b" } as const;

const REASON: Record<string, string> = {
  own_turn: "Your step", full_control: "Full Control", hold_once: "Stop Next", stack_response: "Something is on the stack", attacked: "You are being attacked",
  targeted: "It affects you", targeted_me: "It targets you", phase_stop: "Stop set for this step", choice_prompt: "It will ask you to choose"
};

export function describeStopReason(reason: string | undefined): string {
  return reason ? REASON[reason] ?? reason : "";
}

export function KernelPriorityPanel({ controller }: { controller: KernelGameController }) {
  const reason = controller.stopReason();
  if (reason === undefined) return null;
  const table = controller.table();
  const top = table.pendingAction;
  const opts = controller.options();
  const desc = top && "description" in top ? top.description : undefined;
  const stackLine = desc
    ? `${desc.controller}: ${desc.source}${desc.targets.length ? ` -> ${desc.targets.map((t) => t.label).join(", ")}` : ""}`
    : undefined;
  return (
    <div style={box} role="group" aria-label="Your priority" data-testid="kernel-priority-panel">
      <strong>Your priority: {table.session.phase} <span style={{ opacity: 0.7, fontWeight: "normal" }}>({describeStopReason(reason)})</span></strong>
      {stackLine ? <div data-testid="kernel-stack-line">On the stack: {stackLine}{table.stackActions.length ? ` (+${table.stackActions.length} more)` : ""}</div> : null}
      {opts.length ? (
        <>
          <small style={{ opacity: 0.75 }}>You can now:</small>
          {opts.map((a) => (
            <button key={a.id} type="button" style={a.kind === "castSpell" || a.kind === "castPrepared" ? cast : btn} onClick={() => controller.doOption(a.id)} title={a.asks ? `Asks: ${a.asks.replace(/_/g, " ")}` : undefined}>
              {a.label}{a.option && a.option !== "normal" ? ` [${a.option}]` : ""}
            </button>
          ))}
        </>
      ) : <small style={{ opacity: 0.75 }}>Nothing to cast or activate right now.</small>}
      <button type="button" style={{ ...btn, background: "#7a5cd6", textAlign: "center" }} onClick={controller.passPriority}>
        {top ? "Pass priority (let it resolve)" : "Pass priority"}
      </button>
    </div>
  );
}
