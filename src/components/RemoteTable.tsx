"use client";
// Read-only renderer of a host's MpSnapshot using the normal ThreeGameTable. Everything the host's AppFlow normally derives (prompts, response
// buttons, attack targets, stack hints) is left unset; only local UI state (selection, inspected card, camera) lives here.
import { useState } from "react";
import type { VisibleCard } from "@/lib/types";
import { createReadOnlySender, handlersFor, type IntentSender } from "@/lib/multiplayer/intentProxy";
import type { MpSnapshot } from "@/lib/multiplayer/snapshot";
import { ThreeGameTable } from "./ThreeGameTable";

const readOnlySender = createReadOnlySender();

export function RemoteTable({ snapshot, send = readOnlySender }: { snapshot: MpSnapshot; send?: IntentSender }) {
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>();
  const [inspectedCard, setInspectedCard] = useState<VisibleCard | undefined>();
  // Spectator (M3): no action handlers at all. M4 passes "player" for a seated guest and gets the intent proxy.
  const handlers = handlersFor(snapshot.viewer === "spectator" ? "spectator" : "player", send);

  return (
    <main className="app-shell game-shell">
      {snapshot.gameStage === "mulligan" ? (
        <div style={{ position: "fixed", top: 8, right: 12, zIndex: 9000, background: "rgba(15,18,28,0.9)", color: "#eee", padding: "4px 10px", borderRadius: 6 }}>
          {snapshot.hostName} is deciding on their opening hand
        </div>
      ) : null}
      <ThreeGameTable
        {...handlers}
        session={snapshot.session}
        prioritySeatId={snapshot.prioritySeatId}
        priorityPasses={snapshot.priorityPasses}
        requiredPasses={snapshot.requiredPasses}
        pendingAction={snapshot.pendingAction}
        stackActions={snapshot.stackActions}
        manaPool={snapshot.hostManaPool}
        // Always "playing" so no mulligan decision UI shows (a spectator cannot decide); the banner above says what is happening.
        gameStage="playing"
        humanMulligans={snapshot.mulligans[snapshot.hostSeatId] ?? 0}
        selectedCardId={selectedCardId}
        inspectedCard={inspectedCard}
        onSelectHandCard={(card) => setSelectedCardId((current) => (current === card.id ? undefined : card.id))}
        onInspectCard={setInspectedCard}
        onCloseInspectCard={() => setInspectedCard(undefined)}
      />
    </main>
  );
}
