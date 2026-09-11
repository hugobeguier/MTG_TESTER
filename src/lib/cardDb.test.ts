import { describe, expect, it } from "vitest";
import { xmageKeyForCardName } from "./cardDb";

// mtg-commander-engine-spec.md Phase 3a — this key has to agree with whatever
// scripts/ingest-xmage-cards.mjs actually indexed from the real magefree/mage filenames, so these
// cases are all real, verified-against-the-live-repo card names, not made up.
describe("xmageKeyForCardName", () => {
  it("strips an apostrophe (Kodama's Reach -> KodamasReach.java)", () => {
    expect(xmageKeyForCardName("Kodama's Reach")).toBe("kodamasreach");
  });

  it("strips a comma and joins words (Gix, Yawgmoth Praetor -> GixYawgmothPraetor.java)", () => {
    expect(xmageKeyForCardName("Gix, Yawgmoth Praetor")).toBe("gixyawgmothpraetor");
  });

  it("strips a hyphen (X-23, Deadly Weapon -> X23DeadlyWeapon.java)", () => {
    expect(xmageKeyForCardName("X-23, Deadly Weapon")).toBe("x23deadlyweapon");
  });

  it("strips a combining diacritic (Jötun Grunt -> JotunGrunt.java)", () => {
    expect(xmageKeyForCardName("Jötun Grunt")).toBe("jotungrunt");
  });

  it("uses only the front face for a modal-DFC/transform name (XMage keys the file by the front face alone)", () => {
    expect(xmageKeyForCardName("Aang, Swift Savior // Aang and La, Ocean's Fury")).toBe("aangswiftsavior");
  });

  it("documented limitation: a TRUE split card's combined key doesn't match (XMage names it FireIce.java, not FireXxx)", () => {
    // Front-face-only is correct for the far more common transform/MDFC case above, but wrong for a
    // true split card — this is the known, documented gap from cardDb.ts's own doc comment, pinned
    // here as a regression guard so a future "fix" doesn't silently change behavior without a test
    // update, and so a reader can see exactly what the gap looks like.
    expect(xmageKeyForCardName("Fire // Ice")).toBe("fire");
    expect(xmageKeyForCardName("Fire // Ice")).not.toBe("fireice");
  });
});
