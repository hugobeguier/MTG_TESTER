// Where an Equipment / Aura / Fortification sits relative to the permanent it is attached to on the 3D table (pure; ThreeGameTable applies it).
// The attachment lies BEHIND its host (a lower height, so the host's art is never cut through) and peeks out sideways with a visible strip: Equipment to the
// right, Auras to the left, each further attachment of the same side a little further out and one step lower, so they fan out without touching each other's depth.
// Cards are flat planes on the table; depth is only the height, so a distinct height per attachment is what stops the flicker (z-fighting).

export const HOST_HEIGHT = 0.08;
const HEIGHT_STEP = 0.012;
const MAX_STEPS = 5;
const CARD_WIDTH = 0.72;
const PEEK = 0.17;

export interface AttachmentPlacement {
  /** offset from the host's position (world units, same axes as the table) */
  dx: number;
  dz: number;
  /** height of the plane; always below HOST_HEIGHT and unique per index up to MAX_STEPS */
  y: number;
  /** below the host's (0) so sorting agrees with the depth order */
  renderOrder: number;
}

/** `index` counts the attachments already placed on the same side of the same host; `hostCount` is how many attachments that side has (a crowded side is packed tighter) */
export function attachmentLayout(hostCount: number, index: number, side: "right" | "left"): AttachmentPlacement {
  const step = hostCount > 3 ? 0.08 : 0.13;
  const sign = side === "right" ? 1 : -1;
  const steps = Math.min(index, MAX_STEPS) + 1;
  return {
    dx: sign * (CARD_WIDTH - PEEK + index * step),
    dz: 0.12 + index * 0.03,
    y: HOST_HEIGHT - HEIGHT_STEP * steps,
    renderOrder: -(index + 1)
  };
}
