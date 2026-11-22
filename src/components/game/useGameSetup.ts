// Game start and lifecycle: building decks, starting a game (opening hands, mulligans for human and agent seats), save/load snapshots, opening-hand battlefield cards.
// Part of the AppFlow() split: shared state arrives through `ctx` (see ./context.ts); handlers owned by other hooks are called through `lateFn` so every hook sees the current render's functions.
import { type AgentAction, type CommanderDeck, type GameEvent, type GameSession, type PlayerSeat, type VisibleCard } from "@/lib/types";
import { type GameSnapshot, SAVE_FORMAT_VERSION, deserializeTurnCounters, isCleanSaveStop, serializeTurnCounters } from "@/lib/saveGame";
import { type LegalAgentAction } from "@/engine/flowTypes";
import { MULLIGAN_HARD_CAP, MULLIGAN_SOFT_CAP, agentKeepsHand, keepOpeningHandSize, openingHandBattlefieldCards, openingHandKeepSize, putOpeningHandCardOnBattlefield, withOpeningHand } from "@/engine/mulligan";
import { type SeatConfig, applyDeckToSeat, createInitialConfigs, fallbackCommander, formatDeckList, inferColors, playingConfigs, validateConfigsForPlay } from "@/components/DeckSetup";
import { evaluateOpeningHand } from "@/lib/mulliganHeuristics";
import { isLandCard } from "@/engine/shared";
import { makeCommonTrigger, phaseEvent } from "@/engine/triggers";
import { rollForStartingSeat } from "@/engine/turnFlow";
import { warmUpAgentModel } from "@/lib/agentRuntime";
import { seatVerb } from "@/engine/abilities";
import { hostStatusStore } from "@/lib/multiplayer/hostStatusStore";
import { lobbyBlockers } from "@/lib/multiplayer/lobby";
import { assignSlots, isRemoteSeat } from "@/lib/multiplayer/seatMap";
import { isLastToKeep, mulliganReturnRequired } from "@/lib/multiplayer/mulliganGate";
import { type GameContext, lateFn } from "./context";

export function useGameSetup(ctx: GameContext) {
  const { mode, setMode, session, setSession, activeSeatId, setActiveSeatId, prioritySeatId, setPrioritySeatId, selectedHandCardId, setSelectedHandCardId, inspectedCard, setInspectedCard, gameStage, setGameStage, setGameOverDismissed, setSetupMessage, configs, setConfigs, defaultDecksApplied, setSavedGames, gameStarting, setGameStarting, humanSeat, baseSeats } = ctx;
  const { agentMainActions, agentDecisionRequests, agentThinking, setAgentThinking, setAgentReasoning, agentStatedPlans } = ctx.agent;
  const { mulligans, setMulligans, keptHands, setKeptHands, keptHandsRef, mulliganReturnCardIds, setMulliganReturnCardIds, setLibraryLook, setManualLibrarySearch, pendingRuleChoice, setPendingRuleChoice, decisions, setBlockChoice, selectedBlockerIds, setSelectedBlockerIds, setMyriadSearch, setMyriadTapChoice, setBasicLandFetchSearch, commanderZoneChoiceAsked, auraRetargetAsked } = ctx.choices;
  const { manaPools, setManaPools, manaContributions, setManaContributions, restrictedManaBatches, setRestrictedManaBatches, setManaChoice } = ctx.mana;
  const { stackStore, pendingAction, setPendingAction, stackActions, priorityPasses, setPriorityPasses, holdPriorityOnce, setHoldPriorityOnce } = ctx.stack;
  const { landPlaysThisTurn, spellsCastThisTurn, firstDrawThisTurn, loyaltyActivationsThisTurn, phaseTriggersChecked, cleanupDiscardChecked, cleanupRestrictedManaChecked } = ctx.turn;
  const addEvent = lateFn(ctx, "addEvent");
  const recordAgentReasoning = lateFn(ctx, "recordAgentReasoning");
  const replaceStackActions = lateFn(ctx, "replaceStackActions");
  const requestAgentDecision = lateFn(ctx, "requestAgentDecision");

  function updateConfig(seatId: string, patch: Partial<SeatConfig>) {
    setConfigs((current) => current.map((config) => (config.seatId === seatId ? { ...config, ...patch } : config)));
  }

  async function buildDeck(config: SeatConfig) {
    const commander = config.commander.trim() || fallbackCommander(config.name);
    const colors = inferColors(commander);
    updateConfig(config.seatId, {
      commander,
      status: "building",
      message: config.mode === "decklist" ? "Validating deck list..." : "Asking Ollama to build this deck..."
    });

    const response = await fetch("/api/decks/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentName: config.name,
        commander,
        colors,
        deckList: config.mode === "decklist" ? config.deckList : undefined
      })
    });
    const result = (await response.json()) as {
      source: "decklist" | "ollama" | "ollama-invalid" | "error";
      message: string;
      notes?: string;
      deck?: CommanderDeck;
    };
    if (!result.deck) {
      updateConfig(config.seatId, { status: "error", message: result.message || "Deck build failed." });
      return;
    }
    const deck = result.deck;
    const activity = [
      result.source === "ollama"
        ? `${config.name} received an Ollama deck draft and the app repaired/validated it against the card catalog.`
        : result.source === "ollama-invalid"
          ? `${config.name} received an Ollama deck draft, but it still failed validation.`
          : `${config.name} validated the pasted deck list.`,
      result.notes ? `Agent notes: ${result.notes}` : undefined,
      `Deck score ${deck.score.total}. ${deck.validation.cardCount} cards. ${deck.validation.gameChangerCount} Game Changers.`,
      ...deck.score.notes
    ].filter((item): item is string => Boolean(item));

    updateConfig(config.seatId, {
      commander,
      deck,
      deckList: formatDeckList(deck),
      status: deck.validation.legal ? "ready" : "error",
      message:
        result.source === "decklist"
          ? result.message
          : result.source === "ollama"
          ? "Ollama built and validated this deck."
          : deck.validation.errors[0] ?? result.message,
      activity
    });
  }

  async function startGame() {
    if (gameStarting) return;
    setGameStarting(true);
    try {
      await startGameInner();
    } finally {
      setGameStarting(false);
    }
  }

  async function startGameInner() {
    setSetupMessage(undefined);
    const validated = validateConfigsForPlay(configs);
    if (!validated.ready) {
      setConfigs(validated.configs);
      const blockers = validated.configs.filter((config) => config.status === "error").map((config) => `${config.name}: ${config.message}`);
      setSetupMessage(`Cannot start yet. ${blockers.join(" ")}`);
      return;
    }

    // Empty seats (multiplayer host chose "Empty") are not in the game at all: 1 to 4 seats play. The seat objects come from the current session,
    // or from the original 4-seat session for a seat an earlier game left out.
    const playing = playingConfigs(validated.configs);
    const playingSeats = playing.flatMap((config) => {
      const found = session.seats.find((seat) => seat.id === config.seatId) ?? baseSeats.find((seat) => seat.id === config.seatId);
      return found ? [found] : [];
    });
    if (playingSeats.length === 0) {
      setSetupMessage("Cannot start yet. At least one seat must be played.");
      return;
    }
    // Remote friends: refuse to start until each remote seat has a connected guest, then stamp the seats (human, no agent) with their slot.
    const guests = hostStatusStore.get().guests;
    if (playing.some((config) => config.remoteSlot !== undefined)) {
      const missing = lobbyBlockers(playing, guests);
      if (missing.length > 0) {
        setSetupMessage(`Cannot start yet. Friend seats are not ready (${missing.map((b) => `${playing.find((c) => c.seatId === b.seatId)?.name ?? b.seatId} ${b.reason}`).join("; ")}).`);
        return;
      }
    }
    const slotToSeat = assignSlots(playing, guests);
    const seatToSlot = new Map(Object.entries(slotToSeat).map(([slot, seatId]) => [seatId, slot]));
    const deckedSeats = playingSeats.map((baseSeat) => {
      const config = playing.find((item) => item.seatId === baseSeat.id);
      let seat = baseSeat;
      if (config?.remoteSlot !== undefined) {
        const { agentName: _agent, ...rest } = baseSeat;
        const slot = seatToSlot.get(baseSeat.id);
        const friend = guests.find((g) => g.seatId === slot)?.displayName; // the friend plays under their own name
        seat = { ...rest, name: friend || config.name, kind: "human", remoteSlot: slot };
      } else if (baseSeat.remoteSlot !== undefined) {
        const { remoteSlot: _slot, ...rest } = baseSeat;
        seat = { ...rest, name: config?.name ?? baseSeat.name, kind: "agent", agentName: (config?.name ?? baseSeat.name) as PlayerSeat["agentName"] }; // a seat that was remote in an earlier game goes back to its AI
      }
      if (!config?.deck) return seat;
      return applyDeckToSeat(seat, config.deck);
    });
    const openingSeats = deckedSeats.map((seat) => withOpeningHand(seat, 7, 0));
    // Every agent seat's mulligan decision below is its own live Ollama round-trip — the single
    // most important call this session makes, and the one place a timeout is most costly, since
    // there's no cache to fall back on for a first-ever decision. Started AFTER resolving mulligans
    // (not before/concurrently, as this used to) so it never competes with them for the same local
    // Ollama instance's (typically serial, not truly parallel) generation queue — reported live as
    // agent mulligans themselves timing out ("Ollama is unavailable") because this fire-and-forget
    // prewarm's own PREWARM_CONCURRENCY-many requests were already occupying it. Still fire-and-
    // forget and still never delays the game actually starting (that still means "mulligans
    // resolved, ready to play," not "every setup step finished") — it now runs during the human's
    // own opening-hand deliberation instead, a naturally idle window for Ollama. Runs over every
    // seat's full deck (not just the human's) since the cache is shared board-wide — any seat
    // encountering a card benefits every other seat's later encounter of the same card too.
    const agentResolved = await resolveAgentMulligansWithLLM(openingSeats);
    const nextSession: GameSession = {
      ...session,
      status: "ready",
      winnerSeatId: undefined,
      attackPool: undefined,
      activePlayerId: agentResolved.seats.some((seat) => seat.id === activeSeatId) ? activeSeatId : agentResolved.seats[0].id,
      phase: "opening hand",
      turn: 0,
      seats: agentResolved.seats,
      // Nothing from a previous game carries over: monarch, initiative, dungeon progress, queued triggers and per-turn bookkeeping all start fresh.
      monarchSeatId: undefined,
      monarchDrawTurn: undefined,
      initiativeSeatId: undefined,
      undercityRooms: undefined,
      pendingVentureRooms: undefined,
      pendingVentureChoices: undefined,
      pendingEntries: undefined,
      pendingDeaths: undefined,
      pendingLeaves: undefined,
      pendingSacrificeChoices: undefined,
      pendingCounterChoices: undefined,
      pendingDiscardChoices: undefined,
      pendingDiscoverChoices: undefined,
      pendingPunisherChoices: undefined,
      pendingBraidsChoices: undefined,
      pendingFreeCastChoices: undefined,
      pendingCombatDamageToPlayer: undefined,
      pendingAttackDeclarations: undefined,
      pendingBlockDeclarations: undefined,
      extraCombatsPending: undefined,
      extraTurnsQueue: undefined,
      extraBeginningPhaseActive: undefined,
      onceEachTurnEffectsUsed: undefined,
      events: [
        ...agentResolved.events,
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          message: "Opening hands drawn. Choose whether to keep or mulligan."
        },
        ...session.events
      ]
    };
    // Per-turn bookkeeping is keyed by turn number, so a restarted game (turn 1 again) would find the last game's entries: forget them all.
    for (const ref of [agentMainActions, agentDecisionRequests, landPlaysThisTurn, firstDrawThisTurn, loyaltyActivationsThisTurn, phaseTriggersChecked, cleanupDiscardChecked, cleanupRestrictedManaChecked]) ref.current.clear();
    spellsCastThisTurn.current.clear();
    agentStatedPlans.current = {};
    setRestrictedManaBatches({});
    setSession(nextSession);
    if (nextSession.activePlayerId && nextSession.activePlayerId !== activeSeatId) setActiveSeatId(nextSession.activePlayerId);
    if (!agentResolved.seats.some((seat) => seat.id === prioritySeatId)) setPrioritySeatId(agentResolved.seats[0].id);
    setMulligans(agentResolved.mulligans);
    setKeptHands(agentResolved.keptHands);
    keptHandsRef.current = agentResolved.keptHands;
    setMulliganReturnCardIds({});
    setPendingAction(undefined);
    replaceStackActions([]);
    setPriorityPasses([]);
    setManaPools({});
    setManaContributions({});
    setManaChoice(undefined);
    setManualLibrarySearch(undefined);
    setPendingRuleChoice(undefined);
    setBlockChoice(undefined);
    setSetupMessage(undefined);
    setGameStage("mulligan");
    setGameOverDismissed(false);
    setMode("game");
  }

  // Whether Save is currently allowed, and why not if it isn't — every transient/in-flight value
  // this checks is provably empty when it returns ok, so buildSaveSnapshot below never has to
  // serialize PendingAction, the stack, an open choice modal, or an in-flight agent LLM call.
  function currentCleanSaveStopStatus() {
    return isCleanSaveStop({
      mode,
      gameStage,
      sessionStatus: session.status,
      hasPendingAction: Boolean(pendingAction),
      stackActionCount: stackActions.length,
      hasOpenModal: Boolean(
        pendingRuleChoice ||
          decisions.hasOpen || // mana/block choices, library look, library searches, myriad tap
          inspectedCard ||
          selectedHandCardId ||
          selectedBlockerIds.length > 0 ||
          Object.values(mulliganReturnCardIds).some((ids) => ids.length > 0)
      ),
      pendingDeathsCount: session.pendingDeaths?.length ?? 0,
      pendingEntriesCount: session.pendingEntries?.length ?? 0,
      pendingCombatDamageToPlayerCount: session.pendingCombatDamageToPlayer?.length ?? 0,
      pendingGraveyardDeparturesCount: session.pendingGraveyardDepartures?.length ?? 0,
      anyAgentThinking: Object.values(agentThinking).some(Boolean),
      prioritySeatId,
      humanSeatId: humanSeat.id
    });
  }

  function buildSaveSnapshot(): GameSnapshot {
    return {
      formatVersion: SAVE_FORMAT_VERSION,
      savedAt: new Date().toISOString(),
      session,
      ...stackStore.snapshot(),
      gameStage,
      holdPriorityOnce,
      mulligans,
      keptHands,
      manaPools,
      manaContributions,
      restrictedManaBatches,
      turnCounters: serializeTurnCounters({
        landPlaysThisTurn: landPlaysThisTurn.current,
        spellsCastThisTurn: spellsCastThisTurn.current,
        firstDrawThisTurn: firstDrawThisTurn.current,
        loyaltyActivationsThisTurn: loyaltyActivationsThisTurn.current,
        phaseTriggersChecked: phaseTriggersChecked.current,
        cleanupDiscardChecked: cleanupDiscardChecked.current,
        cleanupRestrictedManaChecked: cleanupRestrictedManaChecked.current,
        agentMainActions: agentMainActions.current,
        commanderZoneChoiceAsked: commanderZoneChoiceAsked.current,
        auraRetargetAsked: auraRetargetAsked.current
      })
    };
  }

  async function saveGameNow() {
    const status = currentCleanSaveStopStatus();
    if (!status.ok) return;
    const activeSeatName = session.seats.find((seat) => seat.id === activeSeatId)?.name ?? "Unknown";
    const name = `Turn ${session.turn} — ${activeSeatName}`;
    try {
      const response = await fetch("/api/saves", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, snapshot: buildSaveSnapshot() })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      addEvent(`Saved "${name}".`, undefined, "Rules action");
    } catch (error) {
      addEvent(`Failed to save the game: ${error instanceof Error ? error.message : "unknown error"}.`, undefined, "Rules action");
    }
  }

  // The mirror image of startGameInner's own tail above — restores every piece of state that tail
  // resets, then hands off to the game screen exactly the way starting a fresh game does. No page
  // reload, so there's no SSR/hydration path to get wrong.
  function applySnapshot(snapshot: GameSnapshot) {
    if (snapshot.formatVersion !== SAVE_FORMAT_VERSION) {
      setSetupMessage(`This save is from an incompatible version (format ${snapshot.formatVersion}, this build expects ${SAVE_FORMAT_VERSION}) and can't be loaded.`);
      return;
    }
    setSession(snapshot.session);
    stackStore.restore(snapshot, snapshot.session.seats[1]?.id ?? snapshot.session.seats[0].id); // seats + passes; clears pending and stack
    setGameStage(snapshot.gameStage);
    setHoldPriorityOnce(snapshot.holdPriorityOnce);
    setMulligans(snapshot.mulligans);
    setKeptHands(snapshot.keptHands);
    setManaPools(snapshot.manaPools);
    setManaContributions(snapshot.manaContributions);
    setRestrictedManaBatches(snapshot.restrictedManaBatches);
    const counters = deserializeTurnCounters(snapshot.turnCounters);
    landPlaysThisTurn.current = counters.landPlaysThisTurn;
    spellsCastThisTurn.current = counters.spellsCastThisTurn;
    firstDrawThisTurn.current = counters.firstDrawThisTurn;
    loyaltyActivationsThisTurn.current = counters.loyaltyActivationsThisTurn;
    phaseTriggersChecked.current = counters.phaseTriggersChecked;
    cleanupDiscardChecked.current = counters.cleanupDiscardChecked;
    cleanupRestrictedManaChecked.current = counters.cleanupRestrictedManaChecked;
    agentMainActions.current = counters.agentMainActions;
    commanderZoneChoiceAsked.current = counters.commanderZoneChoiceAsked;
    auraRetargetAsked.current = counters.auraRetargetAsked;
    agentDecisionRequests.current = new Set();
    // Every one of these is guaranteed empty by the clean-stop gate at save time — cleared here too
    // since this game object (React state, not the snapshot) may still be carrying stale values from
    // whatever was on screen just before Load was clicked.
    setMulliganReturnCardIds({});
    setLibraryLook(undefined);
    setManualLibrarySearch(undefined);
    setPendingRuleChoice(undefined);
    setBlockChoice(undefined);
    setSelectedBlockerIds([]);
    setMyriadSearch(undefined);
    setMyriadTapChoice(undefined);
    setBasicLandFetchSearch(undefined);
    setManaChoice(undefined);
    setSelectedHandCardId(undefined);
    setInspectedCard(undefined);
    setAgentThinking({});
    setAgentReasoning({});
    defaultDecksApplied.current = true;
    setConfigs(createInitialConfigs(snapshot.session.seats));
    setSetupMessage(undefined);
    setMode("game");
  }

  async function loadSavedGame(id: string) {
    try {
      const response = await fetch(`/api/saves/${id}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot: GameSnapshot = await response.json();
      applySnapshot(snapshot);
    } catch (error) {
      setSetupMessage(`Failed to load save: ${error instanceof Error ? error.message : "unknown error"}.`);
    }
  }

  async function deleteSavedGameEntry(id: string) {
    setSavedGames((current) => current.filter((item) => item.id !== id));
    try {
      await fetch(`/api/saves/${id}`, { method: "DELETE" });
    } catch {
      // Best-effort — the row already dropped from view; a failed DELETE just leaves a stale row
      // server-side until the next successful one, no different from any other fire-and-forget
      // cleanup in this file.
    }
  }

  async function resolveAgentMulligansWithLLM(seats: PlayerSeat[]) {
    const mulliganCounts: Record<string, number> = {};
    const kept: Record<string, boolean> = {};
    const events: GameEvent[] = [];
    const resolvedSeats: PlayerSeat[] = [];

    // One warm-up per distinct agent model, all at once, before any real decision request below —
    // see warmUpAgentModel. They used to run one-per-seat inside the loop (so each seat's warm-up
    // queued behind the previous seat's whole mulligan chain); they are independent, so overlap them.
    await Promise.all(
      Array.from(new Set(seats.filter((seat) => seat.kind === "agent").map((seat) => seat.agentName ?? seat.name))).map((agentName) => warmUpAgentModel(agentName))
    );

    for (const seat of seats) {
      if (seat.kind !== "agent") {
        resolvedSeats.push(seat);
        continue;
      }

      let nextSeat = seat;
      let count = 0;
      while (count < MULLIGAN_HARD_CAP) {
        // Past the soft cap, stop grinding down to a tiny hand unless there's still no land to
        // show for it — a 4-card hand is already a real handicap, and it's rarely worth going
        // lower just to smooth the curve further. Landless is the one case worth pushing past it.
        if (count >= MULLIGAN_SOFT_CAP && nextSeat.board.hand.some(isLandCard)) break;
        const actions: LegalAgentAction[] = [
          { id: "keep-hand", actionType: "keep_hand", targetIds: [], label: `keep ${openingHandKeepSize(count)}` },
          { id: "mulligan", actionType: "mulligan", targetIds: [], label: "take a mulligan" }
        ];
        // Computed here (not just inside requestAgentDecision's own context-building) so the event
        // log can show WHY, not just WHAT — previously this heuristic verdict and the LLM's own
        // stated reason were both computed/requested but silently discarded, leaving
        // describeMulliganOutcome's bare "kept/mulliganed N" as the only visible record. Reported
        // live as "I still think they think weird sometimes" with no way to see the reasoning at all.
        const heuristicHint = evaluateOpeningHand(nextSeat, count);
        let chosen: AgentAction | undefined;
        // A forceMulligan hand is mulliganed whatever the model says (see overrodeKeep below), so the
        // live Ollama round-trip (~3-4s measured, up to the 40s timeout) can't change the outcome — skip it.
        if (!heuristicHint.forceMulligan) {
          try {
            chosen = await requestAgentDecision(nextSeat, "opening_hand_mulligan", actions);
          } catch {
            chosen = undefined;
          }
        }
        let chosenId = chosen?.legalActionId ?? (agentKeepsHand(nextSeat, count) ? "keep-hand" : "mulligan");
        // heuristicHint.forceMulligan is the same "not a judgment call" tier as the 0/7-lands
        // automatic mulligan — route.ts's system prompt only ever advises the model to defer to the
        // heuristic, and a small local model can still talk itself into keeping a hand this bad with
        // reasoning that doesn't hold up. Override the model's choice outright rather than trust the
        // prompt wording to hold in every case.
        const overrodeKeep = heuristicHint.forceMulligan && chosenId === "keep-hand";
        if (overrodeKeep) chosenId = "mulligan";
        // After two mulligans each further one costs a card: a hand the heuristic calls keepable (2-5 lands) is kept whatever the model says,
        // or the agent spirals down to a 4-card hand with nothing to play.
        if (count >= 2 && heuristicHint.keep && chosenId === "mulligan") chosenId = "keep-hand";
        const decisionLabel = chosenId === "keep-hand" ? `keeps its ${openingHandKeepSize(count)}-card hand` : `mulligans its ${openingHandKeepSize(count)}-card hand`;
        const reasonParts = [
          overrodeKeep ? "overriding the model's proposed keep — hand quality too low to keep" : chosen?.reason?.trim(),
          heuristicHint.reasons.length > 0 ? `heuristic: ${heuristicHint.reasons.join("; ")}` : undefined
        ].filter((part): part is string => Boolean(part));
        const reasoningText = reasonParts.length > 0 ? ` ${reasonParts.join(" — ")}.` : "";
        events.push({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId: seat.id,
          message: `${seat.name} ${decisionLabel}.${reasoningText}`,
          detail: "Agent decision"
        });
        recordAgentReasoning(seat.id, {
          label: chosenId === "keep-hand" ? "keep hand" : "mulligan",
          reason: reasonParts.join(" — "),
          purpose: "opening_hand_mulligan",
          at: new Date().toISOString()
        });
        if (chosenId === "keep-hand") break;
        count += 1;
        nextSeat = withOpeningHand(nextSeat, 7, count);
      }

      mulliganCounts[seat.id] = count;
      kept[seat.id] = true;
      nextSeat = keepOpeningHandSize(nextSeat, openingHandKeepSize(count));
      resolvedSeats.push(nextSeat);
    }

    return { seats: resolvedSeats, mulligans: mulliganCounts, keptHands: kept, events };
  }

  // `seatId` is the seat that decides: the host's own seat by default, a friend's seat when a remote intent calls this (see mpIntents.ts, which forces it
  // to the sender's seat). The game only starts once EVERY human seat has kept; an earlier keeper just waits with its hand already trimmed.
  function keepOpeningHand(seatId: string = humanSeat.id) {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat || seat.kind !== "human" || keptHandsRef.current[seatId]) return;
    const returnIds = mulliganReturnCardIds[seatId] ?? [];
    const keepSize = openingHandKeepSize(mulligans[seatId] ?? 0);
    const returnCount = mulliganReturnRequired(seat.board.hand, mulligans[seatId] ?? 0);
    if (returnIds.length !== returnCount) {
      addEvent(`Choose ${returnCount} card${returnCount === 1 ? "" : "s"} to shuffle into your library before keeping.`, seatId, "Mulligan");
      return;
    }
    const lastToKeep = isLastToKeep(session.seats, keptHandsRef.current, seatId);
    keptHandsRef.current = { ...keptHandsRef.current, [seatId]: true };
    setKeptHands((current) => ({ ...current, [seatId]: true }));
    setMulliganReturnCardIds((current) => ({ ...current, [seatId]: [] }));
    const keepMessage = seatVerb(
      seat,
      keepSize === 7 ? `${seat.name} kept 7.` : `${seat.name} kept ${keepSize} and shuffled ${7 - keepSize} card${7 - keepSize === 1 ? "" : "s"} into their library.`,
      keepSize === 7 ? "You kept 7." : `You kept ${keepSize} and shuffled ${7 - keepSize} card${7 - keepSize === 1 ? "" : "s"} into your library.`
    );
    const keepEvent = (suffix: string): GameEvent => ({ id: crypto.randomUUID(), at: new Date().toISOString(), seatId, message: `${keepMessage}${suffix}` });
    if (!lastToKeep) {
      // Others are still deciding: lock this hand in (the discarded cards go back into the library now) and wait.
      setSession((current) => ({
        ...current,
        seats: current.seats.map((item) => (item.id === seatId ? keepOpeningHandSize(item, keepSize, returnIds, true) : item)),
        events: [keepEvent(" Waiting for the other players."), ...current.events]
      }));
      return;
    }
    // Every seat has now kept a hand (agents resolved their mulligans up front in startGame; this seat is the last human to confirm) - this is the
    // correct moment to roll for who plays first, rather than defaulting to a fixed seat.
    const { winnerId: firstSeatId, rolls } = rollForStartingSeat(session.seats);
    setGameStage("playing");
    setActiveSeatId(firstSeatId);
    setPrioritySeatId(firstSeatId); // the active player starts with priority
    setSession((current) => {
      const started: GameSession = {
      ...current,
      status: "playing",
      activePlayerId: firstSeatId,
      phase: "untap step",
      turn: 1,
      seats: current.seats.map((item) => (item.id === seatId ? keepOpeningHandSize(item, keepSize, returnIds, true) : item)),
      events: [
        phaseEvent(
          firstSeatId,
          (() => {
            const firstSeat = current.seats.find((item) => item.id === firstSeatId);
            return firstSeat ? seatVerb(firstSeat, `${firstSeat.name} starts turn 1: untap step.`, "You start turn 1: untap step.") : "Player starts turn 1: untap step.";
          })()
        ),
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          message: `${current.seats
            .map((item) => `${item.name} rolls ${rolls[item.id] ?? "?"}`)
            .join(", ")}. ${current.seats.find((item) => item.id === firstSeatId)?.name ?? "Player"} wins the roll and goes first.`,
          detail: "Starting player roll"
        },
        keepEvent(" The game begins."),
        ...current.events
      ]
      };
      // Leylines and friends: agents (and a friend's seat, which is not asked yet) always begin the game with them on the battlefield.
      return started.seats.filter((item) => item.kind !== "human" || isRemoteSeat(item)).reduce(
        (next, item) => openingHandBattlefieldCards(item).reduce((inner, card) => putOpeningHandCardOnBattlefield(inner, item.id, card.id), next),
        started
      );
    });
    // ...and the host is asked about each one in their opening hand (its hand is already trimmed unless it is the seat that kept last).
    const hostHand = humanSeat.id === seatId ? humanSeat.board.hand.filter((card) => !returnIds.includes(card.id)) : humanSeat.board.hand;
    const humanLeylines = openingHandBattlefieldCards({ ...humanSeat, board: { ...humanSeat.board, hand: hostHand } });
    if (humanLeylines.length > 0) {
      window.setTimeout(() => askOpeningHandBattlefield(humanSeat.id, humanLeylines.map((card) => card.id)), 100);
    }
  }

  function askOpeningHandBattlefield(seatId: string, remainingIds: string[]) {
    const [cardId, ...rest] = remainingIds;
    const card = session.seats.find((item) => item.id === seatId)?.board.hand.find((entry) => entry.id === cardId);
    if (!cardId) return;
    // Not found in the (possibly stale) closure: ask by id anyway through the trigger's own source info.
    const shim = card ?? ({ id: cardId, name: "Opening-hand card", typeLine: "", oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "hand" } as VisibleCard);
    setPendingRuleChoice({
      id: crypto.randomUUID(),
      kind: "choose_trigger_option",
      controllerSeatId: seatId,
      sourceCardId: cardId,
      sourceCardName: shim.name,
      prompt: `${shim.name}: begin the game with it on the battlefield?`,
      options: [{ index: 0, label: "Yes, put it onto the battlefield" }, { index: 1, label: "No, keep it in hand" }],
      trigger: makeCommonTrigger(seatId, seatId, shim, { kind: "opening_hand_battlefield", remainingIds: rest }, shim.name + " opening hand."),
      remainingStack: []
    });
  }

  function mulliganOpeningHand(seatId: string = humanSeat.id) {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat || seat.kind !== "human" || keptHandsRef.current[seatId]) return;
    const currentCount = mulligans[seatId] ?? 0;
    const nextCount = currentCount + 1;
    const nextKeepSize = openingHandKeepSize(nextCount);
    setMulligans((current) => ({ ...current, [seatId]: nextCount }));
    if (seatId === humanSeat.id) setSelectedHandCardId(undefined);
    setMulliganReturnCardIds((current) => ({ ...current, [seatId]: [] }));
    setSession((current) => ({
      ...current,
      seats: current.seats.map((item) => (item.id === seatId ? withOpeningHand(item, 7, nextCount) : item)),
      events: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          seatId,
          message:
            nextCount === 1
              ? seatVerb(seat, `${seat.name} shuffled their hand into their library and drew 7. First mulligan is free.`, "You shuffled your hand into your library and drew 7. First mulligan is free; you can still keep 7.")
              : seatVerb(seat, `${seat.name} mulliganed again.`, `You shuffled your hand into your library and drew 7. Choose ${7 - nextKeepSize} card${7 - nextKeepSize === 1 ? "" : "s"} not to keep.`)
        },
        ...current.events
      ]
    }));
  }

  function toggleMulliganReturnCard(card: Pick<VisibleCard, "id">, seatId: string = humanSeat.id) {
    const seat = session.seats.find((item) => item.id === seatId);
    if (!seat || seat.kind !== "human" || keptHandsRef.current[seatId]) return;
    if (!seat.board.hand.some((handCard) => handCard.id === card.id)) return; // only a card in that seat's own hand
    const required = mulliganReturnRequired(seat.board.hand, mulligans[seatId] ?? 0);
    if (required === 0) return;
    setMulliganReturnCardIds((all) => {
      const current = all[seatId] ?? [];
      if (current.includes(card.id)) return { ...all, [seatId]: current.filter((id) => id !== card.id) };
      if (current.length >= required) return all;
      return { ...all, [seatId]: [...current, card.id] };
    });
  }

  return { askOpeningHandBattlefield, buildDeck, currentCleanSaveStopStatus, deleteSavedGameEntry, keepOpeningHand, loadSavedGame, mulliganOpeningHand, saveGameNow, startGame, toggleMulliganReturnCard, updateConfig };
}
