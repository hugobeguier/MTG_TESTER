"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeDeckFile } from "../../app/api/decks/library/normalize";

type SavedDeck = { id: string; label: string; commander: string; deckList: string; raw: string };
type Validation = { legal: boolean; errors: string[]; warnings?: string[]; cardCount: number; commander: string };
type CardHit = { name: string; typeLine: string; manaCost?: string };

const NEW_DECK_TEMPLATE = "Commander: \n1 Sol Ring\n1 Arcane Signet\n";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function DeckEditor() {
  const [decks, setDecks] = useState<SavedDeck[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [text, setText] = useState(NEW_DECK_TEMPLATE);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [validation, setValidation] = useState<Validation | undefined>();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CardHit[]>([]);
  const searchSeq = useRef(0);

  const loadLibrary = useCallback(async () => {
    const response = await fetch("/api/decks/library");
    setDecks(response.ok ? ((await response.json()) as SavedDeck[]) : []);
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    const seq = ++searchSeq.current;
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/cards/search?q=${encodeURIComponent(query)}`);
      if (seq === searchSeq.current && response.ok) setHits((await response.json()) as CardHit[]);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  function confirmDiscard() {
    return !dirty || window.confirm("You have unsaved changes. Discard them?");
  }

  function openDeck(id: string) {
    if (!confirmDiscard()) return;
    const deck = decks.find((item) => item.id === id);
    if (!deck) return;
    setSelectedId(deck.id);
    setName(deck.label);
    setText(deck.raw.trim());
    setDirty(false);
    setValidation(undefined);
    setMessage("");
  }

  function newDeck() {
    if (!confirmDiscard()) return;
    setSelectedId(undefined);
    setName("");
    setText(NEW_DECK_TEMPLATE);
    setDirty(false);
    setValidation(undefined);
    setMessage("");
  }

  function edit(next: string) {
    setText(next);
    setDirty(true);
  }

  function addCard(cardName: string) {
    const lines = text.replace(/\s+$/, "").split("\n");
    const matcher = new RegExp(`^(\\d+)\\s+${escapeRegExp(cardName)}\\s*$`, "i");
    const existing = lines.findIndex((line) => matcher.test(line.trim()));
    if (existing >= 0) {
      lines[existing] = lines[existing].replace(/^\s*(\d+)/, (_, count: string) => String(Number(count) + 1));
    } else {
      lines.push(`1 ${cardName}`);
    }
    edit(`${lines.join("\n")}\n`);
    setQuery("");
    setHits([]);
  }

  async function validate() {
    setBusy(true);
    setMessage("Validating...");
    try {
      const { commander, deckList } = normalizeDeckFile(name || "deck", text);
      const response = await fetch("/api/decks/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentName: "Deck editor", commander: commander || "Unknown", deckList })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = (await response.json()) as { deck: { validation: Validation } };
      setValidation(result.deck.validation);
      setMessage(result.deck.validation.legal ? "Deck is legal." : "Deck needs fixes.");
    } catch (error) {
      setMessage(`Could not validate: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const response = await fetch("/api/decks/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: selectedId, name, deckList: text })
      });
      const result = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !result.id) {
        setMessage(result.error ?? "Save failed.");
        return;
      }
      setSelectedId(result.id);
      setDirty(false);
      setMessage(`Saved to ${result.id}. It now appears in the game's "Load saved deck" dropdowns.`);
      await loadLibrary();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selectedId || !window.confirm(`Delete ${selectedId}? This removes the file.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/decks/library?id=${encodeURIComponent(selectedId)}`, { method: "DELETE" });
      setSelectedId(undefined);
      setName("");
      setText(NEW_DECK_TEMPLATE);
      setDirty(false);
      setValidation(undefined);
      setMessage("Deck deleted.");
      await loadLibrary();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="deck-editor">
      <header className="deck-editor-top">
        <div>
          <p className="eyebrow">Deck editor</p>
          <h1>Your decks</h1>
        </div>
        <a className="deck-editor-back" href="/">
          Back to game setup
        </a>
      </header>
      <div className="deck-editor-body">
        <aside className="deck-editor-list">
          <button type="button" onClick={newDeck}>
            + New deck
          </button>
          <ul>
            {decks.map((deck) => (
              <li key={deck.id}>
                <button type="button" className={deck.id === selectedId ? "selected" : ""} onClick={() => openDeck(deck.id)}>
                  <strong>{deck.label}</strong>
                  <span>{deck.commander}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="deck-editor-main">
          <label>
            Deck name {selectedId ? <em>(file: {selectedId} — change the name and Save to rename)</em> : <em>(saved to decks/custom/)</em>}
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setDirty(true);
              }}
              placeholder="My Deck"
            />
          </label>
          <label className="deck-editor-search">
            Add a card
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search card name..." />
            {hits.length > 0 ? (
              <ul>
                {hits.map((hit) => (
                  <li key={hit.name}>
                    <button type="button" onClick={() => addCard(hit.name)}>
                      <strong>{hit.name}</strong>{" "}
                      <span>
                        {hit.manaCost} {hit.typeLine}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </label>
          <label>
            Deck list <em>(first line &quot;Commander: Name&quot;, then &quot;1 Card Name&quot; per line)</em>
            <textarea className="decklist-input deck-editor-text" value={text} onChange={(event) => edit(event.target.value)} spellCheck={false} />
          </label>
          <div className="deck-editor-actions">
            <button type="button" disabled={busy} onClick={validate}>
              Validate
            </button>
            <button type="button" disabled={busy || (!dirty && Boolean(selectedId))} onClick={save}>
              Save{dirty ? " *" : ""}
            </button>
            {selectedId ? (
              <button type="button" disabled={busy} onClick={remove}>
                Delete
              </button>
            ) : null}
          </div>
          {message ? <p className="deck-editor-message">{message}</p> : null}
          {validation ? (
            <div className={`deck-editor-validation ${validation.legal ? "ok" : "bad"}`}>
              <p>
                {validation.commander} — {validation.cardCount} cards
              </p>
              {validation.errors.length > 0 ? (
                <ul>
                  {validation.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              ) : null}
              {validation.warnings?.length ? (
                <ul>
                  {validation.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
