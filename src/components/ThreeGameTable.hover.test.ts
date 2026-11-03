import { afterEach, describe, expect, it } from "vitest";
import type { VisibleCard } from "@/lib/types";
import { CARD_HOVER_EVENT, cardHoverHandlers } from "./ThreeGameTable";

// The graveyard / exile / library-search / look-at-top lists feed the same enlarged hover popup as the hand through this window event.
const card = { id: "c1", name: "Servo Token", typeLine: "Token Artifact Creature - Servo", oracleText: "", manaValue: 0, colors: [], role: "token", zone: "graveyard", token: true, imageUris: { normal: "https://example.test/servo.jpg" } } as VisibleCard;

describe("shared card hover popup events", () => {
  const original = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    (globalThis as { window?: unknown }).window = original;
  });

  it("entering a list card announces it (with its token art) and leaving announces the card id", () => {
    const target = new EventTarget();
    (globalThis as { window?: unknown }).window = target;
    const seen: Array<{ card?: VisibleCard; leaveId?: string }> = [];
    target.addEventListener(CARD_HOVER_EVENT, (event) => seen.push((event as CustomEvent).detail));
    const handlers = cardHoverHandlers(card);
    handlers.onMouseEnter();
    handlers.onMouseLeave();
    expect(seen[0].card?.imageUris?.normal).toBe("https://example.test/servo.jpg");
    expect(seen[1]).toEqual({ leaveId: "c1" });
  });

  it("is a no-op outside a browser", () => {
    (globalThis as { window?: unknown }).window = undefined;
    expect(() => cardHoverHandlers(card).onMouseEnter()).not.toThrow();
  });
});
