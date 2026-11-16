import { describe, expect, it } from "vitest";
import { RANDOM_UUID_POLYFILL } from "./randomUuidPolyfill";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Runs the inline script against a fake global, the way the browser would, without touching the real one.
function run(fakeCrypto: unknown): { crypto?: { randomUUID?: () => string } } {
  const fakeGlobal: { crypto?: { randomUUID?: () => string } } = { crypto: fakeCrypto as never };
  new Function("globalThis", RANDOM_UUID_POLYFILL)(fakeGlobal);
  return fakeGlobal;
}

const withRandomValues = () => ({
  getRandomValues(bytes: Uint8Array) {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
  }
});

describe("randomUUID polyfill for insecure (plain http) contexts", () => {
  it("adds a v4 randomUUID when it is missing", () => {
    const g = run(withRandomValues());
    expect(typeof g.crypto?.randomUUID).toBe("function");
    for (let i = 0; i < 50; i += 1) expect(g.crypto!.randomUUID!()).toMatch(UUID_V4);
  });

  it("produces distinct ids", () => {
    const g = run(withRandomValues());
    const ids = new Set(Array.from({ length: 500 }, () => g.crypto!.randomUUID!()));
    expect(ids.size).toBe(500);
  });

  it("leaves an existing randomUUID untouched", () => {
    const original = () => "native";
    const g = run({ ...withRandomValues(), randomUUID: original });
    expect(g.crypto!.randomUUID).toBe(original);
  });

  it("does nothing, and does not throw, when crypto is unavailable", () => {
    expect(() => run(undefined)).not.toThrow();
    expect(() => run({})).not.toThrow();
  });
});
