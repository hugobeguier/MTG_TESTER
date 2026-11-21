// Deterministic handlers for specific commonly played cards' triggered / loyalty abilities that used to fall through to the LLM Rules Advisor
// (Atarka, Thrakkus, Silumgar, Hellkite Tyrant, Balefire Dragon, Zurgo and Ojutai, Ancient Brass Dragon, Ureni, Tiamat, Hellkite Courser, Sarkhan
// Unbroken, Daretti, Disciple of Freyalise, Gyome, Call the Spirit Dragons, Rith, exploit ...). They are recognised from the Oracle TEXT (a regex on
// the clause), never from the card name, so any card with the same wording is covered. A recognised clause becomes a `{ kind: "scripted" }`
// TriggerEffect; resolveScriptedTrigger resolves it, resolveScriptedChoice resolves the human's answers (pendingPlayerChoices resolver
// "scripted_choice"). A human is always asked for a real choice; an agent gets a deterministic heuristic. Same import-cycle rules as triggers.ts:
// function declarations only, no top-level calls of imported bindings.
import { destroyCreatures, moveCardAcrossSeats, moveLibraryCardToDestination } from "@/engine/entry";
import { applyCombatDamageToTarget, dealDamageToCreature, hasHexproof, hasIndestructible } from "@/engine/damage";
import { drawForSeat, transformPermanent } from "@/engine/effects";
import { createTokensForSeat, parseCreateTokenSpecs, predefinedTokenSpec } from "@/engine/tokens";
import type { PendingAction, TriggerEffect } from "@/engine/types";
import { applyCounterDelta, changeControlWithinBattlefield, findPermanentById, queuePlayerChoice, randomInt, rulesEvent, shuffleCards } from "@/engine/zones";
import { winTheGame } from "@/engine/stateBased";
import { effectivePower } from "@/lib/counters";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { hasCardType } from "@/lib/typeGrants";

type Trigger = Extract<PendingAction, { type: "trigger" }>;
const COLORS = ["W", "U", "B", "R", "G"] as const;
const COLOR_NAMES: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };

// Phase scripts: run from applyDeterministicPhaseTrigger (the clause text carries its "At the beginning of ..." head).
export const PHASE_SCRIPTS = new Set(["gyome_food", "color_dragon_counters", "excess_damage_dragon"]);
// Scripts whose resolution opens a library search for a human (useTriggerResolution) and is done by the engine for an agent.
export const SEARCH_SCRIPTS = new Set(["tiamat_tutor", "exploit_tutor"]);

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------------------------------------------------------------------------

function normalizeClause(raw: string): { full: string; body: string } {
  const full = raw
    .replace(/\([^)]*\)/g, "")
    .replace(/[−–]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[+-]?\d+:\s*/, "")
    .replace(/^[a-z',\- ]+: (?=(?:when|whenever|at the beginning))/i, "")
    .trim()
    .toLowerCase();
  const body = full.replace(/^(?:when|whenever|at the beginning of)\b[^,]*,\s*/, "");
  return { full, body };
}

// Whether this trigger clause belongs to one of the scripted cards, and the effect that models it (undefined otherwise).
export function scriptedEffectFromText(raw: string): TriggerEffect | undefined {
  const { full, body } = normalizeClause(raw);
  if (!full) return undefined;
  const attackGrant = full.match(/^whenever an? [a-z]+ you control attacks, it gains ([a-z ]+?) until end of turn\.?$/);
  if (attackGrant) return { kind: "scripted", script: "grant_keywords_context", params: { keywords: attackGrant[1].split(/ and |, /).map((word) => word.trim()).filter(Boolean) } };
  const doubling = full.match(/^whenever [a-z',\- ]+? attacks, double the power of each ([a-z]+) you control until end of turn\.?$/);
  if (doubling) return { kind: "scripted", script: "double_power", params: { subtype: doubling[1] } };
  const shrink = body.match(/^creatures defending player controls get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/);
  if (shrink) return { kind: "scripted", script: "shrink_defenders", params: { power: Number.parseInt(shrink[1], 10), toughness: Number.parseInt(shrink[2], 10) } };
  if (/^gain control of all artifacts that player controls\.?$/.test(body)) return { kind: "scripted", script: "steal_artifacts" };
  if (/^it deals that much damage to each creature that player controls\.?$/.test(body)) return { kind: "scripted", script: "damage_each_creature" };
  if (/^draw a card, then add one mana of any color\.?$/.test(body)) return { kind: "scripted", script: "draw_then_mana" };
  const massSearch = body.match(/^search your library for any number of ([a-z]+) creature cards, put them onto the battlefield, then shuffle\.?$/);
  if (massSearch) return { kind: "scripted", script: "search_put_all", params: { subtype: massSearch[1] } };
  if (/^sacrifice an artifact\. if you do, return target artifact card from your graveyard to the battlefield\.?$/.test(body)) return { kind: "scripted", script: "daretti_sac_return" };
  if (/^look at the top three cards of your library\. put one of them into your hand and the rest on the bottom of your library in any order\. you may return one of those dragons to its owner's hand\.?$/.test(body)) {
    return { kind: "scripted", script: "look_three_take_one", params: { subtype: "dragon" } };
  }
  if (/^roll a d20\. when you do, put any number of target creature cards with total mana value x or less from graveyards onto the battlefield under your control, where x is the result\.?$/.test(body)) {
    return { kind: "d20_roll", payoff: "reanimate_mv" };
  }
  const lookPut = body.match(/^look at the top (eight|seven|six|five|four|three|\d+) cards of your library\. you may put an? ([a-z]+) creature card from among them onto the battlefield\. put the rest on the bottom of your library in a random order\.?$/);
  if (lookPut) {
    const words: Record<string, number> = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
    return { kind: "scripted", script: "look_put_subtype", params: { count: words[lookPut[1]] ?? Number.parseInt(lookPut[1], 10), subtype: lookPut[2] } };
  }
  const tutor = body.match(/^(?:if you cast it, )?search your library for up to five ([a-z]+) cards not named [a-z ,'-]+ that each have different names, reveal them, put them into your hand, then shuffle\.?$/);
  if (tutor) return { kind: "scripted", script: "tiamat_tutor", params: { subtype: tutor[1], count: 5 } };
  if (/^you may put a commander you own from the command zone onto the battlefield\. it gains haste\. return it to the command zone at the beginning of the next end step\.?$/.test(body)) {
    return { kind: "scripted", script: "courser_commander", optional: true };
  }
  if (/^return it to the battlefield under your control, then return this card to the battlefield transformed under your control\.?$/.test(body)) return { kind: "scripted", script: "journey_return" };
  if (/^you may sacrifice another creature\. if you do, you gain x life and draw x cards, where x is that creature'?s power\.?$/.test(body)) {
    return { kind: "scripted", script: "disciple_sacrifice" };
  }
  if (/^create a number of food tokens equal to the number of nontoken creatures you had enter the battlefield under your control this turn\.?$/.test(body)) return { kind: "scripted", script: "gyome_food" };
  if (/^for each color, put a \+1\/\+1 counter on a dragon you control of that color\. if you put \+1\/\+1 counters on five dragons this way, you win the game\.?$/.test(body)) {
    return { kind: "scripted", script: "color_dragon_counters" };
  }
  if (/^if a creature or planeswalker an opponent controlled was dealt excess damage this turn, create a 4\/4 red dragon creature token with flying\.?$/.test(body)) {
    return { kind: "scripted", script: "excess_damage_dragon" };
  }
  if (/^when(?:ever)? [a-z',\- ]+ exploits a creature, you may search your library for a card, put it into your hand, then shuffle\.?$/.test(full)) return { kind: "scripted", script: "exploit_tutor" };
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------------------------------

const seatOf = (session: GameSession, seatId: string) => session.seats.find((seat) => seat.id === seatId);
const params = (trigger: Trigger): Record<string, unknown> => (trigger.effect.kind === "scripted" ? trigger.effect.params ?? {} : {});

function mapCard(session: GameSession, cardId: string, change: (card: VisibleCard) => VisibleCard): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.board.battlefield.some((card) => card.id === cardId) ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (card.id === cardId ? change(card) : card)) } } : seat
    )
  };
}

function worth(card: VisibleCard) {
  return card.manaValue * 2 + Math.max(0, effectivePower(card)) + (card.commander ? 5 : 0);
}

function ask(session: GameSession, seatId: string, source: { id: string; name: string }, prompt: string, options: Array<{ label: string; value: string }>, data: Record<string, unknown>): GameSession {
  return queuePlayerChoice(session, { seatId, sourceCardId: source.id, sourceCardName: source.name, prompt, options, resolver: "scripted_choice", data });
}

function isOfType(card: VisibleCard, word: string) {
  return card.typeLine.toLowerCase().includes(word.toLowerCase()) || Boolean(card.grantedTypes?.some((type) => type.toLowerCase() === word.toLowerCase()));
}

function shuffleLibrary(session: GameSession, seatId: string): GameSession {
  return { ...session, seats: session.seats.map((seat) => (seat.id === seatId ? { ...seat, library: shuffleCards(seat.library ?? []) } : seat)) };
}

// Everything in `ids` leaves the library and goes (shuffled) to the bottom.
function bottomOfLibrary(session: GameSession, seatId: string, ids: string[]): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) => {
      if (seat.id !== seatId) return seat;
      const library = seat.library ?? [];
      const moved = shuffleCards(library.filter((card) => ids.includes(card.id)));
      const next = [...library.filter((card) => !ids.includes(card.id)), ...moved];
      return { ...seat, library: next, zones: { ...seat.zones, library: next.length } };
    })
  };
}

function addMana(session: GameSession, seatId: string, colors: string[], sourceName: string): GameSession {
  return rulesEvent({ ...session, pendingManaGrants: [...(session.pendingManaGrants ?? []), { seatId, colors, sourceName }] }, seatId, `${sourceName}: adds ${colors.map((color) => `{${color}}`).join("")}.`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------------------------------------------------------

// Targets the script wants chosen as it goes on the stack (undefined: none). Used by an agent's trigger target and the human prompt.
export function scriptedTargetCandidates(session: GameSession, trigger: Trigger): Array<{ seatId: string; cardId: string; label: string }> {
  if (trigger.effect.kind === "scripted" && trigger.effect.script === "destroy_nonland_of_player") return nonlandTargetsOf(session, trigger).map((entry) => ({ seatId: entry.seatId, cardId: entry.card.id, label: entry.card.name }));
  if (trigger.effect.kind !== "scripted" || trigger.effect.script !== "daretti_sac_return") return [];
  const seat = seatOf(session, trigger.controllerSeatId);
  return (seat?.board.graveyard ?? []).filter((card) => hasCardType(card, "Artifact")).map((card) => ({ seatId: trigger.controllerSeatId, cardId: card.id, label: card.name }));
}

export function agentScriptedTarget(session: GameSession, trigger: Trigger): string | undefined {
  if (trigger.effect.kind === "scripted" && trigger.effect.script === "destroy_nonland_of_player") return [...nonlandTargetsOf(session, trigger)].sort((a, b) => worth(b.card) - worth(a.card))[0]?.card.id;
  const best = [...scriptedTargetCandidates(session, trigger)]
    .map((entry) => ({ entry, card: (seatOf(session, entry.seatId)?.board.graveyard ?? []).find((card) => card.id === entry.cardId)! }))
    .sort((a, b) => b.card.manaValue - a.card.manaValue)[0];
  return best?.entry.cardId;
}

export function resolveScriptedTrigger(session: GameSession, trigger: Trigger): GameSession {
  if (trigger.effect.kind !== "scripted") return session;
  const script = trigger.effect.script;
  const p = params(trigger);
  const controller = seatOf(session, trigger.controllerSeatId);
  if (!controller) return session;
  const source = findPermanentById(session, trigger.sourceCardId);
  const name = trigger.sourceCardName;
  switch (script) {
    case "grant_keywords_context": {
      const keywords = (p.keywords as string[]) ?? [];
      const id = trigger.contextCardId;
      if (!id) return session;
      const next = mapCard(session, id, (card) => ({ ...card, temporaryGrantedKeywords: [...(card.temporaryGrantedKeywords ?? []), ...keywords], grantedKeywords: [...new Set([...(card.grantedKeywords ?? []), ...keywords])] }));
      return rulesEvent(next, controller.id, `${name}: ${findPermanentById(session, id)?.name ?? "the attacker"} gains ${keywords.join(" and ")} until end of turn.`);
    }
    case "double_power": {
      const subtype = String(p.subtype ?? "");
      const next: GameSession = {
        ...session,
        seats: session.seats.map((seat) =>
          seat.id !== controller.id
            ? seat
            : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (hasCardType(card, "Creature") && isOfType(card, subtype) ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + Math.max(0, effectivePower(card)) } : card)) } }
        )
      };
      return rulesEvent(next, controller.id, `${name}: the power of each ${subtype} ${controller.name} controls is doubled until end of turn.`);
    }
    case "shrink_defenders": {
      const defenderId = String(p.defendingSeatId ?? "");
      const power = Number(p.power ?? -1);
      const toughness = Number(p.toughness ?? -1);
      if (!seatOf(session, defenderId)) return session;
      const next: GameSession = {
        ...session,
        seats: session.seats.map((seat) =>
          seat.id !== defenderId
            ? seat
            : { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.map((card) => (hasCardType(card, "Creature") ? { ...card, temporaryPowerBonus: (card.temporaryPowerBonus ?? 0) + power, temporaryToughnessBonus: (card.temporaryToughnessBonus ?? 0) + toughness } : card)) } }
        )
      };
      return rulesEvent(next, controller.id, `${name}: creatures ${seatOf(session, defenderId)?.name} controls get ${power}/${toughness} until end of turn.`);
    }
    case "steal_artifacts": {
      const fromId = String(p.damagedSeatId ?? "");
      const from = seatOf(session, fromId);
      if (!from || from.id === controller.id) return session;
      let next = session;
      const stolen = from.board.battlefield.filter((card) => hasCardType(card, "Artifact") && !card.phasedOut);
      for (const card of stolen) next = changeControlWithinBattlefield(next, card.id, from.id, controller.id);
      return rulesEvent(next, controller.id, `${name}: ${controller.name} gains control of ${stolen.length} artifact${stolen.length === 1 ? "" : "s"} ${from.name} controlled.`);
    }
    case "damage_each_creature": {
      const victimId = String(p.damagedSeatId ?? "");
      const amount = Number(p.amount ?? 0);
      const victim = seatOf(session, victimId);
      if (!victim || amount <= 0) return session;
      let next = session;
      for (const card of victim.board.battlefield.filter((entry) => hasCardType(entry, "Creature") && !entry.phasedOut)) next = dealDamageToCreature(next, name, victimId, card.id, amount, source, controller.id);
      return rulesEvent(next, controller.id, `${name}: deals ${amount} damage to each creature ${victim.name} controls.`);
    }
    case "draw_then_mana": {
      const drawn = drawForSeat(session, controller.id, `${name}: ${controller.name} draws a card.`);
      if (controller.kind === "human") {
        return ask(drawn, controller.id, { id: trigger.sourceCardId, name }, `${name}: add one mana of any color.`, COLORS.map((color) => ({ label: `{${color}} (${COLOR_NAMES[color]})`, value: color })), { script: "mana_color" });
      }
      const hand = seatOf(drawn, controller.id)?.board.hand ?? [];
      const wanted = COLORS.map((color) => ({ color, count: hand.filter((card) => card.colors.includes(color)).length })).sort((a, b) => b.count - a.count)[0];
      return addMana(drawn, controller.id, [wanted && wanted.count > 0 ? wanted.color : "G"], name);
    }
    case "search_put_all": {
      const subtype = String(p.subtype ?? "");
      let next = session;
      const found = (controller.library ?? []).filter((card) => hasCardType(card, "Creature") && isOfType(card, subtype));
      for (const card of found) next = moveLibraryCardToDestination(next, controller.id, card.id, "battlefield", false, true);
      return rulesEvent(shuffleLibrary(next, controller.id), controller.id, `${name}: ${controller.name} puts ${found.length} ${subtype} creature card${found.length === 1 ? "" : "s"} onto the battlefield and shuffles.`);
    }
    case "daretti_sac_return": {
      const artifacts = controller.board.battlefield.filter((card) => hasCardType(card, "Artifact"));
      if (artifacts.length === 0) return rulesEvent(session, controller.id, `${name}: ${controller.name} has no artifact to sacrifice.`);
      const targetId = trigger.effect.chosenOption ?? agentScriptedTarget(session, trigger);
      const data = { script: "daretti_sac", targetId: targetId ?? "" };
      if (controller.kind === "human") {
        return ask(session, controller.id, { id: trigger.sourceCardId, name }, `${name}: sacrifice an artifact.`, artifacts.map((card) => ({ label: card.name, value: card.id })), data);
      }
      const cheapest = [...artifacts].sort((a, b) => Number(Boolean(b.token)) - Number(Boolean(a.token)) || a.manaValue - b.manaValue)[0];
      return finishDaretti(session, controller.id, name, cheapest.id, targetId);
    }
    case "look_three_take_one": {
      const top = (controller.library ?? []).slice(0, 3);
      if (top.length === 0) return rulesEvent(session, controller.id, `${name}: ${controller.name}'s library is empty.`);
      const dealer = trigger.contextCardId ?? "";
      const data = { script: "look_pick", ids: top.map((card) => card.id), dealerId: dealer };
      if (controller.kind === "human") return ask(session, controller.id, { id: trigger.sourceCardId, name }, `${name}: put one of the top ${top.length} cards into your hand (the rest go to the bottom).`, top.map((card) => ({ label: `${card.name} (${card.typeLine})`, value: card.id })), data);
      const best = [...top].sort((a, b) => Number(!isLandCardLike(b)) - Number(!isLandCardLike(a)) || b.manaValue - a.manaValue)[0];
      return finishLookThree(session, controller.id, name, data.ids, best.id, dealer);
    }
    case "look_put_subtype": {
      const count = Number(p.count ?? 8);
      const subtype = String(p.subtype ?? "dragon");
      const top = (controller.library ?? []).slice(0, count);
      const matches = top.filter((card) => hasCardType(card, "Creature") && isOfType(card, subtype));
      const data = { script: "look_put", ids: top.map((card) => card.id) };
      if (controller.kind === "human" && matches.length > 0) {
        return ask(session, controller.id, { id: trigger.sourceCardId, name }, `${name}: you may put a ${subtype} creature card from the top ${top.length} onto the battlefield (the rest go to the bottom in a random order).`, [...matches.map((card) => ({ label: card.name, value: card.id })), { label: "Don't put a card onto the battlefield", value: "none" }], data);
      }
      const best = [...matches].sort((a, b) => b.manaValue - a.manaValue)[0];
      return finishLookPut(session, controller.id, name, data.ids, best?.id);
    }
    case "tiamat_tutor": {
      if (controller.kind === "human") return queueSearch(session, controller.id, trigger.sourceCardId, name, script);
      const subtype = String(p.subtype ?? "dragon");
      const wanted = Math.max(1, Number(p.count ?? 5));
      const library = controller.library ?? [];
      const picks: VisibleCard[] = [];
      for (const card of [...library].filter((entry) => isOfType(entry, subtype) && entry.name !== name).sort((a, b) => b.manaValue - a.manaValue)) {
        if (picks.length >= wanted) break;
        if (!picks.some((entry) => entry.name === card.name)) picks.push(card);
      }
      return finishSearchToHand(session, controller.id, name, picks.map((card) => card.id));
    }
    case "exploit_tutor": {
      if (controller.kind === "human") return queueSearch(session, controller.id, trigger.sourceCardId, name, script);
      const library = controller.library ?? [];
      const best = [...library].sort((a, b) => Number(!isLandCardLike(b)) - Number(!isLandCardLike(a)) || b.manaValue - a.manaValue)[0];
      return finishSearchToHand(session, controller.id, name, best ? [best.id] : []);
    }
    case "courser_commander": {
      const commanders = [controller.board.commander].filter((card): card is VisibleCard => Boolean(card));
      if (commanders.length === 0) return rulesEvent(session, controller.id, `${name}: ${controller.name} has no commander in the command zone.`);
      return putCommanderOntoBattlefield(session, controller.id, name, commanders[0].id);
    }
    case "disciple_sacrifice": {
      const others = controller.board.battlefield.filter((card) => hasCardType(card, "Creature") && card.id !== trigger.sourceCardId && !card.phasedOut);
      if (others.length === 0) return rulesEvent(session, controller.id, `${name}: ${controller.name} has no other creature to sacrifice.`);
      if (controller.kind === "human") {
        return ask(session, controller.id, { id: trigger.sourceCardId, name }, `${name}: sacrifice another creature to gain X life and draw X cards (X = its power)?`, [...others.map((card) => ({ label: `${card.name} (power ${Math.max(0, effectivePower(card))})`, value: card.id })), { label: "Don't sacrifice", value: "none" }], { script: "disciple_sac" });
      }
      const fodder = [...others].sort((a, b) => Number(Boolean(b.token)) - Number(Boolean(a.token)) || effectivePower(b) - effectivePower(a))[0];
      // An agent sacrifices only a token or a creature it values below the cards it would draw.
      if (!fodder || (!fodder.token && worth(fodder) > Math.max(0, effectivePower(fodder)) * 2 + 2)) return session;
      return finishDisciple(session, controller.id, name, fodder.id);
    }
    case "gyome_food": {
      const entered = controller.board.battlefield.filter((card) => hasCardType(card, "Creature") && !card.token && card.enteredTurn === session.turn).length;
      if (entered <= 0) return session;
      return createTokensForSeat(session, controller.id, trigger.sourceCardId, [{ ...predefinedTokenSpec("Food"), count: entered }]).session;
    }
    case "color_dragon_counters":
      return resolveColorDragonCounters(session, controller, trigger);
    case "excess_damage_dragon": {
      const record = session.excessDamageTurn;
      const hit = record?.turn === session.turn && record.seatIds.some((id) => id !== controller.id);
      if (!hit) return session;
      const specs = parseCreateTokenSpecs("create a 4/4 red Dragon creature token with flying");
      return createTokensForSeat(session, controller.id, trigger.sourceCardId, specs).session;
    }
    case "riot": {
      const id = trigger.contextCardId ?? trigger.sourceCardId;
      const creature = findPermanentById(session, id);
      if (!creature) return session;
      if (controller.kind === "human") return ask(session, controller.id, { id, name: creature.name }, `${creature.name}: riot. Choose a +1/+1 counter or haste.`, [{ label: "+1/+1 counter", value: "counter" }, { label: "Haste", value: "haste" }], { script: "riot", cardId: id });
      return applyRiot(session, controller.id, id, hasHasteAlready(creature) ? "counter" : "counter");
    }
    case "journey_return":
      return resolveJourneyReturn(session, controller, trigger);
    case "exploit":
      return resolveExploit(session, controller, trigger);
    case "destroy_nonland_of_player":
      return resolveDestroyNonland(session, trigger);
    default:
      return session;
  }
}

function queueSearch(session: GameSession, seatId: string, sourceCardId: string, sourceName: string, script: string): GameSession {
  return { ...session, pendingScriptedSearch: [...(session.pendingScriptedSearch ?? []), { seatId, sourceCardId, sourceCardName: sourceName, script }] };
}

function isLandCardLike(card: VisibleCard) {
  return /\bLand\b/.test(card.typeLine);
}

function finishDaretti(session: GameSession, seatId: string, name: string, sacrificeId: string, targetId: string | undefined): GameSession {
  const seat = seatOf(session, seatId);
  const sacrificed = seat?.board.battlefield.find((card) => card.id === sacrificeId);
  if (!seat || !sacrificed) return session;
  let next = destroyCreatures(session, [{ seatId, cardId: sacrificeId, message: `${seat.name} sacrifices ${sacrificed.name} to ${name}.` }], "Rules action");
  const target = targetId ? (seatOf(next, seatId)?.board.graveyard ?? []).find((card) => card.id === targetId) : undefined;
  if (!target) return rulesEvent(next, seatId, `${name}: there is no artifact card to return.`);
  next = moveCardAcrossSeats(next, seatId, target.id, seatId, "battlefield").session;
  return rulesEvent(next, seatId, `${name}: ${seat.name} returns ${target.name} from the graveyard to the battlefield.`);
}

function finishLookThree(session: GameSession, seatId: string, name: string, ids: string[], pickedId: string, dealerId: string): GameSession {
  const seat = seatOf(session, seatId);
  const picked = (seat?.library ?? []).find((card) => card.id === pickedId);
  if (!seat || !picked) return session;
  let next = moveLibraryCardToDestination(session, seatId, pickedId, "hand", false);
  next = bottomOfLibrary(next, seatId, ids.filter((id) => id !== pickedId));
  next = rulesEvent(next, seatId, `${name}: ${seat.name} puts a card from the top of their library into their hand and the rest on the bottom.`);
  const dragon = dealerId ? findPermanentById(next, dealerId) : undefined;
  if (!dragon || !isOfType(dragon, "dragon")) return next;
  if (seat.kind === "human") {
    return ask(next, seatId, { id: dealerId, name }, `${name}: you may return ${dragon.name} to its owner's hand.`, [{ label: `Return ${dragon.name} to hand`, value: dealerId }, { label: "Keep it on the battlefield", value: "none" }], { script: "zurgo_bounce" });
  }
  return next;
}

function finishLookPut(session: GameSession, seatId: string, name: string, ids: string[], pickedId: string | undefined): GameSession {
  const seat = seatOf(session, seatId);
  if (!seat) return session;
  let next = session;
  const picked = pickedId ? (seat.library ?? []).find((card) => card.id === pickedId) : undefined;
  if (picked) next = moveLibraryCardToDestination(next, seatId, picked.id, "battlefield", false, true);
  next = bottomOfLibrary(next, seatId, ids.filter((id) => id !== picked?.id));
  return rulesEvent(next, seatId, picked ? `${name}: ${seat.name} puts ${picked.name} onto the battlefield and the rest on the bottom of their library.` : `${name}: ${seat.name} puts the cards on the bottom of their library.`);
}

// Moves the chosen library cards to hand (revealed) and shuffles. Public: the human library-search prompt answers through the same helper's result.
export function finishSearchToHand(session: GameSession, seatId: string, name: string, ids: string[]): GameSession {
  let next = session;
  for (const id of ids) next = moveLibraryCardToDestination(next, seatId, id, "hand", false, true);
  return rulesEvent(shuffleLibrary(next, seatId), seatId, `${name}: ${seatOf(session, seatId)?.name ?? "Player"} searches their library for ${ids.length} card${ids.length === 1 ? "" : "s"} and shuffles.`);
}

function putCommanderOntoBattlefield(session: GameSession, seatId: string, name: string, commanderId: string): GameSession {
  const seat = seatOf(session, seatId);
  const commander = seat?.board.commander;
  if (!seat || !commander || commander.id !== commanderId) return session;
  const entered: VisibleCard = {
    ...commander,
    zone: "battlefield",
    tapped: false,
    summoningSick: false,
    enteredFrom: "command",
    enteredTurn: session.turn,
    returnToCommandAtEnd: true,
    commander: true,
    temporaryGrantedKeywords: [...(commander.temporaryGrantedKeywords ?? []), "haste"],
    grantedKeywords: [...new Set([...(commander.grantedKeywords ?? []), "haste"])]
  };
  const next: GameSession = {
    ...session,
    seats: session.seats.map((item) =>
      item.id !== seatId ? item : { ...item, board: { ...item.board, commander: undefined, battlefield: [...item.board.battlefield, entered] }, zones: { ...item.zones, battlefield: item.zones.battlefield + 1, command: Math.max(0, item.zones.command - 1) } }
    ),
    pendingEntries: [...(session.pendingEntries ?? []), { seatId, card: entered }]
  };
  return rulesEvent(next, seatId, `${name}: ${seat.name} puts ${commander.name} onto the battlefield from the command zone. It gains haste and returns to the command zone at the next end step.`);
}

// Hellkite Courser's delayed return: called from applyEndStepEffects for every permanent still flagged.
export function returnFlaggedCommandersToCommandZone(session: GameSession): GameSession {
  let next = session;
  for (const seat of session.seats) {
    for (const card of seat.board.battlefield.filter((entry) => entry.returnToCommandAtEnd)) {
      const ownerId = card.ownerSeatId ?? seat.id;
      next = {
        ...next,
        seats: next.seats.map((item) => {
          if (item.id === seat.id) return { ...item, board: { ...item.board, battlefield: item.board.battlefield.filter((entry) => entry.id !== card.id) }, zones: { ...item.zones, battlefield: Math.max(0, item.zones.battlefield - 1) } };
          return item;
        })
      };
      next = {
        ...next,
        seats: next.seats.map((item) =>
          item.id !== ownerId
            ? item
            : { ...item, board: { ...item.board, commander: { ...card, zone: "command" as const, returnToCommandAtEnd: undefined, tapped: false, attacking: false, blocking: false, damage: undefined, temporaryGrantedKeywords: undefined, grantedKeywords: undefined, counters: undefined } }, zones: { ...item.zones, command: item.zones.command + 1 } }
        )
      };
      next = rulesEvent(next, ownerId, `${card.name} returns to the command zone.`);
    }
  }
  return next;
}

function finishDisciple(session: GameSession, seatId: string, name: string, creatureId: string): GameSession {
  const seat = seatOf(session, seatId);
  const creature = seat?.board.battlefield.find((card) => card.id === creatureId);
  if (!seat || !creature) return session;
  const x = Math.max(0, effectivePower(creature));
  let next = destroyCreatures(session, [{ seatId, cardId: creatureId, message: `${seat.name} sacrifices ${creature.name} to ${name}.` }], "Rules action");
  next = rulesEvent({ ...next, seats: next.seats.map((item) => (item.id === seatId ? { ...item, life: item.life + x } : item)) }, seatId, `${name}: ${seat.name} gains ${x} life.`);
  for (let i = 0; i < x; i += 1) next = drawForSeat(next, seatId, `${name}: ${seat.name} draws a card.`);
  return next;
}

// "For each color, put a +1/+1 counter on a Dragon you control of that color. If you put +1/+1 counters on five Dragons this way, you win the game."
// The distribution is chosen so as many DIFFERENT Dragons as possible get a counter (a matching, fewest-options colour first), which is what wins.
function resolveColorDragonCounters(session: GameSession, controller: PlayerSeat, trigger: Trigger): GameSession {
  const dragons = controller.board.battlefield.filter((card) => hasCardType(card, "Creature") && isOfType(card, "dragon") && !card.phasedOut);
  const options = COLORS.map((color) => ({ color, cards: dragons.filter((card) => card.colors.includes(color)) })).filter((entry) => entry.cards.length > 0);
  const used = new Set<string>();
  const received = new Map<string, number>();
  for (const entry of [...options].sort((a, b) => a.cards.length - b.cards.length)) {
    const pick = entry.cards.find((card) => !used.has(card.id)) ?? [...entry.cards].sort((a, b) => (received.get(a.id) ?? 0) - (received.get(b.id) ?? 0))[0];
    used.add(pick.id);
    received.set(pick.id, (received.get(pick.id) ?? 0) + 1);
  }
  let next = session;
  for (const [cardId, count] of received) next = mapCard(next, cardId, (card) => applyCounterDelta(card, "+1/+1", count));
  next = rulesEvent(next, controller.id, `${trigger.sourceCardName}: ${controller.name} puts +1/+1 counters on ${received.size} Dragon${received.size === 1 ? "" : "s"}.`);
  return received.size >= 5 ? winTheGame(next, controller.id, trigger.sourceCardName) : next;
}

// Exploit (generic keyword): when the creature enters its controller may sacrifice a creature (itself included); afterwards "exploits" payoffs run.
function resolveExploit(session: GameSession, controller: PlayerSeat, trigger: Trigger): GameSession {
  const creatures = controller.board.battlefield.filter((card) => hasCardType(card, "Creature") && !card.phasedOut);
  if (creatures.length === 0) return session;
  const name = trigger.sourceCardName;
  if (controller.kind === "human") {
    return ask(session, controller.id, { id: trigger.sourceCardId, name }, `${name}: exploit. You may sacrifice a creature.`, [...creatures.map((card) => ({ label: `${card.name}${card.id === trigger.sourceCardId ? " (itself)" : ""}`, value: card.id })), { label: "Don't exploit", value: "none" }], { script: "exploit" });
  }
  // An agent exploits only a token or a creature clearly worth less than the card's payoff (cheap fodder), never its best creature.
  const fodder = [...creatures].filter((card) => card.id !== trigger.sourceCardId).sort((a, b) => Number(Boolean(b.token)) - Number(Boolean(a.token)) || worth(a) - worth(b))[0];
  if (!fodder || (!fodder.token && fodder.manaValue > 2)) return session;
  return finishExploit(session, controller.id, trigger.sourceCardId, name, fodder.id);
}

function finishExploit(session: GameSession, seatId: string, exploiterId: string, name: string, victimId: string): GameSession {
  const seat = seatOf(session, seatId);
  const victim = seat?.board.battlefield.find((card) => card.id === victimId);
  if (!seat || !victim) return session;
  const exploiterText = (findPermanentById(session, exploiterId) ?? victim).oracleText;
  let next = destroyCreatures(session, [{ seatId, cardId: victimId, message: `${seat.name} sacrifices ${victim.name} to exploit with ${name}.` }], "Rules action");
  next = rulesEvent(next, seatId, `${name} exploits ${victim.name}.`);
  // The payoff text ("When ~ exploits a creature, ...") of the exploiting creature, parsed like any other trigger clause.
  const payoff = exploiterText.split("\n").map((line) => line.replace(/\([^)]*\)/g, "").trim()).find((line) => /^when(?:ever)? [^,]+ exploits a creature,/i.test(line));
  if (!payoff) return next;
  const effect = scriptedEffectFromText(payoff);
  if (effect) {
    const fresh: Trigger = { id: crypto.randomUUID(), type: "trigger", actorSeatId: seatId, controllerSeatId: seatId, sourceCardId: exploiterId, sourceCardName: name, triggerKind: "common", effect, message: `${name} exploited a creature.` };
    return resolveScriptedTrigger(next, fresh);
  }
  return next;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Human answers
// ---------------------------------------------------------------------------------------------------------------------------------------------

export function resolveScriptedChoice(session: GameSession, seatId: string, sourceCardId: string, sourceName: string, data: Record<string, unknown>, value: string | undefined): GameSession {
  const script = String(data.script ?? "");
  const seat = seatOf(session, seatId);
  if (!seat) return session;
  switch (script) {
    case "mana_color":
      return value && COLORS.includes(value as (typeof COLORS)[number]) ? addMana(session, seatId, [value], sourceName) : session;
    case "daretti_sac":
      return value && value !== "none" ? finishDaretti(session, seatId, sourceName, value, String(data.targetId ?? "") || undefined) : session;
    case "look_pick":
      return value ? finishLookThree(session, seatId, sourceName, (data.ids as string[]) ?? [], value, String(data.dealerId ?? "")) : session;
    case "zurgo_bounce": {
      if (!value || value === "none") return session;
      const dragon = findPermanentById(session, value);
      if (!dragon) return session;
      const holder = session.seats.find((item) => item.board.battlefield.some((card) => card.id === value));
      return holder ? rulesEvent(moveCardAcrossSeats(session, holder.id, value, dragon.ownerSeatId ?? holder.id, "hand").session, seatId, `${sourceName}: ${dragon.name} returns to its owner's hand.`) : session;
    }
    case "look_put":
      return finishLookPut(session, seatId, sourceName, (data.ids as string[]) ?? [], value && value !== "none" ? value : undefined);
    case "disciple_sac":
      return value && value !== "none" ? finishDisciple(session, seatId, sourceName, value) : session;
    case "exploit":
      return value && value !== "none" ? finishExploit(session, seatId, sourceCardId, sourceName, value) : session;
    case "riot":
      return applyRiot(session, seatId, String(data.cardId ?? sourceCardId), value === "haste" ? "haste" : "counter");
    case "hand_land":
      return value && value !== "none" ? putHandLandOntoBattlefield(session, seatId, sourceName, value) : session;
    case "wrathful_target":
      return value ? dealScriptedDamage(session, seatId, String(data.sourceCardId ?? sourceCardId), sourceName, Number(data.amount ?? 0), value) : session;
    case "d20_pick":
      return continueD20Reanimate(session, seatId, sourceCardId, sourceName, Number(data.remaining ?? 0), value);
    default:
      return session;
  }
}

// Ancient Brass Dragon: after the d20 roll, any number of creature cards from graveyards with total mana value X or less come back under the
// roller's control. A human is asked one card at a time (with "Done"); an agent takes the greediest set that fits.
export function startD20Reanimate(session: GameSession, seatId: string, sourceCardId: string, sourceName: string, roll: number): GameSession {
  const seat = seatOf(session, seatId);
  if (!seat) return session;
  if (seat.kind === "human") return continueD20Reanimate(session, seatId, sourceCardId, sourceName, roll, undefined);
  let remaining = roll;
  let next = session;
  const pool = session.seats.flatMap((holder) => (holder.board.graveyard ?? []).filter((card) => hasCardType(card, "Creature")).map((card) => ({ holderId: holder.id, card }))).sort((a, b) => b.card.manaValue - a.card.manaValue);
  for (const entry of pool) {
    if (entry.card.manaValue > remaining) continue;
    remaining -= entry.card.manaValue;
    next = reanimateFromGraveyard(next, seatId, entry.holderId, entry.card.id, sourceName);
  }
  return next;
}

function reanimateFromGraveyard(session: GameSession, seatId: string, holderId: string, cardId: string, sourceName: string): GameSession {
  const card = (seatOf(session, holderId)?.board.graveyard ?? []).find((entry) => entry.id === cardId);
  if (!card) return session;
  const moved = moveCardAcrossSeats(session, holderId, cardId, seatId, "battlefield").session;
  return rulesEvent(moved, seatId, `${sourceName}: ${seatOf(session, seatId)?.name ?? "Player"} puts ${card.name} onto the battlefield under their control.`);
}

function continueD20Reanimate(session: GameSession, seatId: string, sourceCardId: string, sourceName: string, remainingBefore: number, value: string | undefined): GameSession {
  let remaining = remainingBefore;
  let next = session;
  if (value === "done") return session;
  if (value) {
    const [holderId, cardId] = value.split(":");
    const card = (seatOf(session, holderId)?.board.graveyard ?? []).find((entry) => entry.id === cardId);
    if (card && card.manaValue <= remaining) {
      remaining -= card.manaValue;
      next = reanimateFromGraveyard(session, seatId, holderId, cardId, sourceName);
    }
  }
  const options = next.seats.flatMap((holder) => (holder.board.graveyard ?? []).filter((card) => hasCardType(card, "Creature") && card.manaValue <= remaining).map((card) => ({ label: `${card.name} (mana value ${card.manaValue}, ${holder.name}'s graveyard)`, value: `${holder.id}:${card.id}` })));
  if (options.length === 0) return next;
  return ask(next, seatId, { id: sourceCardId, name: sourceName }, `${sourceName}: choose a creature card with mana value ${remaining} or less to put onto the battlefield.`, [...options, { label: "Done", value: "done" }], { script: "d20_pick", remaining });
}

// Rolling the d20 for "reanimate_mv" (called from the d20_roll branch of triggers.ts).
export function rollD20(): number {
  return randomInt(20) + 1;
}

export function scriptedSearchPrompt(script: string): { prompt: string; maxChoices: number; filter: string } | undefined {
  if (script === "tiamat_tutor") return { prompt: "{name}: search your library for up to five Dragon cards with different names, reveal them and put them into your hand, then shuffle.", maxChoices: 5, filter: "dragon" };
  if (script === "exploit_tutor") return { prompt: "{name}: search your library for a card, put it into your hand, then shuffle.", maxChoices: 1, filter: "land, creature, artifact, enchantment, instant, sorcery, planeswalker, battle" };
  return undefined;
}

// Exploit: the creature's own ETB trigger.
// Riot (printed, or granted by Rhythm of the Wild's "Nontoken creatures you control have riot"): the entering creature gets a +1/+1 counter or haste, the controller's choice.
export function riotTriggerFor(session: GameSession, enteringSeatId: string, entering: VisibleCard): TriggerEffect | undefined {
  if (!hasCardType(entering, "Creature")) return undefined;
  const printed = /^riot\b/im.test(entering.oracleText);
  const granted = !entering.token && (seatOf(session, enteringSeatId)?.board.battlefield ?? []).some((source) => !source.abilitiesStripped && !source.phasedOut && /\bnontoken creatures you control have riot\b/i.test(source.oracleText));
  return printed || granted ? { kind: "scripted", script: "riot" } : undefined;
}

export function exploitTriggerFor(source: VisibleCard): TriggerEffect | undefined {
  return /^exploit\b/im.test(source.oracleText) ? { kind: "scripted", script: "exploit" } : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// "Is dealt damage" watchers: Wrathful Red Dragon and the excess-damage record Rith reads (called from applyDealtDamageTriggers).
// ---------------------------------------------------------------------------------------------------------------------------------------------

// "Whenever a Dragon you control is dealt damage, it deals that much damage to any target that isn't a Dragon." (Wrathful Red Dragon)
const DRAGON_DAMAGED = /^whenever a ([a-z]+) you control is dealt damage, it deals that much damage to any target that isn'?t an? ([a-z]+)\.?$/i;

export function recordExcessDamage(session: GameSession, seatId: string, card: VisibleCard, amount: number): GameSession {
  if (amount <= 0 || !(hasCardType(card, "Creature") || hasCardType(card, "Planeswalker"))) return session;
  const remaining = Math.max(0, effectiveToughnessOf(card) - (card.damage ?? 0));
  if (hasCardType(card, "Creature") && amount <= remaining) return session;
  const current = session.excessDamageTurn?.turn === session.turn ? session.excessDamageTurn.seatIds : [];
  return current.includes(seatId) ? session : { ...session, excessDamageTurn: { turn: session.turn, seatIds: [...current, seatId] } };
}

function effectiveToughnessOf(card: VisibleCard) {
  const parsed = Number.parseInt(card.toughness ?? "0", 10);
  return (Number.isFinite(parsed) ? parsed : 0) + (card.temporaryToughnessBonus ?? 0) + (card.attachmentToughnessBonus ?? 0) + (card.counters?.find((counter) => counter.kind === "+1/+1")?.count ?? 0) - (card.counters?.find((counter) => counter.kind === "-1/-1")?.count ?? 0);
}

export function applyDamagedWatchers(session: GameSession, seatId: string, damaged: VisibleCard, amount: number): GameSession {
  if (amount <= 0 || !hasCardType(damaged, "Creature")) return session;
  let next = session;
  const holder = seatOf(session, seatId);
  if (!holder) return session;
  for (const watcher of holder.board.battlefield) {
    if (watcher.abilitiesStripped || watcher.phasedOut) continue;
    for (const raw of watcher.oracleText.split("\n")) {
      const match = raw.replace(/\([^)]*\)/g, "").trim().match(DRAGON_DAMAGED);
      if (!match || !isOfType(damaged, match[1])) continue;
      const excluded = match[2];
      const candidates: Array<{ label: string; value: string }> = [];
      for (const seat of next.seats) {
        if (seat.hasLost) continue;
        candidates.push({ label: `${seat.name} (${seat.life} life)`, value: `p:${seat.id}` });
        for (const card of seat.board.battlefield) {
          if (card.phasedOut || !(hasCardType(card, "Creature") || hasCardType(card, "Planeswalker")) || isOfType(card, excluded)) continue;
          if (seat.id !== holder.id && hasHexproof(card)) continue;
          candidates.push({ label: `${card.name} — ${seat.id === holder.id ? "yours" : seat.name}`, value: `c:${seat.id}:${card.id}` });
        }
      }
      if (candidates.length === 0) continue;
      if (holder.kind === "human") {
        next = ask(next, holder.id, { id: watcher.id, name: watcher.name }, `${watcher.name}: ${damaged.name} was dealt ${amount} damage. Choose any target that isn't ${/^[aeiou]/.test(excluded) ? "an" : "a"} ${excluded} to take ${amount} damage.`, candidates, { script: "wrathful_target", amount, sourceCardId: watcher.id });
        continue;
      }
      // An agent: kill the best opposing creature the damage destroys, else hit the opponent with the lowest life.
      const kills = next.seats
        .filter((seat) => seat.id !== holder.id && !seat.hasLost)
        .flatMap((seat) => seat.board.battlefield.filter((card) => hasCardType(card, "Creature") && !isOfType(card, excluded) && !card.phasedOut && effectiveToughnessOf(card) - (card.damage ?? 0) <= amount).map((card) => ({ seat, card })))
        .sort((a, b) => worth(b.card) - worth(a.card))[0];
      const face = next.seats.filter((seat) => seat.id !== holder.id && !seat.hasLost).sort((a, b) => a.life - b.life)[0];
      const pick = kills ? `c:${kills.seat.id}:${kills.card.id}` : face ? `p:${face.id}` : undefined;
      if (pick) next = dealScriptedDamage(next, holder.id, watcher.id, watcher.name, amount, pick);
    }
  }
  return next;
}

export function dealScriptedDamage(session: GameSession, controllerId: string, sourceCardId: string, sourceName: string, amount: number, value: string): GameSession {
  const [kind, seatId, cardId] = value.split(":");
  const source = findPermanentById(session, sourceCardId);
  if (kind === "p") {
    const target = seatOf(session, seatId);
    if (!target) return session;
    return applyCombatDamageToTarget(session, sourceName, { seat: target }, amount, source, controllerId, "noncombat");
  }
  if (kind === "c" && cardId) {
    const permanent = seatOf(session, seatId)?.board.battlefield.find((card) => card.id === cardId);
    if (!permanent) return session;
    if (hasCardType(permanent, "Planeswalker") && !hasCardType(permanent, "Creature")) {
      return applyCombatDamageToTarget(session, sourceName, { seat: seatOf(session, seatId)!, planeswalker: permanent }, amount, source, controllerId, "noncombat");
    }
    return dealDamageToCreature(session, sourceName, seatId, cardId, amount, source, controllerId);
  }
  return session;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// "Becomes the target of a spell an opponent controls" hook (called as a spell is put on the stack with its chosen targets, rule 601.2c).
// ---------------------------------------------------------------------------------------------------------------------------------------------

// "Spells your opponents cast that target this creature cost an additional 3 life to cast." (Terror of the Peaks): the life each targeted permanent charges.
export function targetingLifeTaxFor(card: VisibleCard): number {
  if (card.abilitiesStripped || card.phasedOut) return 0;
  const match = card.oracleText.replace(/\([^)]*\)/g, "").match(/\bspells your opponents cast that target this (?:creature|permanent|artifact|enchantment) cost an additional (\d+) life to cast\b/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function targetedPermanents(session: GameSession, casterSeatId: string, targets: Array<{ kind: string; seatId?: string; cardId?: string }>): Array<{ seatId: string; card: VisibleCard }> {
  const out: Array<{ seatId: string; card: VisibleCard }> = [];
  for (const target of targets) {
    if (target.kind !== "card" || !target.seatId || !target.cardId || target.seatId === casterSeatId) continue;
    const card = seatOf(session, target.seatId)?.board.battlefield.find((item) => item.id === target.cardId);
    if (card) out.push({ seatId: target.seatId, card });
  }
  return out;
}

export function targetingLifeTax(session: GameSession, casterSeatId: string, targets: Array<{ kind: string; seatId?: string; cardId?: string }>): number {
  return targetedPermanents(session, casterSeatId, targets).reduce((sum, entry) => sum + targetingLifeTaxFor(entry.card), 0);
}

// Pays the life tax (additional cost of the spell, paid as it is cast).
export function applyTargetingLifeTax(session: GameSession, casterSeatId: string, targets: Array<{ kind: string; seatId?: string; cardId?: string }>): GameSession {
  const tax = targetingLifeTax(session, casterSeatId, targets);
  if (tax <= 0) return session;
  const caster = seatOf(session, casterSeatId);
  if (!caster) return session;
  return rulesEvent({ ...session, seats: session.seats.map((item) => (item.id === casterSeatId ? { ...item, life: item.life - tax } : item)) }, casterSeatId, `${caster.name} pays ${tax} life as an additional cost for targeting a permanent that taxes spells with life.`);
}

// Scalelord Reckoner: "Whenever a Dragon you control becomes the target of a spell or ability an opponent controls, destroy target nonland permanent that
// player controls." One trigger per watcher per targeted Dragon.
export function findSpellTargetTriggers(session: GameSession, casterSeatId: string, targets: Array<{ kind: string; seatId?: string; cardId?: string }>): Trigger[] {
  const triggers: Trigger[] = [];
  for (const { seatId, card } of targetedPermanents(session, casterSeatId, targets)) {
    const holder = seatOf(session, seatId);
    if (!holder) continue;
    for (const watcher of holder.board.battlefield) {
      if (watcher.abilitiesStripped || watcher.phasedOut) continue;
      for (const raw of watcher.oracleText.split("\n")) {
        const match = raw.replace(/\([^)]*\)/g, "").trim().match(/^whenever an? ([a-z]+) you control becomes the target of a spell or ability an opponent controls, destroy target nonland permanent that player controls\.?$/i);
        if (!match || !isOfType(card, match[1])) continue;
        triggers.push({
          id: crypto.randomUUID(), type: "trigger", actorSeatId: casterSeatId, controllerSeatId: holder.id, sourceCardId: watcher.id, sourceCardName: watcher.name, triggerKind: "common",
          effect: { kind: "scripted", script: "destroy_nonland_of_player", params: { opponentSeatId: casterSeatId } }, contextCardId: card.id, message: `${watcher.name} triggers because ${card.name} became the target of a spell.`
        });
      }
    }
  }
  return triggers;
}

function nonlandTargetsOf(session: GameSession, trigger: Trigger): Array<{ seatId: string; card: VisibleCard }> {
  const opponent = seatOf(session, String(params(trigger).opponentSeatId ?? ""));
  return (opponent?.board.battlefield ?? []).filter((card) => !isLandCardLike(card) && !card.phasedOut && !hasHexproof(card)).map((card) => ({ seatId: opponent!.id, card }));
}

function resolveDestroyNonland(session: GameSession, trigger: Trigger): GameSession {
  const opponentId = String(params(trigger).opponentSeatId ?? "");
  const targetId = trigger.effect.kind === "scripted" ? trigger.effect.chosenOption : undefined;
  const pool = nonlandTargetsOf(session, trigger);
  const target = pool.find((entry) => entry.card.id === targetId) ?? (targetId ? undefined : [...pool].sort((a, b) => worth(b.card) - worth(a.card))[0]);
  if (!target) return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: no nonland permanent to destroy.`);
  if (hasIndestructible(target.card)) return rulesEvent(session, trigger.controllerSeatId, `${trigger.sourceCardName}: ${target.card.name} is indestructible.`);
  return destroyCreatures(session, [{ seatId: opponentId, cardId: target.card.id, message: `${target.card.name} is destroyed by ${trigger.sourceCardName}.` }], "Rules action");
}

// "Draw a card. Then you may put a land card from your hand onto the battlefield tapped." (Insidious Fungus): a human picks the land (or none); an agent plays its best land.
export function applyDrawThenLand(session: GameSession, seatId: string, sourceName: string): GameSession {
  const drawn = drawForSeat(session, seatId, `${sourceName}: ${seatOf(session, seatId)?.name ?? "Player"} draws a card.`);
  const seat = seatOf(drawn, seatId);
  const lands = (seat?.board.hand ?? []).filter((card) => isLandCardLike(card));
  if (!seat || lands.length === 0) return drawn;
  if (seat.kind === "human") {
    return ask(drawn, seatId, { id: "", name: sourceName }, `${sourceName}: you may put a land card from your hand onto the battlefield tapped.`, [...lands.map((card) => ({ label: card.name, value: card.id })), { label: "Don't put a land onto the battlefield", value: "none" }], { script: "hand_land" });
  }
  return putHandLandOntoBattlefield(drawn, seatId, sourceName, lands[0].id);
}

function putHandLandOntoBattlefield(session: GameSession, seatId: string, sourceName: string, cardId: string): GameSession {
  const seat = seatOf(session, seatId);
  const card = seat?.board.hand.find((entry) => entry.id === cardId);
  if (!seat || !card || !isLandCardLike(card)) return session;
  const entered: VisibleCard = { ...card, zone: "battlefield", tapped: true, enteredFrom: "hand", enteredTurn: session.turn };
  const next: GameSession = {
    ...session,
    seats: session.seats.map((item) => (item.id !== seatId ? item : { ...item, board: { ...item.board, hand: item.board.hand.filter((entry) => entry.id !== cardId), battlefield: [...item.board.battlefield, entered] }, zones: { ...item.zones, hand: Math.max(0, item.zones.hand - 1), battlefield: item.zones.battlefield + 1 } })),
    pendingEntries: [...(session.pendingEntries ?? []), { seatId, card: entered }]
  };
  return rulesEvent(next, seatId, `${sourceName}: ${seat.name} puts ${card.name} onto the battlefield tapped.`);
}

// Journey to Eternity: "When enchanted creature dies, return it to the battlefield under your control, then return this card to the battlefield transformed under your control."
function resolveJourneyReturn(session: GameSession, controller: PlayerSeat, trigger: Trigger): GameSession {
  let next = session;
  const deadId = trigger.contextCardId;
  const holder = deadId ? session.seats.find((seat) => (seat.board.graveyard ?? []).some((card) => card.id === deadId)) : undefined;
  const dead = holder?.board.graveyard?.find((card) => card.id === deadId);
  if (holder && dead) {
    next = moveCardAcrossSeats(next, holder.id, dead.id, controller.id, "battlefield").session;
    next = rulesEvent(next, controller.id, `${trigger.sourceCardName}: ${dead.name} returns to the battlefield under ${controller.name}'s control.`);
  }
  const auraHolder = next.seats.find((seat) => (seat.board.graveyard ?? []).some((card) => card.id === trigger.sourceCardId));
  if (!auraHolder) return next;
  const moved = moveCardAcrossSeats(next, auraHolder.id, trigger.sourceCardId, controller.id, "battlefield").session;
  const cleared = mapCard(moved, trigger.sourceCardId, (card) => ({ ...card, attachedToId: undefined, attachedToSeatId: undefined }));
  const transformed = transformPermanent(cleared, controller.id, trigger.sourceCardId, trigger.sourceCardName, false);
  return rulesEvent(transformed, controller.id, `${trigger.sourceCardName} returns to the battlefield transformed.`);
}

function hasHasteAlready(card: VisibleCard) {
  return /\bhaste\b/i.test(card.oracleText) || Boolean(card.grantedKeywords?.includes("haste"));
}

function applyRiot(session: GameSession, seatId: string, cardId: string, choice: "counter" | "haste"): GameSession {
  const card = findPermanentById(session, cardId);
  if (!card) return session;
  const next = mapCard(session, cardId, (entry) => (choice === "haste" ? { ...entry, summoningSick: false, grantedKeywords: [...new Set([...(entry.grantedKeywords ?? []), "haste"])], temporaryGrantedKeywords: [...(entry.temporaryGrantedKeywords ?? []), "haste"] } : applyCounterDelta(entry, "+1/+1", 1)));
  return rulesEvent(next, seatId, `${card.name} enters with riot: ${choice === "haste" ? "it gains haste" : "it gets a +1/+1 counter"}.`);
}
