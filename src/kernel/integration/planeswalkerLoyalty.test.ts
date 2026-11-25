import { describe, it, expect } from "vitest";
import { sqliteCardDb } from "../engine/testdb";

// A single-faced planeswalker must carry its printed loyalty in the card db (the pack builder reads it from here); without it the walker enters with 0 loyalty counters and state-based actions put it into the graveyard (Aminatou, the Fateshifter).
describe("planeswalker starting loyalty", () => {
  it("Aminatou, the Fateshifter has loyalty 3 in the card db", () => {
    expect(sqliteCardDb().card("Aminatou, the Fateshifter")?.loyalty).toBe(3);
  });
});
