// Parses spell effects that move a card between graveyard/hand/library/battlefield, or change who
// controls a permanent — the "reanimate/mill/steal" family that removalSpells.ts doesn't cover
// (that module only handles destroy/exile/damage of something already on the battlefield). Same
// deterministic, narrow-by-design pattern used throughout this codebase: complex or rare shapes
// (fractional mill like "mills half their library", conditional reveal-based mill, Aura-based
// reanimation like Animate Dead, "return ... unless" clauses) are declined rather than guessed at.

export interface ReanimateEffect {
  kind: "reanimate";
  // "a graveyard" (any player's) vs "your graveyard" (self only) — Reanimate vs Persist.
  anyGraveyard: boolean;
}

export type RegrowTargetType = "card" | "permanent" | "creature" | "land";

export interface RegrowEffect {
  kind: "regrow";
  targetType: RegrowTargetType;
}

export type MillScope = "you" | "target_player" | "each_opponent" | "each_player";

export interface MillEffect {
  kind: "mill";
  amount: number;
  scope: MillScope;
}

export type GraveyardToLibraryScope = "you" | "target_player";

export interface GraveyardToLibraryEffect {
  kind: "graveyard_to_library";
  scope: GraveyardToLibraryScope;
}

export interface GainControlEffect {
  kind: "gain_control";
  untilEndOfTurn: boolean;
}

export interface ImpulseDrawEffect {
  kind: "impulse_draw";
  amount: number;
  // false = playable only this turn ("until end of turn" / "this turn"); true extends the window
  // one extra turn ("until the end of your next turn" — Light Up the Stage-style).
  untilEndOfNextTurn: boolean;
}

// Praetor's Grasp-style: search an opponent's library for a card, exile it, and the searcher may
// play it for as long as it remains exiled (no time limit). The "search for a specific card" part
// is resolved with the same "pick the best available" heuristic this engine uses for every other
// hidden-zone search — see chooseStealAndPlayTarget in AppFlow.tsx.
export interface StealAndPlayEffect {
  kind: "steal_and_play";
}

export type ZoneEffect =
  | ReanimateEffect
  | RegrowEffect
  | MillEffect
  | GraveyardToLibraryEffect
  | GainControlEffect
  | ImpulseDrawEffect
  | StealAndPlayEffect;

function numberWordToInt(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) return parsed;
  return (
    {
      a: 1,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10
    } as Record<string, number>
  )[value];
}

export function parseZoneEffect(oracleText: string): ZoneEffect | undefined {
  const text = oracleText.toLowerCase();

  // "target [non]legendary creature card" — a restriction word can sit between "target" and
  // "creature" (e.g. Persist's "target nonlegendary creature card"), same qualifier-tolerance
  // gap fixed in removalSpells.ts's target-type patterns earlier this session.
  const reanimate = text.match(/\b(?:put|return) target (?:\w+ )?creature card from (a|your) graveyard (?:onto|to) the battlefield\b/);
  if (reanimate) return { kind: "reanimate", anyGraveyard: reanimate[1] === "a" };

  const regrow = text.match(/\breturn target (permanent|creature|land)?\s*card from your graveyard to your hand\b/);
  if (regrow) {
    const typeWord = regrow[1] as RegrowTargetType | undefined;
    return { kind: "regrow", targetType: typeWord ?? "card" };
  }

  const millAmountPattern = "(a|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)";
  const millYou = text.match(new RegExp(`\\byou mill ${millAmountPattern} cards?\\b`));
  if (millYou) {
    const amount = numberWordToInt(millYou[1]);
    if (amount) return { kind: "mill", amount, scope: "you" };
  }
  const millTarget = text.match(new RegExp(`\\btarget player mills ${millAmountPattern} cards?\\b`));
  if (millTarget) {
    const amount = numberWordToInt(millTarget[1]);
    if (amount) return { kind: "mill", amount, scope: "target_player" };
  }
  const millOpponent = text.match(new RegExp(`\\beach opponent mills ${millAmountPattern} cards?\\b`));
  if (millOpponent) {
    const amount = numberWordToInt(millOpponent[1]);
    if (amount) return { kind: "mill", amount, scope: "each_opponent" };
  }
  const millEach = text.match(new RegExp(`\\beach player mills ${millAmountPattern} cards?\\b`));
  if (millEach) {
    const amount = numberWordToInt(millEach[1]);
    if (amount) return { kind: "mill", amount, scope: "each_player" };
  }

  if (/\bshuffle your graveyard into your library\b/.test(text)) return { kind: "graveyard_to_library", scope: "you" };
  if (/\btarget player shuffles (?:their|your) graveyard into (?:their|your) library\b/.test(text)) {
    return { kind: "graveyard_to_library", scope: "target_player" };
  }

  const gainControl = text.match(/\bgain control of (?:it|target creature)\b/);
  if (gainControl) {
    const untilEndOfTurn = /\bgain control of (?:it|target creature) until end of turn\b/.test(text);
    return { kind: "gain_control", untilEndOfTurn };
  }

  // "Exile the top [N] card(s) of your library. [Until end of turn / this turn / until the end of
  // your next turn,] you may play {that card|those cards|it|them}." — very consistent real-card
  // templating (Light Up the Stage, Act on Impulse, Abbot of Keral Keep, ...). A trailing "except"/
  // "if you don't" complication (rare on this specific shape) isn't modeled.
  // "the top card" (singular, no number word) vs "the top N cards" (plural, explicit number).
  const impulseSingular = /\bexile the top card of your library\b/.test(text);
  const impulsePlural = text.match(/\bexile the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards of your library\b/);
  if ((impulseSingular || impulsePlural) && /\byou may play\b/.test(text)) {
    const amount = impulseSingular ? 1 : numberWordToInt(impulsePlural![1]);
    if (amount) {
      const untilEndOfNextTurn = /\buntil the end of your next turn\b/.test(text);
      return { kind: "impulse_draw", amount, untilEndOfNextTurn };
    }
  }

  if (/\bsearch target opponent'?s library for a card and exile it\b/.test(text) && /\byou may play\b/.test(text)) {
    return { kind: "steal_and_play" };
  }

  return undefined;
}
