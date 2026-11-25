import { KernelSession } from "../src/kernel/integration/kernelSession";
import { ctx } from "../src/kernel/integration/testgame";
import { bigState } from "./kernel-perf-big";
const n = +(process.argv[process.argv.indexOf("--n") + 1] ?? 12);
const st = bigState(["Wretched Ranks", "Meren", "Tramplesaurus Rex", "The Ur Dragon"], n, n);
const ks = KernelSession.fromState(st, { ctx });
ks.legal(ks.actor!);
if (process.env.PROF) { const { Session } = await import("node:inspector"); const s = new Session(); s.connect(); await new Promise<void>((r) => s.post("Profiler.enable", () => s.post("Profiler.start", () => r()))); (globalThis as any).__s = s; }
const t = performance.now(); const acts = ks.legal(ks.actor!); console.log("legal", n, performance.now() - t, acts.length);
if (process.env.PROF) { (globalThis as any).__s.post("Profiler.stop", (_e: unknown, { profile }: any) => { require("node:fs").writeFileSync(process.env.PROF, JSON.stringify(profile)); }); }
