// Kernel step 10 (c): Auras that enchant a player (Overwhelming Splendor, Shadow of the Second Sun).
import { describe, expect, it } from "vitest";
import { mk } from "./famkit";
import { drain } from "./step10kit";
import { cardUnsupported } from "./support";
import { charsOf, realDef, realTable } from "./testdb";

describe("step 10c: supported", () => { for (const n of ["Overwhelming Splendor", "Shadow of the Second Sun"]) it(n, () => { expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); }); });
const act = { id: "a1", kind: "activated", text: "{T}: ping", costs: [{ tap: "self" }], steps: [] } as never;
const bear = mk("Bear", { manaCost: "{1}", types: ["creature"], power: 4, toughness: 4 }, [act]);
const gadget = mk("Gadget", { manaCost: "{1}", types: ["artifact"] }, [act]);

describe("Overwhelming Splendor", () => {
  it("only the enchanted player's creatures become 1/1 without abilities; the player cannot activate abilities", () => {
    const t = realTable(["p1", "p2", "p3"], { Bear: bear, Gadget: gadget });
    const mine = t.give("p1", "Bear", "battlefield"), theirs = t.give("p2", "Bear", "battlefield"), other = t.give("p3", "Bear", "battlefield");
    for (const o of [mine, theirs, other]) t.obj(o).controlledSince = -1;
    for (let i = 0; i < 12; i++) t.give("p1", "Plains", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Overwhelming Splendor", "hand"), targets: { t1: ["p2"] } }); drain(t);
    expect(charsOf(t, theirs).power).toBe(1);
    expect(charsOf(t, theirs).abilities.length).toBe(0);
    expect(charsOf(t, other).power).toBe(4);
    expect(charsOf(t, mine).power).toBe(4);
    t.state.priority = "p2";
    expect(t.do({ type: "activateAbility", player: "p2", sourceId: other, abilityId: "a1" }).error?.code).toBe("not_owner");
    // the enchanted player's own non-mana ability
    const g = t.give("p2", "Gadget", "battlefield");
    expect(t.do({ type: "activateAbility", player: "p2", sourceId: g, abilityId: "a1" }).error?.code).toBe("cannot_activate");
  });
});

describe("Shadow of the Second Sun", () => {
  it("adds an untap / upkeep / draw beginning phase after the enchanted player's postcombat main phase", () => {
    const t = realTable(["p1", "p2"]);
    for (let i = 0; i < 12; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
    for (let i = 0; i < 12; i++) t.give("p1", "Island", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Shadow of the Second Sun", "hand"), targets: { t1: ["p1"] } }); drain(t);
    const phases: string[] = [];
    for (let i = 0; i < 30 && t.state.turn.number === 1; i++) { if (t.state.pending || t.state.stack.length || t.state.triggerQueue.length) drain(t); else t.ok({ type: "advancePhase", player: "p1" }); phases.push(t.state.turn.phase); }
    const iPost = phases.indexOf("postcombat_main");
    const seq = phases.slice(iPost).filter((p, i, a) => i === 0 || p !== a[i - 1]).slice(0, 4);
    expect(seq).toEqual(["postcombat_main", "upkeep", "draw", "end_step"]); // the added untap step has no priority, so it is not a stop
  });
});

describe("Aminatou, the Fateshifter: -6 rotates the nonland permanents", () => {
  it("each player gains control of what the next player to the left controlled", () => {
    expect(cardUnsupported(realDef("Aminatou, the Fateshifter")!).all).toEqual([]);
    const t = realTable(["p1", "p2", "p3"], { Bear: bear });
    const am = t.give("p1", "Aminatou, the Fateshifter", "battlefield", { counters: { loyalty: 6 } });
    const b1 = t.give("p1", "Bear", "battlefield"), b2 = t.give("p2", "Bear", "battlefield"), b3 = t.give("p3", "Bear", "battlefield"), land = t.give("p2", "Island", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: am, abilityId: "a3" });
    drain(t, (p) => (p.options.some((o) => o.id === "left") ? { ids: ["left"] } : undefined));
    expect(t.obj(b1).controller).toBe("p3"); // p3 gains control of p1's (p3's next to the left, wrapping, is p1)
    expect(t.obj(b2).controller).toBe("p1");
    expect(t.obj(b3).controller).toBe("p2");
    expect(t.obj(land).controller).toBe("p2");
    expect(t.obj(am).controller).toBe("p1");
  });
});

describe("Lim-Dul's Vault: as many times as you choose", () => {
  it("pays 1 life per round, bottoms the looked cards, looks again, then shuffles the rest and puts the last cards on top", () => {
    expect(cardUnsupported(realDef("Lim-Dûl's Vault")!).all).toEqual([]);
    const t = realTable(["p1", "p2"]);
    const lib: string[] = []; for (let i = 0; i < 12; i++) lib.push(t.give("p1", "Island", "library"));
    for (let i = 0; i < 4; i++) t.give("p1", "Island", "battlefield"); t.give("p1", "Swamp", "battlefield");
    let yes = 0;
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Lim-Dûl's Vault", "hand") });
    drain(t, (p) => (p.kind === "choose_yes_no" ? { yes: yes++ < 2 } : undefined));
    expect(t.p("p1").life).toBe(38);
    expect(t.p("p1").library.length).toBe(12);
    expect(new Set(t.p("p1").library)).toEqual(new Set(lib));
  });
});
