// Casting and card play: playCardFromZone, additional discard/sacrifice costs, cast-face / MDFC / split / room face options,
// instant-speed and flash checks, targeting tax, spell resolution destination, free-cast marking.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { hasResolvableTarget } from "@/engine/castTargets";
import { adjustedCastingCost, cardWithFaceManaCost, manaValueFromManaCost } from "@/engine/costs";
import { addDamageShieldsFromSpec } from "@/engine/damage";
import { chooseSacrificeTargets, chooseWorstHandCardToDiscard } from "@/engine/effects";
import { destroyCreatures, moveCardAcrossSeats } from "@/engine/entry";
import { entersBattlefieldTapped, revealLandControlExempt, revealLandTypes, revealableLandCards, shocklandPayLifeAmount } from "@/engine/lands";
import { chooseManaSourcesForCost, normalizeManaColors, payCostFromPool, producibleColorsForLand, spendManaSources } from "@/engine/mana";
import { capitalizeWord, isLandCard } from "@/engine/shared";
import { isMainPhase } from "@/engine/turnFlow";
import { type PendingAction } from "@/engine/types";
import { findEnterAsCopyTarget, isPlaneswalkerCard, moveCardBetweenVisibleZones, parseEnterAsCopyEffect, rulesEvent, withInitialLoyaltyCounters } from "@/engine/zones";
import { isAura } from "@/lib/attachments";
import { permanentMatchesQualifier } from "@/lib/characteristics";
import { parseDamagePrevention } from "@/lib/damagePrevention";
import { libraryTopCastPermission } from "@/lib/libraryCasting";
import { applySpellLockdownEffects } from "@/engine/lockdownEffects";
import { etbEffectText, parseAdditionalDiscardCost, parseAdditionalSacrificeCost, type AdditionalSacrificeType } from "@/lib/oracleClauses";
import { type ChosenTarget } from "@/lib/targeting";
import { type CardFaceRecord, type GameSession, type ManaPool, type PlayerSeat, type VisibleCard } from "@/lib/types";

// "You can't cast Serra Avenger during your first, second, or third turns of the game." Own-turn number assumes plain
// round-robin turns from the first seat (extra turns shift it by at most one).
export function castRestrictedByTurnCount(session: GameSession, card: VisibleCard): boolean {
  if (!/\byou can'?t cast [^.]*? during your first, second, or third turns of the game\b/i.test(card.oracleText)) return false;
  return Math.floor((session.turn - 1) / Math.max(1, session.seats.length)) + 1 <= 3;
}

// Rule 903.8: commander tax is +{2} for each time the commander was CAST from the command zone, whether the
// spell later resolves, is countered, fizzles, or is replaced. So the bump happens the moment the cast is
// announced (playCard), never on resolution — the commander card stays in the command zone while its spell is
// on the stack in this engine, so a countered cast leaves it there with the tax already counted. Casting from
// anywhere else (e.g. after it was put into hand) records nothing.
export function recordCommanderCast(session: GameSession, seatId: string, cardId: string): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) =>
      seat.id === seatId && seat.board.commander?.id === cardId
        ? { ...seat, board: { ...seat.board, commander: { ...seat.board.commander, commanderTax: (seat.board.commander.commanderTax ?? 0) + 2 } } }
        : seat
    )
  };
}

export function isNonAuraEnchantment(card: VisibleCard): boolean {
  return card.typeLine.includes("Enchantment") && !isAura(card);
}

// What a resolving spell's own "prevent ..." text does: the Fog family ("prevent all combat damage that would be dealt this turn[ by non-X creatures]",
// Arachnogenesis), Batwing Brume's color-conditional halves (read off the mana actually spent), and targeted/self shields on an instant or sorcery
// ("prevent all combat damage that would be dealt to you this turn" + Inkshield's per-point tokens, "prevent the next N damage ... to target ...").
// A creature's own enters-trigger goes through commonTriggerEffect's prevent_damage; a pumped target's "it" through applyTargetedPumpEffect.
export function applySpellDamagePrevention(session: GameSession, seatId: string, sourceCard: VisibleCard, castTarget: ChosenTarget | undefined, manaSpentColors: string[], giftPromised = false): GameSession {
  // Lockdown riders of the spell (Promise of Loyalty's vow counters, Perch Protection's phasing) resolve first, then the prevention text below.
  session = applySpellLockdownEffects(session, seatId, sourceCard, giftPromised);
  const text = etbEffectText(sourceCard.oracleText);
  const brumeFog = /\bprevent all combat damage that would be dealt this turn if \{w\} was spent to cast this spell/i.test(text);
  const fogMatch = brumeFog ? (manaSpentColors.includes("W") ? ["", undefined] : null) : text.match(/\bprevent all combat damage that would be dealt this turn(?! if\b)(?: by non-([a-z]+) creatures)?\b/i);
  const parsedSpec = /Instant|Sorcery/.test(sourceCard.typeLine) ? parseDamagePrevention(text) : undefined;
  let next = parsedSpec && parsedSpec.scope !== "it" ? addDamageShieldsFromSpec(session, seatId, sourceCard, parsedSpec, castTarget) : session;
  // Batwing Brume's {B} half: each player loses 1 life per attacking creature they control.
  if (manaSpentColors.includes("B") && /\beach player loses 1 life for each attacking creature they control if \{b\} was spent to cast this spell/i.test(text)) {
    for (const seat of next.seats) {
      const attackers = seat.board.battlefield.filter((card) => card.attacking).length;
      if (attackers > 0) next = rulesEvent({ ...next, seats: next.seats.map((item) => (item.id === seat.id ? { ...item, life: item.life - attackers } : item)) }, seat.id, `${sourceCard.name}: ${seat.name} loses ${attackers} life (one per attacking creature).`);
    }
  }
  if (!fogMatch) return next;
  return {
    ...next,
    combatDamagePrevented: { turn: next.turn, exceptType: fogMatch[1] ? capitalizeWord(fogMatch[1]) : undefined },
    events: [
      { id: crypto.randomUUID(), at: new Date().toISOString(), seatId, message: `${sourceCard.name}: all combat damage is prevented this turn${fogMatch[1] ? ` except from ${capitalizeWord(fogMatch[1])} creatures` : ""}.`, detail: "Rules action" },
      ...next.events
    ]
  };
}

// "Your opponents can't cast spells during your turn." (Dragonlord Dromoka): true when some OTHER seat with that static is the active player.
export function spellCastLockedOut(session: GameSession, castingSeatId: string, activeSeatId: string | undefined): boolean {
  if (!activeSeatId || activeSeatId === castingSeatId) return false;
  const active = session.seats.find((seat) => seat.id === activeSeatId);
  return Boolean(active?.board.battlefield.some((card) => !card.abilitiesStripped && /your opponents can'?t cast spells during your turn/i.test(card.oracleText)));
}

// "Add {R} for each tapped land your opponents control." (Mana Geyser) — the amount only. Mana pools
// live in the component's own React state, not in GameSession, so a pure session transformer can't
// add the mana itself; the live-game caller reads this and adds it to the caster's pool (see
// resolvePendingAction). Headless self-play has no pool at all, so this effect stays unmodeled there.
export function manaFromTappedOpponentLands(session: GameSession, casterSeatId: string): number {
  return session.seats
    .filter((seat) => seat.id !== casterSeatId && !seat.hasLost)
    .reduce((total, seat) => total + seat.board.battlefield.filter((card) => card.tapped && isLandCard(card)).length, 0);
}

// "As an additional cost to cast this spell, discard a card." — uncastable when the hand holds nothing
// else to discard (the spell itself doesn't count, it's leaving the hand to be cast).
export function hasPayableAdditionalDiscardCost(session: GameSession, casterSeatId: string, card: VisibleCard): boolean {
  const cost = parseAdditionalDiscardCost(card.oracleText);
  if (!cost) return true;
  const seat = session.seats.find((item) => item.id === casterSeatId);
  return Boolean(seat && seat.board.hand.filter((item) => item.id !== card.id).length >= cost.count);
}

// Pays the discard half of a spell's additional cost (Unexpected Windfall) at cast time, by the same
// heuristic every other automatic discard here uses. The spell itself is never the discard.
export function payAdditionalDiscardCost(session: GameSession, seatId: string, spell: VisibleCard): GameSession {
  const cost = parseAdditionalDiscardCost(spell.oracleText);
  const seat = session.seats.find((item) => item.id === seatId);
  if (!cost || !seat) return session;
  let next = session;
  for (let paid = 0; paid < cost.count; paid += 1) {
    const current = next.seats.find((item) => item.id === seatId);
    if (!current) break;
    const chosenDiscard = spell.chosenAdditionalDiscardIds?.[paid] ? current.board.hand.find((card) => card.id === spell.chosenAdditionalDiscardIds![paid] && card.id !== spell.id) : undefined;
    const discard = chosenDiscard ?? chooseWorstHandCardToDiscard({ ...current, board: { ...current.board, hand: current.board.hand.filter((card) => card.id !== spell.id && !(next.stackSpellCardIds ?? []).includes(card.id)) } });
    if (!discard) break;
    next = moveCardBetweenVisibleZones(next, seatId, discard.id, "graveyard");
    next = rulesEvent(next, seatId, `${seat.name} discards ${discard.name} as an additional cost to cast ${spell.name}.`);
  }
  return next;
}

// A mandatory additional cost (Village Rites' "sacrifice a creature", ...) makes a spell uncastable
// outright when it can't be paid (rule 601.2h/601.2b) — without this, every call site that reuses
// hasResolvableTarget as its "can this be cast right now" gate would offer/allow casting the spell
// with no creature anywhere on the battlefield to actually pay the cost with.
export function hasPayableAdditionalSacrificeCost(session: GameSession, casterSeatId: string, card: VisibleCard): boolean {
  const cost = parseAdditionalSacrificeCost(card.oracleText);
  if (!cost) return true;
  const seat = session.seats.find((item) => item.id === casterSeatId);
  return Boolean(seat && additionalSacrificeCandidates(seat, cost, card.id).length >= cost.count);
}

// Pays an additional sacrifice cost at cast time, routed through destroyCreatures so the sacrifice is scanned for death triggers like every other death path.
// The spell is already paying (or has paid) its mana, so this stays paid even if the spell is later countered: nothing here is undone on a counter.
export function sacrificeForAdditionalCost(session: GameSession, seatId: string, targets: VisibleCard[], spellName: string): GameSession {
  const seatName = session.seats.find((item) => item.id === seatId)?.name ?? "Player";
  return destroyCreatures(
    session,
    targets.map((target) => ({ seatId, cardId: target.id, message: `${seatName} sacrifices ${target.name} as an additional cost to cast ${spellName}.` })),
    "Rules action"
  );
}

export function matchesAdditionalSacrificeType(card: VisibleCard, type: AdditionalSacrificeType): boolean {
  switch (type) {
    case "creature":
      return card.typeLine.includes("Creature");
    case "land":
      return card.typeLine.includes("Land");
    case "artifact":
      return card.typeLine.includes("Artifact");
    case "enchantment":
      return card.typeLine.includes("Enchantment");
    case "nonland permanent":
      return !card.typeLine.includes("Land");
    default:
      return true;
  }
}

// The permanents the caster may legally sacrifice to pay "As an additional cost to cast this spell, sacrifice a <type>" (rule 601.2b/601.2h): every
// matching permanent they control, tapped or not (a land already tapped for mana is a fine sacrifice, which is the usual Harrow trick). The spell itself is
// still in the hand while it is being cast, so it never appears here; `spellCardId` is only a guard for a spell cast from the battlefield-adjacent zones.
export function additionalSacrificeCandidates(seat: PlayerSeat, cost: { permanentType: AdditionalSacrificeType }, spellCardId?: string): VisibleCard[] {
  return seat.board.battlefield.filter((card) => card.id !== spellCardId && matchesAdditionalSacrificeType(card, cost.permanentType));
}

// The deterministic pick an agent (or a human who has only one legal choice) pays an additional sacrifice cost with: the least valuable legal permanent.
// Creatures use the shared sacrifice-fodder order (tokens, then lowest power+toughness). A land prefers one that is already tapped (this cast's own mana
// sources count as tapped, since they are spent before the sacrifice), then a basic over a utility land, then the one whose colours the rest of the
// manabase still covers, and never the sole source of a colour of the commander's identity unless nothing else is left. Anything else: tokens, then lowest
// mana value, the commander last. `paidWithSourceIds` are the permanents tapped to pay this very spell.
export function chooseAdditionalCostSacrifice(seat: PlayerSeat, cost: { count: number; permanentType: AdditionalSacrificeType }, paidWithSourceIds: string[] = [], spellCardId?: string): VisibleCard[] | undefined {
  const candidates = additionalSacrificeCandidates(seat, cost, spellCardId);
  if (candidates.length < cost.count) return undefined;
  if (cost.permanentType === "creature") return chooseSacrificeTargets(seat, undefined, cost.count, spellCardId);
  const identity = normalizeManaColors(seat.deck?.colors ?? seat.board.commander?.colorIdentity ?? []);
  const lands = seat.board.battlefield.filter((card) => card.typeLine.includes("Land"));
  const score = (card: VisibleCard): number => {
    if (card.commander) return 5000;
    let total = 0;
    if (card.typeLine.includes("Land")) {
      const colors = producibleColorsForLand(card);
      const others = lands.filter((land) => land.id !== card.id);
      const soleSource = colors.some((color) => (identity.length === 0 || identity.includes(color)) && color !== "C" && !others.some((land) => producibleColorsForLand(land).includes(color)));
      if (soleSource) total += 1000;
      if (!card.typeLine.includes("Basic")) total += 40;
      if (!card.tapped && !paidWithSourceIds.includes(card.id)) total += 25;
      // A land whose colours are produced by many other lands is the cheapest to lose.
      total -= Math.min(10, colors.reduce((sum, color) => sum + others.filter((land) => producibleColorsForLand(land).includes(color)).length, 0));
    } else {
      total += card.token ? 0 : 100 + card.manaValue * 10;
    }
    return total;
  };
  return [...candidates].sort((a, b) => score(a) - score(b)).slice(0, cost.count);
}

// Path of Ancestry: "When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1."
export function pathOfAncestryScries(session: GameSession, seatId: string, spell: VisibleCard, manaSourceIds: string[]): boolean {
  if (!spell.typeLine.includes("Creature")) return false;
  const seat = session.seats.find((item) => item.id === seatId);
  if (!seat) return false;
  const usedPath = seat.board.battlefield.some((card) => manaSourceIds.includes(card.id) && /when that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1/i.test(card.oracleText));
  if (!usedPath) return false;
  const commander = seat.board.commander ?? seat.board.battlefield.find((card) => card.commander);
  const typesOf = (typeLine: string) => (typeLine.includes("—") ? typeLine.slice(typeLine.indexOf("—") + 1).trim().split(/\s+/).filter(Boolean) : []);
  if (!commander) return false;
  const commanderTypes = typesOf(commander.typeLine);
  return typesOf(spell.typeLine).some((type) => commanderTypes.includes(type));
}

// An agent's pick for a free cast: the most expensive permanent that fits, else the most expensive spell.
export function chooseFreeCastCard(cards: VisibleCard[]): VisibleCard | undefined {
  const isSpellOnly = (card: VisibleCard) => card.typeLine.includes("Instant") || card.typeLine.includes("Sorcery");
  const byValue = (a: VisibleCard, b: VisibleCard) => b.manaValue - a.manaValue;
  return [...cards].filter((card) => !isSpellOnly(card)).sort(byValue)[0] ?? [...cards].sort(byValue)[0];
}

// Moves a hand card to exile with a free-cast permission for this turn, so the normal cast flow (targets, ETBs, triggers) can cast it for {0}.
export function markHandCardFreeCastable(session: GameSession, seatId: string, cardId: string): GameSession {
  const moved = moveCardAcrossSeats(session, seatId, cardId, seatId, "exile").session;
  return {
    ...moved,
    seats: moved.seats.map((seat) =>
      seat.id !== seatId
        ? seat
        : { ...seat, board: { ...seat.board, exile: (seat.board.exile ?? []).map((card) => (card.id === cardId ? { ...card, exiledPlayableBySeatId: seatId, exiledPlayableUntilTurn: session.turn, exiledPlayableFree: true } : card)) } }
    )
  };
}

export function spellResolutionDestination(session: GameSession, action: Extract<PendingAction, { type: "spell" }>): "battlefield" | "graveyard" | "exile" | "library" {
  const actor = session.seats.find((seat) => seat.id === action.actorSeatId);
  const card =
    action.sourceZone === "command"
      ? actor?.board.commander
      : action.sourceZone === "exile"
        ? actor?.board.exile?.find((item) => item.id === action.cardId)
        : action.sourceZone === "graveyard"
          ? actor?.board.graveyard?.find((item) => item.id === action.cardId)
          : action.sourceZone === "library"
            ? actor?.library?.find((item) => item.id === action.cardId)
            : actor?.board.hand.find((item) => item.id === action.cardId);
  if (!card) return "graveyard";
  // A two-faced card's own typeLine is the combined "Creature — Dragon // Sorcery — Omen" string,
  // which contains "Sorcery" regardless of which face was actually cast — checking it directly here
  // meant casting the CREATURE face of a card like Scavenger Regent still (accidentally, only
  // "correctly" for the other face) sent it to the graveyard instead of the battlefield. Applying
  // the chosen face first (same as findSpellSourceCard's own sourceCard derivation) makes this read
  // whichever face was actually paid for.
  const effectiveCard = applyChosenFaceToCard(card, action.faceIndex);
  // Adventure (rule 715): casting the smaller spell half doesn't send the card to the graveyard —
  // the rest of the card (its permanent half) is exiled instead, castable later for as long as it
  // remains there (see playCardFromZone's "exile" branch, which stamps exiledPlayableBySeatId).
  if (effectiveCard.typeLine.includes("Adventure")) return "exile";
  // Omen (Tarkir: Dragonstorm): same "smaller spell half, rest of the card goes elsewhere" shape as
  // Adventure, but shuffled into the owner's library instead of exiled — nothing carries over to
  // let it be cast again later the way Adventure's exile does.
  if (effectiveCard.typeLine.includes("Omen")) return "library";
  // "Exile Finale of Revelation." as the spell's own last sentence: it is exiled as it finishes resolving instead of going to the graveyard.
  if ((effectiveCard.typeLine.includes("Instant") || effectiveCard.typeLine.includes("Sorcery")) && effectiveCard.oracleText.split("\n").some((line) => { const lower = line.trim().toLowerCase(); const own = `exile ${effectiveCard.name.toLowerCase()}.`; return lower === own || lower.endsWith(` ${own}`); })) return "exile";
  // Flashback (rule 702.34a): an instant or sorcery cast with flashback is exiled instead of going anywhere
  // else when it would leave the stack. A flashback PERMANENT just enters the battlefield as normal.
  if (action.flashback && (effectiveCard.typeLine.includes("Instant") || effectiveCard.typeLine.includes("Sorcery"))) return "exile";
  return effectiveCard.typeLine.includes("Instant") || effectiveCard.typeLine.includes("Sorcery") ? "graveyard" : "battlefield";
}

// Rule 205.2j: an object is historic if it's an artifact, a Saga (or other subtype with the same
// carve-out), or has the legendary supertype — legendary creatures/enchantments/planeswalkers all
// qualify via "Legendary" appearing in the type line, not just legendary artifacts.

function twoSidedFaces(card: VisibleCard): [CardFaceRecord, CardFaceRecord] | undefined {
  if (!card.faces || card.faces.length !== 2) return undefined;
  return [card.faces[0], card.faces[1]];
}

// Scryfall's own convention for a transform back face: it always opens with this exact
// parenthetical reminder ("(Transforms from Storm the Vault.)", "(Transforms from Azor's
// Gateway.)", ...), never present on a genuine modal DFC's own back face (Zendikar Rising's
// "land // spell" cycle, the Pathway/battle lands, ...), which just states its own rules text
// directly. This is the only reliable signal available at runtime: this app's card data never
// stores Scryfall's own `layout` field (transform vs modal_dfc), only face shapes.
function isTransformBackFace(face: CardFaceRecord): boolean {
  return /^\(transforms from /i.test(face.oracleText.trim());
}

export function modalDoubleFacedLandSplit(card: VisibleCard): { spellFace: CardFaceRecord; spellIndex: number; landFace: CardFaceRecord; landIndex: number } | undefined {
  const faces = twoSidedFaces(card);
  if (!faces) return undefined;
  const [first, second] = faces;
  // A transform card's back face (Westvale Abbey -> Ormendahl, Profane Prince; Storm the Vault ->
  // Vault of Catlacan; any other permanent that flips into something else via an in-play ability)
  // is never castable from hand — Scryfall represents that by leaving its manaCost empty, unlike a
  // genuine modal DFC land (Zendikar Rising-style "land // spell") whose spell face always carries
  // a real printed cost. That alone only distinguishes a transform card whose back face is the
  // NON-land side (Westvale Abbey): a transform card whose back face IS a land (Storm the Vault,
  // Azor's Gateway, Arguel's Blood Fast, ...) has the exact same shape as a real modal DFC land
  // from this manaCost check's perspective (front has a real cost, back — being a land — never
  // does either way), so isTransformBackFace's reminder-text check is what actually tells them
  // apart. Without it, "cast the land side" was offered for a transform permanent whose back face
  // can only ever be reached by transforming, never played from hand at all. Reported live for
  // Storm the Vault // Vault of Catlacan.
  if (!first.typeLine.includes("Land") && second.typeLine.includes("Land") && first.manaCost && !isTransformBackFace(second)) {
    return { spellFace: first, spellIndex: 0, landFace: second, landIndex: 1 };
  }
  if (first.typeLine.includes("Land") && !second.typeLine.includes("Land") && second.manaCost && !isTransformBackFace(first)) {
    return { spellFace: second, spellIndex: 1, landFace: first, landIndex: 0 };
  }
  return undefined;
}

export function roomDoorFaces(card: VisibleCard): [CardFaceRecord, CardFaceRecord] | undefined {
  const faces = twoSidedFaces(card);
  if (!faces) return undefined;
  return faces.every((face) => face.typeLine.includes("Room")) ? faces : undefined;
}

// Two faces that are each independently castable as their own spell — Adventure (Bonecrusher
// Giant // Stomp) and Omen (Scavenger Regent // Exude Toxin) cards, where the "front" permanent
// face and a smaller instant/sorcery back face both have their own real printed mana cost, unlike
// modalDoubleFacedLandSplit's land+spell shape (where only one face is ever cast) or a transform
// permanent's back face (empty manaCost, per modalDoubleFacedLandSplit's own comment — never
// castable from hand at all). Without this, a Creature//Sorcery card like Scavenger Regent had no
// way to be cast as its sorcery face specifically: it always resolved as the single fused,
// combined-oracleText pseudo-card built from both faces mashed together, so the sorcery's own
// effect text was never what actually ran.
export function independentlyCastableSpellFaces(card: VisibleCard): [CardFaceRecord, CardFaceRecord] | undefined {
  const faces = twoSidedFaces(card);
  if (!faces) return undefined;
  const [first, second] = faces;
  if (first.typeLine.includes("Land") || second.typeLine.includes("Land")) return undefined;
  if (first.typeLine.includes("Room") || second.typeLine.includes("Room")) return undefined;
  if (!first.manaCost || !second.manaCost) return undefined;
  return faces;
}

// A SPLIT card (Find // Finality, Fire // Ice, Turn // Burn, Appeal // Authority): two spell halves side by side. Rule 708.4: in every zone but the
// stack it has the combined characteristics of both halves (so its card-level manaValue is the SUM, 8 for Find // Finality); only on the stack does it
// have just the one half that was cast. An Adventure / Omen card (Bonecrusher Giant // Stomp) is also two castable faces, but is not a split card.
export function isSplitSpellCard(card: VisibleCard): boolean {
  const faces = independentlyCastableSpellFaces(card);
  return Boolean(faces && !faces.some((face) => /Adventure|Omen/.test(face.typeLine)));
}

// "Aftermath (Cast this spell only from your graveyard.)" - that half is never castable from the hand.
export function spellFaceCastableFromHand(face: CardFaceRecord): boolean {
  return !/^\s*aftermath\b/im.test(face.oracleText);
}

// The card as it is while ONE half is being cast: that half's own name, type, text, cost and mana value (rule 708.4 / 715.3), so cost reducers,
// timing, targets and affordability all read the half and never the combined card.
export function spellFaceCostCard(card: VisibleCard, face: CardFaceRecord): VisibleCard {
  return { ...card, name: face.name, typeLine: face.typeLine, oracleText: face.oracleText, manaCost: face.manaCost, manaValue: manaValueFromManaCost(face.manaCost) };
}

interface CastFaceOption {
  faceIndex: number;
  faceName: string;
  label: string;
  /** Timing, aftermath and target rules allow casting this half right now. */
  castable: boolean;
  /** The half's OWN cost (after reductions, not counting X) can be paid. */
  payable: boolean;
}

// One entry per castable half of a split / Adventure card, each priced from its OWN cost. A human pays from the floating pool; an agent from untapped sources.
// `session` (optional) adds the timing and legal-target checks per half; without it only the aftermath rule is applied.
function castFaceOptions(
  seat: PlayerSeat,
  card: VisibleCard,
  activeSeatId: string | undefined,
  pool: ManaPool | undefined,
  allSeats: PlayerSeat[],
  session?: GameSession,
  response = false
): CastFaceOption[] | undefined {
  const faces = independentlyCastableSpellFaces(card);
  if (!faces) return undefined;
  return faces.map((face, index) => {
    const costCard = spellFaceCostCard(card, face);
    const fixedCost = adjustedCastingCost(seat, costCard, costCard.manaValue, "hand", activeSeatId, allSeats);
    // Only the non-X portion has to be payable to offer the half at all (X = 0 is always legal).
    const payable = pool ? payCostFromPool(pool, costCard, fixedCost, { life: seat.life, seat, allSeats }).ok : chooseManaSourcesForCost(seat, costCard, fixedCost, undefined, allSeats).ok;
    let castable = spellFaceCastableFromHand(face);
    if (castable && session) {
      const instant = canCastAtInstantSpeed(costCard, seatHasFlashGrant(seat, costCard));
      const sorcerySpeedOk = !response && activeSeatId === seat.id && isMainPhase(session.phase);
      castable = (instant || sorcerySpeedOk) && hasResolvableTarget(session, seat.id, costCard);
    }
    return { faceIndex: index, faceName: face.name, label: `Cast ${face.name} (${face.manaCost ?? "no cost"})`, castable, payable };
  });
}

export type CastFaceDecision =
  | { kind: "none" }
  | { kind: "unpayable"; options: CastFaceOption[] }
  | { kind: "single"; faceIndex: number; options: CastFaceOption[] }
  | { kind: "choose"; options: CastFaceOption[] };

// What casting a multi-half card from the hand should do when the caller did not say which half: nothing to decide (an ordinary card), no half is
// castable right now, exactly one is (just cast that one), or several are (the human must be asked which one).
export function castFaceDecision(session: GameSession, seat: PlayerSeat, card: VisibleCard, activeSeatId: string | undefined, pool?: ManaPool, response = false): CastFaceDecision {
  const options = castFaceOptions(seat, card, activeSeatId, pool, session.seats, session, response);
  if (!options) return { kind: "none" };
  const usable = options.filter((option) => option.castable && option.payable);
  if (usable.length === 0) return { kind: "unpayable", options };
  if (usable.length === 1) return { kind: "single", faceIndex: usable[0].faceIndex, options };
  return { kind: "choose", options };
}

export function applyChosenFaceToCard(card: VisibleCard, faceIndex: number | undefined): VisibleCard {
  const face = faceIndex !== undefined ? card.faces?.[faceIndex] : undefined;
  if (!face) return card;
  return {
    ...card,
    name: face.name,
    typeLine: face.typeLine,
    oracleText: face.oracleText,
    manaCost: face.manaCost,
    power: face.power,
    toughness: face.toughness,
    loyalty: face.loyalty,
    imageUris: face.imageUris ?? card.imageUris,
    unlockedFaceIndices: [faceIndex as number]
  };
}

export function unlockSecondRoomDoor(card: VisibleCard, newFaceIndex: number): VisibleCard {
  const doors = roomDoorFaces(card);
  if (!doors) return card;
  const [firstDoor, secondDoor] = doors;
  const alreadyUnlocked = card.unlockedFaceIndices ?? [];
  const nextUnlocked = Array.from(new Set([...alreadyUnlocked, newFaceIndex])).sort();
  return {
    ...card,
    name: `${firstDoor.name} // ${secondDoor.name}`,
    typeLine: "Enchantment — Room",
    oracleText: `${firstDoor.name}: ${firstDoor.oracleText}\n\n${secondDoor.name}: ${secondDoor.oracleText}`,
    unlockedFaceIndices: nextUnlocked
  };
}

export interface HandCardFaceOption {
  faceIndex: number;
  actionKind: "play_land" | "cast_spell";
  label: string;
  payable: boolean;
}

export function handCardFaceOptions(
  seat: PlayerSeat,
  card: VisibleCard,
  hasPlayedLand: boolean,
  activeSeatId: string | undefined,
  manaPool: ManaPool,
  allSeats: PlayerSeat[],
  session?: GameSession
): HandCardFaceOption[] | undefined {
  const split = modalDoubleFacedLandSplit(card);
  if (split) {
    const spellCost = adjustedCastingCost(seat, card, card.manaValue, "hand", activeSeatId, allSeats);
    const spellPayment = payCostFromPool(manaPool, card, spellCost, { life: seat.life, seat, allSeats });
    return [
      {
        faceIndex: split.landIndex,
        actionKind: "play_land",
        label: `Play ${split.landFace.name} (land)`,
        payable: !hasPlayedLand
      },
      {
        faceIndex: split.spellIndex,
        actionKind: "cast_spell",
        label: `Cast ${split.spellFace.name} (${split.spellFace.manaCost ?? "no cost"})`,
        payable: spellPayment.ok
      }
    ];
  }

  const doors = roomDoorFaces(card);
  if (doors) {
    return doors.map((door, index) => {
      const shim = cardWithFaceManaCost(card, door.manaCost);
      const totalCost = adjustedCastingCost(seat, shim, manaValueFromManaCost(door.manaCost), "hand", activeSeatId, allSeats);
      const payment = payCostFromPool(manaPool, shim, totalCost);
      return {
        faceIndex: index,
        actionKind: "cast_spell" as const,
        label: `Cast ${door.name} (${door.manaCost ?? "no cost"})`,
        payable: payment.ok
      };
    });
  }

  // Split / Adventure / Omen cards: one button per half, each priced from its OWN cost and greyed out unless that half is castable now (affordable,
  // right timing, a legal target, not an aftermath half).
  const faceOptions = castFaceOptions(seat, card, activeSeatId, manaPool, allSeats, session);
  if (faceOptions) {
    return faceOptions.map((option) => ({
      faceIndex: option.faceIndex,
      actionKind: "cast_spell" as const,
      label: option.label,
      payable: option.payable && option.castable
    }));
  }

  return undefined;
}

// flashGranted covers a battlefield static effect like Vedalken Orrery/Leyline of Anticipation
// ("you may cast spells as though they had flash") — see seatHasFlashGrant below, whose scan this
// card-level check can't do on its own (a card only knows its own type line/oracle text, never
// what's sitting elsewhere on its controller's battlefield). Defaults to false so every existing
// call site keeps its current behavior until it's updated to pass the seat's actual grant status.
export function canCastAtInstantSpeed(card: VisibleCard, flashGranted = false) {
  // "You may cast this spell as though it had flash if it targets a commander." (Timely Ward) is a conditional permission, not the Flash keyword.
  const printedFlash = /\bflash\b/i.test(card.oracleText.replace(/as though it had flash/gi, ""));
  return card.typeLine.includes("Instant") || printedFlash || flashGranted;
}

// Scoped narrowly to what a priority-response decision needs: battlefield-only, no "spells of the
// chosen type" variants, no layer-system involvement. A card's own printed Flash is still handled
// entirely by canCastAtInstantSpeed itself; this only covers a SEPARATE permanent granting it.
// "You may cast spells as though they had flash." (Leyline of Anticipation, Vedalken Orrery) grants every spell; "You may cast green creature
// spells as though they had flash." (Yeva, Nature's Herald) only the ones it describes (pass the card to check). Reminder text is ignored:
// a creature that merely HAS flash ("(You may cast this spell any time you could cast an instant.)") grants nothing to anything else.
// "Creatures and enchantments you control have 'Spells your opponents cast that target this permanent cost {1} more to cast.'" (Callaphe,
// Beloved of the Sea, and the same tax printed directly on a permanent, as with Sphere of Safety-style cards): {1} more for each chosen
// target that carries it and belongs to an opponent of the caster.
export function targetingTax(session: GameSession, casterSeatId: string, targets: ChosenTarget[]): number {
  let tax = 0;
  for (const target of targets) {
    if (target.kind !== "card" || target.seatId === casterSeatId) continue;
    const owner = session.seats.find((seat) => seat.id === target.seatId);
    const targeted = owner?.board.battlefield.find((card) => card.id === target.cardId);
    if (!owner || !targeted) continue;
    const grants = owner.board.battlefield.some(
      (source) =>
        !(source.abilitiesStripped || source.phasedOut) &&
        /creatures and enchantments you control have "spells your opponents cast that target this permanent cost \{1\} more to cast\."/i.test(source.oracleText) &&
        (targeted.typeLine.includes("Creature") || targeted.typeLine.includes("Enchantment"))
    );
    if (grants || /\bspells your opponents cast that target this (?:permanent|creature) cost \{1\} more to cast\b/i.test(targeted.oracleText)) tax += 1;
  }
  return tax;
}

export function seatHasFlashGrant(seat: PlayerSeat, card?: VisibleCard): boolean {
  // Timely Ward: flash only if it can target a commander (this checks the caster's own commander on the battlefield).
  if (card && /cast this spell as though it had flash if it targets a commander/i.test(card.oracleText) && seat.board.battlefield.some((permanent) => permanent.commander)) return true;
  return seat.board.battlefield.some((source) => {
    if ((source.abilitiesStripped || source.phasedOut)) return false;
    const text = source.oracleText.replace(/\([^)]*\)/g, "");
    if (/\byou may cast spells as though they had flash\b/i.test(text)) return true;
    const scoped = text.match(/\byou may cast ([a-z ]+?) spells as though they had flash\b/i);
    return Boolean(scoped && card && permanentMatchesQualifier(card, scoped[1]) && !card.typeLine.includes("Land"));
  });
}

export function playCardFromZone(
  session: GameSession,
  seatId: string,
  cardId: string,
  message?: string,
  position?: { x: number; z: number },
  destination: "battlefield" | "graveyard" | "exile" | "library" = "battlefield",
  manaSourceIds: string[] = [],
  sourceZone: "hand" | "command" | "exile" | "graveyard" | "library" = "hand",
  faceIndex?: number
): GameSession {
  let playedName = "";
  let enteredTapped = false;
  let shockLifePaid = 0;
  let shockPrompt: { cardId: string; cardName: string; life: number; revealTypes?: string[] } | undefined;
  let revealedForLand: string | undefined;
  // Set only when an "enter as a copy" replacement effect (parseEnterAsCopyEffect) actually found a
  // target — surfaced in the event log below so the copy is visible even if imageUris didn't come
  // through for some reason (e.g. the copied card itself has none).
  let copiedFromName: string | undefined;
  let playedIsAdventure = false;

  // A card exiled by an effect like Mind's Dilation's physically sits in its OWNER's exile zone,
  // not necessarily the seat granted permission to cast it (see the impulse_cast_free trigger
  // resolution) — so when the acting seat's own exile doesn't have this card, search every other
  // seat's exile for it before giving up. Every OTHER exile-cast shape already in this engine
  // (Adventure cards, Bribery-style steal-and-play) keeps the card in the acting seat's own exile,
  // so this fallback only ever fires for that new cross-seat case; ownExileCard being set is what
  // keeps this whole function's existing same-seat behavior completely unchanged otherwise.
  // Reported live as Mind's Dilation "not working at all" — the exiled card silently could never be
  // found (and so never cast) once it stopped living in the caster's own exile array.
  const actingSeat = session.seats.find((seat) => seat.id === seatId);
  const ownExileCard = sourceZone === "exile" ? actingSeat?.board.exile?.find((item) => item.id === cardId) : undefined;
  const exileOwnerSeatId =
    sourceZone === "exile" && !ownExileCard
      ? session.seats.find((seat) => seat.id !== seatId && seat.board.exile?.some((item) => item.id === cardId))?.id
      : undefined;

  const seats = session.seats.map((seat) => {
    if (exileOwnerSeatId && seat.id === exileOwnerSeatId) {
      // Only removes the card from its owner's exile — the cast's actual resolution (added to the
      // destination zone) is applied to the ACTING seat (seatId) below, same as every other cast.
      return {
        ...seat,
        board: { ...seat.board, exile: (seat.board.exile ?? []).filter((item) => item.id !== cardId) },
        zones: { ...seat.zones, exile: Math.max(0, seat.zones.exile - 1) }
      };
    }
    if (seat.id !== seatId) return seat;
    const sourceCard =
      sourceZone === "command"
        ? seat.board.commander
        : sourceZone === "exile"
          ? (ownExileCard ?? session.seats.find((s) => s.id === exileOwnerSeatId)?.board.exile?.find((item) => item.id === cardId))
          : sourceZone === "graveyard"
            ? (seat.board.graveyard ?? []).find((item) => item.id === cardId)
            : sourceZone === "library"
              ? (seat.library ?? []).find((item) => item.id === cardId)
              : seat.board.hand.find((item) => item.id === cardId);
    if (!sourceCard) return seat;
    const card = applyChosenFaceToCard(sourceCard, faceIndex);
    playedName = card.name;
    playedIsAdventure = card.typeLine.includes("Adventure");
    // A human is asked whether to pay the life (pendingShockChoices): the land enters tapped first, untapped if they pay.
    const humanShockCost = seat.kind === "human" && destination === "battlefield" ? shocklandPayLifeAmount(card.oracleText) : undefined;
    if (humanShockCost !== undefined) shockPrompt = { cardId: card.id, cardName: card.name, life: humanShockCost };
    // Checkland-style reveal (Snarls): a human with something revealable is asked (pendingShockChoices); an agent just reveals it.
    const revealables = destination === "battlefield" && !revealLandControlExempt(card, seat) ? revealableLandCards(card, seat.board.hand) : [];
    if (revealables.length > 0 && seat.kind === "human") shockPrompt = { cardId: card.id, cardName: card.name, life: 0, revealTypes: revealLandTypes(card.oracleText) };
    if (revealables.length > 0 && seat.kind !== "human") revealedForLand = revealables[0].name;
    const entersTapped = destination === "battlefield" && (humanShockCost !== undefined || (revealables.length > 0 && seat.kind === "human") || entersBattlefieldTapped(card, seat, session.seats));
    enteredTapped = entersTapped;
    // Shockland-style "pay life for untapped" replacement — entersBattlefieldTapped already decided
    // whether that life was worth paying; this is just the other half of that same choice, actually
    // charging it when the land enters untapped as a result.
    const shockCost = destination === "battlefield" ? shocklandPayLifeAmount(card.oracleText) : undefined;
    const lifePaidForUntapped = shockCost !== undefined && !entersTapped ? shockCost : 0;
    shockLifePaid = lifePaidForUntapped;
    // An Adventure card landing in exile, or an Omen card shuffled into the library, is still
    // identified by whichever spell face was just cast (card.name/typeLine/etc. above reflect that
    // face, via applyChosenFaceToCard) — but the card should read as the permanent it actually is
    // (faces[0], by Scryfall's convention for Adventure/Omen cards) once it's off the stack: that's
    // the only thing left castable from exile, and a card back in the library needs to show as
    // itself (not as the spell that already resolved) the next time it's drawn. card.faces itself
    // is untouched by applyChosenFaceToCard (only the top-level display fields are overwritten), so
    // the front face is still there to read.
    const revertsToFrontFace = destination === "exile" || destination === "library";
    const frontFace = revertsToFrontFace ? card.faces?.[0] : undefined;
    const enteredCard: VisibleCard = {
      ...card,
      ...(frontFace
        ? {
            name: frontFace.name,
            typeLine: frontFace.typeLine,
            oracleText: frontFace.oracleText,
            manaCost: frontFace.manaCost,
            // Recomputed alongside manaCost above — every cost-check that reads a plain card
            // object (respondWithCard's instant-speed path, most notably) uses card.manaValue
            // directly rather than recomputing it from manaCost, so leaving the old combined-card
            // manaValue in place here would silently misprice the exiled permanent face.
            manaValue: manaValueFromManaCost(frontFace.manaCost),
            power: frontFace.power,
            toughness: frontFace.toughness,
            loyalty: frontFace.loyalty,
            imageUris: frontFace.imageUris ?? card.imageUris,
            unlockedFaceIndices: [0]
          }
        : {}),
      // Rule 708.4: a split card is only ever one half while it is on the stack; once it lands in the graveyard it is the whole card again
      // (name "Find // Finality", both halves' text, combined mana value), not just the half that was cast.
      ...(destination === "graveyard" && faceIndex !== undefined && isSplitSpellCard(sourceCard)
        ? {
            name: sourceCard.name,
            typeLine: sourceCard.typeLine,
            oracleText: sourceCard.oracleText,
            manaCost: sourceCard.manaCost,
            manaValue: sourceCard.manaValue,
            imageUris: sourceCard.imageUris,
            unlockedFaceIndices: sourceCard.unlockedFaceIndices
          }
        : {}),
      zone: destination,
      // Origin zone of a battlefield entry ("entered or were cast from a graveyard": Twilight Diviner). A spell cast from a graveyard
      // (flashback-style grant) counts as coming from there even though sourceZone says where it physically was.
      enteredFrom: destination === "battlefield" ? (card.graveyardCastGrant ? "graveyard" : sourceZone) : undefined,
      // Rule 903.8: the tax was already raised when the cast was announced (recordCommanderCast), so resolving adds nothing.
      commanderTax: card.commanderTax,
      tapped: entersTapped ? true : card.tapped,
      battlefieldPosition: destination === "battlefield" ? position : undefined,
      summoningSick: destination === "battlefield" && card.typeLine.includes("Creature") ? true : card.summoningSick,
      counters: destination === "battlefield" && isPlaneswalkerCard(card) ? withInitialLoyaltyCounters(card) : card.counters,
      // Adventure (destination "exile"): the OTHER face is now exiled, castable indefinitely —
      // exiledPlayableUntilTurn left undefined, same "for as long as it remains exiled" shape
      // applyStealAndPlay already uses for Bribery-style effects (never swept by
      // clearTemporaryBuffs, which only expires a turn-limited exiledPlayableUntilTurn).
      // A flashback spell exiled after resolving (from the graveyard) is NOT castable again from exile.
      // ONLY an Adventure's permanent half is castable from exile afterwards. A spell that merely exiles ITSELF as it finishes
      // resolving ("Exile Temporal Mastery." / Finale of Revelation / Ral's Outburst-style) grants NO permission to recast it.
      exiledPlayableBySeatId: destination === "exile" && sourceZone !== "graveyard" && card.typeLine.includes("Adventure") ? seatId : undefined,
      exiledPlayableUntilTurn: undefined,
      graveyardCastGrant: undefined
    };
    // Rule 707.2: "enters as a copy" is a replacement effect on the copiable values only (name,
    // type line, oracle text, mana cost/value, colors, P/T, image) — everything else about
    // enteredCard (id, zone, tapped state, ...) is untouched. session.seats here is still the PRE-
    // this-card board (this permanent hasn't been added to any battlefield yet), so it can't
    // accidentally copy itself. "You may" is auto-accepted (this engine's standard "always take the
    // beneficial choice" policy for unmodeled optional decisions) since entering with no copy target
    // just leaves it a blank enchantment with no text, strictly worse in every real case.
    const copyEffect = destination === "battlefield" ? parseEnterAsCopyEffect(enteredCard.oracleText) : undefined;
    const copyTarget = copyEffect ? findEnterAsCopyTarget(session, seatId, copyEffect, enteredCard.chosenCopyTargetId) : undefined;
    if (copyTarget) copiedFromName = copyTarget.name;
    const played: VisibleCard = copyTarget
      ? {
          ...enteredCard,
          name: copyTarget.name,
          typeLine: copyTarget.typeLine,
          oracleText: copyEffect?.extraAbilityText ? `${copyTarget.oracleText}\n${copyEffect.extraAbilityText}` : copyTarget.oracleText,
          manaCost: copyTarget.manaCost,
          manaValue: copyTarget.manaValue,
          colors: copyTarget.colors,
          colorIdentity: copyTarget.colorIdentity,
          power: copyTarget.power,
          toughness: copyTarget.toughness,
          // Not one of rule 707.2's own copiable values (paper Magic just relies on the physical
          // copied card being face-up on the battlefield) — but this engine has only one card object
          // per permanent, and the point of copying is to actually look like what it copied rather
          // than sit there under its original art with a different name in small text. Reported
          // live: even Estrid's Invocation's existing (narrower) copy support left the permanent
          // showing its own card image no matter what it copied.
          imageUris: copyTarget.imageUris ?? enteredCard.imageUris,
          // A permanent copy remembers what the real card is, so leaving the battlefield (Estrid's Invocation exiled by its upkeep rider) restores it.
          ...(!copyEffect?.temporary
            ? {
                copyOriginal: {
                  name: enteredCard.name,
                  typeLine: enteredCard.typeLine,
                  oracleText: enteredCard.oracleText,
                  manaCost: enteredCard.manaCost,
                  manaValue: enteredCard.manaValue,
                  colors: enteredCard.colors,
                  colorIdentity: enteredCard.colorIdentity,
                  power: enteredCard.power,
                  toughness: enteredCard.toughness,
                  imageUris: enteredCard.imageUris
                }
              }
            : {}),
          // Cursed Mirror: only until end of turn, with an extra keyword; remember what it really is so it can change back.
          ...(copyEffect?.temporary
            ? {
                temporaryCopyOriginal: {
                  name: enteredCard.name,
                  typeLine: enteredCard.typeLine,
                  oracleText: enteredCard.oracleText,
                  manaCost: enteredCard.manaCost,
                  manaValue: enteredCard.manaValue,
                  colors: enteredCard.colors,
                  colorIdentity: enteredCard.colorIdentity,
                  power: enteredCard.power,
                  toughness: enteredCard.toughness,
                  imageUris: enteredCard.imageUris
                },
                ...(copyEffect.extraKeyword ? { temporaryGrantedKeywords: [copyEffect.extraKeyword], grantedKeywords: [copyEffect.extraKeyword] } : {})
              }
            : {})
        }
      : enteredCard;
    const spentSeat = spendManaSources(seat, manaSourceIds);
    // Casting from the graveyard takes the card out of it first (it re-enters only if it resolves back there).
    const graveyard = sourceZone === "graveyard" ? (spentSeat.board.graveyard ?? []).filter((item) => item.id !== cardId) : (spentSeat.board.graveyard ?? []);
    // Casting from the top of the library takes the card out of it (Thundermane Dragon); the cast creature gains haste until end of turn.
    const library = sourceZone === "library" ? (spentSeat.library ?? []).filter((item) => item.id !== cardId) : (spentSeat.library ?? []);
    const libraryHaste = sourceZone === "library" && destination === "battlefield" && Boolean(libraryTopCastPermission(card, seat.board.battlefield)?.grantsHaste);
    const playedOnBattlefield: VisibleCard = libraryHaste ? { ...played, temporaryGrantedKeywords: [...(played.temporaryGrantedKeywords ?? []), "haste"], grantedKeywords: [...(played.grantedKeywords ?? []), "haste"] } : played;
    const exile = spentSeat.board.exile ?? [];
    const commanderLeavesCommand = sourceZone === "command" && seat.board.commander?.id === cardId;
    // Only relevant when a card is cast FROM exile and resolves somewhere other than back into
    // exile (Adventure's spell half is always cast from hand, so this is really only exercised by
    // an impulse-drawn/stolen card being cast normally) — kept distinct from the "entering exile"
    // case below since both can't be true for the same resolution. Gated on ownExileCard: a
    // Mind's-Dilation-style cross-seat cast never had this card in the ACTING seat's own exile in
    // the first place (it was removed from its owner's exile in the seats.map branch above
    // instead), so there is nothing to remove — or decrement zones.exile for — here.
    const leavesExileZone = sourceZone === "exile" && destination !== "exile" && Boolean(ownExileCard);
    return {
      ...spentSeat,
      life: lifePaidForUntapped > 0 ? Math.max(0, spentSeat.life - lifePaidForUntapped) : spentSeat.life,
      library: destination === "library" ? [played, ...library] : sourceZone === "library" ? library : spentSeat.library,
      board: {
        ...spentSeat.board,
        commander: commanderLeavesCommand ? undefined : spentSeat.board.commander,
        hand: sourceZone === "hand" ? spentSeat.board.hand.filter((item) => item.id !== cardId) : spentSeat.board.hand,
        exile: destination === "exile" ? [...exile.filter((item) => item.id !== cardId), played] : leavesExileZone ? exile.filter((item) => item.id !== cardId) : spentSeat.board.exile,
        battlefield: destination === "battlefield" ? [...spentSeat.board.battlefield, playedOnBattlefield] : spentSeat.board.battlefield,
        graveyard: destination === "graveyard" && !played.spellCopy ? [...graveyard, played] : graveyard
      },
      zones: {
        ...spentSeat.zones,
        battlefield: spentSeat.zones.battlefield + (destination === "battlefield" ? 1 : 0),
        command: Math.max(0, spentSeat.zones.command - (commanderLeavesCommand ? 1 : 0)),
        graveyard: Math.max(0, spentSeat.zones.graveyard + (destination === "graveyard" && !played.spellCopy ? 1 : 0) - (sourceZone === "graveyard" ? 1 : 0)),
        hand: sourceZone === "hand" ? Math.max(0, spentSeat.zones.hand - 1) : spentSeat.zones.hand,
        exile: Math.max(0, spentSeat.zones.exile + (destination === "exile" && sourceZone !== "exile" ? 1 : 0) - (leavesExileZone ? 1 : 0)),
        library: Math.max(0, spentSeat.zones.library + (destination === "library" ? 1 : 0) - (sourceZone === "library" ? 1 : 0))
      }
    };
  });

  if (!playedName) return session;

  return {
    ...session,
    seats,
    ...(shockPrompt ? { pendingShockChoices: [...(session.pendingShockChoices ?? []), { seatId, ...shockPrompt }] } : {}),
    events: [
      {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        seatId,
        message: `${message ?? `${session.seats.find((seat) => seat.id === seatId)?.name ?? "Player"} plays ${playedName}.`}${copiedFromName ? ` It enters as a copy of ${copiedFromName}.` : ""}${enteredTapped ? " It enters tapped." : revealedForLand ? ` Reveals ${revealedForLand} from hand, so it enters untapped.` : shockLifePaid > 0 ? ` Pays ${shockLifePaid} life for it to enter untapped.` : ""}${destination === "exile" ? (sourceZone === "graveyard" ? " It's exiled (flashback)." : playedIsAdventure ? " It's exiled — you may cast the other half later." : " It's exiled.") : destination === "library" ? " It's shuffled into its owner's library." : ""}`,
        detail: destination === "graveyard" || destination === "exile" || destination === "library" ? "Response" : undefined
      },
      ...session.events
    ]
  };
}
