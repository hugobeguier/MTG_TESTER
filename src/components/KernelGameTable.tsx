"use client";
// The table for a game running on the kernel engine (dev flag ?engine=kernel): the unchanged 3D table fed by the controller's derived TableState and intent API,
// plus the two things the legacy table has no kernel-shaped UI for yet: the attack / block declaration bar and the generic decision dialog.
import { useEffect, useSyncExternalStore } from "react";
import type { KernelBoardPick } from "./ThreeGameTable";
import { classifyDecision } from "./game/kernelDecisionView";
import type { KernelGameController } from "./game/kernelController";
import { useKernelDriver } from "./game/useKernelGame";
import { ThreeGameTable } from "./ThreeGameTable";
import { GameOverDialog } from "./GameOverDialog";
import { KernelDecisionDialog } from "./KernelDecisionDialog";
import { KernelPriorityPanel } from "./KernelPriorityPanel";

const bar = { position: "fixed", left: "50%", bottom: 150, transform: "translateX(-50%)", zIndex: 50, background: "#1c1b22ee", color: "#eee", border: "1px solid #6b6a7a", borderRadius: 10, padding: "10px 14px", maxWidth: "min(900px, 94vw)", display: "flex", flexDirection: "column", gap: 8 } as const;
const btn = { padding: "5px 12px", borderRadius: 6, border: "1px solid #6b6a7a", background: "#34333f", color: "#eee", cursor: "pointer", font: "inherit" } as const;
const on = { borderColor: "#e8c04a", background: "#3b3624" } as const;

export function KernelDeclarationBar({ controller }: { controller: KernelGameController }) {
  const d = controller.declaration();
  if (!d) return null;
  if (d.kind === "attackers") {
    const n = Object.keys(d.picks).length;
    return (
      <div style={bar} role="group" aria-label="Declare attackers">
        <strong>Declare attackers</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {d.attackers.map((a) => (
            <span key={a.id} style={{ display: "inline-flex", gap: 4 }}>
              <button type="button" style={{ ...btn, ...(a.id in d.picks ? on : {}) }} aria-pressed={a.id in d.picks} onClick={() => controller.toggleAttacker(a.id)}>{a.name}{a.mustAttack ? " (must attack)" : ""}</button>
              {a.defenders.length > 1 ? (
                <select aria-label={`${a.name} attacks`} value={d.picks[a.id] ?? ""} onChange={(e) => controller.toggleAttacker(a.id, e.target.value || undefined)}>
                  <option value="">-</option>
                  {a.defenders.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              ) : null}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btn} onClick={controller.attackWithAll}>All attack</button>
          <button type="button" style={{ ...btn, background: "#7a5cd6" }} onClick={controller.confirmAttackers}>{n ? `Declare ${n} attacker${n === 1 ? "" : "s"}` : "Declare (no attack)"}</button>
          <button type="button" style={btn} onClick={controller.noAttack}>No attack</button>
        </div>
      </div>
    );
  }
  return (
    <div style={bar} role="group" aria-label="Declare blockers">
      <strong>Declare blockers</strong>
      {d.blockers.map((b) => (
        <label key={b.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {b.name} blocks
          <select value={d.picks[b.id] ?? ""} onChange={(e) => controller.setBlock(b.id, e.target.value || undefined)}>
            <option value="">nothing</option>
            {b.attackers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={{ ...btn, background: "#7a5cd6" }} onClick={controller.confirmBlockers}>Confirm blocks</button>
        <button type="button" style={btn} onClick={controller.passBlocks}>No blocks</button>
      </div>
    </div>
  );
}

/** Enter confirms / Escape cancels a click-on-the-board pick (the dialog handles its own keys) */
function useDecisionKeys(pick: KernelBoardPick | undefined): void {
  useEffect(() => {
    if (!pick) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Enter" && pick.canConfirm) { e.preventDefault(); pick.onConfirm(); }
      else if (e.key === "Escape" && pick.onCancel) { e.preventDefault(); pick.onCancel(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick]);
}

export function KernelGameTable({ controller, onBack }: { controller: KernelGameController; onBack: () => void }) {
  useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
  useKernelDriver(controller);
  const table = controller.table();
  const human = controller.human;
  const thinking = controller.thinkingSeat();
  const degraded = controller.ks.degraded;
  const pick = controller.boardPick();
  const hints = controller.handHints();
  useDecisionKeys(pick);
  return (
    <main className="app-shell game-shell">
      {table.session.status === "complete" ? (
        <GameOverDialog session={table.session} gameStarting={false} setupMessage={undefined} onPlayAgain={onBack} onDismiss={() => undefined} onBackToSetup={onBack} />
      ) : null}
      <button className="game-back-button" type="button" onClick={onBack} aria-label="Back to setup">×</button>
      <div data-testid="kernel-badge" style={{ position: "fixed", top: 6, left: 10, zIndex: 40, fontSize: 11, padding: "2px 8px", borderRadius: 8, background: "#7a5cd6", color: "#fff" }}>
        Kernel engine (dev){degraded ? ` - degraded: ${degraded}` : ""}
      </div>
      <ThreeGameTable
        session={table.session}
        prioritySeatId={table.prioritySeatId}
        pendingAction={table.pendingAction}
        stackActions={table.stackActions}
        requiredPasses={table.requiredPasses}
        priorityPasses={table.priorityPasses}
        manaPool={table.manaPools[human] as never}
        agentThinking={thinking ? { [thinking]: true } : undefined}
        gameStage="playing"
        priorityStopSettings={controller.stops()}
        yielding={controller.isYielding()}
        holdPriorityOnce={controller.isHoldArmed()}
        kernelTurnNumber={table.session.turn}
        kernelStepId={controller.ks.state.turn.phase}
        kernelWaiting={table.decision ? { seatId: human, kind: "choice" } : table.waitingFor ? { seatId: table.waitingFor.player, kind: "choice" } : table.declaring?.players[0] ? { seatId: table.declaring.players[0], kind: table.declaring.kind } : undefined}
        kernelPick={pick}
        kernelCastableIds={hints.castable}
        kernelHandReasons={hints.reasons}
        selectedCardId={controller.selectedCardId}
        inspectedCard={controller.inspectedCard}
        {...(controller.tableProps() as object)}
      />
      <KernelDeclarationBar controller={controller} />
      {table.decision ? null : <KernelPriorityPanel controller={controller} />}
      {table.decision && !pick ? <KernelDecisionDialog key={table.decision.id} decision={table.decision} onAnswer={controller.answer} sourceArt={controller.decisionSourceArt()} onBoard={classifyDecision(table.decision).board ? () => controller.showList(table.decision!.id, false) : undefined} /> : null}
    </main>
  );
}
