// TEST / SCRIPT SUPPORT (Node only): a late-game-sized position made of real cards: `perSeat` creatures + a third as many lands on every seat's battlefield and `graveyard`
// cards in every graveyard (placed, not cast: no triggers). Used by the performance guards and scripts/kernel-perf-*.ts.
import { KernelSession } from "./kernelSession";
import { ctx, deckNames, dl } from "./testgame";
import { debugPlaceCard } from "../engine/setup";
import type { GameState } from "../engine/types";

export const BIG_DECKS = ["Wretched Ranks", "Meren", "Tramplesaurus Rex", "The Ur Dragon"];

export function bigState(decks: string[], perSeat: number, graveyard: number, seed = 5): GameState {
  const players = decks.map((d, i) => { const { cards, commander } = deckNames(d); return { id: `p${i + 1}`, name: d, deck: cards, ...(commander ? { commander } : {}), kind: "agent" as const }; });
  let st = KernelSession.fromDecks({ ctx, decks: players, seed, startPhase: "precombat_main" }).state;
  for (const p of players) {
    const names = [...new Set(p.deck)];
    const crea = names.filter((c) => ctx.cards(c)?.types.includes("creature"));
    const lands = names.filter((c) => ctx.cards(c)?.types.includes("land"));
    for (let k = 0; k < perSeat; k++) st = debugPlaceCard(st, dl.lookup, p.id, crea[k % crea.length], "battlefield", { fresh: false }).state;
    for (let k = 0; k < Math.floor(perSeat / 3); k++) st = debugPlaceCard(st, dl.lookup, p.id, lands[k % lands.length], "battlefield", {}).state;
    for (let k = 0; k < graveyard; k++) st = debugPlaceCard(st, dl.lookup, p.id, k % 2 ? crea[k % crea.length] : names[k % names.length], "graveyard", {}).state;
  }
  return st;
}
