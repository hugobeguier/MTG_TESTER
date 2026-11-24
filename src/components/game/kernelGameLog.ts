// "Save game log": builds the replay / bug-report file of the running kernel game and posts it to the dev-only route (app/api/dev/live-log), which writes
// data/observer/live-logs/<timestamp>.json on the local machine. Never leaves the machine: the route refuses production and non-local hosts.
import type { KernelSession } from "@/kernel/integration/kernelSession";
import { buildReplayFile, type ReplayFile, type ReplayMeta } from "@/kernel/integration/replayFile";
import { loadedKernelPacks } from "./kernelPacks";

/** deck names (the commander when there is one) and the draft hashes of the loaded packs, as recorded in the file */
export function replayMetaFor(ks: KernelSession, human: string): ReplayMeta {
  const s = ks.state;
  const decks = s.players.map((p) => Object.values(s.objects).find((o) => o.isCommander && o.owner === p.id)?.cardName ?? p.name);
  const draftHashes: Record<string, string> = {};
  for (const pack of loadedKernelPacks()?.packs ?? []) if (pack.draftHash) draftHashes[pack.slug] = pack.draftHash;
  return { gameId: ks.gameId, decks, draftHashes, human };
}

export function gameLogFile(ks: KernelSession, human: string): ReplayFile {
  return buildReplayFile(ks, { viewer: human, meta: replayMetaFor(ks, human) });
}

export async function saveGameLog(ks: KernelSession, human: string, fetcher: typeof fetch = fetch): Promise<{ ok: true; file: string } | { ok: false; reason: string }> {
  try {
    const res = await fetcher("/api/dev/live-log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(gameLogFile(ks, human)) });
    const json = (await res.json()) as { ok?: boolean; file?: string; reason?: string };
    return json.ok && json.file ? { ok: true, file: json.file } : { ok: false, reason: json.reason ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
