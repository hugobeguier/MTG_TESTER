"use client";

import { useRef, useState } from "react";

// Throwaway relay debug page (not linked from the app). Open it in two tabs: one hosts, one joins.

async function post(path: string, token: string | null, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export default function MpDebugPage() {
  const [token, setToken] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [name, setName] = useState("Friend");
  const [seatId, setSeatId] = useState("all");
  const [text, setText] = useState('{"hello":"world"}');
  const [intentName, setIntentName] = useState("pass_priority");
  const [log, setLog] = useState<string[]>([]);
  const es = useRef<EventSource | null>(null);
  const seq = useRef(0);
  const rev = useRef(0);

  const add = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${line}`, ...l].slice(0, 200));

  async function create() {
    const r = await post("/api/mp/rooms", null, { hostName: "Host", maxGuests: 3 });
    add(`create -> ${r.status} ${JSON.stringify(r.body)}`);
    if (r.status === 200) {
      setRoomCode(r.body.roomCode);
      setToken(r.body.hostToken);
    }
  }
  async function join() {
    const r = await post(`/api/mp/rooms/${encodeURIComponent(roomCode)}/join`, null, { displayName: name });
    add(`join -> ${r.status} ${JSON.stringify(r.body)}`);
    if (r.status === 200) setToken(r.body.seatToken);
  }
  function connect() {
    es.current?.close();
    const source = new EventSource(`/api/mp/stream?token=${encodeURIComponent(token)}`);
    source.onopen = () => add("stream open");
    source.onmessage = (e) => add(`recv ${e.data}`);
    source.onerror = () => add("stream error/closed (browser will retry)");
    es.current = source;
  }
  function disconnect() {
    es.current?.close();
    es.current = null;
    add("stream closed by user");
  }
  async function intent() {
    const r = await post("/api/mp/intent", token, { name: intentName, args: [], clientSeq: ++seq.current });
    add(`intent -> ${r.status} ${JSON.stringify(r.body)}`);
  }
  async function publish() {
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(text);
    } catch {
      add("snapshot is not valid JSON");
      return;
    }
    const r = await post("/api/mp/publish", token, { toSeatId: seatId, snapshot, rev: ++rev.current });
    add(`publish -> ${r.status} ${JSON.stringify(r.body)}`);
  }
  async function kick() {
    const r = await post("/api/mp/kick", token, { seatId });
    add(`kick -> ${r.status} ${JSON.stringify(r.body)}`);
  }
  async function close() {
    const r = await post("/api/mp/close", token, {});
    add(`close -> ${r.status} ${JSON.stringify(r.body)}`);
  }

  const box = { display: "flex", gap: 8, flexWrap: "wrap" as const, alignItems: "center", margin: "8px 0" };
  return (
    <main style={{ fontFamily: "monospace", padding: 16, maxWidth: 900 }}>
      <h1>Multiplayer relay debug</h1>
      <div style={box}>
        <button onClick={create}>Create room (host)</button>
        <span>room code:</span>
        <input value={roomCode} onChange={(e) => setRoomCode(e.target.value)} size={8} />
        <span>name:</span>
        <input value={name} onChange={(e) => setName(e.target.value)} size={10} />
        <button onClick={join}>Join room (guest)</button>
      </div>
      <div style={box}>
        <span>token:</span>
        <input value={token} onChange={(e) => setToken(e.target.value)} size={50} />
        <button onClick={connect}>Connect stream</button>
        <button onClick={disconnect}>Disconnect</button>
      </div>
      <div style={box}>
        <span>intent name:</span>
        <input value={intentName} onChange={(e) => setIntentName(e.target.value)} size={16} />
        <button onClick={intent}>Send intent (guest)</button>
      </div>
      <div style={box}>
        <span>seat (or &quot;all&quot;):</span>
        <input value={seatId} onChange={(e) => setSeatId(e.target.value)} size={12} />
        <button onClick={publish}>Publish snapshot (host)</button>
        <button onClick={kick}>Kick seat (host)</button>
        <button onClick={close}>Close room (host)</button>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} style={{ width: "100%" }} />
      <h3>Log (newest first)</h3>
      <pre style={{ whiteSpace: "pre-wrap", background: "#111", color: "#ddd", padding: 8, minHeight: 200 }}>
        {log.join("\n")}
      </pre>
    </main>
  );
}
