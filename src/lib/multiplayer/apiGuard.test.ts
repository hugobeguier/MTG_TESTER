import { describe, expect, it } from "vitest";
import { isRemoteApiBlocked } from "./apiGuard";

describe("isRemoteApiBlocked", () => {
  it("allows loopback hosts", () => {
    for (const h of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "LOCALHOST"]) {
      expect(isRemoteApiBlocked(h, "/api/decks/library")).toBe(false);
    }
  });
  it("blocks other hosts on non-mp api routes", () => {
    expect(isRemoteApiBlocked("25.1.2.3:3000", "/api/saves")).toBe(true);
    expect(isRemoteApiBlocked(null, "/api/agents/action")).toBe(true);
  });
  it("never blocks /api/mp or page routes", () => {
    expect(isRemoteApiBlocked("25.1.2.3:3000", "/api/mp/stream")).toBe(false);
    expect(isRemoteApiBlocked("25.1.2.3:3000", "/mp/debug")).toBe(false);
    expect(isRemoteApiBlocked("25.1.2.3:3000", "/")).toBe(false);
    expect(isRemoteApiBlocked("25.1.2.3:3000", "/api/mpx")).toBe(true);
  });
  it("honours MP_ALLOW_REMOTE_API=1", () => {
    expect(isRemoteApiBlocked("25.1.2.3", "/api/saves", { MP_ALLOW_REMOTE_API: "1" })).toBe(false);
  });
});
