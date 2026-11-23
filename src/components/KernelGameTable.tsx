"use client";
// The table for a game running on the kernel engine (dev flag ?engine=kernel): the unchanged 3D table fed by the controller's derived TableState and intent API,
// plus the generic decision dialog (the legacy table has no kernel-shaped UI for that).
// Combat uses the LEGACY UI only: attack targets in the card inspector + Continue, the per-attacker block panel; there is no kernel-only declaration bar.
// Priority uses the LEGACY UI only (the stack dock with Pass Priority / Respond Selected, Space to pass, the glowing hand cards); there is no second panel.
import { useEffect, useSyncExternalStore } from "react";
import type { KernelBoardPick } from "./ThreeGameTable";
import { classifyDecision } from "./game/kernelDecisionView";
import type { KernelGameController } from "./game/kernelController";
import { useKernelDriver } from "./game/useKernelGame";
import { ThreeGameTable } from "./ThreeGameTable";
import { GameOverDialog } from "./GameOverDialog";
import { KernelDecisionDialog } from "./KernelDecisionDialog";

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
  const onKernelCardAction = (id: string) => { controller.closeInspect(); controller.doOption(id); };
  return (
    <main className="app-shell game-shell">
      {table.session.status === "complete" ? (
        <GameOverDialog session={table.session} gameStarting={false} setupMessage={undefined} onPlayAgain={onBack} onDismiss={() => undefined} onBackToSetup={onBack} />
      ) : null}
      <button className="game-back-button" type="button" onClick={onBack} aria-label="Back to setup">×</button>
      <div data-testid="kernel-badge" className="kernel-badge">
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
        hoverLogCards
        kernelCastableIds={hints.castable}
        kernelHandReasons={hints.reasons}
        kernelCardActions={(id) => controller.cardActions(id)}
        onKernelCardAction={onKernelCardAction}
        selectedCardCanRespond={controller.selectedCanRespond()}
        selectedCardId={controller.selectedCardId}
        inspectedCard={controller.inspectedCard}
        {...(controller.tableProps() as object)}
        {...(controller.combatProps() as object)}
      />
      {table.decision && !pick ? <KernelDecisionDialog key={table.decision.id} decision={table.decision} onAnswer={controller.answer} sourceArt={controller.decisionSourceArt()} onBoard={classifyDecision(table.decision).board ? () => controller.showList(table.decision!.id, false) : undefined} /> : null}
    </main>
  );
}
