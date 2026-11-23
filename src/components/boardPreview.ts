// Pure rules for the Left-Alt battlefield hover preview (the same large preview a hand card gets): which hovered cards may be enlarged.
import type { VisibleCard } from "@/lib/types";

/**
 * The card to enlarge for a hovered battlefield permanent, or undefined when the viewer must not see more than the table already shows.
 * Hidden stubs (role "hidden") and face-down permanents (manifests: the card still carries the real image) are never enlarged. Everything
 * else is already public on the battlefield (the per-seat view in lib/multiplayer/view.ts has stripped what a viewer may not know).
 */
export function battlefieldPreviewCard(card: VisibleCard | undefined, location: string | undefined): VisibleCard | undefined {
  if (!card || location !== "battlefield") return undefined;
  if (card.role === "hidden" || card.faceDownCardName || card.name === "Manifested Creature") return undefined;
  return card;
}

/** Left Alt only (AltGr reports AltRight and must keep working for typing). */
export const isLeftAlt = (event: { code: string }): boolean => event.code === "AltLeft";

/**
 * The card to enlarge for a card shown OUTSIDE the board (decision options, the stack, the log, graveyard / exile piles), by plain hover or Left Alt + hover.
 * Only what the table already shows the viewer: hidden stubs and anonymous face-down cards are never enlarged (they carry no real data anyway).
 */
export function listedPreviewCard(card: VisibleCard | undefined): VisibleCard | undefined {
  if (!card || card.role === "hidden" || card.id.startsWith("hidden:") || card.name === "Hidden card" || card.name === "Face-down card" || card.name === "Face-down creature") return undefined;
  return card;
}
