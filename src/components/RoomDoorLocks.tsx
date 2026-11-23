import type { ReactNode } from "react";
import type { VisibleCard } from "@/lib/types";
import { roomDoorViews } from "@/lib/roomDoors";

/** Padlock glyph (shared by the HTML overlays; the 3D table draws the same shape on a canvas). */
export function PadlockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">
      <path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="4.5" y="10" width="15" height="11" rx="2.2" fill="currentColor" stroke="rgba(0,0,0,0.65)" strokeWidth="1" />
      <circle cx="12" cy="14.6" r="1.7" fill="rgba(0,0,0,0.75)" />
      <rect x="11.1" y="15" width="1.8" height="3.4" rx="0.6" fill="rgba(0,0,0,0.75)" />
    </svg>
  );
}

/**
 * Wraps a Room's card art and dims + padlocks each LOCKED half (top = first door, bottom = second door). Renders just the children when the card is not
 * a Room, or has no door state (a Room outside the battlefield has no unlocked / locked designations), or has both doors open: legacy rendering unchanged.
 */
export function RoomArt({ card, children, block }: { card: Pick<VisibleCard, "faces" | "unlockedFaceIndices">; children: ReactNode; block?: boolean }) {
  const doors = roomDoorViews(card);
  if (!doors || doors.every((d) => !d.locked)) return <>{children}</>;
  return (
    <span className={block ? "room-art room-art-block" : "room-art"}>
      {children}
      {doors.map((d) => d.locked ? (
        <span key={d.index} className={`room-door-lock room-door-${d.index === 0 ? "top" : "bottom"}`} role="img" aria-label={`locked door: ${d.name}`} title={`Locked door: ${d.name}${d.manaCost ? ` (unlock cost ${d.manaCost})` : ""}`}>
          <span className="room-door-lock-icon"><PadlockIcon /></span>
        </span>
      ) : null)}
    </span>
  );
}

/** Text rows for the inspector: each door with its state (not colour-only). */
export function RoomDoorStatus({ card }: { card: Pick<VisibleCard, "faces" | "unlockedFaceIndices"> }) {
  const doors = roomDoorViews(card);
  if (!doors) return null;
  return (
    <ul className="room-door-status" aria-label="Room doors">
      {doors.map((d) => (
        <li key={d.index} aria-label={d.ariaLabel}>
          <span className="room-door-status-icon" aria-hidden="true">{d.locked ? <PadlockIcon /> : null}</span>
          <strong>{d.name}</strong> {d.manaCost ? <span>{d.manaCost}</span> : null} <em>{d.locked ? "Locked" : "Unlocked"}</em>
        </li>
      ))}
    </ul>
  );
}
