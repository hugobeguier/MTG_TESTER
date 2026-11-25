// measurement: one AI main-phase decision (planMain) + the end-to-end step (legal + choose + dispatch) at several board sizes
import { KernelSession } from "../src/kernel/integration/kernelSession";
import { ctx } from "../src/kernel/integration/testgame";
import { bigState, stats } from "./kernel-perf-big";
import { chooseAiAction } from "../src/components/game/kernelAi";
import { planMain } from "../src/kernel/ai/plan";
import { profileFromState } from "../src/kernel/ai/profile";
const sizes = (process.argv[process.argv.indexOf("--sizes") + 1] ?? "5,10").split(",").map(Number);
for (const n of sizes) {
  const st = bigState(["Wretched Ranks", "Meren", "Tramplesaurus Rex", "The Ur Dragon"], n, n);
  // give the seat cards to cast: its hand is the opening hand
  const ks = KernelSession.fromState(st, { ctx }); const seat = ks.actor!;
  const acts = ks.legal(seat).filter((a) => a.kind !== "playLand");
  const work = { n: 0, cap: 900 };
  const prof = profileFromState(st, ctx, seat);
  planMain(acts, st, ctx, seat, new Set(), {}, { n: 0, cap: 900 }, prof); // warm
  if (process.env.PROF) { const { Session } = await import("node:inspector"); const s = new Session(); s.connect(); await new Promise<void>((r) => s.post("Profiler.enable", () => s.post("Profiler.start", () => r()))); (globalThis as any).__s = s; }
  const w = { n: 0, cap: 900 }; const t = performance.now(); const plan = planMain(acts, st, ctx, seat, new Set(), {}, w, prof); const dt = performance.now() - t;
  if (process.env.PROF) (globalThis as any).__s.post("Profiler.stop", (_e: unknown, { profile }: any) => { require("node:fs").writeFileSync(process.env.PROF!, JSON.stringify(profile)); });
  console.log(`${n}/seat bf=${st.battlefield.length} castable/activatable=${acts.length} planMain ${dt.toFixed(0)}ms steps=${w.n}/900 -> ${plan?.label ?? "none"} (${(dt / Math.max(w.n, 1)).toFixed(1)} ms/step)`);
}
