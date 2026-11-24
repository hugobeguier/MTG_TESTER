// Card packs for kernel games in the browser: lazy fetch of public/kernel-packs/*.json (made by `npm run kernel:bundle-drafts`), kept in one module-level
// cache, and the readiness gate "may this table run on the kernel?" (every seat's deck is a ready pack deck and every card of it is known to the kernel).
import { fetchPacks, packKit, type CardPack, type PackKit } from "@/kernel/integration/cardPack";
import type { GameSession, VisibleCard } from "@/lib/types";

export interface LoadedPacks { kit: PackKit; packs: CardPack[]; readyCommanders: Set<string>; /** set when the dev server says the packs are older than the card drafts: the kernel refuses to start on them */ stale?: string }

let loaded: LoadedPacks | undefined;
let inFlight: Promise<LoadedPacks | undefined> | undefined;

/** The packs fetched so far (undefined until `preloadKernelPacks` resolved). Synchronous on purpose: the hand-off decision happens inside a click handler. */
export function loadedKernelPacks(): LoadedPacks | undefined { return loaded; }

/** Fetch the index and every READY pack once. Resolves undefined (never rejects) when the packs are missing: run `npm run kernel:bundle-drafts`. */
export function preloadKernelPacks(fetcher: typeof fetch = fetch, base = "/kernel-packs"): Promise<LoadedPacks | undefined> {
  if (loaded) return Promise.resolve(loaded);
  inFlight ??= (async () => {
    try {
      const res = await fetcher(`${base}/index.json`);
      if (!res.ok) return undefined;
      const index = (await res.json()) as { packs?: Array<{ slug: string; ready: boolean }> };
      const slugs = (index.packs ?? []).filter((p) => p.ready).map((p) => p.slug);
      if (!slugs.length) return undefined;
      const packs = await fetchPacks(slugs, base, fetcher);
      const ready = packs.filter((p) => p.unsupported.length === 0);
      let stale: string | undefined;
      try { // dev-only route (404 / not JSON in production): are the packs older than data/kernel-drafts?
        const sr = await fetcher("/api/dev/kernel-packs");
        const sj = sr.ok ? ((await sr.json()) as { stale?: unknown[]; message?: string }) : undefined;
        if (sj?.stale?.length) { stale = sj.message ?? "Kernel packs are older than the card drafts: run npm run kernel:bundle-drafts"; console.error(`[kernel] ${stale}`); }
      } catch { /* no check available */ }
      loaded = { ...(stale ? { stale } : {}), kit: packKit(ready), packs: ready, readyCommanders: new Set(ready.map((p) => p.decks[0]?.commander).filter((c): c is string => !!c)) };
      return loaded;
    } catch {
      return undefined;
    } finally {
      inFlight = undefined;
    }
  })();
  return inFlight;
}

/** tests */
export function setLoadedKernelPacks(p: LoadedPacks | undefined): void { loaded = p; }

function seatCards(seat: GameSession["seats"][number]): VisibleCard[] {
  return [...seat.board.hand, ...seat.board.battlefield, ...(seat.board.graveyard ?? []), ...(seat.board.exile ?? []), ...(seat.library ?? []), ...(seat.board.commander ? [seat.board.commander] : [])];
}

export type Readiness = { ok: true } | { ok: false; reason: string };

/**
 * The gate. Solo only (exactly one human, nobody remote); every seat's commander must be a ready pack deck's commander and every non-token card of the seat must
 * be known to the packs. Anything else stays on the legacy engine with the reason (shown as a one-line notice in the game log).
 */
export function kernelReadiness(session: GameSession, packs: LoadedPacks | undefined): Readiness {
  if (!packs) return { ok: false, reason: "Kernel engine requested, but the card packs are not loaded (run `npm run kernel:bundle-drafts`); playing on the legacy engine." };
  if (packs.stale) return { ok: false, reason: `Kernel engine requested, but ${packs.stale}; playing on the legacy engine.` };
  const humans = session.seats.filter((s) => s.kind === "human");
  if (humans.length !== 1 || humans.some((s) => s.remoteSlot)) return { ok: false, reason: "Kernel engine requested, but it only runs solo games (one human seat) for now; playing on the legacy engine." };
  for (const seat of session.seats) {
    const commander = seat.board.commander?.name;
    if (!commander || !packs.readyCommanders.has(commander)) return { ok: false, reason: `Kernel engine requested, but ${seat.name}'s deck (${commander ?? "no commander"}) is not kernel-ready; playing on the legacy engine.` };
    const unknown = seatCards(seat).find((c) => !c.token && !packs.kit.lookup(c.name));
    if (unknown) return { ok: false, reason: `Kernel engine requested, but "${unknown.name}" in ${seat.name}'s deck is unknown to the kernel; playing on the legacy engine.` };
  }
  return { ok: true };
}
