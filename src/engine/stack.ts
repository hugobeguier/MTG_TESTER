// Pure stack / priority state, mirroring the transitions AppFlow.tsx currently performs with React state
// (pushStackAction, removeStackAction, beginPendingAction, resumeStackAction, passPriority, resolvePendingActionNow).
// Plain data in, new plain data out: nothing here mutates its inputs, touches React, the DOM or timers, and nothing consumes it yet.
// Shape: the top-of-stack item is in BOTH `pending` (the open priority window) and `stack`; a "phase" action has a window but is never on the stack.
// Who must pass is decided by src/engine/priority.ts; the seat-level "can respond" predicate is injected through PriorityCtx.

import type { PlayerSeat } from "@/lib/types";
import type { PendingAction } from "@/engine/types";
import { isStackAction, nextPrioritySeatIdWithPredicate as nextPrioritySeatId, pendingActionRequiredPassesWithPredicate as pendingActionRequiredPasses, type CanReceivePriority } from "@/engine/priority";

export interface StackState {
  activeSeatId?: string;
  prioritySeatId?: string;
  pending?: PendingAction;
  stack: PendingAction[];
  passes: string[];
}

export interface PriorityCtx {
  seats: PlayerSeat[];
  canReceivePriority: CanReceivePriority;
}

export interface StackSnapshotFields {
  activeSeatId?: string;
  prioritySeatId?: string;
  priorityPasses: string[];
}

export function initialStackState(activeSeatId?: string): StackState {
  return { activeSeatId, prioritySeatId: activeSeatId, pending: undefined, stack: [], passes: [] };
}

// pushStackAction: only spells/triggers go on the stack; an id already present is ignored.
export function pushToStack(state: StackState, action: PendingAction): StackState {
  if (!isStackAction(action)) return state;
  if (state.stack.some((item) => item.id === action.id)) return state;
  return { ...state, stack: [...state.stack, action] };
}

export function updateOnStack(state: StackState, action: PendingAction): StackState {
  return { ...state, stack: state.stack.map((item) => (item.id === action.id ? action : item)) };
}

export function removeFromStack(state: StackState, id: string): { state: StackState; remaining: PendingAction[] } {
  const remaining = state.stack.filter((item) => item.id !== id);
  return { state: { ...state, stack: remaining }, remaining };
}

// beginPendingAction / resumeStackAction: put the action on the stack (a no-op when it is already there, as on resume or for a phase action),
// then either auto-resolve when nobody is required to pass, or open the window with the actor getting priority first (rule 117.3b).
export function openWindow(
  state: StackState,
  action: PendingAction,
  ctx: PriorityCtx
): { state: StackState; requiredPasses: string[]; autoResolve: boolean } {
  const pushed = pushToStack(state, action);
  const requiredPasses = pendingActionRequiredPasses(ctx.seats, action, ctx.canReceivePriority);
  if (requiredPasses.length === 0) return { state: pushed, requiredPasses, autoResolve: true };
  return {
    state: {
      ...pushed,
      pending: action,
      passes: [],
      prioritySeatId: nextPrioritySeatId(ctx.seats, action.actorSeatId, [], action, ctx.canReceivePriority)
    },
    requiredPasses,
    autoResolve: false
  };
}

// passPriority: with no window open priority just moves to the next seat; otherwise the holder's pass is recorded and, once every
// required seat has passed, the pending action is returned to resolve; if not, priority moves to the next required seat still to pass.
export function passPriority(state: StackState, ctx: PriorityCtx): { state: StackState; resolve?: PendingAction } {
  const { pending } = state;
  if (!pending) {
    const index = Math.max(0, ctx.seats.findIndex((seat) => seat.id === state.prioritySeatId));
    const nextSeat = ctx.seats[(index + 1) % ctx.seats.length];
    return { state: { ...state, prioritySeatId: nextSeat?.id ?? state.prioritySeatId } };
  }
  const requiredPasses = pendingActionRequiredPasses(ctx.seats, pending, ctx.canReceivePriority);
  const passes = state.prioritySeatId === undefined ? state.passes : Array.from(new Set([...state.passes, state.prioritySeatId]));
  if (requiredPasses.every((seatId) => passes.includes(seatId))) return { state, resolve: pending };
  return {
    state: { ...state, passes, prioritySeatId: nextPrioritySeatId(ctx.seats, pending.actorSeatId, passes, pending, ctx.canReceivePriority) }
  };
}

// resolvePendingActionNow: the window closes and passes reset; a spell/trigger leaves the stack and the remainder is returned
// (the caller then reopens the new top). A phase action was never on the stack, so it leaves it untouched.
export function resolveTop(state: StackState, id: string): { state: StackState; remaining: PendingAction[] } {
  const cleared: StackState = { ...state, pending: undefined, passes: [] };
  return removeFromStack(cleared, id);
}

export function returnPriorityToActor(state: StackState, seatId: string): StackState {
  return { ...state, prioritySeatId: seatId };
}

// New turn: the given seat becomes the active player and holds priority.
export function setActivePlayer(state: StackState, seatId: string): StackState {
  return { ...state, activeSeatId: seatId, prioritySeatId: seatId };
}

export function clearStack(state: StackState): StackState {
  return { ...state, pending: undefined, stack: [], passes: [] };
}

// GameSnapshot (src/lib/saveGame.ts) stores only these flat fields; saves are taken at clean stops, so the stack itself is empty.
export function snapshotStack(state: StackState): StackSnapshotFields {
  return { activeSeatId: state.activeSeatId, prioritySeatId: state.prioritySeatId, priorityPasses: [...state.passes] };
}

export function restoreStack(snapshot: StackSnapshotFields): StackState {
  return { activeSeatId: snapshot.activeSeatId, prioritySeatId: snapshot.prioritySeatId, pending: undefined, stack: [], passes: [...snapshot.priorityPasses] };
}
