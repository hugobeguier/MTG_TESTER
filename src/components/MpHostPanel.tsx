"use client";
// Small overlay on the multiplayer host page: room code, join URL, connected guests, status. Reads hostStatusStore (fed by game/useMpHost.ts).
import { useState, useSyncExternalStore } from "react";
import { hostStatusStore } from "@/lib/multiplayer/hostStatusStore";
import type { HostStatus } from "@/lib/multiplayer/connectionState";

const STATUS_TEXT: Record<HostStatus, string> = {
  off: "Multiplayer off",
  creating: "Creating room...",
  waiting: "Room open - waiting for a friend to join",
  live: "Live - spectators are watching",
  reconnecting: "Connection lost - reconnecting...",
  closed: "Room closed",
  error: "Error"
};

export function MpHostPanel() {
  const state = useSyncExternalStore(hostStatusStore.subscribe, hostStatusStore.get, hostStatusStore.getServer);
  const [open, setOpen] = useState(true);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const joinUrl = state.roomCode ? `${origin}/mp/join?code=${state.roomCode}` : "";
  const box: React.CSSProperties = { position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: "rgba(15,18,28,0.92)", color: "#eee", border: "1px solid #556", borderRadius: 8, padding: "6px 12px", fontSize: 13, maxWidth: 520, fontFamily: "system-ui, sans-serif" };
  if (!open) {
    return (
      <div style={box}>
        <button type="button" onClick={() => setOpen(true)}>Multiplayer {state.roomCode ?? ""}</button>
      </div>
    );
  }
  return (
    <div style={box} role="status">
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <strong>Multiplayer host</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label="Minimize multiplayer panel">-</button>
      </div>
      <div>{STATUS_TEXT[state.status]}</div>
      {state.roomCode ? (
        <>
          <div>Room code: <strong style={{ fontSize: 20, letterSpacing: 2 }}>{state.roomCode}</strong></div>
          <div style={{ wordBreak: "break-all" }}>Join page: <code>{joinUrl}</code></div>
          <div style={{ opacity: 0.7 }}>Friends open the same path on your Hamachi address instead of localhost (keep this tab on localhost so the API works).</div>
        </>
      ) : null}
      {state.error ? <div style={{ color: "#f88" }}>{state.error}</div> : null}
      <div>
        Guests: {state.guests.length === 0 ? "none yet" : state.guests.map((g) => `${g.displayName}${g.connected ? "" : " (disconnected)"}`).join(", ")}
      </div>
    </div>
  );
}
