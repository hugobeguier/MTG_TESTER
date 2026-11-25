// Perf measurement on a SYNTHETIC late-game board: N creatures per seat (real cards of their decks) + a graveyard, then times every layer.
//   npx vite-node -c vitest.config.ts scripts/kernel-perf-big.ts -- [--decks "A;B;C;D"] [--n 30] [--gy 30] [--reps 5]
import { KernelSession } from "../src/kernel/integration/kernelSession";
import { ctx, deckNames } from "../src/kernel/integration/testgame";
import { bigState } from "../src/kernel/integration/bigBoard";
export { bigState };
import { chooseAiAction, freshMemory, type AiMemory } from "../src/components/game/kernelAi";
import { legalActions } from "../src/kernel/engine/legal";
import { resolve } from "../src/kernel/engine/resolve";
import { dl } from "../src/kernel/integration/testgame";
import type { GameState } from "../src/kernel/engine/types";
const a = process.argv.slice(2); const arg = (k: string, d: string) => { const i = a.indexOf("--" + k); return i >= 0 ? a[i + 1] : d; };
export const stats = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return `p50=${s[Math.floor(s.length / 2)].toFixed(1)} p95=${s[Math.min(s.length - 1, Math.floor(s.length * .95))].toFixed(1)} max=${s[s.length - 1].toFixed(1)}`; };
if (process.env.PERF_BIG) {
  const decks = arg("decks", "Wretched Ranks;Meren;Tramplesaurus Rex;The Ur Dragon").split(";"); const n = +arg("n", "30"); const gy = +arg("gy", "30"); const reps = +arg("reps", "5");
  for (const size of [0, 10, 20, n]) {
    const st = bigState(decks, size, Math.floor(gy * size / Math.max(n, 1))); const ks = KernelSession.fromState(st, { ctx });
    const seat = ks.actor!; const mem: AiMemory = { banned: new Set() };
    const T = (f: () => void) => { f(); const r: number[] = []; for (let i = 0; i < reps; i++) { const t = performance.now(); f(); r.push(performance.now() - t); } return stats(r); };
    let acts = ks.legal(seat); const base = chooseAiAction(acts, st, ctx, seat, mem); // warm up
    console.log(`--- ${size}/seat: battlefield ${st.battlefield.length}, objects ${Object.keys(st.objects).length}, acts ${acts.length}`);
    console.log("ks.legal    ", T(() => { acts = ks.legal(seat); }));
    console.log("legalActions", T(() => { legalActions(st, seat, ctx); }));
    console.log("chooseAi    ", T(() => { chooseAiAction(acts, st, ctx, seat, { banned: new Set() }); }), JSON.stringify(base)?.slice(0, 80));
    console.log("structClone ", T(() => { structuredClone(st); }));
    console.log("resolve pass", T(() => { resolve(st, { type: "passPriority", player: seat }, ctx); }));
  }
}
