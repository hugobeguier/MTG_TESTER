// NODE ONLY (fs): where replay / bug-report files live: data/observer/live-logs/<timestamp>.json (local disk, never sent anywhere).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateReplayFile, type ReplayFile } from "./replayFile";

export const LIVE_LOG_DIR = "data/observer/live-logs";

/** A file-name-safe ISO timestamp: 2026-11-24T12-30-05-123Z */
export const stampName = (d = new Date()): string => `${d.toISOString().replace(/[:.]/g, "-")}.json`;

/** Writes a validated replay file (atomically) and returns its path relative to the project root; undefined when the payload does not validate. */
export function saveReplayFile(raw: unknown, o: { root?: string; now?: Date } = {}): string | undefined {
  const file = validateReplayFile(raw);
  if (!file) return undefined;
  const dir = path.join(o.root ?? process.cwd(), LIVE_LOG_DIR);
  mkdirSync(dir, { recursive: true });
  const name = stampName(o.now);
  const tmp = path.join(dir, `${name}.tmp`);
  writeFileSync(tmp, JSON.stringify(file), "utf8");
  renameSync(tmp, path.join(dir, name));
  return `${LIVE_LOG_DIR}/${name}`;
}

export function readReplayFile(p: string): ReplayFile {
  const file = validateReplayFile(JSON.parse(readFileSync(p, "utf8")));
  if (!file) throw new Error(`${p} is not a valid kernel replay file`);
  return file;
}
