"use client";
// Small overlay on the multiplayer host page: room code, join URL, connected guests, status. Reads hostStatusStore (fed by game/useMpHost.ts).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { hostGameStore, hostStatusStore } from "@/lib/multiplayer/hostStatusStore";
import { PANEL_SHORTCUT_HINT, collapsedAfterModeChange, mpPanelStore, panelNeedsAttention } from "@/lib/multiplayer/panelPrefs";
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
  const game = useSyncExternalStore(hostGameStore.subscribe, hostGameStore.get, hostGameStore.getServer);
  // One shared flag (also hides the setup-screen lobby panel), remembered in localStorage; Alt+M toggles it; a game starting collapses it.
  const collapsed = useSyncExternalStore(mpPanelStore.subscribe, mpPanelStore.get, mpPanelStore.getServer);
  const open = !collapsed;
  const previousMode = useRef<string | undefined>(undefined);
  useEffect(() => {
    mpPanelStore.set(collapsedAfterModeChange(previousMode.current, game.mode, mpPanelStore.get()));
    previousMode.current = game.mode;
  }, [game.mode]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.code === "KeyM" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        mpPanelStore.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const attention = panelNeedsAttention(state, game.pausedFor);
  const [addresses, setAddresses] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/mp/address")
      .then((r) => r.json())
      .then((b: { addresses?: string[] }) => setAddresses(b.addresses ?? []))
      .catch(() => {});
  }, []);
  const port = typeof window === "undefined" ? "" : window.location.port;
  // Friends cannot use "localhost": show a link per network address of this machine (Hamachi first).
  const joinUrls = state.roomCode ? addresses.map((a) => `http://${a}${port ? `:${port}` : ""}/mp/join?code=${state.roomCode}`) : [];
  const box: React.CSSProperties = { position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: "rgba(15,18,28,0.92)", color: "#eee", border: "1px solid #556", borderRadius: 8, padding: "6px 12px", fontSize: 13, maxWidth: 520, fontFamily: "system-ui, sans-serif" };
  if (!open) {
    // A tiny chip in the corner: out of the way of the table, but a red dot says a friend dropped / the game is paused.
    return (
      <button
        type="button"
        onClick={() => mpPanelStore.set(false)}
        title={`Show multiplayer panel (${PANEL_SHORTCUT_HINT})${attention ? " - a friend is disconnected or there is a connection problem" : ""}`}
        aria-label={`Show multiplayer panel${attention ? " (needs attention)" : ""}`}
        style={{ position: "fixed", top: 6, left: 6, zIndex: 9999, width: 26, height: 20, padding: 0, fontSize: 11, lineHeight: "18px", background: "rgba(15,18,28,0.7)", color: "#cdd", border: "1px solid #556", borderRadius: 10, opacity: 0.75, cursor: "pointer" }}
      >
        MP
        {attention ? <span aria-hidden="true" style={{ position: "absolute", top: -3, right: -3, width: 9, height: 9, borderRadius: "50%", background: "#e03131", border: "1px solid #fff" }} /> : null}
      </button>
    );
  }
  return (
    <div style={box} role="status">
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <strong>Multiplayer host</strong>
        <button type="button" onClick={() => mpPanelStore.set(true)} aria-label="Hide multiplayer panel" title={PANEL_SHORTCUT_HINT}>Hide</button>
      </div>
      <div>{STATUS_TEXT[state.status]}</div>
      {state.roomCode ? (
        <>
          <div>Room code: <strong style={{ fontSize: 20, letterSpacing: 2 }}>{state.roomCode}</strong></div>
          {joinUrls.length > 0 ? (
            <div style={{ wordBreak: "break-all" }}>
              Send your friend this link{joinUrls.length > 1 ? " (the first one is the Hamachi address)" : ""}:
              {joinUrls.map((u) => (
                <div key={u}><code>{u}</code></div>
              ))}
            </div>
          ) : (
            <div style={{ opacity: 0.7 }}>Looking up this machine's network address...</div>
          )}
          <div style={{ opacity: 0.7 }}>Keep this host tab on localhost so the game API works.</div>
        </>
      ) : null}
      {state.error ? <div style={{ color: "#f88" }}>{state.error}</div> : null}
      <div>
        Guests: {state.guests.length === 0 ? "none yet" : state.guests.map((g) => `${g.displayName}${g.connected ? "" : " (disconnected)"}`).join(", ")}
      </div>
    </div>
  );
}
