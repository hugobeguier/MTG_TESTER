// "Target X gets / gains / loses ..." effects: the many small cards whose whole effect is one verb applied to a target the player chooses
// (Wizard Class's counter, Witch's Clinic's lifelink, Blood Artist's drain, Expedite's haste, ...). Parsing them into a TargetedEffect lets the
// engine ask a human for the target (a TargetSpec) instead of picking one, and apply the verb to whatever was chosen.
import type { RemovalTargetType } from "./removalSpells";
import type { TargetController, TargetSpec } from "./targeting";

export type TargetedVerb =
  | { kind: "add_counters"; counterKind: string; amount: number }
  | { kind: "gain_keywords"; keywords: string[] }
  | { kind: "pump"; power: number; toughness: number; keywords: string[] }
  | { kind: "tap" }
  | { kind: "untap" }
  | { kind: "life"; delta: number }
  | { kind: "draw"; amount: number }
  | { kind: "discard"; amount: number }
  // "Create a token that's a copy of another target nonland permanent you control." (Extravagant Replication)
  | { kind: "copy_token"; asArtifact?: boolean }
  // "Target creature can't block this creature this turn." (Kozilek's Pathfinder): the target can't block the source for the turn.
  | { kind: "cant_block_source" };

export interface TargetedEffect {
  verb: TargetedVerb;
  // A player or a permanent of the given type; controller narrows whose.
  who:
    | { kind: "player"; opponentOnly: boolean }
    | { kind: "permanent"; permanentType: RemovalTargetType; controller: TargetController; attackingOnly?: boolean; another?: boolean };
  // "up to one target ...": choosing nothing is allowed.
  upTo?: boolean;
  // The rest of a compound sentence that happens to the controller: "and you gain 1 life", "and draw a card".
  youGainLife?: number;
  youLoseLife?: number;
  youDraw?: number;
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const KEYWORDS = new Set([
  "flying", "reach", "menace", "deathtouch", "trample", "first strike", "double strike", "lifelink", "vigilance", "haste", "indestructible", "hexproof",
  "shroud", "defender", "infect", "wither", "intimidate", "fear"
]);

function amountOf(word: string): number | undefined {
  return NUMBER_WORDS[word] ?? (/^\d+$/.test(word) ? Number.parseInt(word, 10) : undefined);
}

function permanentShape(phrase: string): { permanentType: RemovalTargetType; controller: TargetController; attackingOnly?: boolean } | undefined {
  let controller: TargetController = "any";
  let noun = phrase.trim();
  const attackingOnly = /^attacking /.test(noun);
  if (attackingOnly) noun = noun.replace(/^attacking /, "");
  const trailing = noun.match(/ (you control|an opponent controls|you don'?t control|your opponents control)$/);
  if (trailing) {
    controller = trailing[1] === "you control" ? "you" : "opponent";
    noun = noun.slice(0, trailing.index).trim();
  }
  const types: Record<string, RemovalTargetType> = {
    creature: "creature",
    "creature or planeswalker": "creature_or_planeswalker",
    "creature or enchantment": "creature_or_enchantment",
    artifact: "artifact",
    enchantment: "enchantment",
    "artifact or enchantment": "artifact_or_enchantment",
    permanent: "permanent",
    "nonland permanent": "nonland_permanent",
    land: "land"
  };
  const permanentType = types[noun];
  return permanentType ? { permanentType, controller, ...(attackingOnly ? { attackingOnly: true } : {}) } : undefined;
}

export function parseTargetedEffect(rawText: string): TargetedEffect | undefined {
  const text = rawText
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");

  // A cantrip: "Target creature gains haste until end of turn. Draw a card." (Expedite) — the same effect plus a card for the controller.
  const cantrip = text.match(/^(.*?)\.\s+(draw a card|draw two cards)$/);
  if (cantrip) {
    const inner = parseTargetedEffect(cantrip[1]);
    if (inner && !inner.youDraw) return { ...inner, youDraw: cantrip[2] === "draw a card" ? 1 : 2 };
  }

  // "Put a +1/+1 counter on [up to one] target creature you control."  /  "...on up to one target creature and draw a card."
  const counters = text.match(/^put (a|an|one|two|three|four|five|\d+) ([+-]\d+\/[+-]\d+|[a-z]+) counters? on (up to one )?target ([a-z ,]+?)(?: and (draw a card|you gain \d+ life))?$/);
  if (counters) {
    const amount = amountOf(counters[1]);
    const shape = permanentShape(counters[4]);
    if (amount && shape) {
      const extra = counters[5];
      return {
        verb: { kind: "add_counters", counterKind: counters[2], amount },
        who: { kind: "permanent", ...shape },
        ...(counters[3] ? { upTo: true } : {}),
        ...(extra === "draw a card" ? { youDraw: 1 } : {}),
        ...(extra?.startsWith("you gain") ? { youGainLife: Number.parseInt(extra.replace(/\D/g, ""), 10) } : {})
      };
    }
  }

  // "Target creature gets +2/+0 [and gains trample] until end of turn."  /  "Another target creature you control gets +1/+1 ..."  /  "Target creature an opponent controls gets -2/-2 ..."
  const pump = text.match(/^(?:you may have )?(?:until end of turn, )?(another )?target ([a-z ,]+?) gets? ([+-]\d+)\/([+-]\d+)(?: and gains? ([a-z ,]+?))?(?: until end of turn)?$/);
  if (pump) {
    const shape = permanentShape(pump[2]);
    const keywords = pump[5] ? pump[5].split(/, | and /).map((word) => word.trim()).filter(Boolean) : [];
    if (shape && keywords.every((keyword) => KEYWORDS.has(keyword))) {
      return { verb: { kind: "pump", power: Number.parseInt(pump[3], 10), toughness: Number.parseInt(pump[4], 10), keywords }, who: { kind: "permanent", ...shape, ...(pump[1] ? { another: true } : {}) } };
    }
  }

  // "Target creature can't block this creature this turn."  /  "Target creature can't block this turn."  /  "Target creature can't be blocked this turn."
  const cantBlockSource = text.match(/^target ([a-z ,]+?) can'?t block this creature this turn$/);
  if (cantBlockSource) {
    const shape = permanentShape(cantBlockSource[1]);
    if (shape) return { verb: { kind: "cant_block_source" }, who: { kind: "permanent", ...shape } };
  }
  const evasion = text.match(/^target ([a-z ,]+?) can'?t (be blocked|block) this turn$/);
  if (evasion) {
    const shape = permanentShape(evasion[1]);
    if (shape) return { verb: { kind: "gain_keywords", keywords: [evasion[2] === "block" ? "can't block" : "can't be blocked"] }, who: { kind: "permanent", ...shape } };
  }

  // "Target creature you control gains haste until end of turn."  (also "and trample")
  const gains = text.match(/^(?:until end of turn, )?target ([a-z ,]+?) gains ([a-z ,]+?)(?: until end of turn)?$/);
  if (gains) {
    const keywords = gains[2].split(/, | and /).map((word) => word.trim()).filter(Boolean);
    const shape = permanentShape(gains[1]);
    if (shape && keywords.length > 0 && keywords.every((keyword) => KEYWORDS.has(keyword))) {
      return { verb: { kind: "gain_keywords", keywords }, who: { kind: "permanent", ...shape } };
    }
  }

  // "Target player loses 1 life and you gain 1 life."
  const life = text.match(/^target (player|opponent) (loses|gains) (\d+) life(?: and you (gain|lose) (\d+) life)?$/);
  if (life) {
    const amount = Number.parseInt(life[3], 10);
    const second = life[5] ? Number.parseInt(life[5], 10) : undefined;
    return {
      verb: { kind: "life", delta: life[2] === "loses" ? -amount : amount },
      who: { kind: "player", opponentOnly: life[1] === "opponent" },
      ...(second !== undefined ? (life[4] === "gain" ? { youGainLife: second } : { youLoseLife: second }) : {})
    };
  }

  const draw = text.match(/^target (player|opponent) (draws|discards) (a|an|one|two|three|four|\d+) cards?$/);
  if (draw) {
    const amount = amountOf(draw[3]);
    if (amount) {
      return { verb: draw[2] === "draws" ? { kind: "draw", amount } : { kind: "discard", amount }, who: { kind: "player", opponentOnly: draw[1] === "opponent" } };
    }
  }

  // "Create a token that's a copy of [another] target nonland permanent you control." — no "except ..." modifiers (those change what is copied).
  // "..., except it's an artifact in addition to its other types." (Saheeli's Artistry) is the one exception modelled.
  const copy = text.match(/^create a token that'?s a copy of (another )?target ([a-z ]+?)(,? except it'?s an artifact in addition to its other types)?$/);
  if (copy) {
    const shape = permanentShape(copy[2]);
    if (shape) return { verb: { kind: "copy_token", ...(copy[3] ? { asArtifact: true } : {}) }, who: { kind: "permanent", ...shape, ...(copy[1] ? { another: true } : {}) } };
  }

  // "Tap target creature."  /  "Untap target land."
  const tapping = text.match(/^(tap|untap) (up to one )?target ([a-z ,]+?)$/);
  if (tapping) {
    const shape = permanentShape(tapping[3]);
    if (shape) return { verb: { kind: tapping[1] === "tap" ? "tap" : "untap" }, who: { kind: "permanent", ...shape }, ...(tapping[2] ? { upTo: true } : {}) };
  }

  return undefined;
}

// What the human may point at, as the shared TargetSpec every other targeted effect uses.
export function targetedEffectSpec(effect: TargetedEffect, sourceCardId: string, label: string): TargetSpec {
  if (effect.who.kind === "player") {
    return { id: "target", zone: "player", controller: effect.who.opponentOnly ? "opponent" : "any", min: effect.upTo ? 0 : 1, max: 1, prompt: `${label}: choose a ${effect.who.opponentOnly ? "opponent" : "player"}.` };
  }
  return {
    id: "target",
    zone: "battlefield",
    permanentType: effect.who.permanentType,
    controller: effect.who.controller,
    min: effect.upTo ? 0 : 1,
    max: 1,
    excludedCardIds: effect.who.another ? [sourceCardId] : [],
    ...(effect.who.attackingOnly ? { attackingOnly: true } : {}),
    prompt: `${label}: choose a target.`
  };
}

// Does the verb help whoever it lands on? (Decides who an agent aims it at.)
export function targetedEffectIsBeneficial(effect: TargetedEffect): boolean {
  const verb = effect.verb;
  if (verb.kind === "add_counters") return !verb.counterKind.startsWith("-");
  if (verb.kind === "gain_keywords" && verb.keywords.includes("can't block")) return false;
  if (verb.kind === "cant_block_source") return false;
  if (verb.kind === "gain_keywords" || verb.kind === "untap" || verb.kind === "draw" || verb.kind === "copy_token") return true;
  if (verb.kind === "pump") return verb.power >= 0 && verb.toughness >= 0;
  if (verb.kind === "life") return verb.delta > 0;
  return false;
}
