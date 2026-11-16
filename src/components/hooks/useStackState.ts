// React home for the plain-data stack/priority state in src/engine/stack.ts.
// Owns the useState plus an always-current ref: every change is applied to the ref synchronously (so timer/closure callers
// reading `ref.current` immediately see it) and then mirrored into React state for rendering. The transitions themselves are pure (stack.ts).

import { useRef, useState } from "react";
import type { PendingAction } from "@/engine/types";
import { pushToStack, removeFromStack, restoreStack, snapshotStack, updateOnStack, type StackSnapshotFields, type StackState } from "@/engine/stack";

export interface StackStateHandle {
  state: StackState;
  ref: { current: StackState };
  apply: (fn: (s: StackState) => StackState) => void;
  replaceStack: (next: PendingAction[]) => void;
  push: (action: PendingAction) => void;
  update: (action: PendingAction) => void;
  remove: (id: string) => PendingAction[];
  setPending: (action: PendingAction | undefined) => void;
  setPasses: (passes: string[]) => void;
  setPrioritySeatId: (seatId: string | undefined) => void;
  setActiveSeatId: (seatId: string | undefined) => void;
  snapshot: () => StackSnapshotFields;
  // Loads a save: seat/passes from the snapshot (a missing seat falls back to `fallbackSeatId`); pending and stack are emptied.
  restore: (snap: StackSnapshotFields, fallbackSeatId: string) => void;
}

export function useStackState(initial: { activeSeatId?: string; prioritySeatId?: string }): StackStateHandle {
  const [state, setState] = useState<StackState>(() => ({ activeSeatId: initial.activeSeatId, prioritySeatId: initial.prioritySeatId, pending: undefined, stack: [], passes: [] }));
  const ref = useRef(state);
  const apply = (fn: (s: StackState) => StackState) => {
    ref.current = fn(ref.current);
    setState(ref.current);
  };
  return {
    state,
    ref,
    apply,
    replaceStack: (next) => apply((s) => ({ ...s, stack: next })),
    push: (action) => apply((s) => pushToStack(s, action)),
    update: (action) => apply((s) => updateOnStack(s, action)),
    remove: (id) => {
      const { state: next, remaining } = removeFromStack(ref.current, id);
      apply(() => next);
      return remaining;
    },
    setPending: (action) => apply((s) => ({ ...s, pending: action })),
    setPasses: (passes) => apply((s) => ({ ...s, passes })),
    setPrioritySeatId: (seatId) => apply((s) => ({ ...s, prioritySeatId: seatId })),
    setActiveSeatId: (seatId) => apply((s) => ({ ...s, activeSeatId: seatId })),
    snapshot: () => snapshotStack(ref.current),
    restore: (snap, fallbackSeatId) =>
      apply(() => restoreStack({ ...snap, activeSeatId: snap.activeSeatId ?? fallbackSeatId, prioritySeatId: snap.prioritySeatId ?? fallbackSeatId }))
  };
}
