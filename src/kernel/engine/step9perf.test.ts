// Kernel step 9: layer evaluation must not blow up with many conditional statics (the "Angel hang").
import { describe, expect, it } from "vitest";
import { filler } from "./famkit";
import { realTable, charsOf } from "./testdb";

const cards = { "Test Angel": filler("Test Angel", ["creature"], 2, 2, ["Angel"]), "Test Elf": filler("Test Elf", ["creature"], 1, 1, ["Elf"]) };

describe("step 9 layers performance", () => {
  it("Angel statics together on a 60-permanent board evaluate fast", () => {
    const t = realTable(["p1", "p2"], cards);
    for (const n of ["Angelic Field Marshal", "Seraph of the Sword", "Angel of Vitality", "Giada, Font of Hope"]) { t.give("p1", n, "battlefield"); }
    for (let i = 0; i < 25; i++) { t.give("p1", "Test Angel", "battlefield"); t.give("p2", "Test Elf", "battlefield"); }
    const ids = t.state.battlefield;
    const t0 = performance.now();
    for (const id of ids) charsOf(t, id);
    const per = (performance.now() - t0) / ids.length;
    expect(per).toBeLessThan(50);
  });
});
