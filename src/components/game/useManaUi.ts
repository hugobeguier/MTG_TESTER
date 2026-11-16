// Mana UI handlers: floating-pool bookkeeping (add/spend/clear per seat, restricted and copy mana, contributions) and tapping permanents for mana (lands, signets, mana choices), plus card inspection.
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
import { type ManaColor, type ManaPool, type PlayerSeat, type RestrictedManaBatch, type VisibleCard } from "@/lib/types";
import { abilityOracleText } from "@/lib/typeGrants";
import { addManaToPool, addPools, chooseManaSourcesForCost, effectiveManaOracleText, emptyManaPool, isAvailableManaSource, isSacrificeManaSource, manaAbilityCounterRemovalKind, manaChoicesForCard, manaPoolTotal, manaProducedBy, payCostFromPool, restrictedBatchUsable, signetAbility, spendManaSources, tapVisibleCard } from "@/engine/mana";
import { basicLandFetchCostRequiresTap, isBasicLandFetchAbility } from "@/lib/oracleClauses";
import { genericCostShim } from "@/engine/effects";
import { isEquipment } from "@/lib/attachments";
import { parseGenericSacrificeAbilities, parseGenericTapAbilities } from "@/lib/activatedAbilities";
import { type GameContext, lateFn } from "./context";

export function useManaUi(ctx: GameContext) {
  const { session, setSession, setInspectedCard, humanSeat } = ctx;
  const { setMyriadTapChoice } = ctx.choices;
  const { manaPools, setManaPools, setCopyMana, manaContributions, setManaContributions, restrictedManaBatches, setRestrictedManaBatches, setManaChoice } = ctx.mana;
  const addEvent = lateFn(ctx, "addEvent");

  function poolForSeat(seatId: string) {
    return manaPools[seatId] ?? emptyManaPool();
  }

  function setSeatManaPool(seatId: string, pool: ManaPool) {
    setManaPools((current) => ({ ...current, [seatId]: pool }));
  }

  function clearManaPool(seatId: string) {
    // "You don't lose unspent red mana as steps and phases end." (Leyline Tyrant) — the red stays; everything else empties.
    const keepsRed = session.seats.find((seat) => seat.id === seatId)?.board.battlefield.some((card) => !card.abilitiesStripped && /you don'?t lose unspent red mana as steps and phases end/i.test(card.oracleText));
    setSeatManaPool(seatId, keepsRed ? { ...emptyManaPool(), R: poolForSeat(seatId).R } : emptyManaPool());
    setManaContributions((current) => ({ ...current, [seatId]: [] }));
    setCopyMana((current) => (current[seatId] ? { ...current, [seatId]: 0 } : current));
  }

  // Rule 500.4: a step or phase ending empties every player's mana pool, not just the active
  // player's — mana floated by a non-active seat (e.g. holding up an instant during an opponent's
  // end step) is just as unused once that window closes. clearManaPool's callers used to only
  // target the active seat, so a responder's floating mana silently survived phase changes forever.
  function clearAllManaPools(seats: PlayerSeat[]) {
    for (const seat of seats) clearManaPool(seat.id);
  }

  function clearManaContributions(seatId: string) {
    setManaContributions((current) => ({ ...current, [seatId]: [] }));
  }

  function restrictedManaPoolForSeat(seatId: string, forCard?: VisibleCard): ManaPool {
    const batches = (restrictedManaBatches[seatId] ?? []).filter((batch) => restrictedBatchUsable(batch, forCard));
    return batches.reduce((pool, batch) => addPools(pool, batch.remaining), emptyManaPool());
  }

  // Drains `spent` out of a seat's restricted-mana batches, oldest batch first, dropping any batch
  // that's fully drained. `spent` is always <= restrictedManaPoolForSeat's own total per color (only
  // ever called right after a successful payCostFromPool against that exact pool), so this never
  // needs to handle an over-drain.
  function spendRestrictedMana(seatId: string, spent: ManaPool, forCard?: VisibleCard) {
    setRestrictedManaBatches((current) => {
      const batches = current[seatId] ?? [];
      const remainingSpend = { ...spent };
      const nextBatches: RestrictedManaBatch[] = [];
      for (const batch of batches) {
        if (!restrictedBatchUsable(batch, forCard)) {
          nextBatches.push(batch);
          continue;
        }
        const nextRemaining = { ...batch.remaining };
        for (const color of Object.keys(nextRemaining) as ManaColor[]) {
          const take = Math.min(nextRemaining[color], remainingSpend[color]);
          nextRemaining[color] -= take;
          remainingSpend[color] -= take;
        }
        if (manaPoolTotal(nextRemaining) > 0) nextBatches.push({ ...batch, remaining: nextRemaining });
      }
      return { ...current, [seatId]: nextBatches };
    });
  }

  function addRestrictedManaBatch(seatId: string, sourceCardName: string, amounts: ManaPool, spellType?: string) {
    if (manaPoolTotal(amounts) <= 0) return;
    setRestrictedManaBatches((current) => ({
      ...current,
      [seatId]: [...(current[seatId] ?? []), { id: crypto.randomUUID(), sourceCardName, remaining: amounts, restriction: "cast_spells_only", ...(spellType ? { spellType } : {}) }]
    }));
  }

  // "Until end of turn" — cleared only at the cleanup step of the turn the batch was created, never
  // by clearAllManaPools (which this deliberately never touches, so it survives every phase/step
  // change on its own, unlike a normal mana pool).
  function clearRestrictedManaForSeat(seatId: string) {
    setRestrictedManaBatches((current) => (current[seatId]?.length ? { ...current, [seatId]: [] } : current));
  }

  function addManaContribution(seatId: string, cardId: string, color: ManaColor, amount: number) {
    setManaContributions((current) => ({
      ...current,
      [seatId]: [...(current[seatId] ?? []).filter((item) => item.cardId !== cardId), { cardId, color, amount }]
    }));
  }

  function removeManaContribution(seatId: string, cardId: string) {
    const contribution = manaContributions[seatId]?.find((item) => item.cardId === cardId);
    if (!contribution) return;
    setManaPools((current) => {
      const pool = current[seatId] ?? emptyManaPool();
      return {
        ...current,
        [seatId]: {
          ...pool,
          [contribution.color]: Math.max(0, pool[contribution.color] - contribution.amount)
        }
      };
    });
    setManaContributions((current) => ({ ...current, [seatId]: (current[seatId] ?? []).filter((item) => item.cardId !== cardId) }));
  }

  // A permanent whose only function is producing mana (a land or a mana rock, not a creature and
  // not equipment) doesn't need the card inspector at all — tapping it for mana is the only thing
  // there is to decide, so a single click should just do it (or open the color-choice modal
  // toggleTapCard already shows for multi-color sources), instead of requiring the hidden hover +
  // "T" keyboard shortcut to discover that tapping is even possible.
  function isSimpleManaSourcePermanent(card: VisibleCard, seat: PlayerSeat) {
    // A card with a SECOND real ability that also costs {T} isn't "simple" — besides tapping for
    // mana it has something else worth choosing (a generic sacrifice ability like Mind Stone's "{1},
    // {T}, Sacrifice this artifact: Draw a card," a generic tap ability, or a land-fetch ability
    // requiring {T}), so a bare click can't just auto-resolve to the mana tap; it needs the inspector
    // so that other ability is actually reachable (see the dedicated Myriad Landscape branch above,
    // and toggleTapCard's own matching dispatch check below, for the same shape).
    // Used to special-case only Myriad Landscape by name, which meant Mind Stone's identically-shaped
    // sacrifice ability was silently unreachable by mouse click — reported live: clicking it (or
    // right-clicking) always just tapped it for mana, with no way to ever reach the sacrifice-draw
    // ability once it was already tapped.
    return (
      !card.typeLine.includes("Creature") &&
      !isEquipment(card) &&
      isAvailableManaSource(card, seat, session.seats) &&
      !parseGenericSacrificeAbilities(abilityOracleText(card)).some((ability) => ability.costTap) &&
      parseGenericTapAbilities(abilityOracleText(card)).length === 0 &&
      !(isBasicLandFetchAbility(card) && basicLandFetchCostRequiresTap(card))
    );
  }

  function handleInspectCard(card: VisibleCard) {
    const ownerSeat = session.seats.find((seat) => seat.board.battlefield.some((item) => item.id === card.id));
    // A battlefield click hands this function whatever card object was baked into the 3D mesh's
    // userData at the last scene rebuild (keyed off tableRenderKey) — that can lag one render behind
    // the real session state (e.g. its tapped flag), unlike the "T" hotkey's toggleTapCard, which
    // already re-reads the card straight from session and never had this problem. Re-resolving to
    // the live battlefield card here (falling back to the passed-in one for non-battlefield cards,
    // e.g. hand clicks, which are plain DOM-rendered and never go stale) keeps every check below, and
    // the inspector modal itself, in sync with what's actually on the table right now.
    const liveCard = ownerSeat?.board.battlefield.find((item) => item.id === card.id) ?? card;
    if (ownerSeat?.id === humanSeat.id && liveCard.name === "Myriad Landscape" && !liveCard.tapped) {
      // Only offer the choice when the search ability is actually payable (2 generic, from mana
      // already floating in the pool OR from sources other than this land itself); otherwise
      // there's nothing to choose between, so just tap for the colorless mana like any other simple
      // mana source. Checking the pool first matches resolveMyriadLandscape's own payment order —
      // without it, a human with 2 mana already floating (and no OTHER untapped source left to
      // auto-tap) never got offered the search choice at all, since chooseManaSourcesForCost alone
      // has no concept of already-floating mana.
      const searchCostShim = genericCostShim(2);
      if (payCostFromPool(poolForSeat(ownerSeat.id), searchCostShim, 2).ok || chooseManaSourcesForCost(ownerSeat, searchCostShim, 2, liveCard.id, session.seats).ok) {
        setMyriadTapChoice({ seatId: ownerSeat.id, cardId: liveCard.id, cardName: liveCard.name });
      } else {
        tapForMana(ownerSeat.id, liveCard.id, "battlefield", "C");
      }
      return;
    }
    if (ownerSeat?.id === humanSeat.id && isSimpleManaSourcePermanent(liveCard, humanSeat)) {
      toggleTapCard(humanSeat.id, liveCard.id, "battlefield");
      return;
    }
    setInspectedCard(liveCard);
  }

  function toggleTapCard(seatId: string, cardId: string, location: "battlefield" | "command") {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = location === "command" ? seat?.board.commander : seat?.board.battlefield.find((item) => item.id === cardId);
    // Same special-case as handleInspectCard's dedicated Myriad Landscape branch, needed here too
    // since the "T" keyboard shortcut (see ThreeGameTable's setMovementKey) calls this function
    // directly, bypassing handleInspectCard entirely — without this, that shortcut always just
    // tapped Myriad Landscape for colorless mana with no way to ever reach its search ability.
    if (seatId === humanSeat.id && location === "battlefield" && card?.name === "Myriad Landscape" && !card.tapped && seat) {
      // Same pool-first check as handleInspectCard's own Myriad Landscape branch above (this
      // shortcut bypasses that one entirely, so it needs its own copy of the fix too).
      const searchCostShim = genericCostShim(2);
      if (payCostFromPool(poolForSeat(seatId), searchCostShim, 2).ok || chooseManaSourcesForCost(seat, searchCostShim, 2, card.id, session.seats).ok) {
        setMyriadTapChoice({ seatId, cardId, cardName: card.name });
      } else {
        tapForMana(seatId, cardId, "battlefield", "C");
      }
      return;
    }
    // Generalizes the Myriad Landscape case above to every other permanent whose {T} is (also) the
    // cost of a real non-mana activated ability — a generic sacrifice ability like Wayfarer's
    // Bauble's "{2}, {T}, Sacrifice: search for a basic land," a generic tap ability like Retrofitter
    // Foundry's, or Mind Stone's "{1}, {T}, Sacrifice this artifact: Draw a card." Deliberately NOT
    // gated on "isn't a mana source" (it used to be, which is exactly what let this fall through to
    // the mana-tap branch below for a card that's BOTH a plain mana rock AND has this second ability
    // — reported live: pressing the "T" hotkey on Mind Stone always just tapped it for {C}, with no
    // way to ever reach the sacrifice-draw ability). Routes to the same card inspector a click
    // already opens instead, so the human gets an actual choice of what to activate — including
    // still tapping for mana, since the inspector shows that option too whenever it applies.
    if (
      seatId === humanSeat.id &&
      location === "battlefield" &&
      seat &&
      card &&
      !card.tapped &&
      (parseGenericSacrificeAbilities(abilityOracleText(card)).some((ability) => ability.costTap) ||
        parseGenericTapAbilities(abilityOracleText(card)).length > 0 ||
        (isBasicLandFetchAbility(card) && basicLandFetchCostRequiresTap(card)))
    ) {
      setInspectedCard(card);
      return;
    }
    if (seat && card && !card.tapped && isAvailableManaSource(card, seat, session.seats)) {
      if (location === "battlefield" && tapSignet(seatId, cardId)) return;
      const choices = manaChoicesForCard(card, seat, session.seats);
      if (choices.length > 1) {
        setManaChoice({ seatId, cardId, cardName: card.name, location, choices });
        return;
      }
      tapForMana(seatId, cardId, location, choices[0] ?? "C");
      return;
    }

    if (card?.tapped) {
      removeManaContribution(seatId, cardId);
    }

    setSession((current) => ({
      ...current,
      seats: current.seats.map((seat) => {
        if (seat.id !== seatId) return seat;
        const nextCommander =
          location === "command" && seat.board.commander?.id === cardId
            ? { ...seat.board.commander, tapped: !seat.board.commander.tapped }
            : seat.board.commander;
        const nextBattlefield =
          location === "battlefield"
            ? seat.board.battlefield.map((card) => (card.id === cardId ? { ...card, tapped: !card.tapped } : card))
            : seat.board.battlefield;

        return {
          ...seat,
          board: {
            ...seat.board,
            commander: nextCommander,
            battlefield: nextBattlefield
          }
        };
      })
    }));
    setInspectedCard((current) => (current?.id === cardId ? { ...current, tapped: !current.tapped } : current));
  }

  // A dedicated "tap for mana" entry point for the card inspector's own button (see CardInspector's
  // onTapForMana below) — needed because toggleTapCard's mana branch is no longer reachable at all
  // for a card that ALSO has another {T}-cost ability (Mind Stone, ...), since that shape now always
  // routes to the inspector instead (see toggleTapCard's own comment). Without this, fixing the
  // "can't reach Mind Stone's sacrifice ability" bug would have traded it for a new one: no longer
  // being able to just tap such a card for mana at all. Battlefield-only (unlike toggleTapCard/
  // tapForMana's shared "battlefield" | "command" location) since a card sitting in the command zone
  // isn't a permanent yet and can't produce mana regardless.
  function tapPermanentForMana(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !card || card.tapped || !isAvailableManaSource(card, seat, session.seats)) return;
    if (tapSignet(seatId, cardId)) return;
    const choices = manaChoicesForCard(card, seat, session.seats);
    if (choices.length > 1) {
      setManaChoice({ seatId, cardId, cardName: card.name, location: "battlefield", choices });
      return;
    }
    tapForMana(seatId, cardId, "battlefield", choices[0] ?? "C");
  }

  // Izzet Signet and friends: pay the {N} from mana already in the pool, then add one of each color (it used to ask for ONE color and add it twice, free).
  function tapSignet(seatId: string, cardId: string): boolean {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    const signet = card ? signetAbility(effectiveManaOracleText(card)) : undefined;
    if (!seat || !card || !signet) return false;
    if (card.tapped || !isAvailableManaSource(card, seat, session.seats)) return true;
    const pool = manaPools[seatId] ?? emptyManaPool();
    const paid = signet.generic > 0 ? payCostFromPool(pool, genericCostShim(signet.generic), signet.generic) : { ok: true as const, pool };
    if (!paid.ok) {
      addEvent(`${card.name} needs {${signet.generic}} first: tap a land (or another source) so the mana is in your pool, then tap ${card.name}.`, seatId, "Mana");
      return true;
    }
    let next = paid.pool;
    for (const symbol of signet.symbols) next = addManaToPool(next, symbol, 1);
    setManaPools((current) => ({ ...current, [seatId]: next }));
    for (const symbol of signet.symbols) addManaContribution(seatId, cardId, symbol, 1);
    setSession((current) => tapVisibleCard(current, seatId, cardId, "battlefield"));
    addEvent(`${seat.name} pays {${signet.generic}} and taps ${card.name} for ${signet.symbols.map((symbol) => "{" + symbol + "}").join("")}.`, seatId, "Mana");
    setInspectedCard((current) => (current?.id === cardId ? { ...current, tapped: true } : current));
    setManaChoice(undefined);
    return true;
  }

  function tapForMana(seatId: string, cardId: string, location: "battlefield" | "command", color: ManaColor) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = location === "command" ? seat?.board.commander : seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !card || card.tapped || !isAvailableManaSource(card, seat, session.seats)) return;
    if (location === "battlefield" && signetAbility(effectiveManaOracleText(card)) && tapSignet(seatId, cardId)) return;
    // A Treasure (or any "{T}, Sacrifice this: Add ...") is used up by tapping it, and a storage land loses its counter - the automatic payment
    // already did this through spendManaSources; a manual tap only ever tapped it, so Treasures stayed on the battlefield.
    const consumedOnUse = location === "battlefield" && (isSacrificeManaSource(card) || manaAbilityCounterRemovalKind(card.oracleText) !== undefined);
    setSession((current) =>
      consumedOnUse ? { ...current, seats: current.seats.map((item) => (item.id === seatId ? spendManaSources(item, [cardId]) : item)) } : tapVisibleCard(current, seatId, cardId, location)
    );
    const amount = manaProducedBy(card, seat);
    setManaPools((current) => {
      const pool = current[seatId] ?? emptyManaPool();
      return { ...current, [seatId]: addManaToPool(pool, color, amount) };
    });
    addManaContribution(seatId, cardId, color, amount);
    addEvent(`${seat.name} taps ${card.name} for ${amount > 1 ? amount : ""}${color}.`, seatId, "Mana");
    setInspectedCard((current) => (current?.id === cardId ? { ...current, tapped: true } : current));
    setManaChoice(undefined);
  }

  return { addRestrictedManaBatch, clearAllManaPools, clearManaContributions, clearRestrictedManaForSeat, handleInspectCard, poolForSeat, restrictedManaPoolForSeat, setSeatManaPool, spendRestrictedMana, tapForMana, tapPermanentForMana, toggleTapCard };
}
