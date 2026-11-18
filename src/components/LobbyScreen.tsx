"use client";
// Friend's LOBBY screen (multiplayer M4 stage 2): shown on /mp/join after joining and before the host starts the game. Lists the seats, lets the
// friend take / leave one and choose a deck (one the host saved, one remembered in this browser, or a newly pasted list). Everything goes to the host
// as intents (lobby_take_seat / lobby_leave_seat / lobby_set_deck); the host validates decks and reports back through the lobby message.
import { useEffect, useState } from "react";
import { MY_DECKS_KEY, parseMyDecks, rememberDeck, type LobbyMessage, type LobbySeatView, type MyDeck } from "@/lib/multiplayer/lobby";

const card: React.CSSProperties = { border: "1px solid #556", borderRadius: 8, padding: 10, marginBottom: 10, background: "rgba(255,255,255,0.04)" };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", marginBottom: 6 };

const SEAT_KIND_TEXT = { agent: "AI agent", open: "Open", friend: "Friend", host: "Host" } as const;
const DECK_TEXT = { empty: "no deck yet", building: "checking deck...", ready: "deck ready", error: "deck has problems" } as const;

function loadMyDecks(): MyDeck[] {
  try {
    return parseMyDecks(localStorage.getItem(MY_DECKS_KEY));
  } catch {
    return [];
  }
}
function saveMyDecks(decks: MyDeck[]) {
  try {
    localStorage.setItem(MY_DECKS_KEY, JSON.stringify(decks));
  } catch {
    /* storage unavailable: decks are just not remembered */
  }
}

export function LobbyScreen({ lobby, roomCode, sendIntent, onLeave }: { lobby: LobbyMessage; roomCode?: string; sendIntent: (name: string, args: unknown[]) => Promise<string | undefined>; onLeave: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [myDecks, setMyDecks] = useState<MyDeck[]>([]);
  const [name, setName] = useState("");
  const [commander, setCommander] = useState("");
  const [deckList, setDeckList] = useState("");
  const [savedId, setSavedId] = useState("");
  useEffect(() => setMyDecks(loadMyDecks()), []);

  const mine = lobby.seats.find((s) => s.you);
  async function send(intentName: string, args: unknown[]) {
    setBusy(true);
    setError(await sendIntent(intentName, args));
    setBusy(false);
  }
  function submitNew(deck: MyDeck) {
    const next = rememberDeck(myDecks, deck);
    setMyDecks(next);
    saveMyDecks(next);
    void send("lobby_set_deck", [{ source: "new", name: deck.name, commander: deck.commander, deckList: deck.deckList }]);
  }
  function forget(deckName: string) {
    const next = myDecks.filter((d) => d.name !== deckName);
    setMyDecks(next);
    saveMyDecks(next);
  }

  const seatLine = (seat: LobbySeatView) => {
    const who = seat.kind === "friend" ? `${seat.takenBy}${seat.connected ? "" : " (disconnected)"}` : seat.kind === "open" ? "open seat" : SEAT_KIND_TEXT[seat.kind];
    return (
      <li key={seat.seatId} style={{ ...card, borderColor: seat.you ? "#7c7" : "#556" }} data-testid={`lobby-seat-${seat.seatId}`}>
        <strong>{seat.label}</strong> - {who}
        {seat.you ? " (you)" : ""}
        {seat.kind === "friend" && seat.deck ? (
          <div style={{ opacity: 0.8 }}>
            {[seat.deck.name, seat.deck.commander].filter(Boolean).join(" / ")} {DECK_TEXT[seat.deck.status]}
          </div>
        ) : null}
        {seat.kind === "open" ? (
          <div>
            <button type="button" disabled={busy} onClick={() => void send("lobby_take_seat", [seat.seatId])}>
              {mine ? "Move here" : "Take this seat"}
            </button>
          </div>
        ) : null}
        {seat.you ? (
          <div>
            <button type="button" disabled={busy} onClick={() => void send("lobby_leave_seat", [])}>
              Leave seat
            </button>
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <main style={{ maxWidth: 560, margin: "4vh auto", padding: 16, fontFamily: "system-ui, sans-serif", color: "#eee" }}>
      <h1 style={{ marginBottom: 4 }}>Game lobby</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        {lobby.hostName}&apos;s room{roomCode ? ` ${roomCode}` : ""}. Take a seat and choose a deck; the host starts the game when everyone is ready.
      </p>
      {lobby.notice || error ? <p style={{ color: "#f88" }}>{error ?? lobby.notice}</p> : null}
      {lobby.seats.length === 0 ? (
        <p data-testid="lobby-no-seats" style={card}>
          The host has not opened a seat yet - ask them to set one to &quot;Open for a friend&quot;.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>{lobby.seats.map(seatLine)}</ul>
      )}

      {mine ? (
        <section aria-label="Choose a deck">
          <h2>Your deck</h2>
          <div style={card} data-testid="lobby-deck-status">
            <strong>{mine.deck ? DECK_TEXT[mine.deck.status] : "no deck yet"}</strong>
            {mine.deck?.name || mine.deck?.commander ? <div>{[mine.deck?.name, mine.deck?.commander].filter(Boolean).join(" / ")}</div> : null}
            {mine.deck?.message ? <div style={{ opacity: 0.8 }}>{mine.deck.message}</div> : null}
            {mine.deck?.errors.map((e) => (
              <div key={e} style={{ color: "#f88" }}>
                {e}
              </div>
            ))}
            {mine.deck?.warnings.map((w) => (
              <div key={w} style={{ color: "#fc8" }}>
                {w}
              </div>
            ))}
          </div>

          <div style={card}>
            <h3 style={{ marginTop: 0 }}>A deck saved on the host</h3>
            <select style={input} value={savedId} onChange={(e) => setSavedId(e.target.value)} aria-label="Host decks">
              <option value="">{lobby.hostDecks.length ? "Choose a deck..." : "The host has no saved decks"}</option>
              {lobby.hostDecks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} - {d.commander}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy || !savedId} onClick={() => void send("lobby_set_deck", [{ source: "saved", id: savedId }])}>
              Use this deck
            </button>
          </div>

          {myDecks.length > 0 ? (
            <div style={card}>
              <h3 style={{ marginTop: 0 }}>Your decks (remembered in this browser)</h3>
              {myDecks.map((d) => (
                <div key={d.name} style={{ marginBottom: 4 }}>
                  {d.name} - {d.commander || "?"}{" "}
                  <button type="button" disabled={busy} onClick={() => submitNew(d)}>
                    Use
                  </button>{" "}
                  <button type="button" onClick={() => forget(d.name)}>
                    Forget
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <form
            style={card}
            onSubmit={(e) => {
              e.preventDefault();
              submitNew({ name: name.trim(), commander: commander.trim(), deckList });
            }}
          >
            <h3 style={{ marginTop: 0 }}>Add a new deck</h3>
            <input style={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Deck name" aria-label="Deck name" />
            <input style={input} value={commander} onChange={(e) => setCommander(e.target.value)} maxLength={120} placeholder="Commander (or put a 'Commander: ...' line in the list)" aria-label="Commander" />
            <textarea style={{ ...input, minHeight: 140 }} value={deckList} onChange={(e) => setDeckList(e.target.value)} maxLength={20000} placeholder={"Commander: Atraxa, Praetors' Voice\n1 Sol Ring\n1 Arcane Signet\n..."} aria-label="Deck list" />
            <button type="submit" disabled={busy || !name.trim() || !deckList.trim()}>
              Validate and use this deck
            </button>
          </form>
        </section>
      ) : null}
      <p>
        <button type="button" onClick={onLeave}>
          Leave room
        </button>
      </p>
    </main>
  );
}
