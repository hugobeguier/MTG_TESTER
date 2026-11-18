import { describe, expect, it } from "vitest";
import { chooseTransport, diagnosticsReducer, forcePollRequested, initialDiagnostics } from "./guestTransport";

describe("chooseTransport", () => {
  const base = { transport: "stream" as const, elapsedMs: 0, heard: false, errors: 0 };
  it("keeps the stream while it is young or has been heard", () => {
    expect(chooseTransport(base)).toBe("stream");
    expect(chooseTransport({ ...base, elapsedMs: 4999 })).toBe("stream");
    expect(chooseTransport({ ...base, elapsedMs: 60_000, heard: true })).toBe("stream");
  });
  it("falls back to polling when nothing arrives within 5s", () => {
    expect(chooseTransport({ ...base, elapsedMs: 5000 })).toBe("poll");
  });
  it("falls back after two errors, but not after one", () => {
    expect(chooseTransport({ ...base, heard: true, errors: 1 })).toBe("stream");
    expect(chooseTransport({ ...base, heard: true, errors: 2 })).toBe("poll");
  });
  it("stays on poll once switched, and honours the force flag", () => {
    expect(chooseTransport({ ...base, transport: "poll", heard: true })).toBe("poll");
    expect(chooseTransport({ ...base, forcePoll: true })).toBe("poll");
  });
});

describe("diagnostics and flag", () => {
  it("tracks transport, events and errors", () => {
    let d = diagnosticsReducer(initialDiagnostics, { type: "start", now: 10, transport: "stream" });
    d = diagnosticsReducer(d, { type: "event", now: 20 });
    d = diagnosticsReducer(d, { type: "error", message: "boom" });
    d = diagnosticsReducer(d, { type: "transport", transport: "poll" });
    expect(d).toEqual({ transport: "poll", joinedAt: 10, lastEventAt: 20, lastError: "boom" });
  });
  it("reads the force-poll flag from the query or storage", () => {
    expect(forcePollRequested("?code=A&mpForcePoll=1", null)).toBe(true);
    expect(forcePollRequested("", "1")).toBe(true);
    expect(forcePollRequested("?mpForcePoll=0", null)).toBe(false);
  });
});
