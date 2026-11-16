"use client";

import { useEffect, useState } from "react";
import { RemoteTable } from "@/components/RemoteTable";
import { useMpGuest } from "@/components/hooks/useMpGuest";

// Friend's page: enter the room code + a name, then watch the host's table live (read-only spectator in M3).
export default function MpJoinPage() {
  const guest = useMpGuest();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("code");
    if (fromUrl) setCode(fromUrl.toUpperCase());
  }, []);

  const joined = guest.status !== "idle" && guest.status !== "error" && guest.status !== "closed" && guest.status !== "joining";
  const hostName = guest.snapshot?.hostName ?? "the host";

  if (guest.snapshot && guest.status !== "closed" && guest.status !== "error") {
    return (
      <>
        {guest.status === "reconnecting" ? <Banner>Connection lost - reconnecting...</Banner> : null}
        <RemoteTable snapshot={guest.snapshot} />
      </>
    );
  }

  const box: React.CSSProperties = { maxWidth: 420, margin: "10vh auto", padding: 20, fontFamily: "system-ui, sans-serif", color: "#eee" };
  return (
    <main style={box}>
      <h1>Join a game</h1>
      {guest.status === "closed" ? <p>The room was closed by the host.</p> : null}
      {guest.status === "error" ? <p style={{ color: "#f88" }}>{guest.error}</p> : null}
      {joined ? (
        <p>
          {guest.status === "reconnecting" ? "Connection lost - reconnecting..." : `Spectating ${hostName}'s game - waiting for the host to start`}
          <br />
          <button type="button" onClick={guest.leave}>Leave</button>
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void guest.join(code, name);
          }}
        >
          <label>
            Room code <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} autoFocus />
          </label>
          <br />
          <label>
            Your name <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </label>
          <br />
          <button type="submit" disabled={!code.trim() || guest.status === "joining"}>
            {guest.status === "joining" ? "Joining..." : "Join"}
          </button>
        </form>
      )}
    </main>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return <div style={{ position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: "#833", color: "#fff", padding: "4px 12px", borderRadius: 6 }}>{children}</div>;
}
