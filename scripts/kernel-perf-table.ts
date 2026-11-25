// measurement: the table pipeline (toSession / tableState / stack log) on a fresh session per rep, so no cache is hit
import { KernelSession } from "../src/kernel/integration/kernelSession";
import { ctx } from "../src/kernel/integration/testgame";
import { BIG_DECKS, bigState } from "../src/kernel/integration/bigBoard";
import { stats } from "./kernel-perf-big";
for (const n of [3, 10, 20]) {
  const st = bigState(BIG_DECKS, n, n);
  const T = (name: string, f: (ks: KernelSession) => unknown, reps = 4) => { const r: number[] = []; for (let i = 0; i < reps + 1; i++) { const ks = KernelSession.fromState(st, { ctx }); const t = performance.now(); f(ks); if (i) r.push(performance.now() - t); } console.log(`  ${name.padEnd(14)}`, stats(r)); };
  console.log(`--- ${n}/seat bf=${st.battlefield.length}`);
  T("tableState", (ks) => ks.tableState("p1"));
}
