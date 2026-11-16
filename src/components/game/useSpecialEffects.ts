// One-off interactive effects: Myriad Landscape, basic-land fetch, library-look starts, Lim-Dul's Vault, rule-driven library searches.
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
import { type LibraryLookMode } from "@/engine/flowTypes";
import { basicLandFetchCostRequiresTap, basicLandFetchManaCost, isBasicLandFetchAbility } from "@/lib/oracleClauses";
import { cannotPayMessage, chooseManaSourcesForCost, manaPoolTotal, payCostFromPool, selectedManaTotal, spendManaSources } from "@/engine/mana";
import { chooseBestBasicLandPairForMyriad, getBasicLandFetchOptions, resolveBasicLandFetchSearch, resolveMyriadLandscapeSearch } from "@/engine/etb";
import { genericCostShim } from "@/engine/effects";
import { remainingLibraryTotalManaValue, searchableLibraryCards } from "@/engine/oneShotEffects";
import { shuffleCards } from "@/engine/zones";
import { type GameContext, lateFn } from "./context";

export function useSpecialEffects(ctx: GameContext) {
  const { session, setSession, setInspectedCard, humanSeat } = ctx;
  const { libraryLook, setLibraryLook, pendingRuleChoice, setPendingRuleChoice, myriadSearch, setMyriadSearch, myriadTapChoice, setMyriadTapChoice, basicLandFetchSearch, setBasicLandFetchSearch } = ctx.choices;
  const addEvent = lateFn(ctx, "addEvent");
  const clearManaContributions = lateFn(ctx, "clearManaContributions");
  const completeRuleChoice = lateFn(ctx, "completeRuleChoice");
  const poolForSeat = lateFn(ctx, "poolForSeat");
  const setSeatManaPool = lateFn(ctx, "setSeatManaPool");
  const tapForMana = lateFn(ctx, "tapForMana");

  function resolveMyriadLandscape(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    setInspectedCard(undefined);
    if (!seat || !card) return;
    if (card.tapped) {
      addEvent(`${card.name} is tapped and cannot activate its search ability.`, seatId, "Rules action");
      return;
    }
    const totalCost = 2;
    // Myriad Landscape's own {T} is a separate cost component of this same ability (302.6) — it must
    // stay untapped to pay that, so it can't also be tapped as one of the 2 generic mana sources
    // (moot for the pool path below: this function already bailed out above if the card itself were
    // tapped, so its own mana can never be sitting in the floating pool at this point).
    const costCard = genericCostShim(totalCost);
    const pool = poolForSeat(seatId);
    const poolPayment = payCostFromPool(pool, costCard, totalCost);
    const payment = poolPayment.ok ? poolPayment : chooseManaSourcesForCost(seat, costCard, totalCost, cardId, session.seats);
    const availableMana = poolPayment.ok ? manaPoolTotal(pool) : selectedManaTotal(seat, payment.sourceIds);
    if (!payment.ok) {
      addEvent(cannotPayMessage(seat, costCard, availableMana, totalCost, payment.reason), seatId, "Mana");
      return;
    }
    if (poolPayment.ok) {
      setSeatManaPool(seatId, poolPayment.pool);
      clearManaContributions(seatId);
    } else {
      setSession((current) => ({
        ...current,
        seats: current.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item))
      }));
    }
    setMyriadSearch({ seatId, sourceCardId: cardId });
  }

  function chooseMyriadLandscapeTapMana() {
    const choice = myriadTapChoice;
    setMyriadTapChoice(undefined);
    if (!choice) return;
    tapForMana(choice.seatId, choice.cardId, "battlefield", "C");
  }

  function chooseMyriadLandscapeSearch() {
    const choice = myriadTapChoice;
    setMyriadTapChoice(undefined);
    if (!choice) return;
    resolveMyriadLandscape(choice.seatId, choice.cardId);
  }

  // Agents have no interactive land-picker, so they auto-resolve the search the same way
  // basic-land fetches already do for them (chooseBestBasicLandPairForMyriad).
  function activateMyriadLandscapeForAgent(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !card || card.tapped) return;
    const totalCost = 2;
    const payment = chooseManaSourcesForCost(seat, genericCostShim(totalCost), totalCost, cardId, session.seats);
    if (!payment.ok) return;
    const pair = chooseBestBasicLandPairForMyriad(seat);
    if (pair.length !== 2) return;
    setSession((current) => {
      const spentSeats = current.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item));
      return resolveMyriadLandscapeSearch({ ...current, seats: spentSeats }, seatId, cardId, pair.map((item) => item.id));
    });
  }

  function resolveBasicLandFetch(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    setInspectedCard(undefined);
    if (!seat || !card || !isBasicLandFetchAbility(card)) return;
    if (basicLandFetchCostRequiresTap(card) && card.tapped) {
      addEvent(`${card.name} is tapped and cannot activate its fetch ability.`, seatId, "Rules action");
      return;
    }
    const options = getBasicLandFetchOptions(seat.library ?? []);
    if (options.length === 0) {
      addEvent(`${seat.name} has no basic lands to find with ${card.name}.`, seatId, "Rules action");
      return;
    }
    // Wayfarer's Bauble-style "{2}, {T}, Sacrifice ...: Search..." has a real generic-mana
    // component that this whole system never used to pay at all (it was modeled only on Evolving
    // Wilds' plain "{T}, Sacrifice ...", which costs 0 here) — paid up front, same "pay first, then
    // open the picker" order as resolveMyriadLandscape, so a human who can't afford it gets a clear
    // message instead of picking a land only to have nothing happen.
    const manaCost = basicLandFetchManaCost(card);
    if (manaCost > 0) {
      const costCard = genericCostShim(manaCost);
      const pool = poolForSeat(seatId);
      const poolPayment = payCostFromPool(pool, costCard, manaCost);
      const payment = poolPayment.ok ? poolPayment : chooseManaSourcesForCost(seat, costCard, manaCost, cardId, session.seats);
      const availableMana = poolPayment.ok ? manaPoolTotal(pool) : selectedManaTotal(seat, payment.sourceIds);
      if (!payment.ok) {
        addEvent(cannotPayMessage(seat, costCard, availableMana, manaCost, payment.reason), seatId, "Mana");
        return;
      }
      if (poolPayment.ok) {
        setSeatManaPool(seatId, poolPayment.pool);
        clearManaContributions(seatId);
      } else {
        setSession((current) => ({
          ...current,
          seats: current.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item))
        }));
      }
    }
    setBasicLandFetchSearch({ seatId, sourceCardId: cardId, sourceCardName: card.name });
  }

  // Agent counterpart to resolveBasicLandFetch — pays the same {2}-if-any generic mana cost, then
  // auto-picks a basic land the same way resolveBasicLandFetchSearch always has for agents (no
  // chosenCardId).
  function activateBasicLandFetchForAgent(seatId: string, cardId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const card = seat?.board.battlefield.find((item) => item.id === cardId);
    if (!seat || !card || !isBasicLandFetchAbility(card)) return;
    const manaCost = basicLandFetchManaCost(card);
    const payment = manaCost > 0 ? chooseManaSourcesForCost(seat, genericCostShim(manaCost), manaCost, cardId, session.seats) : undefined;
    if (manaCost > 0 && !payment?.ok) return;
    setSession((current) => {
      const spentSeats = payment?.ok ? current.seats.map((item) => (item.id === seatId ? spendManaSources(item, payment.sourceIds) : item)) : current.seats;
      return resolveBasicLandFetchSearch({ ...current, seats: spentSeats }, seatId, cardId);
    });
  }

  function completeBasicLandFetch(cardId: string) {
    const activeSearch = basicLandFetchSearch;
    if (!activeSearch) return;
    setSession((current) => resolveBasicLandFetchSearch(current, activeSearch.seatId, activeSearch.sourceCardId, cardId));
    setBasicLandFetchSearch(undefined);
  }

  function completeMyriadLandscape(cardIds: string[]) {
    const activeSearch = myriadSearch;
    if (!activeSearch) return;
    setSession((current) => resolveMyriadLandscapeSearch(current, activeSearch.seatId, activeSearch.sourceCardId, cardIds));
    setMyriadSearch(undefined);
  }

  function startLibraryLook(
    mode: LibraryLookMode,
    count: number,
    allowedCardFilter?: string,
    drawCountAfter?: number,
    restDestination?: "bottom" | "graveyard",
    // Portent looks at ANOTHER player's library.
    targetSeatId?: string,
    shuffleOfferSource?: string
  ) {
    // setLibraryLook must not be called from inside setSession's updater (React may invoke that
    // updater more than once, and other setState calls inside it are unreliable) — computed against
    // the current session directly instead, mirroring every other modal-opening call in this file.
    // Reproduced live as Diabolic Vision's "look at the top 5, pick one" window never opening at
    // all: the event log line this same call also wrote could still show up (the returned session
    // object was still correct), while the actual look-window state silently never stuck.
    const seat = session.seats.find((item) => item.id === (targetSeatId ?? humanSeat.id));
    const cards = (seat?.library ?? []).slice(0, mode === "scry" ? 1 : count);
    setLibraryLook({
      seatId: targetSeatId ?? humanSeat.id,
      ...(targetSeatId && targetSeatId !== humanSeat.id ? { lookerSeatId: humanSeat.id } : {}),
      ...(shuffleOfferSource ? { shuffleOfferSource } : {}),
      mode,
      cards,
      remaining: count,
      orderedCards: mode === "reorder" ? [] : undefined,
      allowedCardFilter,
      restDestination,
      drawCountAfter
    });
    addEvent(
      mode === "scry"
        ? `${humanSeat.name} starts scry ${count}.`
        : mode === "reorder"
          ? `${humanSeat.name} looks at the top ${cards.length} card${cards.length === 1 ? "" : "s"} and will put them back in any order.`
          : mode === "choose_one_bottom"
            ? `${humanSeat.name} looks at the top ${cards.length} card${cards.length === 1 ? "" : "s"}, may reveal a ${allowedCardFilter ?? "matching"} card to hand, and will put the rest ${restDestination === "graveyard" ? "into the graveyard" : "on the bottom"}.`
            : `${humanSeat.name} looks at the top ${cards.length} card${cards.length === 1 ? "" : "s"} to ${mode}.`,
      humanSeat.id
    );
  }

  // "Look at the top five cards of your library. As many times as you choose, you may pay 1 life,
  // put those cards on the bottom of your library in any order, then look at the top five cards of
  // your library. Then shuffle and put the last cards you looked at this way on top in any order."
  // (Lim-Dûl's Vault) — the deterministic rules-advisor explicitly declines this shape as an
  // unmodeled repeatable loop (see rulesAdvisor.ts's "as many times as you choose" check), which
  // left it doing nothing at all for a human caster. This trio of functions (start/repeat/keep)
  // implements the loop as its own interactive flow instead. The "any order" on the bottom-placed
  // cards each repeat is simplified to "same order they were looked at in" — asking for a fresh
  // reorder every single repeat would make the loop far more tedious than the card itself; the
  // meaningful choice (what ends up on top at the end) still gets the real reorder step via
  // keepLimDulVaultCards handing off to the existing "reorder" mode.
  function startLimDulVaultLook(seatId: string) {
    const seat = session.seats.find((item) => item.id === seatId);
    const cards = (seat?.library ?? []).slice(0, 5);
    setLibraryLook({ seatId, mode: "vault_look", cards, remaining: cards.length });
    addEvent(
      `${seat?.name ?? "Player"} looks at the top ${cards.length} card${cards.length === 1 ? "" : "s"} of their library (Lim-Dûl's Vault).`,
      seatId
    );
  }

  function repeatLimDulVault() {
    const activeLook = libraryLook;
    if (!activeLook || activeLook.mode !== "vault_look" || activeLook.cards.length === 0) return;
    const seatId = activeLook.seatId;
    // Paying the last point of life would eliminate the player; refuse rather than let a misclick end the game.
    const payingSeat = session.seats.find((item) => item.id === seatId);
    if (payingSeat && payingSeat.life <= 1) {
      addEvent(`${payingSeat.name} can't afford to pay 1 life for Lim-Dûl's Vault without losing the game.`, seatId, "Rules action");
      return;
    }
    const lookedAtIds = new Set(activeLook.cards.map((card) => card.id));
    setSession((current) => {
      const seat = current.seats.find((item) => item.id === seatId);
      if (!seat) return current;
      const rest = (seat.library ?? []).filter((card) => !lookedAtIds.has(card.id));
      return {
        ...current,
        seats: current.seats.map((item) => (item.id === seatId ? { ...item, life: item.life - 1, library: [...rest, ...activeLook.cards] } : item)),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId,
            message: `${seat.name} pays 1 life, puts those cards on the bottom of their library, and looks at the next 5 (Lim-Dûl's Vault).`,
            detail: "Rules action"
          },
          ...current.events
        ]
      };
    });
    const seat = session.seats.find((item) => item.id === seatId);
    // The bottomed cards are part of the library again, so a library of five or fewer shows the same cards a second time.
    const nextCards = [...(seat?.library ?? []).filter((card) => !lookedAtIds.has(card.id)), ...activeLook.cards].slice(0, 5);
    setLibraryLook({ seatId, mode: "vault_look", cards: nextCards, remaining: nextCards.length });
  }

  function keepLimDulVaultCards() {
    const activeLook = libraryLook;
    if (!activeLook || activeLook.mode !== "vault_look") return;
    const seatId = activeLook.seatId;
    const keptIds = new Set(activeLook.cards.map((card) => card.id));
    setSession((current) => {
      const seat = current.seats.find((item) => item.id === seatId);
      if (!seat) return current;
      const shuffledRest = shuffleCards((seat.library ?? []).filter((card) => !keptIds.has(card.id)));
      return {
        ...current,
        // The kept cards stay on top (in looked-at order) until the human orders them, so closing the dialog early can't lose them.
        seats: current.seats.map((item) => (item.id === seatId ? { ...item, library: [...activeLook.cards, ...shuffledRest] } : item)),
        events: [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            seatId,
            message: `${seat.name} shuffles their library (Lim-Dûl's Vault).`,
            detail: "Rules action"
          },
          ...current.events
        ]
      };
    });
    if (activeLook.cards.length === 0) {
      setLibraryLook(undefined);
      return;
    }
    setLibraryLook({ seatId, mode: "reorder", cards: activeLook.cards, remaining: activeLook.cards.length, orderedCards: [] });
    addEvent(
      `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} will put those ${activeLook.cards.length} card${activeLook.cards.length === 1 ? "" : "s"} back on top in any order (Lim-Dûl's Vault).`,
      seatId
    );
  }

  // destination: the per-pick zone override for Dina's Guidance-style choose_card_from_library
  // choices (see PendingRuleChoice.destinationChoices/chosenDestinations) — undefined for every
  // ordinary single-destination search, which just falls back to `choice.destination` as before.
  function chooseRuleLibraryCard(cardId: string, destination?: "hand" | "graveyard" | "battlefield") {
    const choice = pendingRuleChoice;
    if (!choice || choice.kind !== "choose_card_from_library") return;
    const chosenCardIds = [...(choice.chosenCardIds ?? []), cardId];
    // Kodama's Reach / Cultivate (split destination): the first find goes wherever the player said, the second gets the other zone.
    const firstSplitDestination = choice.splitDestination && choice.chosenCardIds?.length ? choice.chosenDestinations?.[choice.chosenCardIds[0]] : undefined;
    const effectiveDestination = destination ?? (firstSplitDestination ? (firstSplitDestination === "battlefield" ? "hand" : "battlefield") : undefined);
    const chosenDestinations = effectiveDestination ? { ...(choice.chosenDestinations ?? {}), [cardId]: effectiveDestination } : choice.chosenDestinations;
    // Protean Hulk-style total-mana-value budget: finish on its own once nothing else fits.
    const controllerLibrary = session.seats.find((item) => item.id === choice.controllerSeatId)?.library ?? [];
    const remainingBudget = remainingLibraryTotalManaValue({ totalManaValueLimit: choice.totalManaValueLimit, chosenCardIds }, controllerLibrary);
    const budgetExhausted =
      remainingBudget !== undefined &&
      searchableLibraryCards(controllerLibrary.filter((card) => !chosenCardIds.includes(card.id)), { ...choice, remainingTotalManaValue: remainingBudget }).length === 0;
    if (chosenCardIds.length >= choice.maxChoices || budgetExhausted) {
      completeRuleChoice({ ...choice, chosenDestinations }, chosenCardIds);
      return;
    }
    // "Up to N" (Archaeomancer's Map's "up to two basic Plains cards," ...) — keep the search open
    // for further picks instead of finalizing after the first one, which used to cap every
    // multi-card search at exactly one card regardless of maxChoices.
    setPendingRuleChoice({ ...choice, chosenCardIds, chosenDestinations });
  }

  return { activateBasicLandFetchForAgent, activateMyriadLandscapeForAgent, chooseMyriadLandscapeSearch, chooseMyriadLandscapeTapMana, chooseRuleLibraryCard, completeBasicLandFetch, completeMyriadLandscape, keepLimDulVaultCards, repeatLimDulVault, resolveBasicLandFetch, resolveMyriadLandscape, startLibraryLook, startLimDulVaultLook };
}
