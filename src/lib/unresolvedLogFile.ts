// Server-only half of the unresolved-effect sink: appends one JSON line per record to data/observer/live-unresolved.jsonl.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { UNRESOLVED_LOG_RELATIVE_PATH, UnresolvedDeduper, type UnresolvedRecord } from "./unresolvedLog";

const serverDeduper = new UnresolvedDeduper();
// Per-process rate limit: a runaway loop can write at most this many lines per minute.
const MAX_PER_MINUTE = 120;
let windowStart = 0;
let windowCount = 0;

export function appendUnresolvedRecord(record: UnresolvedRecord, opts: { file?: string; deduper?: UnresolvedDeduper; now?: number } = {}): "written" | "duplicate" | "rate_limited" | "error" {
  try {
    const now = opts.now ?? Date.now();
    if (!opts.file) {
      if (now - windowStart > 60_000) {
        windowStart = now;
        windowCount = 0;
      }
      if (windowCount >= MAX_PER_MINUTE) return "rate_limited";
    }
    if (!(opts.deduper ?? serverDeduper).admit(record)) return "duplicate";
    const file = opts.file ?? path.join(process.cwd(), UNRESOLVED_LOG_RELATIVE_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
    if (!opts.file) windowCount += 1;
    return "written";
  } catch {
    return "error";
  }
}
