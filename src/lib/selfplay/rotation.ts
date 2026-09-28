// Deterministic per-game rotation for the self-play CLI (scripts/self-play.ts).
//
// The three axes below (which decks are paired, who goes first, which seat gets ollamaBrain) must
// never correlate with each other, or a win-rate comparison silently measures one of those
// confounds instead of real brain skill. This has already broken twice from hand-derived period
// arithmetic that looked right but wasn't:
//
//   1. First version: ollamaSeatIndex = Math.floor(globalIndex / 2) % 2. pairIndex is
//      Math.floor(globalIndex / 2) % 4 — the SAME underlying counter, just read mod 4 instead of
//      mod 2. Since 2 evenly divides 4, `pairIndex % 2` and that ollamaSeatIndex were mathematically
//      IDENTICAL every game: every deck got exactly one brain assignment for its whole run. A real
//      24-game run couldn't distinguish "ollamaBrain plays worse" from "this deck is just weaker."
//   2. "Fix" that shipped next: Math.floor(globalIndex / 3) % 2, on the theory that period 3 (vs.
//      forceFirstSeatIndex's period 2 and pairIndex's effective period 8) was enough. It wasn't —
//      `floor(x / 3) % 2` does not have period 3, it has period 6 (3 values of x per output level,
//      times 2 levels). 6 shares a factor of 2 with forceFirstSeatIndex's period 2, so
//      ollamaSeatIndex still correlated with who-goes-first: across a 24-game run, ollamaSeatIndex=0
//      paired with forceFirstSeatIndex=0 eight times but forceFirstSeatIndex=1 only four times (and
//      the mirror image for ollamaSeatIndex=1) — a real, if smaller, confound between brain
//      assignment and turn order. Verified by simulating the formula, not by re-inspecting it.
//
// The actual fix: `(globalIndex % 3) % 2` genuinely has period 3 (globalIndex % 3 cycles 0,1,2 and
// the outer %2 is a fixed per-value relabeling, so the composite still repeats every 3). Period 3 is
// coprime with forceFirstSeatIndex's period 2 and with pairIndex's effective period 2 * DECK_FILES.length
// (currently 8), so ollamaSeatIndex is independent of both — confirmed by rotation.test.ts, which
// checks the actual joint distribution rather than trusting the arithmetic again. The one
// unavoidable side effect of a period-3 binary split: ollamaSeatIndex isn't exactly 50/50 (it's 1/3
// vs 2/3), but that imbalance is identical for every deck and every turn-order value, so it doesn't
// bias which deck or seat ollamaBrain gets compared against — it only costs a little statistical
// power relative to a true coin flip.
//
// If DECK_FILES.length ever changes, re-run rotation.test.ts: this reasoning only holds because
// 2 * DECK_FILES.length (8) shares no factor with 3. A deck count that's a multiple of 3 (e.g. 6)
// would reintroduce exactly this kind of confound.
export const DECK_FILES = ["Meren.txt", "UrDragon.txt", "Saheeli.txt", "Aminatou 100 cards.txt"];

export interface GameRotation {
  // Which two decks play this game: DECK_FILES[pairIndex] vs DECK_FILES[(pairIndex + 1) % length].
  pairIndex: number;
  // Which physical seat (0 or 1) is forced to go first this game.
  forceFirstSeatIndex: 0 | 1;
  // Which physical seat (0 or 1) gets ollamaBrain this game. Only meaningful under --ollama.
  ollamaSeatIndex: 0 | 1;
}

export function computeGameRotation(globalIndex: number): GameRotation {
  const pairIndex = Math.floor(globalIndex / 2) % DECK_FILES.length;
  const forceFirstSeatIndex = (globalIndex % 2) as 0 | 1;
  const ollamaSeatIndex = ((globalIndex % 3) % 2) as 0 | 1;
  return { pairIndex, forceFirstSeatIndex, ollamaSeatIndex };
}
