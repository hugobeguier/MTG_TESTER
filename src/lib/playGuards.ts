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
import { hasDeathtouch, hasIndestructible, hasKeyword, parseNum, simulateDuel } from "./combatSim";
import { untappedBlockersFor } from "./freeAttack";
import { wipeSequencingGuard } from "./wipeSequencing";
import { mustAttackEachCombat } from "./combatRestrictions";

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
  // The permanent types the target phrase names (destroy/exile only).
  types?: Array<"creature" | "artifact" | "enchantment" | "planeswalker" | "permanent">;
  // Fixed damage (damage spells only): a target whose toughness is above it cannot be killed, so it is never "the threat worth the spell".
  damage?: number;
  // A "Choose one —" spell whose every mode is removal (Abrade: 3 damage to a creature OR destroy an artifact): the guard judges the best target across all modes.
  modes?: RemovalSpell[];
}

const NOUN = "([a-z,' -]*?)";

// Recognizes a spell/aura whose job is to take out ONE opposing creature/permanent. Counterspells, board wipes, burn that may go face
// ("any target") and modal spells are deliberately not recognized — the guard can't tell which mode/target they will use.
export function parseTargetedRemoval(action: ScorableAction): RemovalSpell | undefined {
  if (action.actionType !== "cast_spell") return undefined;
  const text = actionText(action);
  if (!text || /\bcounter target\b/.test(text)) return undefined;
  // "Choose one — • A • B" where every bullet is itself targeted removal (Abrade): evaluated as the union of its modes. Any non-removal mode (a counter, a
  // draw, ...) leaves the whole spell alone — the guard cannot tell which mode will be used.
  if (/\bchoose (?:one|two|three|up to)\b/.test(text)) {
    if (!/\bchoose one\b/.test(text)) return undefined;
    const bullets = text.split("•").slice(1).map((bullet) => bullet.trim()).filter(Boolean);
    if (bullets.length < 2) return undefined;
    const modes = bullets.map((bullet) => parseTargetedRemoval({ ...action, detail: bullet }));
    if (modes.some((mode) => !mode || mode.modes)) return undefined;
    const concrete = modes as RemovalSpell[];
    return { kind: concrete[0].kind, scope: "permanent", modes: concrete };
  }
  const isAura = /\baura\b/.test(text.split(".")[0] ?? "") || /\benchant creature\b/.test(text);

  if (isAura && /\benchant creature\b(?! you control)/.test(text)) {
    if (/\benchanted creature\b[^.]*\b(?:can't attack|can't block|loses all abilities|base power and toughness|doesn't untap|gets -\d+\/-\d+|becomes? a)/.test(text)) return { kind: "aura", scope: "creature" };
    return undefined;
  }

  // "Destroy/exile target <types>" -- creature, artifact, enchantment, planeswalker, permanent or a mix ("artifact, enchantment, or creature with
  // power 4 or greater"). Graveyard cards and "you control" targets are not removal of an opposing permanent.
  const destroyExile = text.match(/\b(destroy|exile) target ([a-z,' -]+?)(?= with | that | an opponent|\.|$)/);
  if (destroyExile) {
    const sentence = text.slice(destroyExile.index ?? 0).split(".")[0] ?? "";
    const phrase = destroyExile[2];
    if (!/\bcards?\b/.test(phrase) && !/\byou (?:control|own)\b/.test(sentence)) {
      const types = (["creature", "artifact", "enchantment", "planeswalker", "permanent"] as const).filter((type) => new RegExp(`\\b${type}s?\\b`).test(phrase));
      if (types.length > 0) {
        return { kind: destroyExile[1] as "destroy" | "exile", scope: types.every((type) => type === "creature" || type === "planeswalker") ? "creature" : "permanent", types: [...types] };
      }
    }
  }

  // "The owner of target permanent shuffles it into their library, then reveals the top card..." (Chaos Warp): removal-shaped, premium.
  if (/\bthe owner of target permanent shuffles it into their library\b/.test(text)) return { kind: "exile", scope: "permanent", types: ["permanent"] };

  if (new RegExp(`\\breturn target ${NOUN}(creature|permanent)\\b(?! cards?)(?! you (?:control|own))[^.]* to (?:its|their) owner's hand`).test(text)) {
    return { kind: "bounce", scope: "creature" };
  }
  const damageMatch = text.match(new RegExp(`\\bdeals? (\\d+|x) damage to target ${NOUN}creature\\b(?! you control)(?! card)`));
  if (damageMatch && !/\bany target\b/.test(text)) {
    return { kind: "damage", scope: "creature", ...(/^\d+$/.test(damageMatch[1]) ? { damage: Number(damageMatch[1]) } : {}) };
  }
  if (/\btarget creature (?:an opponent controls )?gets? -(?:\d+|x)\/-(?:\d+|x)/.test(text)) return { kind: "shrink", scope: "creature" };
  return undefined;
}

const COLOR_NAME_TO_CODE: Record<string, string> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };

// Colour letters in the leading mana cost of a legal-action detail ("{1}{W} Instant. ...").
export function spellColorsOf(action: ScorableAction): string[] {
  const cost = (action.detail ?? "").match(/^\s*((?:\{[^}]+\}\s*)+)/)?.[1] ?? "";
  return Array.from(new Set((cost.match(/\{([WUBRG])(?:\/[A-Z0-9]+)?\}/g) ?? []).map((symbol) => symbol[1])));
}

// "protection from white", "protection from red and blue", "protection from everything" (card.keywords entries, or the card's own text).
export function isProtectedFromSpell(card: CardLike, spellColors: string[]): boolean {
  const lines = [...(card.keywords ?? []), ...(card.keywords ? [] : (card.oracleText ?? "").split("\n"))].map((line) => line.toLowerCase());
  for (const line of lines) {
    const match = line.match(/^protection from ([a-z ,]+)/);
    if (!match) continue;
    if (/\beverything\b/.test(match[1])) return true;
    const words = match[1].split(/[ ,]+/);
    if (words.some((word) => spellColors.includes(COLOR_NAME_TO_CODE[word] ?? ""))) return true;
  }
  return false;
}

// Ward is a tax on the removal spell: the target is worth that much less (at least one point; one point per ward {1}).
export function wardPenalty(card: CardLike): number {
  const entry = (card.keywords ?? []).map((line) => line.toLowerCase()).find((line) => line.startsWith("ward"));
  const text = entry ?? (card.keywords ? undefined : clean(card.oracleText).match(/\bward\b[^.\n]*/)?.[0]);
  if (!text) return 0;
  const amount = Number(text.match(/\d+/)?.[0] ?? 1);
  return 0.5 + 0.5 * Math.max(1, amount);
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

// ---------------------------------------------------------------------------------------------------------------------------------
// Target worth: WHY a permanent deserves a removal spell. One deterministic evaluation, a score plus a list of short human-readable reasons, used by
// removalGuard as its veto threshold for every removal type, shown to the agent's model in the scored options, and recorded with the decision.
// The ten questions it answers (mirrored in the agent prompt and docs/agents/system.md):
//   1 threat to me (damage vs my life, lethal board)   2 can it hurt my permanents (destroy/exile/steal/bounce/tap/damage)   3 does it add or double damage
//   4 can I block it (flying/menace/trample/unblockable/protection)   5 value engine / combo / artifact-count enabler   6 their commander, attachments, counters
//   7 vanilla token / 1-1 / cheap to replace   8 cost of the removal vs what it buys (premium removal waits)   9 tempo: am I under lethal pressure, outnumbered
//   10 summoning sick, death/leave triggers that help them, indestructible/regenerate vs destroy, is its controller even the player threatening me
// ---------------------------------------------------------------------------------------------------------------------------------
export interface TargetWorth {
  score: number;
  reasons: string[];
}

export interface RemovalSpellInfo {
  kind: RemovalSpell["kind"];
  manaValue: number;
  // Premium, cheap, unconditional removal (Swords, Path, Chaos Warp): held for a real threat.
  premium: boolean;
}

function attachmentsOn(card: CardLike, context: ScoringContext): CardLike[] {
  const everyone = [...(context.you?.battlefield ?? []), ...(context.opponents ?? []).flatMap((opponent) => opponent.battlefield ?? [])];
  return everyone.filter((other) => (other as { attachedToId?: string }).attachedToId === card.id);
}

export function evaluateTargetWorth(card: CardLike, context: ScoringContext, spell?: Pick<RemovalSpellInfo, "kind">): TargetWorth {
  const reasons: string[] = [];
  let score = 0;
  const add = (amount: number, reason: string) => {
    score += amount;
    reasons.push(`${reason} (${amount >= 0 ? "+" : ""}${amount.toFixed(1)})`);
  };
  const text = clean(card.oracleText);
  const power = Math.max(0, parseNum(card.power) ?? 0);
  const myLife = Math.max(1, context.you?.life ?? 40);
  const mine = context.you?.battlefield ?? [];
  const myBlockers = mine.filter((other) => isCreature(other) && !other.tapped);
  const owner = ownerOf(card, context);
  const ownerPower = totalPower(owner?.battlefield);

  // 1 + base: its body, keywords, engines (creatureValue) and what its power does against MY life (opposingThreat).
  add(opposingThreat(card, context), isCreature(card) ? "body, keywords and damage against my life" : "what this permanent does for them");

  // 1: lethal pressure from its controller's whole board
  if (ownerPower >= myLife) add(3, `its controller's board (${ownerPower} power) is lethal against my ${myLife} life`);
  else if (ownerPower >= myLife * 0.6) add(1.2, `its controller's board (${ownerPower} power) is close to lethal against my ${myLife} life`);
  // 9: outnumbered
  const theirAttackers = (owner?.battlefield ?? []).filter((other) => isCreature(other) && !other.tapped).length;
  if (isCreature(card) && theirAttackers > myBlockers.length + 1) add(0.8, `they have ${theirAttackers} creatures against my ${myBlockers.length} untapped blockers`);

  // 2: can it hurt my permanents
  if (/\b(?:destroy|exile|sacrifices?)\b[^.]*\b(?:target|each|all|an opponent)\b/.test(text)) add(1.5, "can destroy, exile or force sacrifices of my permanents");
  if (/\bgain control of\b|\bcontrol (?:target|another)\b/.test(text)) add(2, "can steal my permanents");
  if (/\bdeals? (?:\d+|x|that much) damage to (?:any target|target (?:creature|player|opponent)|each (?:creature|opponent|player))/.test(text)) add(1.2, "can damage my creatures or me with its abilities");
  if (/\breturn target [^.]* to (?:its|their) owner's hand\b|\btap target\b|\bdoesn't untap\b/.test(text)) add(0.8, "can bounce or tap down my permanents");

  // 3: adds or multiplies damage
  if (/\b(?:other )?(?:[a-z]+ )?creatures? you control get \+\d|\bcreatures you control have (?:double strike|trample|haste)\b/.test(text)) add(1.5, "pumps or empowers the creatures that attack me (anthem)");
  if (/\bdouble (?:the )?damage\b|\bdeals? double\b|\bdouble the power\b/.test(text)) add(2, "doubles damage");
  if (/\badditional combat phase\b/.test(text)) add(2, "grants extra combat phases");
  if (/\{[^}]*\}:[^.]*gets? \+(?:\d|x)\/\+0/.test(text)) add(0.8, "can pump itself with spare mana");

  // 4: can I block it?
  if (hasKeyword(card, "flying") && !mine.some((other) => hasKeyword(other, "flying") || hasKeyword(other, "reach"))) add(1.2, "flying and I have nothing with flying or reach to block it");
  if (/\bcan'?t be blocked\b/.test(text) && !/\bcan'?t be blocked by\b/.test(text)) add(1.5, "cannot be blocked");
  if ((hasKeyword(card, "shadow") || hasKeyword(card, "fear") || hasKeyword(card, "intimidate") || hasKeyword(card, "skulk")) && power >= 2) add(1, "evasion that dodges my blockers");
  if (hasKeyword(card, "menace") && myBlockers.length < 2) add(0.8, "menace and I cannot double-block it");
  if (hasKeyword(card, "trample") && power >= 4) add(0.6, "trample runs over my chump blockers");
  if (/\bprotection from\b/.test(text)) add(0.5, "protection makes it hard to block or deal with");

  // 5: engines, tutors, recursion, artifact-count enablers
  if (/\bsearch your library\b/.test(text)) add(1.2, "tutors for more threats");
  if (/\breturn [^.]* from (?:your|a) graveyard\b/.test(text)) add(1, "recursion engine");
  if (/\bextra turn\b|\btake an extra turn\b/.test(text)) add(3, "extra turns");
  if (/\bfor each artifact you control\b|\baffinity for artifacts\b|\bimprovise\b|\bartifact (?:spells|creatures) you (?:cast|control)\b/.test(text)) add(1.5, "artifact-count / affinity synergy piece");
  const theirArtifacts = (owner?.battlefield ?? []).filter((other) => (other.typeLine ?? "").includes("Artifact")).length;
  if ((card.typeLine ?? "").includes("Artifact") && theirArtifacts >= 4 && !isToken(card)) add(0.8, `one of ${theirArtifacts} artifacts powering their artifact synergies`);

  // 6: commander, attachments
  if (card.commander) reasons.push("it is their commander (already priced into its body value)");
  const attached = attachmentsOn(card, context);
  if (attached.length > 0) add(Math.min(2.5, attached.length * 1), `carries ${attached.length} attached Aura/Equipment that would be lost with it`);

  // 7: low value
  if (isToken(card) && !text) add(-2.5, "vanilla token — cheap to replace, no abilities");
  else if (isToken(card)) add(-0.8, "a token: removing it costs them no card");
  else if (!text && power <= 2) add(-1, "no abilities to speak of");

  // 10: misc
  if (card.summoningSick) add(-0.5, "summoning sick, it cannot attack until their next turn");
  if (/\bwhen(?:ever)? (?:this (?:creature|permanent)|[^,]+) (?:dies|leaves the battlefield)\b/.test(text)) add(-1.5, "its death/leave trigger pays them back when it is removed");
  if ((spell?.kind === "destroy" || spell?.kind === "damage") && hasIndestructible(card)) add(-100, "indestructible: destroy/damage does nothing to it");
  if (/\bregenerate\b/.test(text) && (spell?.kind === "destroy" || spell?.kind === "damage")) add(-2, "it can regenerate");
  const maxOtherPower = Math.max(0, ...(context.opponents ?? []).filter((opponent) => opponent !== owner).map((opponent) => totalPower(opponent.battlefield)));
  if (owner && ownerPower > 0 && ownerPower * 4 <= maxOtherPower && ownerPower < myLife * 0.3) add(-1, "its controller is not the opponent threatening me most");
  return { score, reasons };
}

export interface RemovalAssessment extends GuardVerdict {
  bestTarget?: CardLike;
  bestThreat?: number;
  threshold?: number;
  // The target-worth evaluation behind the verdict: who was judged, the score against the bar, and every reason in plain words.
  worth?: { target: string; score: number; threshold: number; reasons: string[] };
}

// Is there a target on the table worth spending this removal on? The target is chosen AFTER the cast (legal-action targetIds is usually
// empty), so this asks whether the best available target clears the bar; a removal spell may still be held for a better one.
export function removalGuard(action: ScorableAction, context: ScoringContext): RemovalAssessment {
  const spell = parseTargetedRemoval(action);
  if (!spell) return ALLOWED;
  const opponents = context.opponents ?? [];
  const named = action.targetIds.map((id) => opponents.flatMap((opponent) => opponent.battlefield ?? []).find((card) => card.id === id)).filter((card): card is CardLike => Boolean(card));
  // An opponent's hexproof/shroud or phased-out permanent is not a legal target at all, so it can never be "the threat worth removing"
  // (a hexproof commander next to a 1/1 Servo made the guard approve Swords, whose only legal target was the Servo).
  // Protection from the SPELL's colour (read from the leading mana cost of the action detail) or from everything makes it illegal too.
  const spellColors = spellColorsOf(action);
  const targetable = (card: CardLike) => !card.phasedOut && !hasKeyword(card, "hexproof") && !hasKeyword(card, "shroud") && !isProtectedFromSpell(card, spellColors);
  const pool = opponents.flatMap((opponent) => opponent.battlefield ?? []).filter((card) => !(card.typeLine ?? "").includes("Land") && targetable(card));
  // One pool per mode (a plain spell is a single mode); a damage spell can only ever kill what its fixed damage reaches.
  const modes = spell.modes ?? [spell];
  const poolFor = (mode: RemovalSpell): CardLike[] => {
    const modeTyped = mode.types && !mode.types.includes("permanent") ? mode.types : undefined;
    const modeMatches = (card: CardLike) => (modeTyped ?? []).some((type) => (type === "creature" ? isCreature(card) : (card.typeLine ?? "").includes(type === "artifact" ? "Artifact" : type === "enchantment" ? "Enchantment" : "Planeswalker")));
    const base = mode.scope === "creature" ? pool.filter(isCreature) : modeTyped ? pool.filter(modeMatches) : pool;
    return mode.kind === "damage" && mode.damage !== undefined ? base.filter((card) => (parseNum(card.toughness) ?? 0) <= mode.damage!) : base;
  };
  const typed = spell.modes ? undefined : spell.types && !spell.types.includes("permanent") ? spell.types : undefined;
  const modePools = modes.flatMap((mode) => poolFor(mode));
  const candidates = named.length > 0 ? named.filter(targetable) : Array.from(new Map(modePools.map((card) => [card.id, card])).values());
  if (candidates.length === 0 && spell.kind === "damage" && spell.damage !== undefined && named.length === 0 && pool.some(isCreature)) {
    return { allowed: false, reason: `removal held: ${spell.damage} damage cannot kill any opposing creature, so it would be wasted` };
  }
  if (candidates.length === 0) {
    // Removal with no opposing legal target on the table (no creature for creature removal, no artifact/enchantment/creature for Exorcise or
    // Putrefy-style text) can only be aimed at my own permanents (Swords on my own commander); self-play found agents casting it anyway.
    // Plain "target permanent" removal is left to the engine (a land may be a legal target).
    if ((spell.scope === "creature" || typed || spell.modes) && named.length === 0) {
      return { allowed: false, reason: `removal held: no opposing ${typed ? typed.join("/") : "creature"} to target, so ${spell.kind === "aura" ? "the Aura" : "the spell"} could only hit your own` };
    }
    return ALLOWED;
  }
  // Non-creature targets (artifacts, enchantments): a real permanent — not a token, and costing 2+ or carrying rules text — is worth a destroy/exile on its own.
  // A creature token wearing the artifact type (a Servo), or a vanilla one, is judged like any creature below instead of getting a free pass.
  // (Open-ended "target permanent" removal such as Chaos Warp is NOT waved through: it goes through the worth threshold below.)
  const touchesNonCreature = modes.some((mode) => mode.types?.some((type) => type === "artifact" || type === "enchantment"));
  if (touchesNonCreature) {
    const worthy = candidates.find((card) => !isCreature(card) && !isToken(card) && ((card.manaValue ?? 0) >= 2 || clean(card.oracleText).length > 0));
    if (worthy) {
      const verdict = evaluateTargetWorth(worthy, context, { kind: "destroy" });
      return { allowed: true, bestTarget: worthy, worth: { target: worthy.name ?? "an artifact or enchantment", score: verdict.score, threshold: 0, reasons: ["a real (non-token) artifact/enchantment with value is worth a destroy effect", ...verdict.reasons] } };
    }
  }

  const spellCard = (context.you?.hand ?? []).find((card) => card.id === action.cardId);
  const manaValue = spellCard?.manaValue ?? 2;
  const myLife = Math.max(1, context.you?.life ?? 40);

  // Ward is a real tax on the removal spell: the target is worth that much less per point of ward cost (at least one point).
  const evaluated = candidates.map((card) => {
    const worth = evaluateTargetWorth(card, context, { kind: spell.modes ? "exile" : spell.kind });
    const ward = wardPenalty(card);
    return { card, threat: worth.score - ward, reasons: ward > 0 ? [...worth.reasons, `ward taxes the spell (-${ward.toFixed(1)})`] : worth.reasons };
  });
  const scored = evaluated.sort((a, b) => b.threat - a.threat);
  const best = scored[0];
  const second = scored[1]?.threat ?? 0;
  let threshold = removalMinThreat(manaValue);
  // Premium cheap unconditional removal (Swords, Path, Chaos Warp) waits for a real threat; burn and narrow removal has a lower bar.
  // Premium: one-or-two-mana unconditional exile/destroy on a creature (Swords, Path), or open-ended "target permanent" removal (Chaos Warp).
  const unconditionalCreature = spell.types?.length === 1 && spell.types[0] === "creature" && manaValue <= 2;
  const openEndedPermanent = spell.types?.length === 1 && spell.types[0] === "permanent";
  const premium = (spell.kind === "exile" || spell.kind === "destroy") && !spell.modes && (unconditionalCreature || openEndedPermanent);
  const barNotes: string[] = [];
  if (premium) {
    threshold += 1;
    barNotes.push("premium cheap removal waits for a real threat (bar +1.0)");
  }
  // The one clear standout on a board of small stuff is worth a little less than the usual bar.
  if (best.threat >= second + 2) {
    threshold = Math.max(3, threshold - 1);
    barNotes.push("it is the clear standout on the board (bar -1.0)");
  }
  const worth = { target: best.card.name ?? "a permanent", score: best.threat, threshold, reasons: [...best.reasons, ...barNotes] };

  if (best.threat >= threshold) return { allowed: true, bestTarget: best.card, bestThreat: best.threat, threshold, worth };

  // Threatening lethal: an opponent whose combined power reaches my life, and the target is part of it.
  for (const { card } of scored) {
    const owner = ownerOf(card, context);
    if ((parseNum(card.power) ?? 0) > 0 && totalPower(owner?.battlefield) >= myLife) {
      return { allowed: true, bestTarget: card, bestThreat: best.threat, threshold, worth: { ...worth, reasons: [...worth.reasons, "lethal on board: removing a body that is part of it is justified"] } };
    }
  }
  return {
    allowed: false,
    reason: `removal held: the best target (${best.card.name ?? "a creature"}, worth ${best.threat.toFixed(1)}) is below the ${threshold.toFixed(1)} bar for spending a removal spell — keep it for a real threat. Why: ${worth.reasons.slice(0, 4).join("; ")}`,
    bestTarget: best.card,
    bestThreat: best.threat,
    threshold,
    worth
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
// Rule 5: spells that cannot do anything useful (found by the self-play mistake detector, npm run agent:mistakes)
// ---------------------------------------------------------------------------------------------------------------------------------

const COUNTER_RE = /\bcounter target (?:[a-z-]+ )*(?:spell|ability)\b/;

// Life this spell makes its caster lose as it resolves (an instant/sorcery's "you lose N life", or a permanent's enters trigger).
// Recurring upkeep/attack triggers, activated abilities and ward costs are not part of casting it.
export function immediateLifeLoss(action: ScorableAction): number {
  const text = actionText(action);
  const head = text.split(".")[0] ?? "";
  const spell = isInstantOrSorcery(action);
  let total = 0;
  for (const sentence of text.split(/(?<=\.)\s+|\n/)) {
    const lose = sentence.match(/\byou lose (\d+) life\b/);
    if (!lose) continue;
    if (/^(?:at the beginning|whenever|ward)\b|:/.test(sentence.trim())) continue;
    if (!spell && !/^when [^,]*\benters\b/.test(sentence.trim())) continue;
    total += Number(lose[1]);
  }
  return head ? total : 0;
}

// A counterspell cast with nothing to counter (empty stack, or only my own spells on it) is simply thrown away; a spell that costs more
// life than I have kills me. Both are exactly specifiable, so they are hard vetoes. Modal spells (Cryptic Command) are left alone.
export function wastedSpellGuard(action: ScorableAction, context: ScoringContext): GuardVerdict {
  if (action.actionType !== "cast_spell") return ALLOWED;
  const text = actionText(action);
  const name = (action.label ?? "").replace(/^cast\s+/i, "") || "this spell";
  if (COUNTER_RE.test(text) && !/\bchoose (?:one|two|three|up to)\b/.test(text)) {
    const mine = context.you?.id;
    const others = stackItems(context).filter((item) => !mine || item.actorSeatId !== mine);
    if (others.length === 0) return { allowed: false, reason: `${name} held: there is nothing from an opponent on the stack to counter` };
  }
  const loss = immediateLifeLoss(action);
  const life = context.you?.life;
  if (loss > 0 && life !== undefined && life <= loss) return { allowed: false, reason: `${name} held: it makes you lose ${loss} life and you only have ${life}` };
  return ALLOWED;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Rule 6: suicide attacks
// ---------------------------------------------------------------------------------------------------------------------------------

const ATTACK_VALUE_TRIGGER_RE = /\bwhenever (?:this creature|[a-z,' -]+?) attacks\b[^.]*\b(?:create|draw|deal|deals|add|gain|put|return|exile|destroy|each opponent|target)\b/;

// An attacker the defender can block and kill without losing the blocker is just given away -- unless the attack achieves something else:
// it is lethal (alone or with the rest of the team), the creature is forced to attack, it has an
// attack trigger that pays for itself, it is a commander closing in on 21, or the defender cannot afford to eat every attacker I send
// (more attackers than creatures that can kill one for free). Cheap bodies (value < 3) are expendable and never vetoed.
export function suicideAttackGuard(action: ScorableAction, context: ScoringContext): GuardVerdict {
  if (action.actionType !== "attack") return ALLOWED;
  const attacker = (context.you?.battlefield ?? []).find((card) => card.id === action.cardId);
  const targetId = action.targetIds[0];
  const defender = (context.opponents ?? []).find((opponent) => opponent.id === targetId);
  if (!attacker || !defender) return ALLOWED; // planeswalker / battle attacks are not judged here
  if (mustAttackEachCombat({ oracleText: attacker.oracleText ?? "", goaded: attacker.goaded })) return ALLOWED;
  if (isToken(attacker) || creatureValue(attacker) < 3) return ALLOWED;

  const killers = untappedBlockersFor(attacker, defender).filter((blocker) => {
    const duel = simulateDuel(attacker, blocker);
    return duel.attackerDies && !duel.blockerDies;
  });
  if (killers.length === 0) return ALLOWED;

  const power = Math.max(0, parseNum(attacker.power) ?? 0);
  const life = defender.life ?? 40;
  // Everything of mine that could be sent at this defender this combat (declared already, or still able to attack).
  const team = (context.you?.battlefield ?? []).filter((card) => isCreature(card) && (card.attacking ? card.attackTargetId === defender.id || !card.attackTargetId : !card.tapped && !card.summoningSick && (parseNum(card.power) ?? 0) > 0));
  const teamPower = totalPower(team.concat(team.includes(attacker) ? [] : [attacker]));
  if (power >= life || (teamPower >= life && team.length > killers.length)) return ALLOWED;
  if (team.length > killers.length) return ALLOWED; // the defender cannot block and kill every attacker
  if (ATTACK_VALUE_TRIGGER_RE.test(clean(attacker.oracleText))) return ALLOWED;
  if (attacker.commander && (defender.commanderDamage?.[attacker.id] ?? 0) >= 12) return ALLOWED;

  const killer = killers[0];
  return { allowed: false, reason: `attack held: ${attacker.name ?? "the attacker"} would be blocked and killed by ${killer.name ?? "an untapped creature"} without killing it, and nothing else (lethal, trample, an attack trigger, a wider attack) makes the attack worth it` };
}

// ---------------------------------------------------------------------------------------------------------------------------------

export function evaluatePlayGuards(action: ScorableAction, context: ScoringContext): { vetoed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const verdict of [sacrificeGuard(action, context), removalGuard(action, context), protectionGuard(action, context), situationalTimingGuard(action, context), wastedSpellGuard(action, context), suicideAttackGuard(action, context), wipeSequencingGuard(action, context)]) {
    if (!verdict.allowed && verdict.reason) reasons.push(verdict.reason);
  }
  return { vetoed: reasons.length > 0, reasons };
}
