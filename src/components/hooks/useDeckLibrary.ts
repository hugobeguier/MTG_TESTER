// Owns the setup screen's per-seat deck configs and the saved-deck library (.txt files under decks/, fetched from /api/decks/library on mount).
// The first successful fetch also fills still-empty seats with the default decks. defaultDecksApplied is returned because loading a saved game
// sets it (the loaded game's seats must not be overwritten by a late library response).
import { useEffect, useRef, useState } from "react";
import type { PlayerSeat } from "@/lib/types";
import { applyDefaultDecks, createInitialConfigs, type SavedDeck, type SeatConfig } from "@/components/DeckSetup";

export function useDeckLibrary(initialSeats: PlayerSeat[], options: { emptyNonHostSeats?: boolean } = {}) {
  const [configs, setConfigs] = useState<SeatConfig[]>(() => createInitialConfigs(initialSeats, options));
  // Saved decks (.txt files under decks/) offered in each seat's "Load saved deck" dropdown. The first successful load
  // also fills still-empty seats with the default Foundations decks (see applyDefaultDecks).
  const [deckLibrary, setDeckLibrary] = useState<SavedDeck[]>([]);
  const defaultDecksApplied = useRef(false);
  useEffect(() => {
    fetch("/api/decks/library")
      .then((response) => (response.ok ? response.json() : []))
      .then((decks: SavedDeck[]) => {
        setDeckLibrary(decks);
        if (defaultDecksApplied.current) return;
        defaultDecksApplied.current = true;
        setConfigs((current) => applyDefaultDecks(current, decks));
      })
      .catch(() => {});
  }, []);
  return { configs, setConfigs, deckLibrary, defaultDecksApplied };
}
