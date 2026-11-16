// React home for the serializable PendingDecision model in src/engine/decisions.ts (same pattern as useStackState: useState + always-current ref,
// `apply` assigns the ref synchronously then mirrors into state). One decision per slot key, NOT one global slot: a mana choice (tapping a land is
// allowed while a prompt is open) can legitimately be open at the same time as a block choice, and the library look plus the three library searches
// (manual / myriad / basic fetch) were independent prompts that never cleared each other, so each keeps its own slot (see slotKey).

import { useMemo, useRef, useState } from "react";
import type { BasicLandFetchSearchState, BlockChoiceState, LibraryLookState, ManaChoiceState, ManualLibrarySearchState, MyriadSearchState, MyriadTapChoiceState } from "@/engine/flowTypes";
import { decisionIdFor, openDecision, slotKey, type LibrarySearchFlavor, type PendingDecision, type SlotKey } from "@/engine/decisions";

export type DecisionSlots = Partial<Record<SlotKey, PendingDecision>>;
type OfKind<K extends PendingDecision["kind"]> = Extract<PendingDecision, { kind: K }>;
type Setter<T> = (value: T | undefined | ((current: T | undefined) => T | undefined)) => void;

export interface DecisionStateHandle {
  slots: DecisionSlots;
  ref: { current: DecisionSlots };
  apply: (fn: (s: DecisionSlots) => DecisionSlots) => void;
  // Opens a decision; a second open into the same slot is ignored (warned in dev) and the existing one returned.
  open: (decision: PendingDecision) => PendingDecision;
  clear: (key: SlotKey) => void;
  hasOpen: boolean;
  nextId: () => string;
  // Legacy-shaped views for existing consumers (referentially stable while the decision is unchanged).
  manaChoice: ManaChoiceState | undefined;
  blockChoice: BlockChoiceState | undefined;
  libraryLook: LibraryLookState | undefined;
  manualLibrarySearch: ManualLibrarySearchState | undefined;
  myriadSearch: MyriadSearchState | undefined;
  myriadTapChoice: MyriadTapChoiceState | undefined;
  basicLandFetchSearch: BasicLandFetchSearchState | undefined;
  // Thin adapters keeping the old setter semantics: undefined clears, a value replaces whatever was open (setLibraryLook also takes an updater).
  setManaChoice: (choice: ManaChoiceState | undefined) => void;
  setBlockChoice: (choice: BlockChoiceState | undefined) => void;
  setLibraryLook: Setter<LibraryLookState>;
  setManualLibrarySearch: Setter<ManualLibrarySearchState>;
  setMyriadSearch: Setter<MyriadSearchState>;
  setMyriadTapChoice: Setter<MyriadTapChoiceState>;
  setBasicLandFetchSearch: Setter<BasicLandFetchSearchState>;
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
    const key = slotKey(decision);
    const { decision: result, ok } = openDecision(ref.current[key], decision);
    if (!ok) {
      console.warn(`Decision ${key} is already open; ignoring the second open.`);
      return result;
    }
    apply((s) => ({ ...s, [key]: decision }));
    return result;
  };
  const clear = (key: SlotKey) => {
    if (!ref.current[key]) return;
    apply((s) => {
      const { [key]: _removed, ...rest } = s;
      return rest;
    });
  };
  const manaDecision = slots.mana_color as OfKind<"mana_color"> | undefined;
  const blockDecision = slots.declare_blockers as OfKind<"declare_blockers"> | undefined;
  const lookDecision = slots.library_look as OfKind<"library_look"> | undefined;
  const manualDecision = slots["library_search:manual"] as OfKind<"library_search"> | undefined;
  const myriadDecision = slots["library_search:myriad"] as OfKind<"library_search"> | undefined;
  const fetchDecision = slots["library_search:basic_land_fetch"] as OfKind<"library_search"> | undefined;
  const tapDecision = slots.myriad_tap as OfKind<"myriad_tap"> | undefined;
  const manaChoice = useMemo<ManaChoiceState | undefined>(
    () => (manaDecision ? { seatId: manaDecision.seatId, cardId: manaDecision.cardId, cardName: manaDecision.cardName, location: manaDecision.location, choices: manaDecision.choices } : undefined),
    [manaDecision]
  );
  const blockChoice = useMemo<BlockChoiceState | undefined>(
    () => (blockDecision ? { attackerSeatId: blockDecision.attackerSeatId, defenderSeatId: blockDecision.defenderSeatId, attackerCardId: blockDecision.attackerCardId, targetId: blockDecision.targetId } : undefined),
    [blockDecision]
  );
  const libraryLook = lookDecision?.look; // the stored LibraryLookState itself: same object identity the old useState held
  const manualLibrarySearch = useMemo<ManualLibrarySearchState | undefined>(
    () => (manualDecision ? { seatId: manualDecision.seatId, destination: manualDecision.destination ?? "hand", ...(manualDecision.tapped !== undefined ? { tapped: manualDecision.tapped } : {}) } : undefined),
    [manualDecision]
  );
  const myriadSearch = useMemo<MyriadSearchState | undefined>(
    () => (myriadDecision ? { seatId: myriadDecision.seatId, sourceCardId: myriadDecision.sourceCardId ?? "" } : undefined),
    [myriadDecision]
  );
  const myriadTapChoice = useMemo<MyriadTapChoiceState | undefined>(
    () => (tapDecision ? { seatId: tapDecision.seatId, cardId: tapDecision.cardId, cardName: tapDecision.cardName } : undefined),
    [tapDecision]
  );
  const basicLandFetchSearch = useMemo<BasicLandFetchSearchState | undefined>(
    () => (fetchDecision ? { seatId: fetchDecision.seatId, sourceCardId: fetchDecision.sourceCardId ?? "", sourceCardName: fetchDecision.sourceCardName ?? "" } : undefined),
    [fetchDecision]
  );
  // Setters for the five moved prompts. Stable identity like the old useState setters: they only touch the stable ref / setSlots / counter.
  const moved = useMemo(() => {
    const put = (key: SlotKey, decision: PendingDecision | undefined) => (decision ? apply((s) => ({ ...s, [key]: decision })) : clear(key));
    const searchSetter = <T,>(flavor: LibrarySearchFlavor, fields: (v: T) => { seatId: string } & Partial<OfKind<"library_search">>): Setter<T> => (value) => {
      const next = typeof value === "function" ? (value as (c: T | undefined) => T | undefined)(undefined) : value;
      put(`library_search:${flavor}`, next ? { id: nextId(), kind: "library_search", flavor, visibility: "private", ...fields(next) } : undefined);
    };
    const setLibraryLook: Setter<LibraryLookState> = (value) => {
      const current = (ref.current.library_look as OfKind<"library_look"> | undefined)?.look;
      const next = typeof value === "function" ? value(current) : value;
      if (next === current) return;
      put("library_look", next ? { id: nextId(), kind: "library_look", seatId: next.lookerSeatId ?? next.seatId, visibility: "private", look: next } : undefined);
    };
    const setMyriadTapChoice: Setter<MyriadTapChoiceState> = (value) => {
      const next = typeof value === "function" ? value(undefined) : value;
      put("myriad_tap", next ? { id: nextId(), kind: "myriad_tap", seatId: next.seatId, visibility: "private", sourceCardId: next.cardId, sourceCardName: next.cardName, cardId: next.cardId, cardName: next.cardName } : undefined);
    };
    return {
      setLibraryLook,
      setMyriadTapChoice,
      setManualLibrarySearch: searchSetter<ManualLibrarySearchState>("manual", (v) => ({ seatId: v.seatId, destination: v.destination, tapped: v.tapped })),
      setMyriadSearch: searchSetter<MyriadSearchState>("myriad", (v) => ({ seatId: v.seatId, sourceCardId: v.sourceCardId })),
      setBasicLandFetchSearch: searchSetter<BasicLandFetchSearchState>("basic_land_fetch", (v) => ({ seatId: v.seatId, sourceCardId: v.sourceCardId, sourceCardName: v.sourceCardName }))
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
    libraryLook,
    manualLibrarySearch,
    myriadSearch,
    myriadTapChoice,
    basicLandFetchSearch,
    ...moved,
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
