"use client";
// Host's lobby panel on the multiplayer setup screen: who has joined, which friend seat they hold, their deck status, and Kick / Free seat buttons.
import { useSyncExternalStore } from "react";
import { hostActionsStore } from "@/lib/multiplayer/hostStatusStore";
import { PANEL_SHORTCUT_HINT, mpPanelStore } from "@/lib/multiplayer/panelPrefs";
import { isOpenConfig, isRemoteConfig, openSeatPatch, seatOfSlot } from "@/lib/multiplayer/lobby";
import type { GuestInfo } from "@/lib/multiplayer/protocol";
import type { SeatConfig } from "@/components/DeckSetup";

export const NO_OPEN_SEAT_HINT = "No seat is open for friends: set a seat to \"Open for a friend\" in the setup below.";

export function LobbyHostPanel({ configs, guests, blockers, onUpdateConfig }: { configs: SeatConfig[]; guests: GuestInfo[]; blockers: { seatId: string; reason: string }[]; onUpdateConfig: (seatId: string, patch: Partial<SeatConfig>) => void }) {
  const friendSeats = configs.filter(isRemoteConfig);
  const hidden = useSyncExternalStore(mpPanelStore.subscribe, mpPanelStore.get, mpPanelStore.getServer);
  if (hidden) {
    const attention = guests.some((guest) => !guest.connected) || blockers.length > 0;
    return (
      <button type="button" onClick={() => mpPanelStore.set(false)} title={`Show the multiplayer lobby (${PANEL_SHORTCUT_HINT})`} aria-label="Show multiplayer lobby" style={{ fontSize: 12, padding: "2px 8px" }}>
        Lobby{attention ? " (!)" : ""}
      </button>
    );
  }
  return (
    <div className="saved-games-panel" aria-label="Multiplayer lobby">
      <h3>
        Lobby{" "}
        <button type="button" onClick={() => mpPanelStore.set(true)} title={PANEL_SHORTCUT_HINT} aria-label="Hide multiplayer lobby" style={{ fontSize: 12, marginLeft: 8 }}>
          Hide
        </button>
      </h3>
      <p>
        {friendSeats.length === 0
          ? NO_OPEN_SEAT_HINT
          : blockers.length === 0
            ? "Every friend seat is taken and has a valid deck - you can press PLAY."
            : `Waiting: ${blockers.map((b) => `${configs.find((c) => c.seatId === b.seatId)?.name ?? b.seatId} ${b.reason}`).join("; ")}.`}
      </p>
      <ul>
        {guests.map((guest) => {
          const seat = seatOfSlot(configs, guest.seatId);
          return (
            <li key={guest.seatId} className="saved-games-row">
              <div>
                <strong>{guest.displayName}</strong>
                <span>
                  {guest.connected ? "connected" : "disconnected"} · {seat ? `seat ${seat.name}, ${seat.deck?.validation.legal ? "deck ready" : seat.status === "building" ? "validating deck" : "no valid deck yet"}` : "no seat (spectating)"}
                </span>
              </div>
              <div className="saved-games-row-actions">
                {seat ? (
                  <button type="button" onClick={() => onUpdateConfig(seat.seatId, openSeatPatch())}>
                    Free seat
                  </button>
                ) : null}
                <button type="button" onClick={() => hostActionsStore.get()?.kick(guest.seatId)}>
                  Kick
                </button>
              </div>
            </li>
          );
        })}
        {friendSeats.filter(isOpenConfig).map((seat) => (
          <li key={seat.seatId} className="saved-games-row">
            <div>
              <strong>{seat.name}</strong>
              <span>open for a friend</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
