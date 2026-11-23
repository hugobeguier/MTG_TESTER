import type { VisibleCard } from "@/lib/types";

/** One door of a Room as the renderers show it (pure view model; the lock overlay on the 3D card, the inspector and the previews all read this). */
export interface RoomDoorView {
  /** 0 = top / first door, 1 = bottom / second door */
  index: number;
  name: string;
  manaCost?: string;
  locked: boolean;
  /** accessible text (never colour-only): "locked door: Secret Arcade" / "unlocked door: ..." */
  ariaLabel: string;
}

/**
 * The doors of a Room permanent with their lock state, or undefined when the card is not a Room or has no door state (a Room anywhere but the
 * battlefield has no designations, CR 709.5c, so nothing is locked or unlocked). `unlockedFaceIndices` is the legacy field: the kernel fills it
 * for Rooms on the battlefield (an empty array = both doors locked).
 */
export function roomDoorViews(card: Pick<VisibleCard, "faces" | "unlockedFaceIndices">): RoomDoorView[] | undefined {
  const faces = card.faces;
  if (!faces || faces.length !== 2 || !faces.every((f) => /\bRoom\b/.test(f.typeLine))) return undefined;
  if (!card.unlockedFaceIndices) return undefined;
  const open = new Set(card.unlockedFaceIndices);
  return faces.map((f, index) => {
    const locked = !open.has(index);
    return { index, name: f.name, manaCost: f.manaCost, locked, ariaLabel: `${locked ? "locked" : "unlocked"} door: ${f.name}` };
  });
}

/** Only the locked doors (what the overlays draw a padlock on). */
export const lockedDoors = (card: Pick<VisibleCard, "faces" | "unlockedFaceIndices">): RoomDoorView[] => roomDoorViews(card)?.filter((d) => d.locked) ?? [];
