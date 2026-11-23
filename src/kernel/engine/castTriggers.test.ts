// Cast-trigger scoping: "an opponent casts" never fires for the controller's own spells, "first noncreature spell each turn" counts
// only noncreature spells per caster, and a land play is a special action, not a cast (no trigger, no cast count).
import { describe, expect, it } from "vitest";
import { filler } from "./famkit";
import { realTable } from "./testdb";
import type { Table } from "./testkit";

const cards = { "Test Elf": filler("Test Elf", ["creature"], 1, 1, ["Elf"]), "Fill Artifact": filler("Fill Artifact", ["artifact"], 0, 0) };
/** `who` casts `name` in their own main phase; returns how many triggered abilities that cast put on the stack (the stack is then emptied for the next cast). */
const castCount = (t: Table, who: string, name: string): number => {
  const id = t.give(who, name, "hand");
  t.state = { ...t.state, turn: { ...t.state.turn, active: who }, priority: who, stack: [], passes: [] };
  t.ok({ type: "castSpell", player: who, cardId: id });
  const n = t.state.stack.filter((i) => i.kind === "triggered").length;
  t.state = { ...t.state, stack: [] };
  return n;
};

describe("cast triggers: whose spell, which spell", () => {
  it("Mystic Remora ignores its controller's own noncreature spells and fires for every opponent noncreature spell", () => {
    const t = realTable(["p1", "p2"], cards); t.give("p1", "Mystic Remora", "battlefield");
    t.lands("p1", "Island", 4); t.lands("p2", "Island", 4);
    expect(castCount(t, "p1", "Fill Artifact")).toBe(0);
    expect(castCount(t, "p2", "Test Elf")).toBe(0);
    expect(castCount(t, "p2", "Fill Artifact")).toBe(1);
    expect(castCount(t, "p2", "Fill Artifact")).toBe(1); // the real Remora has no "first each turn" clause
  });

  it("Esper Sentinel: only the opponent's FIRST NONCREATURE spell counts (a creature spell first does not use it up)", () => {
    const t = realTable(["p1", "p2"], cards); t.give("p1", "Esper Sentinel", "battlefield");
    t.lands("p2", "Island", 4); t.lands("p1", "Island", 4);
    expect(castCount(t, "p1", "Fill Artifact")).toBe(0); // own spell
    expect(castCount(t, "p2", "Test Elf")).toBe(0); // creature
    expect(castCount(t, "p2", "Fill Artifact")).toBe(1); // first noncreature
    expect(castCount(t, "p2", "Fill Artifact")).toBe(0); // second noncreature
  });

  it("a land play is not a cast: no cast trigger and it does not count as a spell cast", () => {
    const t = realTable(["p1", "p2"], cards); t.give("p1", "Esper Sentinel", "battlefield");
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p2" };
    t.ok({ type: "playLand", player: "p2", cardId: t.give("p2", "Island", "hand") } as never);
    expect(t.state.stack).toHaveLength(0);
    expect(t.state.turnLog.filter((e) => e.type === "cast")).toHaveLength(0);
  });
});
