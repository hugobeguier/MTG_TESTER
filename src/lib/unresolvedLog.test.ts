import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UnresolvedDeduper, unresolvedLoggingEnabled, validateUnresolvedPayload } from "./unresolvedLog";
import { appendUnresolvedRecord } from "./unresolvedLogFile";
import { aggregateUnresolved, parseUnresolvedJsonl, renderUnresolvedMarkdown } from "./unresolvedReport";

const good = { cardName: "Swan Song", clause: "Counter it.", abilityKind: "spell", engine: "legacy", decks: ["Saheeli"], turn: 4, phase: "main", seatKind: "human", gameId: "g1" };

describe("unresolved log validation", () => {
  it("accepts a well-formed payload and drops unknown fields", () => {
    const r = validateUnresolvedPayload({ ...good, hand: ["Secret Card"], extra: 1 }, () => "2026-01-01T00:00:00.000Z");
    expect(r).toEqual({ ...good, at: "2026-01-01T00:00:00.000Z" });
    expect(r).not.toHaveProperty("hand");
  });
  it("defaults engine to legacy, accepts kernel, rejects unknown engines", () => {
    expect(validateUnresolvedPayload({ ...good, engine: undefined })?.engine).toBe("legacy");
    expect(validateUnresolvedPayload({ ...good, engine: "kernel" })?.engine).toBe("kernel");
    expect(validateUnresolvedPayload({ ...good, engine: "xmage" })).toBeUndefined();
  });
  it("rejects malformed input and truncates oversize strings", () => {
    for (const bad of [null, "x", [], {}, { ...good, turn: -1 }, { ...good, turn: 1.5 }, { ...good, seatKind: "bot" }, { ...good, cardName: "" }, { ...good, clause: 5 }]) expect(validateUnresolvedPayload(bad)).toBeUndefined();
    const long = validateUnresolvedPayload({ ...good, clause: "a".repeat(5000), decks: Array(50).fill("d") });
    expect(long?.clause.length).toBe(600);
    expect(long?.decks.length).toBe(6);
    expect(validateUnresolvedPayload({ ...good, clause: "line1\nline2" })?.clause).toBe("line1 line2");
  });
  it("is off in production and when MTG_UNRESOLVED_LOG=0", () => {
    expect(unresolvedLoggingEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(unresolvedLoggingEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(unresolvedLoggingEnabled({ NODE_ENV: "development", MTG_UNRESOLVED_LOG: "0" })).toBe(false);
  });
});

describe("unresolved log sink", () => {
  it("dedupes per game+card+clause and appends one JSON line per new record", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "unres-"));
    const file = path.join(dir, "nested", "live-unresolved.jsonl");
    const deduper = new UnresolvedDeduper();
    const rec = validateUnresolvedPayload(good)!;
    expect(appendUnresolvedRecord(rec, { file, deduper })).toBe("written");
    expect(appendUnresolvedRecord(rec, { file, deduper })).toBe("duplicate");
    expect(appendUnresolvedRecord({ ...rec, gameId: "g2" }, { file, deduper })).toBe("written");
    expect(appendUnresolvedRecord({ ...rec, clause: "Other." }, { file, deduper })).toBe("written");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(3);
  });
  it("never throws, even for an unwritable path", () => {
    expect(appendUnresolvedRecord(validateUnresolvedPayload(good)!, { file: path.join("\0bad", "x.jsonl") })).toBe("error");
  });
});

describe("unresolved report", () => {
  it("aggregates by card+clause, sorts by frequency and flags kernel support", () => {
    const mk = (cardName: string, clause: string, at: string, deck: string) => ({ ...validateUnresolvedPayload({ ...good, cardName, clause, decks: [deck] }, () => at)!, at });
    const rows = aggregateUnresolved(
      [mk("A", "x", "2026-01-02T00:00:00.000Z", "D1"), mk("B", "y", "2026-01-01T00:00:00.000Z", "D1"), mk("A", "x", "2026-01-03T00:00:00.000Z", "D2"), mk("A", "x", "2026-01-01T00:00:00.000Z", "D2")],
      (n) => (n === "A" ? "no" : "unknown")
    );
    expect(rows.map((r) => [r.cardName, r.times])).toEqual([["A", 3], ["B", 1]]);
    expect(rows[0]).toMatchObject({ firstSeen: "2026-01-01T00:00:00.000Z", lastSeen: "2026-01-03T00:00:00.000Z", decks: ["D1", "D2"], kernelRunnable: "no" });
    const md = renderUnresolvedMarkdown(rows);
    expect(md).toContain("| A | x | 3 |");
    expect(parseUnresolvedJsonl(`${JSON.stringify(rows[0])}\nnot json\n\n`)).toHaveLength(1);
  });
});
