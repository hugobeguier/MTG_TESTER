import { KernelSession } from "../src/kernel/integration/kernelSession";
import { ctx } from "../src/kernel/integration/testgame";
import { bigState } from "./kernel-perf-big";
import { resolve } from "../src/kernel/engine/resolve";
const n = +(process.argv[process.argv.indexOf("--n") + 1] ?? 10);
const st = bigState(["Wretched Ranks", "Meren", "Tramplesaurus Rex", "The Ur Dragon"], n, n);
const ks = KernelSession.fromState(st, { ctx }); const seat = ks.actor!;
const act = { type: "passPriority" as const, player: seat }; const adv = { type: "advancePhase" as const, player: seat };
const go = (a: any) => resolve(st, a, ctx);
go(adv); const reps = 6;
if (process.env.PROF) { const { Session } = await import("node:inspector"); const s = new Session(); s.connect(); await new Promise<void>((r) => s.post("Profiler.enable", () => s.post("Profiler.start", () => r()))); (globalThis as any).__s = s; }
const t = performance.now(); for (let i = 0; i < reps; i++) go(adv); console.log("resolve(advancePhase) bf", st.battlefield.length, ((performance.now() - t) / reps).toFixed(1), "ms");
const t2 = performance.now(); for (let i = 0; i < reps; i++) go(act); console.log("resolve(pass) ", ((performance.now() - t2) / reps).toFixed(1), "ms");
if (process.env.PROF) (globalThis as any).__s.post("Profiler.stop", (_e: unknown, { profile }: any) => { require("node:fs").writeFileSync(process.env.PROF!, JSON.stringify(profile)); });
