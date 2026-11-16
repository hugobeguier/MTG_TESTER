// Owns the saved-game list shown in the setup screen's Load panel: refetched from /api/saves whenever the setup screen becomes visible.
// setSavedGames is returned so deleting an entry can drop its row optimistically.
import { useEffect, useState } from "react";
import type { SavedGameSummary } from "@/lib/saveGame";

export function useSavedGames(mode: "setup" | "game") {
  // Saved-game list for the setup screen's Load panel — refetched whenever the setup screen becomes
  // visible (a save/delete made from elsewhere in this same session, or in another tab, should show
  // up without a full page reload).
  const [savedGames, setSavedGames] = useState<SavedGameSummary[]>([]);
  useEffect(() => {
    if (mode !== "setup") return;
    let cancelled = false;
    fetch("/api/saves")
      .then((response) => (response.ok ? response.json() : []))
      .then((list: SavedGameSummary[]) => {
        if (!cancelled) setSavedGames(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mode]);
  return { savedGames, setSavedGames };
}
