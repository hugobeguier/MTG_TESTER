// Pure timing for the phased-out card animation (ThreeGameTable.addPhaseVisual): 0 = solid, 1 = fully phased out.
export const PHASE_ANIM_MS = 1100;
export interface PhaseTween {
  from: number;
  to: number;
  start: number;
}

export function phaseProgress(tween: PhaseTween | undefined, now: number, target: number): number {
  if (!tween) return target;
  const t = Math.min(1, Math.max(0, (now - tween.start) / PHASE_ANIM_MS));
  const eased = t * t * (3 - 2 * t);
  return tween.from + (tween.to - tween.from) * eased;
}

/** The tween to use when a card is drawn: unchanged while the flag agrees, a new one from the current level when it flips, none animated the first time a card is seen. */
export function nextPhaseTween(previous: PhaseTween | undefined, now: number, target: number): PhaseTween {
  if (!previous) return { from: target, to: target, start: now - PHASE_ANIM_MS };
  if (previous.to === target) return previous;
  return { from: phaseProgress(previous, now, previous.to), to: target, start: now };
}
