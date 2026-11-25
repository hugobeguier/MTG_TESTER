// measurement: cost of the per-state derived-data layers at several board sizes (warm caches)
import { KernelSession } from "../src/kernel/integration/kernelSession";
import { ctx } from "../src/kernel/integration/testgame";
import { bigState, stats } from "./kernel-perf-big";
import { effectiveViews } from "../src/kernel/engine/legal";
import { evaluate } from "../src/kernel/ai/evaluate";
import { toSession } from "../src/kernel/integration/toSession";
const sizes = (process.argv[process.argv.indexOf("--sizes") + 1] ?? "5,10,15").split(",").map(Number);
for (const n of sizes) {
  const st = bigState(["Wretched Ranks", "Meren", "Tramplesaurus Rex", "The Ur Dragon"], n, n * 2);
  const ks = KernelSession.fromState(st, { ctx }); const seat = ks.actor!;
  const T = (name: string, f: () => unknown, reps = 3) => { f(); const r: number[] = []; for (let i = 0; i < reps; i++) { const t = performance.now(); f(); r.push(performance.now() - t); } console.log(`  ${name.padEnd(16)}`, stats(r)); };
  console.log(`--- ${n}/seat battlefield=${st.battlefield.length} objects=${Object.keys(st.objects).length}`);
  T("effectiveViews", () => effectiveViews(st, ctx, st.battlefield));
  T("evaluate", () => evaluate(st, ctx, seat));
  T("tableState", () => ks.tableState(seat));
  T("ks.legal", () => ks.legal(seat), 2);
}
