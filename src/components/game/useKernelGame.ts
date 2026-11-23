// Kernel engine hooks (dev flag ?engine=kernel; plan docs/kernel-integration-plan.md phase 4).
//   useKernelGame(ctx, { enabled }): called by AppFlow on every render. When the flag is on it fetches the card packs and registers `ctx.kernelStartRef`; the end of
//     the legacy mulligans (useGameSetup.keepOpeningHand) calls it with the finished opening position. If every seat's deck is kernel-ready it creates the
//     KernelSession + KernelGameController and returns { ok: true } (the game then runs on the kernel); otherwise it returns the reason and the game stays legacy.
//   useKernelDriver(controller): drives the AI seats (and the human's automatic passes) with the paced timer loop of the controller. Mounted by KernelGameTable.
// With the flag absent nothing here does anything: no fetch, no ref, no state beyond one null.
import "@/kernel/engine/resolve"; // FIRST: the engine modules import each other in a cycle that only initialises when resolve.ts is entered first
import { useEffect, useState } from "react";
import type { GameSession } from "@/lib/types";
import { agentPaceMs, loadPriorityStopSettings, savePriorityStopSettings } from "@/lib/agentRuntime";
import type { PriorityStopSettings } from "@/lib/priorityStops";
import { kernelEngineWanted } from "@/lib/kernelFlag";
import { postUnresolved } from "@/lib/unresolvedLog";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { hostHumanSeat } from "@/lib/multiplayer/seatMap";
import { type GameContext } from "./context";
import { KernelGameController } from "./kernelController";
import { kernelReadiness, loadedKernelPacks, preloadKernelPacks, type Readiness } from "./kernelPacks";

export type KernelStarter = (finished: GameSession) => Readiness;

/** Build the controller for a finished legacy opening position (pure of React: tests call it too). */
export function startKernelGame(finished: GameSession, o: { seed?: number; sink?: Parameters<typeof KernelSession.fromLegacyHandoff>[1]["sink"]; pace?: (ms: number) => number; stops?: PriorityStopSettings; saveStops?: (s: PriorityStopSettings) => void } = {}): { ok: true; controller: KernelGameController } | { ok: false; reason: string } {
  const packs = loadedKernelPacks();
  const gate = kernelReadiness(finished, packs);
  if (!gate.ok || !packs) return gate.ok ? { ok: false, reason: "kernel packs are not loaded" } : gate;
  const human = hostHumanSeat(finished.seats);
  if (!human) return { ok: false, reason: "Kernel engine requested, but there is no human seat; playing on the legacy engine." };
  try {
    const ks = KernelSession.fromLegacyHandoff(finished, {
      ctx: { cards: packs.kit.lookup, db: packs.kit.db },
      lookup: packs.kit,
      display: packs.kit.display,
      seed: o.seed ?? Math.floor(Math.random() * 2 ** 31),
      deckNames: finished.seats.map((s) => s.board.commander?.name ?? s.name),
      now: () => new Date().toISOString(),
      ...(o.sink ? { sink: o.sink } : {})
    });
    return { ok: true, controller: new KernelGameController(ks, { human: human.id, pace: o.pace, stops: o.stops, saveStops: o.saveStops }) };
  } catch (e) {
    return { ok: false, reason: `Kernel engine requested, but the hand-off failed (${e instanceof Error ? e.message : String(e)}); playing on the legacy engine.` };
  }
}

export function useKernelGame(ctx: GameContext, opts: { enabled: boolean }): { controller: KernelGameController | null } {
  const [controller, setController] = useState<KernelGameController | null>(null);
  const { kernelStartRef } = ctx;
  useEffect(() => {
    // the flag is read on the client only (query string at the time of the effect; the env kill switch is inlined by Next at build time)
    const wanted = opts.enabled && typeof window !== "undefined" && kernelEngineWanted(window.location.search, process.env.NEXT_PUBLIC_KERNEL_ENGINE);
    if (!wanted) { kernelStartRef.current = undefined; return; }
    void preloadKernelPacks();
    kernelStartRef.current = (finished: GameSession): Readiness => {
      const r = startKernelGame(finished, { sink: postUnresolved, pace: agentPaceMs, stops: loadPriorityStopSettings(), saveStops: savePriorityStopSettings });
      if (!r.ok) return r;
      setController(r.controller);
      return { ok: true };
    };
    return () => { kernelStartRef.current = undefined; };
  }, [opts.enabled, kernelStartRef]);
  return { controller };
}

/** Drive the AI seats of a kernel game (and the human's automatic passes) until the component unmounts. */
export function useKernelDriver(controller: KernelGameController | null): void {
  useEffect(() => (controller ? controller.startDriver() : undefined), [controller]);
}
