"use client";
// Renderer of a host's MpSnapshot using the normal ThreeGameTable. Everything the host's AppFlow normally derives (prompts, response
// buttons, attack targets, stack hints) is left unset; only local UI state (selection, inspected card) lives here.
//  * Spectator (no seat): read-only, the host's seat is drawn as "me" with a hidden hand.
//  * Seated friend: THEIR seat is "me" (own hand face-up, camera on their battlefield). Stage 3: the only thing they can DO is the opening-hand step
//    (Keep / Mulligan / pick cards to shuffle away) through the intent proxy; the hand is selectable and inspectable, every other control is off
//    (ThreeGameTable `guestReadOnly`). Later stages grow ACTING_GUEST_INTENTS and drop `guestReadOnly` per control.
import { useState } from "react";
import type { VisibleCard } from "@/lib/types";
import { createReadOnlySender, handlersFor, type IntentSender } from "@/lib/multiplayer/intentProxy";
import type { MpSnapshot } from "@/lib/multiplayer/snapshot";
import { ThreeGameTable } from "./ThreeGameTable";

const readOnlySender = createReadOnlySender();

export function RemoteTable({ snapshot, send = readOnlySender }: { snapshot: MpSnapshot; send?: IntentSender }) {
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>();
  const [inspectedCard, setInspectedCard] = useState<VisibleCard | undefined>();
  const seated = snapshot.mySeatId !== undefined;
  const handlers = handlersFor(seated ? "player" : "spectator", send);
  const mySeat = snapshot.session.seats.find((seat) => seat.id === snapshot.mySeatId);
  const waiting = snapshot.mulliganWaiting.filter((name) => name !== mySeat?.name);

  return (
    <main className="app-shell game-shell">
      {!seated && snapshot.gameStage === "mulligan" ? (
        <div style={{ position: "fixed", top: 8, right: 12, zIndex: 9000, background: "rgba(15,18,28,0.9)", color: "#eee", padding: "4px 10px", borderRadius: 6 }}>
          Waiting for {snapshot.mulliganWaiting.join(", ") || snapshot.hostName} to decide on their opening hand
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
        manaPool={seated ? snapshot.myManaPool : snapshot.hostManaPool}
        // A spectator is always shown "playing" (it cannot decide; the banner above says what is happening); a seated friend gets the real stage.
        gameStage={seated ? snapshot.gameStage : "playing"}
        spectator={!seated}
        guestReadOnly={seated}
        spectatorHandLabel={`${snapshot.hostName}'s hand`}
        humanMulligans={snapshot.mulligans[snapshot.mySeatId ?? snapshot.hostSeatId] ?? 0}
        mulliganReturnCardIds={snapshot.mulligan?.returnCardIds}
        mulliganReturnRequired={snapshot.mulligan?.returnRequired}
        mulliganKept={snapshot.mulligan?.kept}
        mulliganWaitingFor={seated ? waiting : undefined}
        selectedCardId={selectedCardId}
        inspectedCard={inspectedCard}
        onSelectHandCard={(card) => setSelectedCardId((current) => (current === card.id ? undefined : card.id))}
        onInspectCard={setInspectedCard}
        onCloseInspectCard={() => setInspectedCard(undefined)}
      />
    </main>
  );
}
