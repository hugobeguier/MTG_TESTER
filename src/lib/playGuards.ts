// Deterministic "don't make this specific dumb play" guards for agent seats (casual-Commander sensible, not cEDH optimizing).
// (A 4th rule, situationalTimingGuard — fogs, combat tricks, attacker removal with no attackers — follows the same pattern.)
// Three rules, each a pure function over a ScorableAction + ScoringContext so they can be unit-tested with real oracle text:
//   1. sacrificeGuard    — don't sacrifice your own permanents for a trivial payoff (Viscera Seer scrying away the board).
//   2. removalGuard      — don't spend creature removal / removal Auras on a non-threat.
//   3. protectionGuard   — don't cast hexproof/indestructible/protection instants with nothing threatening your permanents.
// evaluatePlayGuards() runs all three. actionScoring.scoreLegalAction applies it as a large score penalty (so the heuristic picker never
// chooses a violating action) and marks the scored action `vetoed`; app/api/agents/action/route.ts uses that mark to replace an
// LLM-chosen violating action (see resolveGuardedChoice in actionScoring.ts).

import type { CardLike, ScorableAction, ScoringContext } from "./actionScoring";
import { creatureValue } from "./strategy";
import { hasDeathtouch, hasIndestructible, parseNum } from "./combatSim";

type Opponent = NonNullable<ScoringContext["opponents"]>[number];

export interface GuardVerdict {
  allowed: boolean;
  reason?: string;
}

const ALLOWED: GuardVerdict = { allowed: true };

function clean(text: string | undefined): string {
  return (text ?? "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").toLowerCase();
}

// The legal-action detail is "<cost> <type line>. <oracle text> Payable with ...": keep only the card-text part.
function actionText(action: ScorableAction): string {
  return clean((action.detail ?? "").replace(/Payable with[\s\S]*$/i, ""));
}

function isCreature(card: CardLike): boolean {
  return (card.typeLine ?? "").includes("Creature") || (parseNum(card.power) !== undefined && parseNum(card.toughness) !== undefined && !(card.typeLine ?? "").includes("Land"));
}

function isToken(card: CardLike): boolean {
  return Boolean((card as { token?: unknown }).token) || /^token\b/i.test(card.typeLine ?? "");
}

function stackItems(context: ScoringContext): StackItem[] {
  const items: StackItem[] = [...(context.stack ?? [])];
  if (context.pendingAction) items.push(context.pendingAction);
  return items;
}

type StackItem = NonNullable<ScoringContext["stack"]>[number];

// ---------------------------------------------------------------------------------------------------------------------------------
// Rule 2: removal
// ---------------------------------------------------------------------------------------------------------------------------------

export interface RemovalSpell {
  kind: "destroy" | "exile" | "bounce" | "damage" | "shrink" | "aura";
  scope: "creature" | "permanent";
}

const NOUN = "([a-z,' -]*?)";

// Recognizes a spell/aura whose job is to take out ONE opposing creature/permanent. Counterspells, board wipes, burn that may go face
// ("any target") and modal spells are deliberately not recognized — the guard can't tell which mode/target they will use.
export function parseTargetedRemoval(action: ScorableAction): RemovalSpell | undefined {
  if (action.actionType !== "cast_spell") return undefined;
  const text = actionText(action);
  if (!text || /\bchoose (?:one|two|three|up to)\b|\bcounter target\b/.test(text)) return undefined;
  const isAura = /\baura\b/.test(text.split(".")[0] ?? "") || /\benchant creature\b/.test(text);

  if (isAura && /\benchant creature\b(?! you control)/.test(text)) {
    if (/\benchanted creature\b[^.]*\b(?:can't attack|can't block|loses all abilities|base power and toughness|doesn't untap|gets -\d+\/-\d+|becomes? a)/.test(text)) return { kind: "aura", scope: "creature" };
    return undefined;
  }

  const destroyExile = text.match(new RegExp(`\\b(destroy|exile) target ${NOUN}(creature|permanent)\\b(?! cards?)(?! you (?:control|own))`));
  if (destroyExile) return { kind: destroyExile[1] as "destroy" | "exile", scope: destroyExile[3] === "permanent" ? "permanent" : "creature" };

  if (new RegExp(`\\breturn target ${NOUN}(creature|permanent)\\b(?! cards?)(?! you (?:control|own))[^.]* to (?:its|their) owner's hand`).test(text)) {
    return { kind: "bounce", scope: "creature" };
  }
  if (new RegExp(`\\bdeals? (?:\\d+|x) damage to target ${NOUN}creature\\b(?! you control)(?! card)`).test(text) && !/\bany target\b/.test(text)) {
    return { kind: "damage", scope: "creature" };
  }
  if (/\btarget creature (?:an opponent controls )?gets? -(?:\d+|x)\/-(?:\d+|x)/.test(text)) return { kind: "shrink", scope: "creature" };
  return undefined;
}

function removalMinThreat(spellManaValue: number): number {
  return 4 + Math.max(0, spellManaValue - 2) * 0.5;
}

// How much a permanent threatens the deciding seat, in the same "mana worth of stuff" units as strategy.creatureValue (which already
// prices keywords, draw/ramp/token engines, anthems and the commander), plus what its power does against MY life and a few game-ending
// text patterns.
export function opposingThreat(card: CardLike, context: ScoringContext): number {
  let threat = creatureValue(card);
  const text = clean(card.oracleText);
  const power = Math.max(0, parseNum(card.power) ?? 0);
  const myLife = Math.max(1, context.you?.life ?? 40);
  threat += Math.min(3, (power / myLife) * 8);
  if (/\beach opponent loses\b|\bdeals? \d+ damage to each opponent\b|\byou win the game\b|\bextra turn\b|\buntap all\b|\bgain control of\b/.test(text)) threat += 2;
  if (/\bwhenever (?:you|an opponent|a player) (?:cast|casts|draw|draws)\b/.test(text)) threat += 1;
  if (/\bcan't be blocked\b|\bhaste\b/.test(text) && power >= 3) threat += 0.7;
  if (/\binfect\b/.test(text)) threat += 2;
  if (/\bprotection from\b|\bhexproof\b/.test(text) && /\bcreatures? you control\b/.test(text)) threat += 1;
  if (card.commander) {
    const dealt = Object.values(context.you?.commanderDamage ?? {}).reduce((max, value) => Math.max(max, value), 0);
    if (dealt >= 10) threat += 3;
  }
  return threat;
}

function ownerOf(card: CardLike, context: ScoringContext): Opponent | undefined {
  return (context.opponents ?? []).find((opponent) => (opponent.battlefield ?? []).some((entry) => entry.id === card.id));
}

function totalPower(cards: CardLike[] | undefined): number {
  return (cards ?? []).filter(isCreature).reduce((sum, card) => sum + Math.max(0, parseNum(card.power) ?? 0), 0);
}

export interface RemovalAssessment extends GuardVerdict {
  bestTarget?: CardLike;
  bestThreat?: number;
  threshold?: number;
}

// Is there a target on the table worth spending this removal on? The target is chosen AFTER the cast (legal-action targetIds is usually
// empty), so this asks whether the best available target clears the bar; a removal spell may still be held for a better one.
export function removalGuard(action: ScorableAction, context: ScoringContext): RemovalAssessment {
  const spell = parseTargetedRemoval(action);
  if (!spell) return ALLOWED;
  const opponents = context.opponents ?? [];
  const named = action.targetIds.map((id) => opponents.flatMap((opponent) => opponent.battlefield ?? []).find((card) => card.id === id)).filter((card): card is CardLike => Boolean(card));
  const pool = opponents.flatMap((opponent) => opponent.battlefield ?? []).filter((card) => !(card.typeLine ?? "").includes("Land"));
  const candidates = named.length > 0 ? named : spell.scope === "creature" ? pool.filter(isCreature) : pool;
  if (candidates.length === 0) return ALLOWED; // nothing visible to judge (the engine decides legality)

  const spellCard = (context.you?.hand ?? []).find((card) => card.id === action.cardId);
  const manaValue = spellCard?.manaValue ?? 2;
  const myLife = Math.max(1, context.you?.life ?? 40);

  const scored = candidates.map((card) => ({ card, threat: opposingThreat(card, context) })).sort((a, b) => b.threat - a.threat);
  const best = scored[0];
  const second = scored[1]?.threat ?? 0;
  let threshold = removalMinThreat(manaValue);
  // The one clear standout on a board of small stuff is worth a little less than the usual bar.
  if (best.threat >= second + 2) threshold = Math.max(3, threshold - 1);

  if (best.threat >= threshold) return { allowed: true, bestTarget: best.card, bestThreat: best.threat, threshold };

  // Threatening lethal: an opponent whose combined power reaches my life, and the target is part of it.
  for (const { card } of scored) {
    const owner = ownerOf(card, context);
    if ((parseNum(card.power) ?? 0) > 0 && totalPower(owner?.battlefield) >= myLife) {
      return { allowed: true, bestTarget: card, bestThreat: best.threat, threshold };
    }
  }
  return {
    allowed: false,
    reason: `removal held: the best target (${best.card.name ?? "a creature"}, threat ${best.threat.toFixed(1)}) is below the ${threshold.toFixed(1)} bar for spending a removal spell — keep it for a real threat`,
    bestTarget: best.card,
    bestThreat: best.threat,
    threshold
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Rule 3: protection spells
// ---------------------------------------------------------------------------------------------------------------------------------

const PROTECTION_RE = /\b(?:gains?|have|has) (?:hexproof|indestructible|protection from|shroud)\b|\bphases? out\b/;

export function isProtectionInstant(action: ScorableAction): boolean {
  if (action.actionType !== "cast_spell") return false;
  const text = actionText(action);
  if (!PROTECTION_RE.test(text) || !/\byou control\b/.test(text)) return false;
  return /\binstant\b/.test(text.split(".")[0] ?? "") || /\bflash\b/.test(text);
}

const THREAT_RE = /\b(?:destroy|exile|sacrifices?)\b|\bdeals? (?:\d+|x|that much) damage\b|\bgets? -(?:\d+|x)\/-(?:\d+|x)|\breturn target [^.]* to (?:its|their) owner's hand\b|\bfights?\b|\bgain control\b|\bloses? all abilities\b/;
const MASS_RE = /\b(?:all|each|every)\b/;

function myCardIds(context: ScoringContext): Set<string> {
  return new Set([...(context.you?.battlefield ?? []).map((card) => card.id), ...(context.you?.commander ? [context.you.commander.id] : [])]);
}

// Does this stack item (cast or triggered by someone else) threaten something I control that THIS protection would actually save?
export function stackItemThreatensMe(item: StackItem, context: ScoringContext, protectionText: string): boolean {
  const mine = context.you?.id;
  if (mine && item.actorSeatId === mine) return false;
  const text = clean(item.oracleText);
  if (!text || !THREAT_RE.test(text)) return false;
  const cardTargets = item.targetCardIds ?? [];
  const seatTargets = item.targetSeatIds ?? [];
  const ids = myCardIds(context);
  const stopsTargeting = /\bhexproof\b|\bshroud\b|\bprotection from\b|\bphases? out\b/.test(protectionText);
  const stopsDestroyAndDamage = /\bindestructible\b|\bprotection from\b|\bphases? out\b/.test(protectionText);
  const isDestroyOrDamage = /\bdestroy\b|\bdeals? [^.]*damage\b/.test(text);
  if (cardTargets.length > 0 || seatTargets.length > 0) {
    const aimedAtMine = cardTargets.some((id) => ids.has(id)) || (mine !== undefined && seatTargets.includes(mine));
    // Hexproof makes it fizzle; indestructible only helps against destroy / damage (not exile, -X/-X, sacrifice).
    return aimedAtMine && (stopsTargeting || (stopsDestroyAndDamage && isDestroyOrDamage));
  }
  if (/\btarget\b/.test(text)) {
    // Targets unknown — assume it may be aimed at me if I have anything to lose.
    return ids.size > 0 && (stopsTargeting || (stopsDestroyAndDamage && isDestroyOrDamage));
  }
  if (MASS_RE.test(text)) {
    // A non-targeted sweeper: only indestructible / protection / phasing helps.
    return stopsDestroyAndDamage && (isDestroyOrDamage || /\bphases? out\b/.test(protectionText));
  }
  return false;
}

// A creature of mine in combat that the combat damage in front of it would kill and this spell can save (indestructible / protection / phasing).
function savesCreatureInCombat(context: ScoringContext, protectionText: string): boolean {
  if (!/combat|declare|blockers|damage/i.test(context.phase ?? "")) return false;
  if (!/\bindestructible\b|\bprotection from\b|\bphases? out\b/.test(protectionText)) return false;
  const mine = (context.you?.battlefield ?? []).filter((card) => isCreature(card) && (card.attacking || card.blocking));
  const theirs = (context.opponents ?? []).flatMap((opponent) => opponent.battlefield ?? []).filter((card) => isCreature(card) && (card.attacking || card.blocking));
  return mine.some((card) => {
    if (hasIndestructible(card)) return false;
    const toughness = parseNum(card.toughness) ?? 0;
    return theirs.some((enemy) => hasDeathtouch(enemy) || (parseNum(enemy.power) ?? 0) >= toughness);
  });
}

export function protectionGuard(action: ScorableAction, context: ScoringContext): GuardVerdict {
  if (!isProtectionInstant(action)) return ALLOWED;
  const text = actionText(action);
  if (stackItems(context).some((item) => stackItemThreatensMe(item, context, text))) return ALLOWED;
  if (savesCreatureInCombat(context, text)) return ALLOWED;
  return { allowed: false, reason: "protection held: nothing on the stack (or in combat) threatens your permanents, so casting it now just wastes it" };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Rule 1: pointless sacrifices
// ---------------------------------------------------------------------------------------------------------------------------------

// Effects worth giving up a real permanent for: the sacrifice converts it into something bigger.
const CONVERT_EFFECT_RE = /\btransform\b|\bsearch your library\b|\bcreate\b[^.]*\btokens?\b|\bput [^.]* onto the battlefield\b|\breturn [^.]* from (?:your|a) graveyard\b/;

function sacrificedCards(action: ScorableAction, context: ScoringContext): CardLike[] | undefined {
  const battlefield = context.you?.battlefield ?? [];
  if (action.sacrificeCardIds && action.sacrificeCardIds.length > 0) {
    const found = action.sacrificeCardIds.map((id) => battlefield.find((card) => card.id === id)).filter((card): card is CardLike => Boolean(card));
    return found.length > 0 ? found : undefined;
  }
  const names = (action.label ?? "").match(/\(sacrifice ([^)]+)\)/i)?.[1];
  if (!names) return undefined;
  const picked: CardLike[] = [];
  for (const name of names.split(/,\s*/)) {
    const matches = battlefield.filter((card) => card.name === name && !picked.includes(card));
    if (matches.length === 0) continue;
    picked.push([...matches].sort((a, b) => Number(isToken(b)) - Number(isToken(a)) || creatureValue(a) - creatureValue(b))[0]);
  }
  return picked.length > 0 ? picked : undefined;
}

// Fodder: a token that is just a body, or a nothing card (0 mana value, 1 total stats, no text).
export function isWorthlessFodder(card: CardLike): boolean {
  const text = clean(card.oracleText);
  const stats = Math.max(0, parseNum(card.power) ?? 0) + Math.max(0, parseNum(card.toughness) ?? 0);
  if (card.commander) return false;
  if (isToken(card)) return creatureValue(card) <= 3.5 && !/\bwhenever\b|\bdraw\b|\bcreatures? you control (?:get|have)\b/.test(text);
  return (card.manaValue ?? 0) <= 0 && stats <= 1 && text.length === 0;
}

// Will this permanent be gone anyway: delayed sacrifice/exile on itself, or removal already on the stack aimed at it (or a sweeper).
export function isDoomed(card: CardLike, context: ScoringContext): boolean {
  const text = clean(card.oracleText);
  if (/\b(?:sacrifice|exile) (?:it|this creature)\b[^.]*\b(?:end step|end of turn)\b|\bat the beginning of (?:the )?(?:next )?end step, (?:sacrifice|exile)\b/.test(text)) return true;
  const mine = context.you?.id;
  for (const item of stackItems(context)) {
    if (mine && item.actorSeatId === mine) continue;
    const itemText = clean(item.oracleText);
    if (!itemText || !THREAT_RE.test(itemText)) continue;
    if ((item.targetCardIds ?? []).includes(card.id)) return true;
    if ((item.targetCardIds ?? []).length === 0 && /\b(?:destroy|exile) all\b|\ball creatures get -|\bdeals? \d+ damage to each creature\b|\beach creature\b/.test(itemText)) return true;
    // Removal on the stack whose target we cannot see, answered with a sacrifice outlet: the classic in-response play.
    if ((item.targetCardIds ?? []).length === 0 && (item.targetSeatIds ?? []).length === 0 && /\btarget (?:[a-z-]+ )*(?:creature|permanent)\b/.test(itemText) && context.purpose === "priority_response") return true;
  }
  return false;
}

// Life-drain per sacrifice the board already provides (Blood Artist, Zulaport Cutthroat, Falkenrath Noble ...) plus the outlet's own damage.
function drainPerSacrifice(action: ScorableAction, context: ScoringContext): number {
  let drain = 0;
  for (const card of context.you?.battlefield ?? []) {
    const match = clean(card.oracleText).match(/whenever [^.,]*(?:another creature|a creature)[^.,]* dies,[^.]*?(?:loses?|deals?) (\d+)(?: life| damage)/);
    if (match) drain += Number(match[1]);
  }
  const own = actionText(action).match(/deals? (\d+) damage to (?:any target|each opponent|target (?:player|opponent))/);
  if (own) drain += Number(own[1]);
  return drain;
}

export function sacrificeGuard(action: ScorableAction, context: ScoringContext): GuardVerdict {
  if (action.actionType !== "activate_ability") return ALLOWED;
  if (action.abilityKind !== undefined && action.abilityKind !== "generic_sacrifice") return ALLOWED;
  if (!/\(sacrifice /i.test(action.label ?? "") && !(action.sacrificeCardIds?.length)) return ALLOWED;
  const fodder = sacrificedCards(action, context);
  if (!fodder) return ALLOWED;
  // Sacrificing the ability's own source (fetch lands, Mind Stone) is a different trade, scored elsewhere.
  if (fodder.some((card) => card.id === action.cardId)) return ALLOWED;

  const text = actionText(action);
  const names = fodder.map((card) => card.name ?? "a permanent").join(", ");
  const converts = CONVERT_EFFECT_RE.test(text);

  // A lethal (or chain-lethal) drain is worth any sacrifice.
  const drain = drainPerSacrifice(action, context);
  if (drain > 0) {
    const minLife = Math.min(...(context.opponents ?? []).map((opponent) => opponent.life ?? 40), 999);
    const bodies = (context.you?.battlefield ?? []).filter(isCreature).length;
    if (minLife <= drain * Math.max(1, bodies)) return ALLOWED;
  }

  const realFodder = fodder.filter((card) => !isWorthlessFodder(card) && !isDoomed(card, context));
  if (realFodder.length > 0 && !converts) {
    return { allowed: false, reason: `sacrifice held: giving up ${realFodder.map((card) => card.name).join(", ")} for this payoff has no real gain (it is not doomed, not worthless fodder, and the effect is not lethal)` };
  }

  // Cheap repeatable outlets (scry, +1/+1 counter, mana, a card) fed with tokens: only while there are tokens to spare.
  if (!converts && realFodder.length === 0) {
    const doomed = fodder.every((card) => isDoomed(card, context));
    const spareTokens = (context.you?.battlefield ?? []).filter((card) => isToken(card) && isWorthlessFodder(card)).length;
    if (!doomed && drain === 0 && spareTokens < 3) {
      return { allowed: false, reason: `sacrifice held: ${names} is the last of your spare fodder; repeating a low-value sacrifice outlet just shrinks your board` };
    }
  }
  return ALLOWED;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Rule 4: situational / combat-only timing
// ---------------------------------------------------------------------------------------------------------------------------------

function isInstantOrSorcery(action: ScorableAction): boolean {
  const head = (actionText(action).split(".")[0] ?? "");
  return /\b(?:instant|sorcery)\b/.test(head) && !/\b(?:creature|enchantment|artifact|land|planeswalker)\b/.test(head);
}

interface CombatView {
  inCombat: boolean;
  attackersAtMe: CardLike[];
  oppAttackers: CardLike[];
  oppBlockers: CardLike[];
  myCombat: CardLike[];
  oppCombat: CardLike[];
}

function combatView(context: ScoringContext): CombatView {
  const mineIds = myCardIds(context);
  const me = context.you?.id;
  const oppCreatures = (context.opponents ?? []).flatMap((opponent) => opponent.battlefield ?? []).filter(isCreature);
  const myCreatures = (context.you?.battlefield ?? []).filter(isCreature);
  const oppAttackers = oppCreatures.filter((card) => card.attacking);
  const attackersAtMe = oppAttackers.filter((card) => !card.attackTargetId || card.attackTargetId === me || mineIds.has(card.attackTargetId));
  const phase = (context.phase ?? "").toLowerCase();
  const anyAttacking = oppAttackers.length > 0 || myCreatures.some((card) => card.attacking);
  const inCombat = phase ? /\bdeclare (?:attackers|blockers)\b|\bcombat damage\b|^combat$/.test(phase) : anyAttacking;
  return {
    inCombat,
    attackersAtMe,
    oppAttackers,
    oppBlockers: oppCreatures.filter((card) => card.blocking),
    myCombat: myCreatures.filter((card) => card.attacking || card.blocking),
    oppCombat: oppCreatures.filter((card) => card.attacking || card.blocking)
  };
}

const FOG_RE = /\bprevent all (?:combat )?damage that would be dealt\b/;
const X_ATTACKERS_RE = /\bnumber of (?:attacking )?creatures attacking you\b|\bfor each creature attacking you\b/;
const ATTACKER_REMOVAL_RE = /\b(?:destroy|exile) (?:target|all|each) (?:tapped )?(?:attacking|blocking) creatures?\b/;
const PUMP_RE = /\b(?:gets?|get) \+(\d+|x)\/\+(\d+|x)\b/;
const NOT_PURE_PUMP_RE = /\b(?:draw|create|destroy|exile|search|return|counter target|deals? (?:\d+|x) damage|gains? \d+ life|untap|tap target|choose (?:one|two|three|up to))\b/;

// A spell that only has value in a specific game situation (a fog / "X = creatures attacking you", a combat trick, removal of an
// attacking creature, anything that names attacking/blocking creatures) is held unless that situation is actually on the table.
export function situationalTimingGuard(action: ScorableAction, context: ScoringContext): GuardVerdict {
  if (action.actionType !== "cast_spell" || !isInstantOrSorcery(action)) return ALLOWED;
  const text = actionText(action);
  if (!text || /\bchoose (?:one|two|three|up to)\b/.test(text)) return ALLOWED;
  const view = combatView(context);
  const name = (action.label ?? "").replace(/^cast\s+/i, "") || "this spell";
  const life = Math.max(1, context.you?.life ?? 40);
  const where = view.inCombat ? "this combat" : "outside combat";

  // (a) fog / combat-damage prevention / "X = creatures attacking you"
  if (FOG_RE.test(text) || X_ATTACKERS_RE.test(text)) {
    if (!view.inCombat) return { allowed: false, reason: `${name} held: it only matters once creatures are attacking you, and it is ${where} (it would do nothing now)` };
    if (view.attackersAtMe.length === 0) return { allowed: false, reason: `${name} held: no creature is attacking you or your permanents` };
    const power = totalPower(view.attackersAtMe);
    if (power < 3 && power < life / 4) return { allowed: false, reason: `${name} held: the ${power} combat damage coming at you is not worth a card` };
    return ALLOWED;
  }

  // (c) removal of attacking/blocking creatures (Settle the Wreckage, "destroy target attacking creature")
  if (ATTACKER_REMOVAL_RE.test(text)) {
    const blocking = /\bblocking creatures?\b/.test(text);
    const pool = blocking ? view.oppBlockers : view.attackersAtMe;
    if (!view.inCombat || pool.length === 0) return { allowed: false, reason: `${name} held: there is no ${blocking ? "blocking" : "attacking"} creature to hit ${where}` };
    if (/\b(?:all|each) (?:tapped )?(?:attacking|blocking) creatures\b/.test(text) && pool.length < 2 && totalPower(pool) < 4) {
      return { allowed: false, reason: `${name} held: a mass exile/destroy of attackers is wasted on so small an attack` };
    }
    return ALLOWED; // whether the (single) target is worth a removal spell is removalGuard's call
  }

  // (e) generic: the text names attacking / blocking creatures and none exist
  const namesAttackers = /\battacking\b|\bcreatures? attacking you\b/.test(text) && !/\btapped and attacking\b|\bthat's attacking\b/.test(text);
  const namesBlockers = /\bblocking\b|\bblocked creature\b/.test(text);
  if (namesAttackers || namesBlockers) {
    const attackers = (context.opponents ?? []).flatMap((opponent) => opponent.battlefield ?? []).concat(context.you?.battlefield ?? []).filter((card) => card.attacking);
    const blockers = (context.opponents ?? []).flatMap((opponent) => opponent.battlefield ?? []).concat(context.you?.battlefield ?? []).filter((card) => card.blocking);
    if ((namesAttackers && attackers.length === 0) || (namesBlockers && !namesAttackers && blockers.length === 0)) {
      return { allowed: false, reason: `${name} held: its text needs ${namesAttackers ? "attacking" : "blocking"} creatures and there are none right now` };
    }
  }

  // (b) combat tricks / pump spells
  const pump = text.match(PUMP_RE);
  if (pump && /\buntil end of turn\b/.test(text) && !NOT_PURE_PUMP_RE.test(text)) {
    const bonusP = pump[1] === "x" ? 3 : Number(pump[1]);
    const bonusT = pump[2] === "x" ? 3 : Number(pump[2]);
    const mass = /\bcreatures you control get\b/.test(text);
    const mine = view.myCombat;
    const outcomeChanges = mine.some((creature) =>
      view.oppCombat.some((enemy) => {
        if (hasIndestructible(creature) && hasIndestructible(enemy)) return false;
        const toughness = parseNum(creature.toughness) ?? 0;
        const power = parseNum(creature.power) ?? 0;
        const enemyPower = parseNum(enemy.power) ?? 0;
        const enemyToughness = parseNum(enemy.toughness) ?? 0;
        const diesBefore = !hasIndestructible(creature) && (hasDeathtouch(enemy) || enemyPower >= toughness);
        const diesAfter = !hasIndestructible(creature) && (hasDeathtouch(enemy) || enemyPower >= toughness + bonusT);
        const killsBefore = !hasIndestructible(enemy) && (hasDeathtouch(creature) || power >= enemyToughness);
        const killsAfter = !hasIndestructible(enemy) && (hasDeathtouch(creature) || power + bonusP >= enemyToughness);
        return (diesBefore && !diesAfter) || (!killsBefore && killsAfter);
      })
    );
    const minOppLife = Math.min(...(context.opponents ?? []).map((opponent) => opponent.life ?? 40), 999);
    // Lethal: my attackers, after the pump, minus one blocked body per potential blocker, reach the lowest life total.
    const attackers = (context.you?.battlefield ?? []).filter((card) => isCreature(card) && (view.inCombat ? card.attacking : !card.tapped && !card.summoningSick));
    const boosted = attackers.map((card) => Math.max(0, parseNum(card.power) ?? 0) + (mass ? bonusP : 0)).sort((a, b) => b - a);
    if (!mass && boosted.length > 0) boosted[0] += bonusP;
    const blockersLeft = view.inCombat
      ? view.oppBlockers.length
      : (context.opponents ?? []).flatMap((opponent) => opponent.battlefield ?? []).filter((card) => isCreature(card) && !card.tapped).length;
    const lethal = boosted.slice(Math.min(blockersLeft, boosted.length)).reduce((sum, value) => sum + value, 0) >= minOppLife;

    if (view.inCombat) {
      if (mine.length === 0) return { allowed: false, reason: `${name} held: none of your creatures is in combat, so a pump trick has nothing to improve` };
      if (outcomeChanges || lethal) return ALLOWED;
      return { allowed: false, reason: `${name} held: the pump would not save a creature, kill a creature or make the attack lethal — keep it for when it changes the combat` };
    }
    if (lethal) return ALLOWED;
    return { allowed: false, reason: `${name} held: a pump spell cast ${where} with no lethal attack available just wastes it` };
  }

  return ALLOWED;
}

// The positive side of the rule: a combat-only spell (fog, "X = attackers", attacker removal, an outcome-changing pump) that the guard
// ALLOWS during a real combat is exactly when it should be cast, so it must outscore passing even though scoreHoldInstants penalizes
// casting an instant onto an empty stack. Returns the score bonus (0 when not applicable).
export function combatSpellBonus(action: ScorableAction, context: ScoringContext): number {
  if (action.actionType !== "cast_spell" || !isInstantOrSorcery(action)) return 0;
  const text = actionText(action);
  if (!(FOG_RE.test(text) || X_ATTACKERS_RE.test(text) || ATTACKER_REMOVAL_RE.test(text) || (PUMP_RE.test(text) && !NOT_PURE_PUMP_RE.test(text)))) return 0;
  if (!combatView(context).inCombat || !situationalTimingGuard(action, context).allowed) return 0;
  return 7;
}

// ---------------------------------------------------------------------------------------------------------------------------------

export function evaluatePlayGuards(action: ScorableAction, context: ScoringContext): { vetoed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const verdict of [sacrificeGuard(action, context), removalGuard(action, context), protectionGuard(action, context), situationalTimingGuard(action, context)]) {
    if (!verdict.allowed && verdict.reason) reasons.push(verdict.reason);
  }
  return { vetoed: reasons.length > 0, reasons };
}
