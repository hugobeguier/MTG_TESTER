// React home for the serializable PendingDecision model in src/engine/decisions.ts (same pattern as useStackState: useState + always-current ref,
// `apply` assigns the ref synchronously then mirrors into state). One decision per kind, NOT one global slot: a mana choice (tapping a land is
// allowed while a prompt is open) can legitimately be open at the same time as a block choice.

import { useMemo, useRef, useState } from "react";
import type { BlockChoiceState, ManaChoiceState } from "@/engine/flowTypes";
import { decisionIdFor, openDecision, type DecisionKind, type PendingDecision } from "@/engine/decisions";

export type DecisionSlots = Partial<Record<DecisionKind, PendingDecision>>;
type OfKind<K extends DecisionKind> = Extract<PendingDecision, { kind: K }>;

export interface DecisionStateHandle {
  slots: DecisionSlots;
  ref: { current: DecisionSlots };
  apply: (fn: (s: DecisionSlots) => DecisionSlots) => void;
  // Opens a decision; a second open of the same kind is ignored (warned in dev) and the existing one returned.
  open: (decision: PendingDecision) => PendingDecision;
  clear: (kind: DecisionKind) => void;
  hasOpen: boolean;
  nextId: () => string;
  // Legacy-shaped views for existing consumers (referentially stable while the decision is unchanged).
  manaChoice: ManaChoiceState | undefined;
  blockChoice: BlockChoiceState | undefined;
  // Thin adapters keeping the old setter semantics: undefined clears, a value replaces whatever was open.
  setManaChoice: (choice: ManaChoiceState | undefined) => void;
  setBlockChoice: (choice: BlockChoiceState | undefined) => void;
}

export function useDecisionState(): DecisionStateHandle {
  const [slots, setSlots] = useState<DecisionSlots>({});
  const ref = useRef(slots);
  const counter = useRef(0);
  const apply = (fn: (s: DecisionSlots) => DecisionSlots) => {
    ref.current = fn(ref.current);
    setSlots(ref.current);
  };
  const nextId = () => decisionIdFor(++counter.current);
  const open = (decision: PendingDecision) => {
    const { decision: result, ok } = openDecision(ref.current[decision.kind], decision);
    if (!ok) {
      console.warn(`Decision of kind ${decision.kind} is already open; ignoring the second open.`);
      return result;
    }
    apply((s) => ({ ...s, [decision.kind]: decision }));
    return result;
  };
  const clear = (kind: DecisionKind) => {
    if (!ref.current[kind]) return;
    apply((s) => {
      const { [kind]: _removed, ...rest } = s;
      return rest;
    });
  };
  const manaDecision = slots.mana_color as OfKind<"mana_color"> | undefined;
  const blockDecision = slots.declare_blockers as OfKind<"declare_blockers"> | undefined;
  const manaChoice = useMemo<ManaChoiceState | undefined>(
    () => (manaDecision ? { seatId: manaDecision.seatId, cardId: manaDecision.cardId, cardName: manaDecision.cardName, location: manaDecision.location, choices: manaDecision.choices } : undefined),
    [manaDecision]
  );
  const blockChoice = useMemo<BlockChoiceState | undefined>(
    () => (blockDecision ? { attackerSeatId: blockDecision.attackerSeatId, defenderSeatId: blockDecision.defenderSeatId, attackerCardId: blockDecision.attackerCardId, targetId: blockDecision.targetId } : undefined),
    [blockDecision]
  );
  return {
    slots,
    ref,
    apply,
    open,
    clear,
    hasOpen: Object.keys(slots).length > 0,
    nextId,
    manaChoice,
    blockChoice,
    setManaChoice: (choice) => {
      if (!choice) return clear("mana_color");
      apply((s) => ({ ...s, mana_color: { id: nextId(), kind: "mana_color", seatId: choice.seatId, visibility: "private", sourceCardId: choice.cardId, sourceCardName: choice.cardName, cardId: choice.cardId, cardName: choice.cardName, location: choice.location, choices: choice.choices } }));
    },
    setBlockChoice: (choice) => {
      if (!choice) return clear("declare_blockers");
      apply((s) => ({ ...s, declare_blockers: { id: nextId(), kind: "declare_blockers", seatId: choice.defenderSeatId, visibility: "public", attackerSeatId: choice.attackerSeatId, defenderSeatId: choice.defenderSeatId, attackerCardId: choice.attackerCardId, targetId: choice.targetId } }));
    }
  };
}
