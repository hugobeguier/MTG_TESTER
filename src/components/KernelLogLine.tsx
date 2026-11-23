"use client";
// A game-log line whose card names (of cards the viewer can see) show the full card on hover: the same enlarged preview as hand cards (window event "mtg-card-hover").
import { useMemo } from "react";
import type { GameSession, VisibleCard } from "@/lib/types";
import { splitCardNames, visibleCardsByName } from "./game/logCards";

const HOVER = "mtg-card-hover"; // = CARD_HOVER_EVENT in ThreeGameTable (not imported: that module imports this one)
const fire = (detail: object) => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(HOVER, { detail })); };

export function KernelLogLine({ message, session }: { message: string; session: GameSession }) {
  const cards = useMemo(() => visibleCardsByName(session), [session]);
  const parts = splitCardNames(message, cards);
  return (
    <>
      {parts.map((p, i) => p.card ? (
        <span key={i} className="log-card-name kernel-log-card" onMouseEnter={() => fire({ card: p.card as VisibleCard })} onMouseLeave={() => fire({ leaveId: p.card!.id })}>{p.text}</span>
      ) : <span key={i}>{p.text}</span>)}
    </>
  );
}
