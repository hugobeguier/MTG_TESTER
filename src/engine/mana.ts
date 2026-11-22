// Mana engine, extracted verbatim from components/AppFlow.tsx (see docs/ARCHITECTURE.md section 5).
// Owns: mana-pool arithmetic and payment (emptyManaPool, payCostFromPool, ...), choosing which
// permanents to tap for a cost (chooseManaSourcesForCost), what mana a permanent can currently
// produce (manaChoicesForCard, costly/conditional taps, chosen-color and granted abilities),
// mana-rock/signet/scaling-amount parsing, and actually tapping/spending sources (spendManaSources).
// AppFlow.tsx re-exports the previously public symbols so existing importers keep working.

import type { ColoredMana, GameSession, ManaColor, ManaPool, PlayerSeat, RestrictedManaBatch, VisibleCard } from "@/lib/types";
import { countMatchingPermanents, permanentMatchesQualifier } from "@/lib/characteristics";
import { effectivePower } from "@/lib/counters";
import { oracleClauses } from "@/lib/oracleClauses";
import { hasCardType } from "@/lib/typeGrants";
import { COMMANDER_STARTING_LIFE, basicLandTypes, hasHaste, isBasicLandCard, isLandCard, numberWordToInt } from "@/engine/shared";
import { isSummoningSick } from "@/lib/summoningSickness";
import { cardWithColoredPipsReduced } from "@/engine/costs";

export function availableManaForSeat(seat: PlayerSeat, pool?: ManaPool): number {
  if (seat.kind === "human" && pool) return manaPoolTotal(pool);
  return seat.board.battlefield.filter((card) => isAvailableManaSource(card, seat)).reduce((total, source) => total + manaProducedBy(source, seat), 0);
}

export function emptyManaPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function addManaToPool(pool: ManaPool, color: ManaColor, amount: number) {
  return { ...pool, [color]: pool[color] + amount };
}

export function addPools(a: ManaPool, b: ManaPool): ManaPool {
  return { W: a.W + b.W, U: a.U + b.U, B: a.B + b.B, R: a.R + b.R, G: a.G + b.G, C: a.C + b.C };
}

export function spentManaColors(spent: ManaPool | undefined): string[] {
  return spent ? (Object.keys(spent) as ManaColor[]).filter((color) => spent[color] > 0) : [];
}

export function manaPoolTotal(pool: ManaPool) {
  return Object.values(pool).reduce((total, value) => total + value, 0);
}

// Klauth, Unrivaled Ancient's "add X mana in any combination of colors" — an agent gets a
// deterministic heuristic instead of a real choice: split evenly across whichever colors its own
// commander's color identity actually contains (round-robin, so an off-by-one leftover favors
// earlier colors in W/U/B/R/G order), falling back to colorless for a colorless-identity commander
// (vanishingly rare in practice, but keeps this total, not a partial/undefined pool).
export function attackTriggerManaHeuristicSplit(seat: PlayerSeat, amount: number): ManaPool {
  const identity = (seat.board.commander?.colorIdentity ?? seat.deck?.colors ?? []).filter((color): color is ColoredMana =>
    (["W", "U", "B", "R", "G"] as const).includes(color as ColoredMana)
  );
  const pool = emptyManaPool();
  if (identity.length === 0) {
    pool.C = amount;
    return pool;
  }
  for (let index = 0; index < amount; index += 1) {
    pool[identity[index % identity.length]] += 1;
  }
  return pool;
}

function spendGenericMana(pool: ManaPool, amount: number) {
  const next = { ...pool };
  let remaining = amount;
  for (const color of ["C", "W", "U", "B", "R", "G"] as ManaColor[]) {
    const spent = Math.min(next[color], remaining);
    next[color] -= spent;
    remaining -= spent;
    if (remaining === 0) break;
  }
  return next;
}

// Pays a cost from mana already floating in a pool. A Phyrexian pip ({G/P}) is paid with its colour from the pool; it is paid with 2 life instead
// only when the caller says life is available (options.life = the payer's life total) - the caller then has to charge the returned lifeCost.
// options.seat: the payer, so a "costs {W}{U}{B}{R}{G} less" effect (Morophon) is applied to the spell's coloured pips before they are demanded.
export function payCostFromPool(pool: ManaPool, card: VisibleCard, totalCost: number, options: { life?: number; seat?: PlayerSeat; allSeats?: PlayerSeat[] } = {}) {
  const payCard = options.seat ? cardWithColoredPipsReduced(options.seat, card, options.allSeats) : card;
  const phyrexianCount = manaRequirementForCard(payCard, totalCost).phyrexian.length;
  let lastFailure: { ok: false; sourceIds: never[]; pool: ManaPool; reason: string } | undefined;
  for (let lifePips = 0; lifePips <= phyrexianCount; lifePips += 1) {
    if (lifePips > 0 && (options.life === undefined || options.life < 2 * lifePips)) break;
    const attempt = payCostFromPoolWithLife(pool, payCard, totalCost, lifePips);
    if (attempt.ok) return lifePips > 0 ? { ...attempt, lifeCost: 2 * lifePips } : attempt;
    lastFailure ??= attempt;
  }
  return lastFailure ?? { ok: false as const, sourceIds: [] as never[], pool, reason: "cannot pay" };
}

function payCostFromPoolWithLife(pool: ManaPool, card: VisibleCard, totalCost: number, lifePips: number) {
  const requirement = manaRequirementForCard(card, totalCost, false, lifePips);
  const next = { ...pool };
  for (const color of ["W", "U", "B", "R", "G"] as ColoredMana[]) {
    if (next[color] < requirement.colors[color]) {
      return { ok: false as const, sourceIds: [] as never[], pool, reason: `missing ${color} mana` };
    }
    next[color] -= requirement.colors[color];
  }
  // {C} in a cost (Utter Insignificance's {2}{C}) can only be paid with colourless mana.
  if (next.C < requirement.colorless) {
    return { ok: false as const, sourceIds: [] as never[], pool, reason: "missing {C} (colorless) mana" };
  }
  next.C -= requirement.colorless;
  for (const options of requirement.hybrids) {
    const pick = [...options].sort((a, b) => next[b] - next[a])[0];
    if (next[pick] < 1) {
      return { ok: false as const, sourceIds: [] as never[], pool, reason: `missing ${options.join(" or ")} mana` };
    }
    next[pick] -= 1;
  }
  if (manaPoolTotal(next) < requirement.generic) {
    return { ok: false as const, sourceIds: [] as never[], pool, reason: `missing ${requirement.generic - manaPoolTotal(next)} generic mana` };
  }
  const genericPool = spendGenericMana(next, requirement.generic);
  return { ok: true as const, sourceIds: [] as never[], pool: genericPool, spent: manaPoolDifference(pool, genericPool) };
}

// Phyrexian mana ({G/P}: pay {G} or 2 life): chooseManaSourcesForCost first tries to pay every Phyrexian pip with mana, then with 1, 2, ... of them
// paid with 2 life each (the player must have the life: rule 119.4), and takes the first way that works. The life is recorded against the returned
// sourceIds array and charged by spendManaSources, the one place every payment site already calls, so no site needed new plumbing.
const phyrexianLifeByPayment = new WeakMap<readonly string[], number>();

export function chooseManaSourcesForCost(seat: PlayerSeat, card: VisibleCard, totalCost: number, excludeCardId?: string, allSeats?: PlayerSeat[]) {
  const payCard = cardWithColoredPipsReduced(seat, card, allSeats);
  const phyrexianCount = manaRequirementForCard(payCard, totalCost).phyrexian.length;
  let firstFailure: ReturnType<typeof chooseManaSourcesForCostWithLife> | undefined;
  for (let lifePips = 0; lifePips <= phyrexianCount; lifePips += 1) {
    if (lifePips > 0 && seat.life < 2 * lifePips) break;
    const attempt = chooseManaSourcesForCostWithLife(seat, payCard, totalCost, excludeCardId, allSeats, lifePips);
    if (attempt.ok) {
      if (lifePips > 0) phyrexianLifeByPayment.set(attempt.sourceIds, 2 * lifePips);
      return lifePips > 0 ? { ...attempt, lifeCost: 2 * lifePips } : attempt;
    }
    firstFailure ??= attempt;
  }
  return firstFailure!;
}

// A paid signet-shaped source ("{1}, {T}: Add {B}{G}.": Signets, Viridescent Bog) is modelled by its NET gain (BG - {1} = 1), which is only true when the
// {1} is really paid out of OTHER sources in the same payment. A selection where the other chosen sources make less than the signet's generic cost would
// get the mana for free (Bog alone paid for a one-mana spell), so such a signet is banned from that payment and the selection is redone without it.
function chooseManaSourcesForCostWithLife(seat: PlayerSeat, card: VisibleCard, totalCost: number, excludeCardId: string | undefined, allSeats: PlayerSeat[] | undefined, lifePips: number) {
  const banned = new Set<string>();
  for (;;) {
    const attempt = selectManaSourcesForCost(seat, card, totalCost, excludeCardId, allSeats, lifePips, banned);
    if (!attempt.ok) return attempt;
    const unpaid = attempt.sourceIds.filter((id) => {
      const source = seat.board.battlefield.find((candidate) => candidate.id === id);
      const signet = source ? signetAbility(effectiveManaOracleText(source)) : undefined;
      if (!source || !signet || signet.generic === 0) return false;
      const others = attempt.sourceIds.filter((other) => other !== id).reduce((total, otherId) => {
        const otherCard = seat.board.battlefield.find((candidate) => candidate.id === otherId);
        return otherCard ? total + manaProducedBy(otherCard, seat) : total;
      }, 0);
      return others < signet.generic;
    });
    if (unpaid.length === 0) return attempt;
    for (const id of unpaid) banned.add(id);
  }
}

// Whether a paid signet-shaped source can be activated at all right now: some OTHER untapped mana source has to pay its {1}.
export function signetCostPayable(card: VisibleCard, seat: PlayerSeat, allSeats?: PlayerSeat[]): boolean {
  const signet = signetAbility(effectiveManaOracleText(card));
  if (!signet || signet.generic === 0) return true;
  const others = seat.board.battlefield.filter(
    (other) => other.id !== card.id && !other.tapped && !other.phasedOut && !signetAbility(effectiveManaOracleText(other)) && !scalingPaidManaAbility(effectiveManaOracleText(other)) && manaChoicesForCardRaw(other, seat, allSeats).length > 0 &&
      !(isSummoningSick(other))
  );
  return others.reduce((total, other) => total + manaProducedBy(other, seat), 0) >= signet.generic;
}

function selectManaSourcesForCost(seat: PlayerSeat, card: VisibleCard, totalCost: number, excludeCardId: string | undefined, allSeats: PlayerSeat[] | undefined, lifePips: number, banned: Set<string>) {
  const requirement = manaRequirementForCard(card, totalCost, anyColorManaSpendingActive(allSeats ?? [seat]), lifePips);
  // Pips paid with life are not paid with mana: they come off the total that mana has to cover.
  totalCost -= lifePips;
  const sources = seat.board.battlefield.filter((source) => source.id !== excludeCardId && !banned.has(source.id) && isAvailableManaSource(source, seat, allSeats) && manaSourceMayPayFor(source, card));
  // A restricted source that is only here for its unrestricted colorless ability (Haven of the Spirit Dragon) can't make colors.
  const choicesFor = (source: VisibleCard) => {
    const choices = manaChoicesForCard(source, seat, allSeats);
    return manaSourceRestrictionMismatch(source, card) ? choices.filter((color) => color === "C") : choices;
  };
  const chosen = new Set<string>();
  const pool = emptyManaPool();
  const tappedFor: Record<string, ManaColor> = {};
  // Prefer a source that is not a pain land, so a coloured pip is paid with a basic before a land that hurts.
  const cheapestFirst = (candidates: VisibleCard[], accepts: (candidate: VisibleCard) => boolean, color?: ManaColor) =>
    candidates.find((candidate) => !chosen.has(candidate.id) && accepts(candidate) && painDamageForTap(candidate, color) === 0) ?? candidates.find((candidate) => !chosen.has(candidate.id) && accepts(candidate));

  for (const color of ["W", "U", "B", "R", "G"] as ColoredMana[]) {
    // A source that makes several mana of that colour ({T}: Add {G}{G}, The Great Henge) covers that many pips of it.
    // (pool[color] already holds the {color} half of a two-colour source chosen for an earlier colour, see below)
    for (let needed = requirement.colors[color] - pool[color]; needed > 0; ) {
      const source = cheapestFirst(sources, (candidate) => choicesFor(candidate).includes(color), color);
      if (!source) return { ok: false as const, sourceIds: [...chosen], reason: `missing ${color} mana` };
      chosen.add(source.id);
      tappedFor[source.id] = color;
      const produced = manaProducedBy(source, seat);
      // A tap that makes two DIFFERENT colours at once ("{T}: Add {U}{R}", the bounce lands) covers one pip of each, never two pips of one colour:
      // it used to be credited as {U}{U} (Izzet Boilerworks + a Mountain paid {X}{U}{U}). Its other colour goes to the pool for the later colours / generic.
      const multi = fixedMultiColourTap(source);
      if (multi) {
        for (const symbol of multi) pool[symbol] += 1;
        needed -= Math.max(1, multi.filter((symbol) => symbol === color).length);
        continue;
      }
      pool[color] += produced;
      needed -= Math.max(1, produced);
    }
  }

  // {C} in a cost (Utter Insignificance's {2}{C}) can only be paid with colourless mana, i.e. a source that makes {C}.
  for (let colorlessCovered = 0; colorlessCovered < requirement.colorless; ) {
    const source = cheapestFirst(sources, (candidate) => choicesFor(candidate).includes("C"), "C");
    if (!source) return { ok: false as const, sourceIds: [...chosen], reason: "missing {C} (colorless) mana" };
    chosen.add(source.id);
    tappedFor[source.id] = "C";
    const produced = manaProducedBy(source, seat);
    pool.C += produced;
    colorlessCovered += Math.max(1, produced);
  }

  for (const options of requirement.hybrids) {
    const source = cheapestFirst(sources, (candidate) => options.some((color) => choicesFor(candidate).includes(color)));
    if (!source) return { ok: false as const, sourceIds: [...chosen], reason: `missing ${options.join(" or ")} mana` };
    chosen.add(source.id);
    const color = options.find((option) => choicesFor(source).includes(option)) ?? options[0];
    tappedFor[source.id] = color;
    pool[color] += manaProducedBy(source, seat);
  }

  // Improvise: each untapped artifact that is not itself a mana source pays for {1} of the generic cost, saving lands.
  if (/\bimprovise\b/i.test(card.oracleText ?? "") || seat.nextSpellHasImprovise) {
    for (const artifact of seat.board.battlefield) {
      if (manaPoolTotal(pool) >= totalCost) break;
      if (artifact.id === excludeCardId || chosen.has(artifact.id) || artifact.tapped || !artifact.typeLine.includes("Artifact") || isAvailableManaSource(artifact, seat, allSeats)) continue;
      chosen.add(artifact.id);
      pool.C += 1;
    }
  }

  while (manaPoolTotal(pool) < totalCost) {
    const source = cheapestFirst(sources, () => true);
    if (!source) return { ok: false as const, sourceIds: [...chosen], reason: `missing ${totalCost - manaPoolTotal(pool)} generic mana` };
    chosen.add(source.id);
    const choices = choicesFor(source);
    const color = choices.includes("C") ? "C" : choices[0] ?? "C";
    tappedFor[source.id] = color;
    pool[color] += manaProducedBy(source, seat);
  }

  const sourceIds = [...chosen];
  sourceColorsByPayment.set(sourceIds, tappedFor);
  return { ok: true as const, sourceIds, pool, spent: pool };
}

// "Spend this mana only to cast an Angel spell." (Giada), "...only to cast a Dragon creature spell." (Haven of the Spirit Dragon): a
// source with that clause can only help pay for a matching spell. A payment for anything without a type line (an activated
// ability's cost shim) can't use it.
function manaSourceRestrictionMismatch(source: VisibleCard, payingFor: VisibleCard): boolean {
  const match = source.oracleText.match(/spend this mana only to cast (?:an? )?([a-z]+)(?: (creature))? spells?\b/i);
  if (!match) return false;
  if (!payingFor.typeLine) return true;
  return !permanentMatchesQualifier(payingFor, match[1]) || Boolean(match[2] && !payingFor.typeLine.includes("Creature"));
}

function manaSourceMayPayFor(source: VisibleCard, payingFor: VisibleCard): boolean {
  if (!manaSourceRestrictionMismatch(source, payingFor)) return true;
  // Still usable if the card also has a plain, unrestricted {T}: Add ability (Haven's {C}); choicesFor limits it to colorless.
  return oracleClauses(source.oracleText).some((clause) => /^\{t\}: add \{c\}\.?$/i.test(clause));
}

// "Players may spend mana as though it were mana of any color." (Mycosynth Lattice) — checked
// across every seat's battlefield, not just the caster's own: the permission is granted to every
// player, by anyone's Lattice. Reported live as Hellkite Igniter's {R}{R} needing an actual red
// source even with Mycosynth Lattice out, when any 2 mana of any color should satisfy it.
function anyColorManaSpendingActive(allSeats: PlayerSeat[]): boolean {
  return allSeats.some((seat) => seat.board.battlefield.some((card) => /players may spend mana as though it were mana of any color\b/i.test(card.oracleText)));
}

function manaRequirementForCard(card: VisibleCard, totalCost: number, anyColorSpendingActive = false, lifePips = 0) {
  const colors: Record<ColoredMana, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  // {C} (not generic {1}): must be paid with colourless mana. Phyrexian pips ({G/P}): paid with {G}, or with 2 life (the first `lifePips` of them).
  let colorless = 0;
  const phyrexian: ColoredMana[] = [];
  // Hybrid symbols ({B/G}, {W/U}, ...): each is paid with EITHER of its two colors. Before this they were counted as plain generic
  // mana, so Find // Finality's {B/G}{B/G} was payable with any two lands (white, say).
  const hybrids: ColoredMana[][] = [];
  // A cost of 0 means genuinely free (Omniscience's "without paying their mana costs," Mind's
  // Dilation's exile-cast permission, ...), not "0 generic, but still pay the card's own colored
  // pips" — without this, the loop below computed colored requirements straight from the card's
  // printed mana cost regardless of totalCost, so chooseManaSourcesForCost still demanded (and
  // spent) real colored sources for a spell that should have cost nothing at all, and refused to
  // cast it entirely for anyone without those specific colors untapped. Reproduced live as
  // Omniscience not actually letting spells be cast for free.
  if (totalCost <= 0) return { colors, hybrids, colorless, phyrexian, generic: 0 };
  // Every colored pip becomes payable with any color of mana (Mycosynth Lattice) — folded entirely
  // into the generic requirement rather than tracked per-color, since chooseManaSourcesForCost's
  // colored loop only exists to demand a source of that SPECIFIC color.
  if (anyColorSpendingActive) {
    const symbolsAny = card.manaCost?.match(/\{[^}]+\}/g) ?? [];
    // Mycosynth Lattice lets any mana pay a coloured pip, never a {C} pip; Phyrexian pips stay payable with life.
    const colorlessPips = symbolsAny.filter((symbol) => symbol.toUpperCase() === "{C}").length;
    const phyrexianPips = symbolsAny.filter((symbol) => /^\{[WUBRG]\/P\}$/i.test(symbol)).map((symbol) => symbol[1].toUpperCase() as ColoredMana);
    return { colors, hybrids, colorless: colorlessPips, phyrexian: phyrexianPips, generic: Math.max(0, totalCost - colorlessPips) };
  }
  const symbols = card.manaCost?.match(/\{[^}]+\}/g) ?? [];
  for (const symbol of symbols) {
    const value = symbol.replace(/[{}]/g, "").toUpperCase();
    if (value in colors) {
      colors[value as ColoredMana] += 1;
    } else if (/^[WUBRG]\/[WUBRG]$/.test(value)) {
      hybrids.push(value.split("/") as ColoredMana[]);
    } else if (value === "C") {
      colorless += 1;
    } else if (/^[WUBRG]\/P$/.test(value)) {
      phyrexian.push(value[0] as ColoredMana);
    }
  }
  if (symbols.length === 0 && totalCost > 0) {
    const fallbackColors = card.colors && card.colors.length > 0 ? card.colors : (card.colorIdentity ?? []);
    for (const color of normalizeManaColors(fallbackColors)) {
      if (color !== "C") colors[color] += 1;
    }
  }
  // The Phyrexian pips that are paid with mana count as coloured pips; the first `lifePips` of them are paid with life instead (and are not generic).
  phyrexian.forEach((color, index) => {
    if (index >= lifePips) colors[color] += 1;
  });
  const coloredTotal = Object.values(colors).reduce((total, value) => total + value, 0) + hybrids.length + colorless + Math.min(lifePips, phyrexian.length);
  const generic = Math.max(0, totalCost - coloredTotal);
  return { colors, hybrids, colorless, phyrexian, generic };
}

function manaPoolDifference(before: ManaPool, after: ManaPool) {
  return {
    W: Math.max(0, before.W - after.W),
    U: Math.max(0, before.U - after.U),
    B: Math.max(0, before.B - after.B),
    R: Math.max(0, before.R - after.R),
    G: Math.max(0, before.G - after.G),
    C: Math.max(0, before.C - after.C)
  };
}

export function formatManaPoolPayment(pool: ManaPool) {
  const parts = (["W", "U", "B", "R", "G", "C"] as ManaColor[]).flatMap((color) => Array.from({ length: pool[color] }, () => color));
  return parts.length > 0 ? parts.join(" ") : "no mana";
}



// Being a land is not evidence of a mana ability — Evolving Wilds, Terramorphic Expanse, and every
// other sacrifice-for-a-basic-land fetch land have no "{T}: Add..." line at all, only a
// "{T}, Sacrifice this land: search..." ability. This used to just check isLandCard(card), which
// treated every untapped land as a free colorless source regardless of whether it actually had one
// — tapping a fetch land "for mana" left it tapped and produced nothing, without ever sacrificing
// it or searching. Delegating to manaChoicesForCard (which only returns colors it can actually find
// real evidence for) makes this the same single source of truth instead of two independently
// drifting "is this a mana source" checks.
export function isAvailableManaSource(card: VisibleCard, seat: PlayerSeat, allSeats?: PlayerSeat[]) {
  // Rule 302.6/603.3d: a mana dork's "{T}: Add X" is an activated ability with {T} in its cost, so
  // summoning sickness blocks it exactly like any other tap ability (unless the creature has haste)
  // — this was the ONE mana-source gate in the whole file that didn't check it (every other tap-cost
  // legality check elsewhere already does; see legalActivatedAbilityActions and its siblings), so it
  // let chooseManaSourcesForCost/chooseManaSources silently auto-tap a mana dork the same turn it
  // entered the battlefield for spell/ability payment. Reported live as a freshly fetched Elvish
  // Mystic and a freshly played Llanowar Elves both tapping for mana immediately, neither with haste.
  if (isSummoningSick(card)) return false;
  // Orb of Dragonkind ("{1}, {T}: Add two mana ... only for Dragon spells") is not a plain mana source: it is modelled as a one-mana discount on
  // Dragon spells (see isDragonMana). Counting it as two free mana as well made a six-mana Dragon castable with three lands.
  if (isDragonMana(card)) return false;
  if (card.phasedOut) return false;
  // A signet-shaped source ("{1}, {T}: Add {B}{G}.") with nothing else to pay its {1} with is no source at all (it used to count as +1 free mana).
  if (!card.tapped && !signetCostPayable(card, seat, allSeats)) return false;
  return !card.tapped && manaChoicesForCard(card, seat, allSeats).length > 0;
}

export function summarizeAvailableMana(seat: PlayerSeat, allSeats?: PlayerSeat[]) {
  const sources = seat.board.battlefield.filter((card) => isAvailableManaSource(card, seat, allSeats));
  const byColor = emptyManaPool();
  let total = 0;
  for (const source of sources) {
    const produced = manaProducedBy(source, seat);
    total += produced;
    const choices = manaChoicesForCard(source, seat, allSeats);
    const color = choices.includes("C") ? "C" : choices[0];
    if (color) byColor[color] += produced;
  }
  return { total, untappedSources: sources.length, byColor };
}

// Colors that can only be produced by paying a cost beyond a plain {T} (Sacrifice a creature, pay
// life, an additional mana cost, ...) — Phyrexian Tower's "{T}, Sacrifice a creature: Add {B}{B}."
// (alongside its own separate, genuinely free "{T}: Add {C}.") is the motivating case. Scryfall's
// aggregate producedMana field lists every color a card can ever produce with no regard for what
// it costs, so trusting it directly let a single click ("tap for mana," this engine's only tapping
// gesture) hand out mana nothing was actually paid for. Only clauses whose own cost segment (before
// the colon) is exactly {T} plus this extra-cost language are excluded; a plain "{T}: Add {X}."
// clause for the same card still contributes its color normally.
// Any mana ability whose cost is more than "just tap it" — sacrifice/pay/discard/an extra mana
// symbol — regardless of whether {T} is ALSO part of that cost. This used to require {T} to be
// present (hasTap), written narrowly around Phyrexian Tower's "{T}, Sacrifice a creature: Add
// {B}{B}." shape — but that missed Ashnod's Altar's real cost, "Sacrifice a creature: Add {C}{C}."
// with no {T} at all, which was being treated as a free colorless source exactly like Phyrexian
// Tower's own bug (sacrifice a creature for mana without ever actually sacrificing anything).
// Splits a card's own "Add ..." clauses into the ones payable with just {T} ("free") versus ones
// whose cost includes something extra — sacrifice/pay/discard/an additional mana symbol ("costly").
// Shared by costlyTapManaColors (which color a plain tap can produce) and manaAmountFromAddClause
// (how much a plain tap produces) below, since both need the exact same "was this clause's cost
// more than just tapping it" classification and previously computed it independently — only one of
// them correctly. Phyrexian Tower's "{T}, Sacrifice a creature: Add {B}{B}." (alongside its own
// separate, genuinely free "{T}: Add {C}.") is the motivating shape for costly; Arena of Glory's
// "{T}: Add {R}." alongside "{R}, {T}, Exert this land: Add {R}{R}." is the motivating shape for why
// AMOUNT needs the same split, not just color (see manaAmountFromAddClause's own comment).
// The coloured symbols of a source whose plain {T} ability adds two or more DIFFERENT fixed colours at once ("{T}: Add {U}{R}." Izzet Boilerworks and the
// other bounce lands), or undefined for every other source (single colour, a choice "{W} or {B}", filters, signets, any-colour...).
function fixedMultiColourTap(card: VisibleCard): ManaColor[] | undefined {
  const text = effectiveManaOracleText(card);
  if (signetAbility(text) || scalingPaidManaAbility(text)) return undefined;
  for (const clause of splitManaClausesByCost(text).free) {
    const match = clause.match(/^\{t\}:\s*add\s+((?:\{[wubrg]\}){2,})\s*\.?\s*$/i);
    if (!match) continue;
    const symbols = [...match[1].matchAll(/\{([wubrg])\}/gi)].map((m) => m[1].toUpperCase() as ManaColor);
    if (new Set(symbols).size >= 2) return symbols;
  }
  return undefined;
}

function splitManaClausesByCost(oracleText: string): { free: string[]; costly: string[] } {
  const clauses = oracleText.split("\n").map((line) => line.trim()).filter(Boolean);
  const free: string[] = [];
  const costly: string[] = [];
  for (const clause of clauses) {
    const costMatch = clause.match(/^([^:]+):/);
    if (!costMatch) continue;
    const costText = costMatch[1].toLowerCase();
    const hasExtraCost = /\bsacrifice\b|\bpay\b|\bdiscard\b|\bremove\b|\bexile\b|\{[0-9wubrgc/]+\}/.test(costText.replace(/\{t\}/g, ""));
    (hasExtraCost ? costly : free).push(clause);
  }
  return { free, costly };
}

// Every color a clause's "Add ..." sentence can produce: all the {W}{U}{B}{R}{G}{C} symbols up to the end of that sentence
// ("Add {W} or {B}." — Isolated Chapel, the Tainted lands; "Add {W}{W}, {W}{B}, or {B}{B}." — Fetid Heath's filter ability;
// "Add {W}{U}{B}{R}{G}.") plus every color for the "any color / any combination of colors / chosen color" wordings (Prismatic
// Lens, Cascading Cataracts, Orb of Dragonkind, Crucible of the Spirit Dragon). Reading only the FIRST symbol after "add"
// let the other half of a two-color or filter ability escape the costly/conditional filters below.
function addedManaColors(clause: string): string[] {
  const colors = new Set<string>();
  for (const match of clause.matchAll(/\badd\b([^.]*)/gi)) {
    for (const symbol of match[1].matchAll(/\{([wubrgc])\}/gi)) colors.add(symbol[1].toUpperCase());
    if (/\bany (?:one )?color\b|\bany combination of colors\b|\bany type\b|\bchosen color\b/i.test(match[1])) for (const color of ["W", "U", "B", "R", "G"]) colors.add(color);
  }
  if (/\bchoose a color\b[^.]*\.\s*add\b/i.test(clause)) for (const color of ["W", "U", "B", "R", "G"]) colors.add(color);
  return [...colors];
}

export function costlyTapManaColors(oracleText: string): Set<string> {
  const { free, costly } = splitManaClausesByCost(oracleText);
  const costlyColors = new Set<string>();
  const freeColors = new Set<string>();
  // "Add {W}{U}{B}{R}{G}." (Cascading Cataracts' {5},{T} ability) is a run of symbols after one
  // "add" — capture the whole run, not just the first symbol, or the later colors escape the filter.
  const symbolsAfterAdd = (clause: string): string[] => addedManaColors(clause);
  for (const clause of costly) for (const color of symbolsAfterAdd(clause)) costlyColors.add(color);
  for (const clause of free) for (const color of symbolsAfterAdd(clause)) freeColors.add(color);
  // A color is only actually unavailable "for free" if EVERY clause that produces it carries an
  // extra cost. Sunken Palace has both a plain "{T}: Add {U}." and a separate, genuinely costly
  // "{1}{U}, {T}, Exile seven cards from your graveyard: Add {U}. ..." alternative — before this,
  // finding blue in the costly clause blacklisted blue entirely, silencing the land's ordinary free
  // tap ability along with the real exploit this function exists to close.
  for (const color of freeColors) costlyColors.delete(color);
  return costlyColors;
}

// "{T}: Add {X} or one mana of the chosen color." (the Thriving cycle, the Gate cycle) or the
// plain "{T}: Add one mana of the chosen color." with no fixed second color (Crossroads Village,
// Edgewall Inn, Uncharted Haven, and the rest of that wider "choose a color" land family) —
// checked before the producedMana branch below, which would otherwise offer every color the land
// could ever have chosen (Scryfall's producedMana is the union across every possible choice, not
// what THIS copy actually locked in) instead of just its fixed home color (if any) plus the one
// real chosenColor from ETB. Doesn't match the "choose a color" AGAIN at activation-time family
// (Meteor Crater, Nykthos, Rhystic Cave, Three Tree City's own mana ability) — those pick a color
// fresh every tap rather than locking one in at ETB, so producedMana's "any color" answer is
// already roughly correct for them rather than the bug this fixes.
function chosenColorManaAbility(oracleText: string): { fixedColor?: ManaColor } | undefined {
  const fixedMatch = oracleText.match(/add \{([wubrgc])\} or one mana of the chosen color/i);
  if (fixedMatch) return { fixedColor: fixedMatch[1].toUpperCase() as ManaColor };
  if (/\{t\}:\s*add one mana of the chosen color\b/i.test(oracleText)) return {};
  return undefined;
}

// "{cost}: [effect]. Activate only if [condition]." (Temple of the False God's "control five or
// more lands," the Verge cycle's "control a Forest or a Plains," Mox Opal's "control three or more
// artifacts," Mox Jasper's "control a Dragon," Loyal Apprentice's "you control a commander," ...) —
// narrow, well-templated condition shapes only, shared by every generic activated-ability path
// (mana, sacrifice, tap, self-untap — see their own legal-action and payment call sites) rather than
// re-implemented per ability shape. An UNRECOGNIZED condition deliberately evaluates to "not met"
// rather than "met": the bug this fixes (Temple of the False God usable with any number of lands,
// Loyal Apprentice's sacrifice ability usable with no commander on the battlefield at all) is the
// "wrongly always available" direction, the same class as the Ashnod's Altar/Phyrexian Tower free-
// mana bugs, so declining toward unavailable is the safe default rather than guessing the condition
// is satisfied.
export function activateOnlyIfConditionMet(clause: string, seat: PlayerSeat): boolean {
  const conditionMatch = clause.match(/\bactivate (?:this ability )?only if (.+?)\.?\s*$/i);
  if (!conditionMatch) return true;
  // "...and only as a sorcery" is a separate timing restriction (hasSorcerySpeedOnlyLimiter), not part of the board condition.
  return isBoardConditionMet(conditionMatch[1].replace(/\s+and only as a sorcery$/i, ""), seat);
}

// The board-state-phrase matcher activateOnlyIfConditionMet's "activate only if X" gate has always
// used, pulled out standalone so consultPrimitiveActionPlanner (AppFlow.tsx's primitive-plan apply
// path) can evaluate the SAME vocabulary against a card-parser-extracted "if X"/"only if X" clause
// (cardParser.ts's Ability.condition / primitiveActionPlan.ts's new PrimitiveActionPlan.condition)
// before applying a plan's steps — rather than the old behavior of ignoring any captured condition
// text and applying the effect unconditionally regardless of whether it was actually met.
export function isBoardConditionMet(conditionRaw: string, seat: PlayerSeat, allSeats?: PlayerSeat[], sourceId?: string): boolean {
  const condition = conditionRaw
    .toLowerCase()
    .trim()
    .replace(/^(?:if|only if)\s+/, "")
    .replace(/\.$/, "");
  // Empty means "no condition was captured at all" — always met, same as activateOnlyIfConditionMet
  // returning true when its own "activate only if" regex doesn't match anything in the clause.
  if (!condition) return true;

  // "You control the artifact with the greatest mana value or tied for the greatest mana value"
  // (Padeem, Consul of Innovation) — the ONE condition shape here that isn't purely local to this
  // seat's own board: it's a comparison against every artifact on the WHOLE battlefield (allSeats,
  // falling back to just this seat if a caller has no wider session in hand — undercounting toward
  // "not met" is the safe direction, same reasoning adjustedCastingCost's own allSeats default
  // uses). Previously unrecognized entirely, which routed Padeem's upkeep trigger to the Rules
  // Advisor/agent path instead of resolving deterministically — reported live as the agent drawing
  // a card off Padeem because of an OPPONENT's higher-mana-value artifact, not this seat's own.
  if (condition === "you control the artifact with the greatest mana value or tied for the greatest mana value") {
    const seats = allSeats ?? [seat];
    const artifactMvs = seats.flatMap((item) => item.board.battlefield.filter((card) => hasCardType(card, "Artifact")).map((card) => card.manaValue));
    if (artifactMvs.length === 0) return false;
    const greatest = Math.max(...artifactMvs);
    return seat.board.battlefield.some((card) => hasCardType(card, "Artifact") && card.manaValue === greatest);
  }

  // "You control a commander" means on the battlefield specifically — a commander still sitting in
  // the command zone (seat.board.commander, not yet cast) doesn't count as controlled, only an
  // actual permanent on the battlefield does (rule 903.9, and consistent with how Eminence already
  // treats seat.board.commander as "not yet on the battlefield" elsewhere in this file).
  if (condition === "you control a commander" || condition === "you control your commander") {
    return seat.board.battlefield.some((card) => card.commander);
  }

  const landCountMatch = condition.match(/^you control (\d+|two|three|four|five|six|seven|eight|nine|ten) or more lands$/);
  if (landCountMatch) return countMatchingPermanents(seat.board.battlefield, "lands") >= (numberWordToInt(landCountMatch[1]) ?? Infinity);

  const genericCountMatch = condition.match(/^you control (\d+|two|three|four|five|six|seven|eight|nine|ten) or more ([a-z]+)$/);
  if (genericCountMatch) return countMatchingPermanents(seat.board.battlefield, genericCountMatch[2]) >= (numberWordToInt(genericCountMatch[1]) ?? Infinity);

  if (condition === "an opponent has more life than you") {
    return (allSeats ?? []).some((other) => other.id !== seat.id && !other.hasLost && other.life > seat.life);
  }
  if (condition === "an opponent controls more creatures than you") {
    const creatures = (candidate: PlayerSeat) => candidate.board.battlefield.filter((card) => hasCardType(card, "Creature")).length;
    return (allSeats ?? []).some((other) => other.id !== seat.id && !other.hasLost && creatures(other) > creatures(seat));
  }
  // Land Tax: "if an opponent controls more lands than you"
  if (condition === "an opponent controls more lands than you") {
    const lands = (candidate: PlayerSeat) => candidate.board.battlefield.filter((card) => hasCardType(card, "Land")).length;
    return (allSeats ?? []).some((other) => other.id !== seat.id && !other.hasLost && lands(other) > lands(seat));
  }

  const bigCreatureMatch = condition.match(/^you control an? creature with power (\d+|two|three|four|five|six|seven|eight|nine|ten) or greater$/);
  if (bigCreatureMatch) {
    const needed = numberWordToInt(bigCreatureMatch[1]) ?? Infinity;
    return seat.board.battlefield.some((card) => hasCardType(card, "Creature") && effectivePower(card) >= needed);
  }

  const graveyardCountMatch = condition.match(/^you have (\d+|two|three|four|five|six|seven|eight|nine|ten) or more ([a-z]+) cards? in your graveyard$/);
  if (graveyardCountMatch) return countMatchingPermanents(seat.board.graveyard ?? [], graveyardCountMatch[2]) >= (numberWordToInt(graveyardCountMatch[1]) ?? Infinity);

  const pairMatch = condition.match(/^you control an? ([a-z]+) or an? ([a-z]+)$/);
  if (pairMatch) return countMatchingPermanents(seat.board.battlefield, pairMatch[1]) > 0 || countMatchingPermanents(seat.board.battlefield, pairMatch[2]) > 0;

  // "this land entered this turn or if you control a basic land" (the MKM surveil-land cycle) —
  // "entered this turn" isn't tracked by this engine (no per-permanent ETB-turn timestamp), so this
  // only checks the "or you control a basic land" half — the common case regardless, and a false
  // "not met" here (declining rather than guessing on the untracked half) still errs toward the
  // safe direction.
  if (condition === "this land entered this turn or if you control a basic land") {
    return seat.board.battlefield.some((c) => isBasicLandCard(c));
  }
  // "you created a token this turn" (Idol of Oblivion's draw)
  if (condition === "you created a token this turn") return Boolean(seat.createdTokenThisTurn);
  // "you gained life this turn" (Witch of the Moors, Moseo's Infusion, Eccentric Pestfinder): see PlayerSeat.lifeAtTurnStart
  if (condition === "you gained life this turn") return lifeGainedThisTurn(seat) > 0;
  // "you control no Thopters other than this creature" (Thopter Assembly)
  const noOtherMatch = condition.match(/^you control no ([a-z]+?)s? other than this (?:creature|permanent|artifact)$/);
  if (noOtherMatch) {
    const type = noOtherMatch[1];
    return !seat.board.battlefield.some((card) => card.id !== sourceId && card.typeLine.toLowerCase().includes(type));
  }

  // "you control three or more lands with the same name" (Endless Atlas)
  const sameNameMatch = condition.match(/^you control (\d+|two|three|four|five|six|seven|eight|nine|ten) or more lands with the same name$/);
  if (sameNameMatch) {
    const counts = new Map<string, number>();
    for (const land of seat.board.battlefield.filter((c) => isLandCard(c))) counts.set(land.name, (counts.get(land.name) ?? 0) + 1);
    return Math.max(0, ...counts.values()) >= (numberWordToInt(sameNameMatch[1]) ?? Infinity);
  }
  // "creatures you control have total power 8 or greater" (Surrak, the Hunt Caller's formidable)
  const totalPowerMatch = condition.match(/^creatures you control have total power (\d+) or greater$/);
  if (totalPowerMatch) {
    return seat.board.battlefield.filter((c) => c.typeLine.includes("Creature")).reduce((total, c) => total + Math.max(0, effectivePower(c)), 0) >= Number.parseInt(totalPowerMatch[1], 10);
  }
  // "you have at least 7 life more than your starting life total" (Speaker of the Heavens)
  const lifeOverMatch = condition.match(/^you have at least (\d+) life more than your starting life total$/);
  if (lifeOverMatch) return seat.life >= COMMANDER_STARTING_LIFE + Number.parseInt(lifeOverMatch[1], 10);

  const singleMatch = condition.match(/^you control an? ([a-z]+)$/);
  if (singleMatch) return countMatchingPermanents(seat.board.battlefield, singleMatch[1]) > 0;

  return false;
}

// How much life this player has gained this turn, net (life now minus life when the turn began; never negative).
export function lifeGainedThisTurn(seat: PlayerSeat): number {
  return Math.max(0, seat.life - (seat.lifeAtTurnStart ?? COMMANDER_STARTING_LIFE));
}

// Whether isBoardConditionMet actually has a real evaluator for this condition text, as opposed to
// falling through to its own final "return false" — which means "unrecognized," NOT "recognized and
// false." applyDeterministicPhaseTrigger's own "if X, [effect]" gate needs this distinction: a
// phase-triggered condition it can genuinely evaluate should resolve to a real no-op when false, but
// one it can't recognize at all must still decline to the Rules Advisor exactly as before, not
// silently resolve as "condition not met." Mirrors isBoardConditionMet's own pattern list so the two
// can't drift out of sync — deliberately NOT reusing isBoardConditionMet's boolean return itself
// (which conflates both cases into false).
export function isRecognizedBoardCondition(conditionRaw: string): boolean {
  const condition = conditionRaw
    .toLowerCase()
    .trim()
    .replace(/^(?:if|only if)\s+/, "")
    .replace(/\.$/, "");
  if (!condition) return true;
  if (condition === "you control the artifact with the greatest mana value or tied for the greatest mana value") return true;
  if (condition === "you control a commander" || condition === "you control your commander") return true;
  if (/^you control (\d+|two|three|four|five|six|seven|eight|nine|ten) or more lands$/.test(condition)) return true;
  if (/^you control (\d+|two|three|four|five|six|seven|eight|nine|ten) or more ([a-z]+)$/.test(condition)) return true;
  // Linvala, the Preserver's two conditions
  if (condition === "an opponent has more life than you" || condition === "an opponent controls more creatures than you" || condition === "an opponent controls more lands than you") return true;
  // "you control a creature with power 4 or greater" (Whisperer of the Wilds' ferocious mana)
  if (/^you control an? creature with power (\d+|two|three|four|five|six|seven|eight|nine|ten) or greater$/.test(condition)) return true;
  // "you have four or more creature cards in your graveyard" (Oversold Cemetery)
  if (/^you have (\d+|two|three|four|five|six|seven|eight|nine|ten) or more ([a-z]+) cards? in your graveyard$/.test(condition)) return true;
  if (/^you control an? ([a-z]+) or an? ([a-z]+)$/.test(condition)) return true;
  if (condition === "this land entered this turn or if you control a basic land") return true;
  if (condition === "you created a token this turn") return true;
  if (condition === "you gained life this turn") return true;
  if (/^you control no [a-z]+?s? other than this (?:creature|permanent|artifact)$/.test(condition)) return true;
  if (/^you control an? ([a-z]+)$/.test(condition)) return true;
  if (/^you control (\d+|two|three|four|five|six|seven|eight|nine|ten) or more lands with the same name$/.test(condition)) return true;
  if (/^you have at least (\d+) life more than your starting life total$/.test(condition)) return true;
  if (/^creatures you control have total power (\d+) or greater$/.test(condition)) return true;
  return false;
}

// Colors a mana ability could otherwise produce, but whose ONLY producing clause(s) carry an
// "Activate only if" condition that isn't currently met — checked as a final filter over whatever
// manaChoicesForCardRaw already found, rather than threading condition-awareness through every one
// of its branches (producedMana, hardcoded names, the generic "add {X}" regex, ...).
function conditionallyUnavailableColors(oracleText: string, seat: PlayerSeat): Set<string> {
  const colors = new Set<string>();
  const clauses = oracleText.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const clause of clauses) {
    if (!/\bactivate (?:this ability )?only if\b/i.test(clause)) continue;
    if (activateOnlyIfConditionMet(clause, seat)) continue;
    for (const color of addedManaColors(clause)) colors.add(color);
    // "Add one/two/three mana of any [one] color" gated by a condition (Mox Opal, Mox Jasper,
    // Flywheel Racer) — if the condition isn't met, every color is blocked, not just one.
    if (/add (?:one|two|three) mana of any (?:one )?color/i.test(clause)) {
      for (const color of ["W", "U", "B", "R", "G", "C"]) colors.add(color);
    }
  }
  // A color some OTHER, unconditional clause of the same card still produces isn't unavailable: Whisperer of the
  // Wilds' plain "{T}: Add {G}." works even while its ferocious "Activate only if ..." {G}{G} clause doesn't.
  for (const clause of clauses) {
    if (/\bactivate (?:this ability )?only if\b/i.test(clause)) continue;
    for (const color of addedManaColors(clause)) colors.delete(color);
  }
  return colors;
}

export function manaChoicesForCard(card: VisibleCard, seat: PlayerSeat, allSeats?: PlayerSeat[]): ManaColor[] {
  // Mana abilities are abilities: a permanent that lost all abilities (Utter Insignificance on a mana dork) or is phased out taps for nothing.
  if (card.phasedOut || (card.abilitiesStripped && !card.grantedManaAbilityText)) return [];
  const raw = manaChoicesForCardRaw(card, seat, allSeats);
  const blocked = conditionallyUnavailableColors(card.oracleText, seat);
  const filtered = blocked.size > 0 ? raw.filter((color) => !blocked.has(color)) : raw;
  // A land with a basic land type it was GIVEN (Urborg: every land is a Swamp) also has that type's intrinsic "{T}: Add {B}", on top of whatever its
  // own text produces (Command Tower is still Command Tower, and a Mountain under Urborg taps for R or B). Not for a phased-out land.
  if (card.grantedTypes?.length && card.typeLine.includes("Land") && !card.phasedOut && !card.abilitiesStripped) {
    const intrinsic = card.grantedTypes.map(manaColorForBasicLand).filter((color): color is ManaColor => Boolean(color));
    if (intrinsic.some((color) => !filtered.includes(color))) return normalizeManaColors([...filtered, ...intrinsic]);
  }
  return filtered;
}

// allSeats (every seat in the game, including this card's controller) is optional and only needed
// for Exotic Orchard's board-state-dependent color set ("a land an opponent controls could
// produce") — when the caller doesn't have it handy, this falls through to the old producedMana-
// based behavior further down instead of guessing, so every un-migrated call site is unaffected.
// Reflecting Pool needs no such threading since "a land you control" is already on `seat`.
// Insidious Roots: "Creature tokens you control have '{T}: Add one mana of any color.'" — every
// mana-ability parser below reads a card's own oracleText directly, which never includes a mana
// ability granted by a SEPARATE permanent's static text. This is the one choke point that appends
// grantedManaAbilityText (set by the state-based-action recompute pass, see parseGroupManaAbilityGrant)
// onto the real oracleText, so those parsers see the granted line without needing to be rewritten.
//
// Also the one choke point that strips reminder text — parenthetical rules text that often restates
// a DIFFERENT object's ability inline, most commonly a Treasure/Powerstone/Clue token's own
// "(It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")" printed on
// whatever card creates it. Every regex below used to read raw oracleText, so a card that merely
// CREATES such a token — with no mana ability of its own — was misread as having that ability
// itself, including the "sacrifice this token" clause, which isSacrificeManaSource also matches.
// Caught live by self-play's anomaly detector: Storm the Vault (a Legendary Enchantment with no mana
// ability at all — its only abilities are a Treasure-on-combat-damage trigger and an end-step
// transform condition, neither implemented in self-play, so it should never have been touched by
// mana payment) got chosen as a mana source purely from its own reminder text and was silently
// sacrificed to help pay for an unrelated spell, with no game log entry naming it — this same
// mana-payment code is shared by the live game, so a live match with any Treasure/Clue/Powerstone
// producer printed with reminder text was equally exposed.
//
// Also strips any double-quoted substring, not just parenthetical text — the OTHER real templating
// shape that quotes an ability belonging to something other than the source card: a granted-ability
// clause, "<permanents> you control have \"<ability text>\"" (Goldspan Dragon: "Treasures you control
// have \"{T}, Sacrifice this artifact: Add two mana of any one color.\""; Insidious Roots: "Creature
// tokens you control have \"{T}: Add one mana of any color.\""). This is a SEPARATE parser's job
// (parseGroupManaAbilityGrant, reading the card's own raw oracleText directly, not through this
// function) to actually grant that ability to the right permanents — but every mana-ability regex
// here used to see the same quoted text and misread it as the GRANTING card's own ability. Caught
// live immediately after the Storm the Vault fix above: Goldspan Dragon (a Creature — Dragon with no
// mana ability of its own) got chosen as a mana source of any color and sacrificed the moment it was
// tapped, for the same reason — Scryfall's own producedMana field for a card like this lists every
// color the GRANTED ability could ever produce, and nothing here filtered it out once the reminder-
// text fix above stopped catching this differently-shaped quote.
function stripReminderText(oracleText: string): string {
  return oracleText.replace(/\([^()]*\)/g, " ").replace(/"[^"]*"/g, " ");
}

export function effectiveManaOracleText(card: VisibleCard): string {
  // A TRIGGERED ability that adds mana ("Whenever this creature attacks, add {R}{R}{R}{G}{G}{G}." Savage Ventmaw; "Whenever you tap a permanent for
  // {C}, add an additional {C}." Forsaken Monument) is not a mana ability a player can use to pay for something: the mana only exists while the trigger
  // resolves (attack mana is added by the combat code, the extra {C} by manaProducedBy). Left in, these cards were counted as free mana sources and
  // auto-payment tapped them for mana they could not make at that time.
  const base = stripReminderText(card.oracleText)
    .split("\n")
    .filter((line) => !/^\s*(?:whenever|when|at the beginning)\b[^\n]*\badd\b/i.test(line))
    .join("\n");
  return card.grantedManaAbilityText ? `${base}\n${card.grantedManaAbilityText}` : base;
}

// "{2}, {T}: Add {B} for each Swamp you control." (Cabal Coffers; Cabal Stronghold-style): a PAID tap that scales with the board. Modelled like a signet,
// as its NET gain (count - generic cost). The generic cost is paid by tapping other untapped lands (spendManaSources does that), so the source
// is only usable while enough other lands are untapped and the net gain is at least 1.
// Crypt of Agadeem: "{2}, {T}: Add {B} for each black creature card in your graveyard." counts cards in the controller's graveyard (graveyardNoun).
export function scalingPaidManaAbility(oracleText: string): { generic: number; color: ManaColor; noun: string; graveyardNoun?: string } | undefined {
  const text = oracleText.replace(/\([^)]*\)/g, "");
  const match = text.match(/^\{(\d+)\},\s*\{t\}:\s*add \{([wubrgc])\} for each ([a-z]+) you control\.?\s*$/im);
  if (match) return { generic: Number.parseInt(match[1], 10), color: match[2].toUpperCase() as ManaColor, noun: match[3].toLowerCase() };
  const graveyard = text.match(/^\{(\d+)\},\s*\{t\}:\s*add \{([wubrgc])\} for each ([a-z ]+?) cards? in your graveyard\.?\s*$/im);
  return graveyard ? { generic: Number.parseInt(graveyard[1], 10), color: graveyard[2].toUpperCase() as ManaColor, noun: "", graveyardNoun: graveyard[3].toLowerCase() } : undefined;
}

// How many the scaling count is right now: permanents of the noun you control, or cards of the graveyardNoun in your graveyard.
function scalingPaidCount(scaling: { noun: string; graveyardNoun?: string }, seat: PlayerSeat): number {
  return scaling.graveyardNoun ? countMatchingPermanents(seat.board.graveyard ?? [], scaling.graveyardNoun) : countMatchingPermanents(seat.board.battlefield, scaling.noun);
}

// "{T}, Pay 2 life, Tap X untapped tokens you control: Add X mana in any combination of colors." (Hazel of the Rootbloom): modelled like a scaling mana
// source - it makes as many mana as there are untapped tokens it can tap, costs 2 life, and spendManaSources taps those tokens along with it. A token
// that is itself a mana source (a Treasure) is not counted: it would be tapped twice by one payment. Colours: any, all X of the one chosen.
export function tokenTapManaAbility(card: VisibleCard): { life: number } | undefined {
  const match = effectiveManaOracleText(card).match(/^\{t\}, pay (\d+) life, tap x untapped tokens you control: add x mana in any combination of colors\.?\s*$/im);
  return match ? { life: Number.parseInt(match[1], 10) } : undefined;
}

export function tokensTappableForMana(card: VisibleCard, seat: PlayerSeat, allSeats?: PlayerSeat[]): VisibleCard[] {
  return seat.board.battlefield.filter(
    (other) => other.id !== card.id && other.token && !other.tapped && !other.phasedOut && !tokenTapManaAbility(other) && manaChoicesForCardRaw(other, seat, allSeats).length === 0
  );
}

function otherUntappedLands(card: VisibleCard, seat: PlayerSeat): VisibleCard[] {
  return seat.board.battlefield.filter((other) => other.id !== card.id && !other.tapped && isLandCard(other));
}

function manaChoicesForCardRaw(card: VisibleCard, seat: PlayerSeat, allSeats?: PlayerSeat[]): ManaColor[] {
  const tokenTap = tokenTapManaAbility(card);
  if (tokenTap) {
    // Needs at least one untapped token to tap, and the life (it cannot be paid down to a loss by an automatic payment).
    return seat.life > tokenTap.life && tokensTappableForMana(card, seat, allSeats).length > 0 ? ["W", "U", "B", "R", "G"] : [];
  }
  const scalingPaid = scalingPaidManaAbility(effectiveManaOracleText(card));
  if (scalingPaid) {
    const net = scalingPaidCount(scalingPaid, seat) - scalingPaid.generic;
    if (net >= 1 && otherUntappedLands(card, seat).length >= scalingPaid.generic) return [scalingPaid.color];
    // Crypt of Agadeem also has a plain "{T}: Add {B}": when the paid ability would not gain anything, it still taps for that.
    if (splitManaClausesByCost(effectiveManaOracleText(card)).free.length === 0) return [];
  }
  const chosenColorAbility = chosenColorManaAbility(effectiveManaOracleText(card));
  if (chosenColorAbility) {
    const colors: ManaColor[] = [];
    if (chosenColorAbility.fixedColor) colors.push(chosenColorAbility.fixedColor);
    if (card.chosenColor) colors.push(card.chosenColor as ManaColor);
    return normalizeManaColors(colors);
  }

  const name = card.name.toLowerCase();
  // Reflecting Pool: "{T}: Add one mana of any type that a land you control could produce." — a
  // dynamic ability keyed to the caster's own battlefield, not the unconditional "any color" that
  // producedMana's static Scryfall approximation (all 5 colors, see below) would otherwise imply.
  // Filtered to actual Land permanents: without this, a mana rock's own producedMana (Arcane
  // Signet's "any color in your commander's color identity," ...) counted as evidence that "a land
  // you control could produce" that color, letting Reflecting Pool tap for colors none of the
  // caster's actual lands could make. Reported live as Reflecting Pool letting Sable cast a green
  // creature with no green-producing land on the battlefield.
  if (name === "reflecting pool") return producibleColorsFromLands(seat.board.battlefield.filter((permanent) => permanent.typeLine.includes("Land")), card.id);
  // Exotic Orchard: "{T}: Add one mana of any color that a land an opponent controls could
  // produce." — same dynamic shape as Reflecting Pool, but keyed to opponents' battlefields, which
  // requires allSeats. Same Land-only filter as Reflecting Pool above, for the same reason.
  // Fellwar Stone shares Exotic Orchard's exact "a land an opponent controls could produce"
  // template but on an artifact rather than a land — matched by TEXT here (not just Exotic
  // Orchard's name) so any card printed with this wording gets the same dynamic treatment,
  // including this one, which had no special-case at all before.
  const preText = effectiveManaOracleText(card).toLowerCase();
  if ((name === "exotic orchard" || preText.includes("any color that a land an opponent controls could produce")) && allSeats) {
    const opponentLands = allSeats
      .filter((other) => other.id !== seat.id)
      .flatMap((other) => other.board.battlefield)
      .filter((permanent) => permanent.typeLine.includes("Land"));
    return producibleColorsFromLands(opponentLands, card.id);
  }
  // Command Tower, Arcane Signet, and anything else printed with this exact template — checked by
  // TEXT (not name) and, crucially, BEFORE the generic producedMana check below: Scryfall's static
  // producedMana approximation for cards worded this way lists all 5 colors unconditionally (it has
  // no way to know a commander's actual identity), so the generic check below always returned every
  // color regardless of the caster's actual commander — a mono-red Command Tower tapping for green
  // was never caught because the correct commander-identity handling used to sit AFTER that early
  // return, unreachable. Reported live via this same session's Reflecting Pool audit.
  if (preText.includes("your commander's color identity")) {
    return normalizeManaColors(seat.deck?.colors ?? seat.board.commander?.colorIdentity ?? ["C"]);
  }

  const costly = costlyTapManaColors(effectiveManaOracleText(card));
  // Scryfall's producedMana is a union over every mana ability the card's TEXT ever mentions —
  // including one that actually belongs to a DIFFERENT permanent, quoted inside a granted-ability
  // clause (Goldspan Dragon: "Treasures you control have \"{T}, Sacrifice this artifact: Add two mana
  // of any one color.\""; Insidious Roots and the rest of that family). effectiveManaOracleText
  // already strips that quoted text (see its own comment), so gating producedMana on the STRIPPED
  // text still containing something shaped like the card's own "{T}: ... add" clause catches exactly
  // this: a card with no real mana ability of its own no longer gets Scryfall's blanket color list
  // trusted just because it prints someone else's ability inline. Every legitimate mana
  // rock/dork/land already has its own such clause in plain, un-quoted text, so this loses no real
  // case — and a source with no {T} at all (Ashnod's Altar, ...) was never reaching this branch for
  // its color anyway, since it's caught by the explicit "{color}" symbol regex further down instead.
  const hasOwnTapManaAbility = /\{t\}[^\n]*?\badd\b/i.test(effectiveManaOracleText(card));
  const produced = hasOwnTapManaAbility ? normalizeManaColors(card.producedMana ?? []).filter((color) => !costly.has(color)) : [];
  if (produced.length > 0) return produced;

  const basicTypes = basicLandTypes(card);
  if (basicTypes.length > 0) return basicTypes.map(manaColorForBasicLand).filter((color): color is ManaColor => Boolean(color));

  const text = effectiveManaOracleText(card).toLowerCase();
  if (name === "arcane sanctum") return ["W", "U", "B"];
  if (name.includes("talisman of dominance")) return ["C", "U", "B"];
  if (name.includes("talisman of hierarchy")) return ["C", "W", "B"];
  if (name.includes("talisman of progress")) return ["C", "W", "U"];
  // A two-color signet ("{1}, {T}: Add {W}{B}.") makes exactly its own printed colors; only Arcane Signet's
  // commander-identity text (handled above) uses the commander's colors. Its {1} is why the generic filters above emptied it.
  // Viridescent Bog ("{1}, {T}: Add {B}{G}.") is a land with the same printed shape: recognised by the text, not the name.
  const signetShaped = name.includes("signet") || signetAbility(effectiveManaOracleText(card)) !== undefined;
  if (signetShaped) {
    const own = normalizeManaColors(addedManaColors(text));
    if (own.length > 0) return own;
  }
  if (name.includes("signet")) return normalizeManaColors(seat.deck?.colors ?? seat.board.commander?.colorIdentity ?? ["C"]);
  if (name === "sol ring") return ["C"];

  const addedColors = addedManaColors(text).filter((color) => !costly.has(color));
  if (addedColors.length > 0) return normalizeManaColors(addedColors);

  // "Add one mana of any color." (Treasure tokens, Insidious Roots' granted ability, ...) — an
  // unrestricted 5-color choice, distinct from the narrower "chosen color" (locked in once, handled
  // above via chosenColorManaAbility) and "your commander's color identity" (handled above via the
  // preText check) shapes. Checked before the generic isManaRock colorless-only fallback below,
  // which would otherwise undercount this to "C" only — the whole point of this wording is choosing
  // any of the five, not being stuck at colorless. The commander's-color-identity variant contains
  // this same substring but is intercepted by its own earlier check first, so reaching here means
  // it's genuinely unrestricted.
  if (/\badd one mana of any color\b/i.test(text)) return normalizeManaColors(["W", "U", "B", "R", "G"]);

  // isManaRock only (not isLandCard): a mana rock's own regex requires actual "{T}: ... add ..."
  // text as positive evidence, but plenty of real lands (Evolving Wilds, Terramorphic Expanse, Maze
  // of Ith, ...) have no mana ability at all and must not default to colorless just for being a
  // land — see isAvailableManaSource's comment for the bug this used to cause.
  if (isManaRock(card)) return ["C"];
  return [];
}

export function normalizeManaColors(colors: string[]) {
  const valid = new Set<ManaColor>(["W", "U", "B", "R", "G", "C"]);
  return Array.from(new Set(colors.map((color) => (color === "colorless" ? "C" : color.toUpperCase())).filter((color): color is ManaColor => valid.has(color as ManaColor))));
}

export function manaColorForBasicLand(type: string): ManaColor | undefined {
  if (type === "Plains") return "W";
  if (type === "Island") return "U";
  if (type === "Swamp") return "B";
  if (type === "Mountain") return "R";
  if (type === "Forest") return "G";
  if (type === "Wastes") return "C";
  return undefined;
}

// The color(s) a single land could produce, used to answer "a land [you control/an opponent
// controls] could produce" (Reflecting Pool, Exotic Orchard) without recursing into
// manaChoicesForCard itself — basic land types first, falling back to the card's raw producedMana
// (a nested Reflecting Pool/Exotic Orchard among the candidate lands still resolves to its own
// static producedMana here rather than recursing, a rare-enough edge case to approximate this way).
export function producibleColorsForLand(card: VisibleCard): ManaColor[] {
  const basicTypes = basicLandTypes(card);
  if (basicTypes.length > 0) return basicTypes.map(manaColorForBasicLand).filter((color): color is ManaColor => Boolean(color));
  return normalizeManaColors(card.producedMana ?? []);
}

// excludeId keeps a land from counting itself (Reflecting Pool doesn't see its own color via "a
// land you control").
function producibleColorsFromLands(lands: VisibleCard[], excludeId?: string): ManaColor[] {
  const colors = new Set<ManaColor>();
  for (const land of lands) {
    if (land.id === excludeId) continue;
    for (const color of producibleColorsForLand(land)) colors.add(color);
  }
  return Array.from(colors);
}

// Deliberately does NOT check `card.role === "ramp"` or a loose text.includes("add ") — "ramp" also
// tags land-fetch/land-ramp artifacts with no mana ability at all (Wayfarer's Bauble, Expedition
// Map: sacrifice to search for a land CARD, not mana), and "add " matches any unrelated sentence
// containing that word (e.g. "add a +1/+1 counter"). Both used to make isAvailableManaSource treat
// those as always-tappable mana sources. Require the real templating instead: a repeatable "{T}
// [, additional costs]: Add ..." ability in the same clause, which is what every actual mana rock's
// oracle text uses.
function isManaRock(card: VisibleCard) {
  if (!card.typeLine.includes("Artifact")) return false;
  const name = card.name.toLowerCase();
  if (name === "sol ring" || name.includes("signet") || name.includes("talisman")) return true;
  return /\{t\}[^.\n]*?:\s*add\b/i.test(card.oracleText);
}

// "Add {X} for each [Type] you control" scaling mana sources (Cabal Coffers, Gaea's Cradle, ...) —
// without this, every mana source produced a flat 1 (or 2 for Sol Ring), so Cabal Coffers tapped
// for a single black mana regardless of how many Swamps were actually in play.
function scalingManaAmount(card: VisibleCard, seat: PlayerSeat): number | undefined {
  const scalingPaid = scalingPaidManaAbility(effectiveManaOracleText(card));
  if (scalingPaid) {
    const net = Math.max(0, scalingPaidCount(scalingPaid, seat) - scalingPaid.generic);
    return splitManaClausesByCost(effectiveManaOracleText(card)).free.length > 0 ? Math.max(1, net) : net;
  }
  const perControlled = card.oracleText.match(/\badd \{[wubrgc]\} for each ([a-z]+) you control\b/i);
  if (perControlled) {
    const noun = perControlled[1].toLowerCase();
    return seat.board.battlefield.filter((permanent) => permanent.typeLine.toLowerCase().includes(noun)).length;
  }
  // "{T}: Add {C} for each charge counter on this artifact." (Everflowing Chalice, ...) — a card with
  // zero charge counters (never multikicked) correctly produces 0 here, matching the fix that now
  // actually places those counters on ETB; previously this always fell through to the flat "produces
  // 1 mana" default regardless of how many times (if ever) it was kicked. The self-reference isn't
  // always "this artifact/permanent/creature/it" — Ramos, Dragon Engine's real templating spells its
  // own name out instead: "Add {C} for each +1/+1 counter on Ramos, Dragon Engine.", which the old
  // fixed pronoun list didn't recognize at all (silently falling through to the flat "produces 1"
  // default below no matter how many counters it actually had). The counter kind also isn't always a
  // plain word — "+1/+1"/"-1/-1" has no letters for a bare [a-z]+ to match.
  const perCounter = card.oracleText.match(/\badd \{[wubrgc]\} for each (\+1\/\+1|-1\/-1|[a-z]+) counters? on ([^.\n]+?)\.?\s*(?:$|\n)/i);
  if (perCounter) {
    const selfRefText = perCounter[2].trim().toLowerCase();
    const isSelfRef = ["this artifact", "this permanent", "this creature", "it"].includes(selfRefText) || selfRefText === card.name.toLowerCase();
    if (isSelfRef) {
      const counterKind = perCounter[1].toLowerCase();
      return card.counters?.find((counter) => counter.kind.toLowerCase() === counterKind)?.count ?? 0;
    }
  }
  return undefined;
}

// Flat multi-mana "Add {X}{X}" (or word-quantified "Add two/three mana of...") sources — without
// this, every mana source except a hardcoded "Sol Ring" produced exactly 1, so Ancient Tomb,
// Eldrazi Temple, every karoo/bounce land (Azorius Chancery, ...), and filter lands (Cascade
// Bluffs, ...) were all undercounted by half. Takes the MAX symbol count across a card's relevant
// "Add ..." clause(s) (see the free/costly split just below) rather than the specific ability
// actually activated — this codebase doesn't track which of a card's several mana abilities a given
// tap used, the same approximation costlyTapManaColors and painlandDamageAmount already make.
export function manaAmountFromAddClause(oracleText: string): number | undefined {
  // Prefer clauses payable with just {T} over costlier ones on the same card — Arena of Glory's
  // "{T}: Add {R}." (free, produces 1) alongside "{R}, {T}, Exert this land: Add {R}{R}." (costs
  // {R} and exerting, nets +1) used to take the MAX symbol count across EVERY "Add ..." clause on
  // the card regardless of which ability a plain tap actually exercises, crediting Arena of Glory
  // with 2 red for a tap that only ever pays for the free ability's 1. Reported live as an agent
  // affording a 5-drop off what should have been 3 real mana. This exact same shape (a free ability
  // alongside a separate, genuinely costlier one) also affected Phyrexian Tower ("{T}: Add {C}."
  // alongside "{T}, Sacrifice a creature: Add {B}{B}."), previously always overcounted to 2 even for
  // its plain free tap — this fix corrects that card too, not just Arena of Glory, since it was the
  // same bug under a different name. Falls back to the costly clauses only when there's no free one
  // at all (Ashnod's Altar's ONLY way to produce mana — "Sacrifice a creature: Add {C}{C}." — already
  // has an extra cost, so 2 is still the right number for it, unchanged from before this split).
  const { free, costly } = splitManaClausesByCost(oracleText);
  const relevantClauses = free.length > 0 ? free : costly;
  // Strip parenthetical reminder text first — Fire Nation Palace's firebending keyword reminder
  // ("Whenever it attacks, add {R}{R}{R}{R}. This mana lasts until end of combat.") isn't a tap
  // ability at all, but without this its 4 symbols still won the max and overcounted every tap.
  const text = relevantClauses.join("\n").toLowerCase().replace(/\([^)]*\)/g, "");
  const wordMatch = text.match(/\badd (one|two|three) mana\b/);
  if (wordMatch) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3 };
    return words[wordMatch[1]];
  }
  let maxSymbols = 0;
  for (const clause of text.match(/\badd\b[^.]*\./g) ?? []) {
    // Modal/filter clauses ("Add {U}{U}, {U}{R}, or {R}{R}.") list every branch at the same count,
    // so the first branch is representative regardless of which color combination is chosen.
    const firstBranch = clause.split(/,| or /)[0];
    const symbolCount = (firstBranch.match(/\{[^}]+\}/g) ?? []).length;
    if (symbolCount > maxSymbols) maxSymbols = symbolCount;
  }
  return maxSymbols > 0 ? maxSymbols : undefined;
}

// Signets ("{1}, {T}: Add {U}{R}."): a paid tap that adds one of EACH listed color. Net gain = symbols - generic cost.
export function signetAbility(oracleText: string): { generic: number; symbols: ManaColor[] } | undefined {
  const text = oracleText.replace(/\([^)]*\)/g, "");
  const match = text.match(/^\{(\d+)\},\s*\{t\}:\s*add ((?:\{[wubrgc]\}){2,})\.?$/im);
  if (!match) return undefined;
  const symbols = (match[2].match(/\{([wubrgc])\}/gi) ?? []).map((symbol) => symbol[1].toUpperCase() as ManaColor);
  return new Set(symbols).size === symbols.length ? { generic: Number.parseInt(match[1], 10), symbols } : undefined;
}

export function manaProducedBy(card: VisibleCard, seat: PlayerSeat) {
  if (tokenTapManaAbility(card)) return tokensTappableForMana(card, seat).length;
  const signet = signetAbility(effectiveManaOracleText(card));
  if (signet) return Math.max(1, signet.symbols.length - signet.generic);
  const scaling = scalingManaAmount(card, seat);
  if (scaling !== undefined) return scaling;
  // A clause gated by an unmet "Activate only if ..." (Whisperer of the Wilds' ferocious {G}{G}) isn't available, so
  // it can't raise the amount a plain tap produces.
  const usableText = effectiveManaOracleText(card)
    .split("\n")
    .filter((line) => !(/\bactivate (?:this ability )?only if\b/i.test(line) && !activateOnlyIfConditionMet(line, seat)))
    .join("\n");
  let base = manaAmountFromAddClause(usableText) ?? 1;
  // Wolfwillow Haven: "Whenever enchanted land is tapped for mana, its controller adds an additional {G}." Counted when the land makes only that colour
  // (a Forest); a land of another colour would need two different colours from one tap, which the one-colour tap does not express (never over-counted).
  for (const aura of seat.board.battlefield) {
    const extra = aura.attachedToId === card.id && !aura.phasedOut ? aura.oracleText.match(/whenever enchanted land is tapped for mana, its controller adds an additional \{([wubrgc])\}/i)?.[1]?.toUpperCase() : undefined;
    if (extra && manaChoicesForCardRaw(card, seat).every((color) => color === extra) && manaChoicesForCardRaw(card, seat).length > 0) base += 1;
  }
  // Forsaken Monument: "Whenever you tap a permanent for {C}, add an additional {C}." One extra per tap that produces only colorless mana.
  const addClause = usableText.match(/\{t\}[^:\n]*:\s*add\s+((?:\{[^}]+\})+)/i)?.[1] ?? "";
  const producesOnlyColorless = /^(?:\{c\})+$/i.test(addClause);
  if (producesOnlyColorless && seat.board.battlefield.some((permanent) => permanent.id !== card.id && !permanent.abilitiesStripped && /whenever you tap a permanent for \{c\}, add an additional \{c\}/i.test(permanent.oracleText))) return base + 1;
  return base;
}

export function selectedManaTotal(seat: PlayerSeat, sourceIds: string[]) {
  const sourceSet = new Set(sourceIds);
  return seat.board.battlefield.reduce((total, card) => (sourceSet.has(card.id) ? total + manaProducedBy(card, seat) : total), 0);
}

export function cannotPayMessage(seat: PlayerSeat, card: VisibleCard, availableMana: number, totalCost = card.manaValue, reason?: string) {
  const sourceCount = seat.board.battlefield.filter((item) => isAvailableManaSource(item, seat)).length;
  const suffix = reason ? ` (${reason})` : "";
  if (sourceCount === 0) {
    return `${seat.name} cannot cast ${card.name}; it costs ${totalCost} mana and there are no untapped mana sources${suffix}.`;
  }
  return `${seat.name} cannot cast ${card.name}; it costs ${totalCost} mana and only ${availableMana} is available${suffix}.`;
}

// Treasure/Powerstone-style mana sources are consumed on use ("{T}, Sacrifice this artifact: Add
// ..."), not just tapped — without this they'd behave like a permanent extra land forever. Requires
// "sacrifice" to be part of the SAME mana ability's cost (between {T} and its colon), not just
// present anywhere in the card's text — Mind Stone has an unrelated "{1}, {T}, Sacrifice this
// artifact: Draw a card." ability alongside its plain "{T}: Add {C}."; the old text.includes(...)
// check matched on that unrelated sentence and sacrificed Mind Stone the moment it was tapped for
// ordinary mana, even via its non-sacrifice ability.
//
// Also requires "sacrifice THIS ___" specifically (self-referential — the same distinction the rest
// of the codebase already draws, e.g. parseAdditionalSacrificeCost/parseGenericSacrificeAbilities),
// not the bare word "sacrifice" — Phyrexian Tower's real cost is "{T}: Add {C}." alongside a SEPARATE
// "{T}, Sacrifice a creature: Add {B}{B}." ability, which sacrifices a CREATURE, not itself; the land
// stays on the battlefield either way. The old bare-"sacrifice" check matched that second clause and
// sacrificed the LAND ITSELF every time it was tapped for its plain, free colorless mana, even though
// nothing about that ability ever consumes the land. Caught live by self-play's anomaly detector
// right after the Storm the Vault fix above, on the very next run.
export function isSacrificeManaSource(card: VisibleCard): boolean {
  return /\{t\}[^.\n]*?sacrifice this\b[^.\n]*?:\s*add\b/i.test(effectiveManaOracleText(card));
}

// Painlands (Adarkar Wastes, Ancient Tomb, the "Threshold" cycle — Barbarian Ring, ...) and City of
// Brass: "This land deals N damage to you" (or City of Brass's "Whenever this land becomes tapped,
// it deals N damage to you") tied to tapping it for mana. Roughly half this family (Ancient Tomb,
// City of Brass, the single-ability Threshold lands) has no free alternative at all, so this is
// exact for those; the classic dual-ability painlands (Yavimaya Coast, ...) also print a separate
// free "{T}: Add {C}." line this doesn't distinguish from the costly colored one — chooseManaSourcesForCost
// doesn't track which specific ability a source was tapped through (only that it was used), so
// there's no cheap way to tell them apart without restructuring mana payment across every call
// site. Applying the damage on every use is a known, deliberate over-application for that half of
// the cycle (matching how a real player mostly taps these for their colored option anyway, since
// that's the entire reason to run one over a basic land) rather than the status quo of never
// applying it at all.
function painlandDamageAmount(oracleText: string): number | undefined {
  const match = oracleText.match(/(?:this (?:land|artifact|creature|permanent) deals|it deals) (\d+) damage to you\b/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

// "{T}: Add {G}{G}. You gain 2 life." (The Great Henge): life that comes with every tap of a mana ability. Only a mana line whose
// cost is nothing but {T} counts.
export function lifeGainForTap(card: VisibleCard): number {
  for (const rawLine of effectiveManaOracleText(card).split("\n")) {
    const line = rawLine.trim();
    if (!/^\{t\}\s*:\s*add\b/i.test(line)) continue;
    const gain = line.match(/\byou gain (\d+) life\b/i);
    if (gain) return Number.parseInt(gain[1], 10);
  }
  return 0;
}

// Which colour each source was tapped for, recorded by chooseManaSourcesForCost against the `sourceIds` array it returns. Every payment site
// calls spendManaSources(seat, payment.sourceIds) with that same array, so a pain land's damage can follow the colour actually produced without
// threading a new argument through ~30 call sites. A source missing from the map (a caller that built its own id list) falls back to the default
// in painDamageForTap.
const sourceColorsByPayment = new WeakMap<readonly string[], Record<string, ManaColor>>();

/**
 * Damage a pain source deals to its controller when tapped for `color` (undefined = unknown). The classic painlands print a free "{T}: Add {C}."
 * line next to "{T}: Add {W} or {B}. This land deals 1 damage to you.": only the coloured line hurts. City of Brass ("Whenever this land becomes
 * tapped, it deals 1 damage to you.") and the single-ability lands (Ancient Tomb) hurt on every tap. Unknown colour: hurts unless a free ability exists.
 */
export function painDamageForTap(card: VisibleCard, color?: ManaColor): number {
  const text = effectiveManaOracleText(card);
  let always = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const amount = painlandDamageAmount(line);
    if (amount === undefined) continue;
    if (/\badd\b/i.test(line)) {
      const colors = addedManaColors(line);
      // The damage sentence belongs to this line's mana ability: it applies when that ability's colour was chosen.
      if (color === undefined) {
        const hasFreeAlternative = text.split("\n").some((other) => other.trim() !== line && /^\{t\}:\s*add\b/i.test(other.trim()) && painlandDamageAmount(other) === undefined);
        if (!hasFreeAlternative) always = Math.max(always, amount);
      } else if (colors.includes(color)) always = Math.max(always, amount);
    } else {
      // "Whenever this land becomes tapped, it deals N damage to you." (City of Brass): a trigger on any tap.
      always = Math.max(always, amount);
    }
  }
  return always;
}

// Storage lands' "{T}, Remove a/an <kind> counter from this land: Add ..." mana ability (Gemstone
// Mine's mining counters, Tendo Ice Bridge/Mirrodin's Core/the Vivid cycle's charge counters, ...)
// — the counter kind that ability consumes ONE of per activation. Deliberately only the fixed
// "a/an" shape (not "remove X counters," Calciform Pools/Fountain of Cho's variable-count cousin,
// which scales the mana produced rather than always spending exactly one and isn't modeled here).
export function manaAbilityCounterRemovalKind(oracleText: string): string | undefined {
  const match = oracleText.toLowerCase().match(/\{t\}[^:\n]*?,\s*remove an? ([a-z]+) counter from (?:this [a-z]+|it)\s*:[^.\n]*?\badd\b/);
  return match ? match[1] : undefined;
}

// "If there are no <kind> counters on this land, sacrifice it." (Gemstone Mine, and the rest of the
// storage-land cycle sharing this exact template) — checked after spendManaSources decrements a
// matching counter below. Deliberately declines when the sacrifice is followed by an "If you do,
// create ..." token payoff (Dark Depths' real templating, "When Dark Depths has no ice counters on
// it, sacrifice it. If you do, create Marit Lage, ...") that this parser has no way to also
// construct: sacrificing the land without ever creating its payoff token would be a strict downgrade
// from today's status quo (an unlimited, never-depleting mana source) rather than a fix, so it's
// safer to leave that one card's depletion trigger unimplemented than to apply half of it.
function depletionSacrificeCounterKind(oracleText: string): string | undefined {
  const text = oracleText.toLowerCase();
  const plainMatch = text.match(/\bif there are no ([a-z]+) counters on (?:this [a-z]+|it),?\s*sacrifice it\./);
  if (plainMatch) return plainMatch[1];
  const triggeredMatch = text.match(/\b(?:when|whenever) [^.]+ has no ([a-z]+) counters on it,\s*sacrifice it\.(\s*if you do,[^.]*\.)?/);
  if (triggeredMatch && !triggeredMatch[2]) return triggeredMatch[1];
  return undefined;
}

// Spends the chosen mana sources: taps ordinary sources, and sacrifices ones whose mana ability
// requires it (tokens cease to exist; real cards go to the graveyard as a "new object" per the
// zone-change rule, same as destroyCreatures/moveCardBetweenVisibleZones). Also charges any spent
// painland's life cost — see painlandDamageAmount's own comment on why this is an approximation for
// half the family, not an exact simulation.
export function spendManaSources(seat: PlayerSeat, sourceIds: string[], tappedFor?: Record<string, ManaColor>): PlayerSeat {
  // Life paid for Phyrexian pips ({G/P}) is charged here, with the same sourceIds array chooseManaSourcesForCost returned.
  const lifePaid = phyrexianLifeByPayment.get(sourceIds) ?? 0;
  const spent = spendManaSourcesTapping(seat, sourceIds, tappedFor);
  return lifePaid > 0 ? { ...spent, life: Math.max(0, spent.life - lifePaid) } : spent;
}

function spendManaSourcesTapping(seat: PlayerSeat, sourceIds: string[], tappedFor?: Record<string, ManaColor>): PlayerSeat {
  if (sourceIds.length === 0) return seat;
  const colorOf = { ...(sourceColorsByPayment.get(sourceIds) ?? {}), ...(tappedFor ?? {}) };
  const sourceSet = new Set(sourceIds);
  // Cabal Coffers' "{2}" is paid by tapping that many OTHER untapped lands, which the net-gain model never lists as sources.
  for (const id of [...sourceIds]) {
    const source = seat.board.battlefield.find((card) => card.id === id);
    const scalingPaid = source ? scalingPaidManaAbility(effectiveManaOracleText(source)) : undefined;
    if (!source || !scalingPaid) continue;
    for (const land of otherUntappedLands(source, seat).filter((candidate) => !sourceSet.has(candidate.id)).slice(0, scalingPaid.generic)) sourceSet.add(land.id);
  }
  // Hazel of the Rootbloom: the tokens it taps are tapped with it, and its "Pay 2 life" is charged.
  let tokenTapLife = 0;
  for (const id of [...sourceIds]) {
    const source = seat.board.battlefield.find((card) => card.id === id);
    const tokenTap = source ? tokenTapManaAbility(source) : undefined;
    if (!source || !tokenTap) continue;
    tokenTapLife += tokenTap.life;
    for (const token of tokensTappableForMana(source, seat).filter((candidate) => !sourceSet.has(candidate.id))) sourceSet.add(token.id);
  }
  const kept: VisibleCard[] = [];
  const sacrificed: VisibleCard[] = [];
  let painDamage = 0;
  let lifeGain = 0;
  const tokenTapLifeCost = tokenTapLife;
  for (const card of seat.board.battlefield) {
    if (!sourceSet.has(card.id)) {
      kept.push(card);
      continue;
    }
    painDamage += painDamageForTap(card, colorOf[card.id]);
    lifeGain += lifeGainForTap(card);
    if (isSacrificeManaSource(card)) {
      sacrificed.push(card);
      continue;
    }
    const removalKind = manaAbilityCounterRemovalKind(card.oracleText);
    const removableCounter = removalKind ? card.counters?.find((counter) => counter.kind === removalKind) : undefined;
    if (removalKind && removableCounter && removableCounter.count > 0) {
      const remainingCount = removableCounter.count - 1;
      const updatedCounters = (card.counters ?? []).map((counter) => (counter.kind === removalKind ? { ...counter, count: remainingCount } : counter)).filter((counter) => counter.count > 0);
      if (remainingCount === 0 && depletionSacrificeCounterKind(card.oracleText) === removalKind) {
        sacrificed.push({ ...card, counters: updatedCounters });
      } else {
        kept.push({ ...card, tapped: true, tapUsed: true, counters: updatedCounters });
      }
      continue;
    }
    kept.push(hasCardType(card, "Artifact") ? { ...card, tapped: true, tapUsed: true, justTappedForMana: true } : { ...card, tapped: true, tapUsed: true });
  }
  const life = painDamage > 0 || lifeGain > 0 || tokenTapLifeCost > 0 ? Math.max(0, seat.life - painDamage - tokenTapLifeCost + lifeGain) : seat.life;
  if (sacrificed.length === 0) {
    return { ...seat, life, board: { ...seat.board, battlefield: kept } };
  }
  const toGraveyard = sacrificed.filter((card) => !card.token);
  return {
    ...seat,
    life,
    board: {
      ...seat.board,
      battlefield: kept,
      graveyard: [
        ...(seat.board.graveyard ?? []),
        ...toGraveyard.map((card) => ({
          ...card,
          zone: "graveyard" as const,
          tapped: false,
          battlefieldPosition: undefined,
          counters: undefined,
          interpretedEffects: undefined
        }))
      ]
    },
    zones: {
      ...seat.zones,
      battlefield: Math.max(0, seat.zones.battlefield - sacrificed.length),
      graveyard: seat.zones.graveyard + toGraveyard.length
    }
  };
}

export function tapVisibleCard(session: GameSession, seatId: string, cardId: string, location: "battlefield" | "command"): GameSession {
  return {
    ...session,
    seats: session.seats.map((seat) => {
      if (seat.id !== seatId) return seat;
      return {
        ...seat,
        board: {
          ...seat.board,
          commander: location === "command" && seat.board.commander?.id === cardId ? { ...seat.board.commander, tapped: true } : seat.board.commander,
          battlefield:
            location === "battlefield"
              ? seat.board.battlefield.map((card) => (card.id === cardId ? { ...card, tapped: true, tapUsed: false } : card))
              : seat.board.battlefield
        }
      };
    })
  };
}

// "{1}, {T}: Add two mana in any combination of colors. Spend this mana only to cast Dragon spells or activate abilities of Dragons."
// (Orb of Dragonkind): paying {1} and tapping it turns into two mana for a Dragon spell, which is a net one mana cheaper. Modelled as that
// discount (any colours, so it only ever lowers the generic part) on a Dragon spell while the Orb is untapped; playCard taps the Orb.
export function isDragonMana(source: VisibleCard): boolean {
  return !source.abilitiesStripped && !source.tapped && /\{1\}, \{t\}: add two mana in any combination of colors\. spend this mana only to cast dragon spells/i.test(source.oracleText);
}


// A batch limited to one kind of spell ("only to cast Dragon spells") is usable only for a spell of that type or subtype.
export function restrictedBatchUsable(batch: RestrictedManaBatch, forCard?: VisibleCard) {
  return !batch.spellType || Boolean(forCard && forCard.typeLine.toLowerCase().includes(batch.spellType.toLowerCase()));
}
// An AGENT's floating mana (a ritual's {B}{B}{B}, PlayerSeat.floatingMana) pays for a spell first when it covers the whole cost; otherwise the spell is paid by
// tapping sources as before (never a partial blend: the floating mana would then empty unspent). The legal-action lists and the payment use this one function.
export function chooseManaSourcesOrFloating(seat: PlayerSeat, card: VisibleCard, totalCost: number, excludeCardId?: string, allSeats?: PlayerSeat[]): ReturnType<typeof chooseManaSourcesForCost> & { floating?: true; remaining?: ManaPool } {
  const floating = seat.kind !== "human" ? seat.floatingMana : undefined;
  if (floating && manaPoolTotal(floating) > 0 && totalCost > 0) {
    const paid = payCostFromPool(floating, card, totalCost, { seat, allSeats });
    // Same shape as a tapped payment (pool = what was spent), plus the pool that is left.
    if (paid.ok) return { ok: true, sourceIds: [], pool: paid.spent, spent: paid.spent, floating: true, remaining: paid.pool };
  }
  return chooseManaSourcesForCost(seat, card, totalCost, excludeCardId, allSeats);
}
