"use client";
// Renderer of a host's MpSnapshot using the normal ThreeGameTable. Only local UI state (selection, inspected card, picked blockers, minimized choice) lives
// here; everything the host's AppFlow derives for ITS seat (prompts, response buttons, attack targets, stack hints) arrives in `snapshot.prompts` for the
// friend's own seat (lib/multiplayer/seatPrompts.ts), so the table is fed exactly like on the host.
//  * Spectator (no seat): read-only, the host's seat is drawn as "me" with a hidden hand.
//  * Seated friend: THEIR seat is "me" (own hand face-up, camera on their battlefield) and every action goes to the host as an intent (intentProxy.ts +
//    intentSpecs.ts); the host runs the same handler its own click would and answers with the next snapshot (+ `ack` with a reason when it refused).
import { useEffect, useMemo, useState } from "react";
import type { VisibleCard } from "@/lib/types";
import { roomDoorFaces } from "@/engine/casting";
import { isSimpleManaSourcePermanent } from "@/engine/simpleManaSource";
import { DRAG_OVERLAY_TTL_MS, applyDragOverlay, pruneDragOverlay, recordDrag, type DragOverlay } from "@/lib/multiplayer/dragOverlay";
import { createReadOnlySender, handlersFor, type IntentSender } from "@/lib/multiplayer/intentProxy";
import type { MpSnapshot } from "@/lib/multiplayer/snapshot";
import { ThreeGameTable } from "./ThreeGameTable";

const readOnlySender = createReadOnlySender();
const ACK_TOAST_MS = 5000;

const bannerStyle = { position: "fixed", right: 12, zIndex: 9000, background: "rgba(15,18,28,0.9)", color: "#eee", padding: "4px 10px", borderRadius: 6 } as const;

export function RemoteTable({ snapshot, send = readOnlySender }: { snapshot: MpSnapshot; send?: IntentSender }) {
  const [selectedCardId, setSelectedCardId] = useState<string | undefined>();
  const [inspectedCard, setInspectedCard] = useState<VisibleCard | undefined>();
  const [selectedBlockerIds, setSelectedBlockerIds] = useState<string[]>([]);
  const [choiceMinimized, setChoiceMinimized] = useState(false);
  const [toast, setToast] = useState<string | undefined>();
  // Dragging a permanent is local and instant: positions live here until the host's snapshot confirms (or reverts) them; only the drop is sent.
  const [dragOverlay, setDragOverlay] = useState<DragOverlay>({});
  const seated = snapshot.mySeatId !== undefined;
  const handlers = handlersFor(seated ? "player" : "spectator", send);
  const mySeat = snapshot.session.seats.find((seat) => seat.id === snapshot.mySeatId);
  const waiting = snapshot.mulliganWaiting.filter((name) => name !== mySeat?.name);
  const prompts = snapshot.prompts;

  const ackSeqForDrag = snapshot.ack?.seq;
  useEffect(() => {
    setDragOverlay((current) => pruneDragOverlay(current, snapshot.session, snapshot.mySeatId, ackSeqForDrag, Date.now()));
  }, [snapshot, ackSeqForDrag]);
  useEffect(() => {
    if (!Object.values(dragOverlay).some((entry) => entry.dropped)) return;
    const timer = window.setTimeout(() => setDragOverlay((current) => pruneDragOverlay(current, snapshot.session, snapshot.mySeatId, ackSeqForDrag, Date.now())), DRAG_OVERLAY_TTL_MS + 50);
    return () => window.clearTimeout(timer);
  }, [dragOverlay, snapshot, ackSeqForDrag]);
  const shownSession = useMemo(() => applyDragOverlay(snapshot.session, snapshot.mySeatId, dragOverlay), [snapshot.session, snapshot.mySeatId, dragOverlay]);

  // A refused intent comes back as `ack.error` in the next snapshot: say why the click did nothing.
  const ackSeq = snapshot.ack?.seq;
  const ackError = snapshot.ack?.error;
  useEffect(() => {
    if (!ackError) return;
    setToast(ackError);
    const timer = window.setTimeout(() => setToast(undefined), ACK_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [ackSeq, ackError]);

  // The picked blockers belong to one block choice; start clean for the next one (and when it ends).
  const blockKey = prompts?.blockChoice ? JSON.stringify(prompts.blockChoice).length : 0;
  useEffect(() => setSelectedBlockerIds([]), [Boolean(prompts?.blockChoice), blockKey]);
  const ruleKey = (prompts?.ruleChoice as { prompt?: string } | undefined)?.prompt ?? "";
  useEffect(() => setChoiceMinimized(false), [ruleKey, Boolean(prompts?.manaChoice), Boolean(prompts?.libraryLook)]);

  const selectedInfo = selectedCardId ? prompts?.handInfo[selectedCardId] : undefined;
  const lockedRoomDoorFaceIndex = (() => {
    if (!inspectedCard) return undefined;
    const doors = roomDoorFaces(inspectedCard);
    const unlocked = inspectedCard.unlockedFaceIndices ?? [];
    if (!doors || unlocked.length !== 1) return undefined;
    return unlocked[0] === 0 ? 1 : 0;
  })();
  const humanAttackTargets = inspectedCard && prompts?.attackerIds.includes(inspectedCard.id) ? prompts.attackTargets : undefined;

  // A click on one of my own one-click mana sources taps it (the host does it); anything else just opens the inspector, like on the host.
  const onInspectCard = (card: VisibleCard) => {
    if (seated && mySeat) {
      const live = mySeat.board.battlefield.find((item) => item.id === card.id);
      if (live && !live.tapped && (live.name === "Myriad Landscape" || isSimpleManaSourcePermanent(live, mySeat, snapshot.session.seats))) {
        send("onClickPermanent", [live.id]);
        return;
      }
    }
    setInspectedCard(card);
  };

  return (
    <main className="app-shell game-shell">
      {!seated && snapshot.gameStage === "mulligan" ? (
        <div style={{ ...bannerStyle, top: 8 }}>Waiting for {snapshot.mulliganWaiting.join(", ") || snapshot.hostName} to decide on their opening hand</div>
      ) : null}
      {snapshot.pausedFor.length > 0 ? (
        <div role="status" style={{ ...bannerStyle, top: 40, background: "rgba(120,60,10,0.95)" }}>
          Waiting for {snapshot.pausedFor.join(", ")} to reconnect - the game is paused
        </div>
      ) : null}
      {toast ? (
        <div role="alert" style={{ ...bannerStyle, bottom: 140, background: "rgba(140,30,30,0.95)" }}>
          {toast}
        </div>
      ) : null}
      <ThreeGameTable
        {...handlers}
        session={shownSession}
        priorityStopSettings={snapshot.myStops}
        holdPriorityOnce={snapshot.myStops?.holdOnce}
        onMoveBattlefieldCard={(seatId, cardId, position, phase) => {
          if (!seated) return;
          // Mouse-move events only move the card locally; ONE intent goes to the host when it is dropped.
          const seq = phase === "drop" ? send("onMoveBattlefieldCard", [seatId, cardId, position]) : undefined;
          setDragOverlay((current) => recordDrag(current, cardId, position, phase === "drop", Date.now(), typeof seq === "number" ? seq : undefined));
        }}
        prioritySeatId={snapshot.prioritySeatId}
        priorityPasses={snapshot.priorityPasses}
        requiredPasses={snapshot.requiredPasses}
        pendingAction={snapshot.pendingAction}
        stackActions={snapshot.stackActions}
        stackPrompts={prompts?.stackPrompts}
        manaPool={seated ? snapshot.myManaPool : snapshot.hostManaPool}
        // A spectator is always shown "playing" (it cannot decide; the banner above says what is happening); a seated friend gets the real stage.
        gameStage={seated ? snapshot.gameStage : "playing"}
        spectator={!seated}
        guestActing={seated}
        spectatorHandLabel={`${snapshot.hostName}'s hand`}
        humanMulligans={snapshot.mulligans[snapshot.mySeatId ?? snapshot.hostSeatId] ?? 0}
        mulliganReturnCardIds={snapshot.mulligan?.returnCardIds}
        mulliganReturnRequired={snapshot.mulligan?.returnRequired}
        mulliganKept={snapshot.mulligan?.kept}
        mulliganWaitingFor={seated ? waiting : undefined}
        ruleChoice={prompts?.ruleChoice}
        blockChoice={prompts?.blockChoice}
        manaChoice={prompts?.manaChoice}
        myriadTapChoice={prompts?.myriadTapChoice}
        libraryLook={prompts?.libraryLook}
        myriadSearchCards={prompts?.myriadSearchCards}
        basicLandFetchSearch={prompts?.basicLandFetchSearch}
        choiceMinimized={choiceMinimized}
        onSetChoiceMinimized={setChoiceMinimized}
        selectedCardCanRespond={selectedInfo?.canRespond ?? false}
        selectedCardFaceOptions={selectedInfo?.faceOptions}
        lockedRoomDoorFaceIndex={lockedRoomDoorFaceIndex}
        humanAttackTargets={humanAttackTargets}
        selectedCardId={selectedCardId}
        selectedBlockerIds={selectedBlockerIds}
        inspectedCard={inspectedCard}
        onSelectHandCard={(card) => setSelectedCardId((current) => (current === card.id ? undefined : card.id))}
        onInspectCard={onInspectCard}
        onCloseInspectCard={() => setInspectedCard(undefined)}
        onToggleBlocker={(cardId) => setSelectedBlockerIds((current) => (current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId]))}
        onConfirmBlockers={() => seated && send("onConfirmBlockers", [selectedBlockerIds])}
        onRespondWithSelectedCard={() => selectedCardId && seated && send("onRespondWithSelectedCard", [selectedCardId, "hand"])}
      />
    </main>
  );
}
