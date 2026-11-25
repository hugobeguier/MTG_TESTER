// Perf profile of a late-game kernel game (measurement tool): 4 AI seats on real decks, timing each layer per decision and snapshotting the state.
//   npx vite-node -c vitest.config.ts scripts/kernel-perf-selfplay.ts -- --decks "A;B;C;D" --turns 20 --seed 1 [--save out.json]
import { writeFileSync } from "node:fs";
import { KernelSession } from "../src/kernel/integration/kernelSession";
import { ctx, deckNames } from "../src/kernel/integration/testgame";
import { chooseAiAction, freshMemory, type AiMemory } from "../src/components/game/kernelAi";
const a = process.argv.slice(2); const arg = (k: string, d: string) => { const i = a.indexOf("--" + k); return i >= 0 ? a[i + 1] : d; };
const decks = arg("decks", "Aminatou;Saheeli;Meren;The Ur Dragon").split(";"); const turns = +arg("turns", "20"); const seed = +arg("seed", "1");
const players = decks.map((d, i) => { const { cards, commander } = deckNames(d); return { id: `p${i + 1}`, name: d, deck: cards, ...(commander ? { commander } : {}), kind: "agent" as const }; });
const ks = KernelSession.fromDecks({ ctx, decks: players, seed, startPhase: "precombat_main" });
const mem: Record<string, AiMemory> = {}; let memTurn = -1, lastTurn = -1, steps = 0;
const rows: any[] = [];
const q = (xs: number[], p: number) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
let total = 0;
while (!ks.gameOver && total++ < 60000) {
  const s = ks.state;
  if (s.turn.number > turns) break;
  if (s.turn.number !== lastTurn) { lastTurn = s.turn.number; steps = 0; }
  if (memTurn !== s.turn.number) { for (const k of Object.keys(mem)) mem[k] = freshMemory(mem[k]); memTurn = s.turn.number; }
  const actor = ks.actor; if (!actor) break;
  mem[actor] ??= { banned: new Set() };
  let t = performance.now(); const acts = ks.legal(actor); const legalMs = performance.now() - t;
  t = performance.now(); let action = chooseAiAction(acts, s, ctx, actor, mem[actor]); const aiMs = performance.now() - t;
  if (!action) break;
  if (++steps > 400) { const pass = acts.find((x) => x.kind === "passPriority")?.action; if (pass && !s.pending) action = pass; if (steps > 1200) break; }
  t = performance.now(); const res = ks.dispatch(actor, action); const dispMs = performance.now() - t;
  if (!res.ok) { const pass = acts.find((x) => x.kind === "passPriority")?.action ?? { type: "passPriority" as const, player: actor }; if (s.pending || ks.state.pending) break; ks.dispatch(actor, pass); }
  rows.push({ turn: s.turn.number, phase: s.turn.phase, bf: s.battlefield.length, gy: s.players.reduce((n, p) => n + p.graveyard.length, 0), nacts: acts.length, legalMs, aiMs, dispMs, type: action.type, stack: s.stack.length });
}
console.log("final turn", ks.state.turn.number, "decisions", rows.length, "over", !!ks.gameOver);
for (let tn = 1; tn <= turns + 1; tn += 2) {
  const r = rows.filter((x) => x.turn === tn || x.turn === tn + 1); if (!r.length) continue;
  const f = (k: string) => `p50=${q(r.map((x) => x[k]), .5).toFixed(1)} p95=${q(r.map((x) => x[k]), .95).toFixed(1)} max=${Math.max(...r.map((x) => x[k])).toFixed(0)} sum=${r.reduce((n, x) => n + x[k], 0).toFixed(0)}`;
  console.log(`turns ${tn}-${tn + 1} n=${r.length} bf=${Math.max(...r.map((x) => x.bf))} gy=${Math.max(...r.map((x) => x.gy))} | ai ${f("aiMs")} | legal ${f("legalMs")} | dispatch ${f("dispMs")}`);
}
const slow = [...rows].sort((x, y) => y.aiMs - x.aiMs).slice(0, 8); console.log("slowest AI:", JSON.stringify(slow.map((x) => ({ t: x.turn, ph: x.phase, bf: x.bf, acts: x.nacts, ms: Math.round(x.aiMs), ty: x.type }))));
const sl = [...rows].sort((x, y) => y.legalMs - x.legalMs).slice(0, 5); console.log("slowest legal:", JSON.stringify(sl.map((x) => ({ t: x.turn, bf: x.bf, acts: x.nacts, ms: Math.round(x.legalMs) }))));
if (arg("save", "")) writeFileSync(arg("save", ""), JSON.stringify(ks.state));
