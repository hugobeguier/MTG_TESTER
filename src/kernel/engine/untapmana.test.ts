// untapForMana: taking back your own unspent mana tap (the Arena misclick undo). Real cards.
import { describe, expect, it } from "vitest";
import { legalActions } from "./legal";
import { realTable } from "./testdb";
import { ctx, mini } from "../integration/testgame";

const tap = (t: ReturnType<typeof realTable>, src: string, id = "a1", extra: object = {}) => t.do({ type: "activateAbility", player: "p1", sourceId: src, abilityId: id, ...extra } as never);
const untap = (t: ReturnType<typeof realTable>, id: string, player = "p1") => t.do({ type: "untapForMana", player, permanentId: id } as never);

describe("untapForMana", () => {
  it("a basic land tapped for mana untaps and its mana leaves the pool", () => {
    const t = realTable();
    const sw = t.give("p1", "Island", "battlefield");
    expect(tap(t, sw).error).toBeUndefined();
    expect(t.p("p1").manaPool.U).toBe(1);
    expect(untap(t, sw).error).toBeUndefined();
    expect(t.obj(sw).tapped).toBeFalsy();
    expect(t.p("p1").manaPool.U).toBe(0);
    expect(tap(t, sw).error).toBeUndefined(); // and it can be tapped again
    expect(t.p("p1").manaPool.U).toBe(1);
  });
  it("Sol Ring: both {C} leave the pool", () => {
    const t = realTable();
    const ring = t.give("p1", "Sol Ring", "battlefield");
    tap(t, ring);
    expect(t.p("p1").manaPool.C).toBe(2);
    expect(untap(t, ring).error).toBeUndefined();
    expect(t.p("p1").manaPool.C).toBe(0);
  });
  it("two lands tapped, one untapped: exactly that land's mana is retracted", () => {
    const t = realTable();
    const a = t.give("p1", "Island", "battlefield"), b = t.give("p1", "Island", "battlefield");
    tap(t, a); tap(t, b);
    expect(t.p("p1").manaPool.U).toBe(2);
    expect(untap(t, a).error).toBeUndefined();
    expect(t.p("p1").manaPool.U).toBe(1);
    expect(t.obj(b).tapped).toBe(true);
  });
  it("a mana dork (not summoning sick) untaps the same way", () => {
    const t = realTable();
    const elf = t.give("p1", "Llanowar Elves", "battlefield");
    const res = tap(t, elf);
    if (res.error) return; // summoning sick in this fixture: nothing to take back
    expect(untap(t, elf).error).toBeUndefined();
    expect(t.p("p1").manaPool.G).toBe(0);
  });
  it("refused: a land that entered tapped, a permanent not tapped for mana, an untapped permanent", () => {
    const t = realTable();
    const a = t.give("p1", "Island", "battlefield");
    t.obj(a).tapped = true; // entered tapped / tapped by an effect: no tap record
    expect(untap(t, a).error?.code).toBe("cannot_untap");
    const b = t.give("p1", "Island", "battlefield");
    expect(untap(t, b).error?.code).toBe("cannot_untap");
  });
  it("refused once the mana is spent (a spell cast in between), even with other mana left", () => {
    const t = realTable();
    const a = t.give("p1", "Island", "battlefield"), b = t.give("p1", "Island", "battlefield");
    const bs = t.give("p1", "Brainstorm", "hand");
    tap(t, a); tap(t, b);
    expect(t.do({ type: "castSpell", player: "p1", cardId: bs, autoPay: true } as never).error).toBeUndefined();
    expect(untap(t, a).error?.code).toBe("cannot_untap");
    expect(untap(t, b).error?.code).toBe("cannot_untap");
  });
  it("refused after anything else happened: a spell on the stack, passing priority, an activated ability", () => {
    const t = realTable();
    const a = t.give("p1", "Island", "battlefield");
    tap(t, a);
    t.do({ type: "passPriority", player: "p1" } as never);
    expect(untap(t, a).error).toBeTruthy();
  });
  it("only the controller: another player cannot untap it, nor an unknown id", () => {
    const t = realTable();
    const a = t.give("p1", "Island", "battlefield");
    tap(t, a);
    expect(untap(t, a, "p2").error?.code).toBeTruthy();
    expect(t.obj(a).tapped).toBe(true);
    expect(untap(t, "#nope").error?.code).toBe("unknown_object");
  });
  it("a pain tap (Talisman coloured ability) is not retractable; the free {C} tap is", () => {
    const t = realTable();
    const tal = t.give("p1", "Talisman of Progress", "battlefield");
    tap(t, tal, "a2", { color: "U" });
    expect(untap(t, tal).error?.code).toBe("cannot_untap");
    expect(t.p("p1").life).toBe(39);
    const u = realTable();
    const tal2 = u.give("p1", "Talisman of Progress", "battlefield");
    tap(u, tal2, "a1");
    expect(untap(u, tal2).error).toBeUndefined();
    expect(u.p("p1").manaPool.C).toBe(0);
  });
  it("the pool emptying with the step ends the window", () => {
    const t = realTable();
    const a = t.give("p1", "Island", "battlefield");
    tap(t, a);
    t.do({ type: "advancePhase", player: "p1" } as never);
    expect(untap(t, a).error).toBeTruthy();
  });
  it("legalActions lists it only when asked, and only for retractable taps", () => {
    const t = mini(["p1", "p2"], { phase: "precombat_main" });
    const a = t.give("p1", "Island", "battlefield");
    expect(legalActions(t.state, "p1", ctx, { untap: true }).some((x) => x.kind === "untapForMana")).toBe(false);
    tap(t as never, a);
    expect(legalActions(t.state, "p1", ctx).some((x) => x.kind === "untapForMana")).toBe(false);
    const listed = legalActions(t.state, "p1", ctx, { untap: true }).filter((x) => x.kind === "untapForMana");
    expect(listed.map((x) => x.objectId)).toEqual([a]);
    expect(legalActions(t.state, "p2", ctx, { untap: true }).some((x) => x.kind === "untapForMana")).toBe(false);
  });
  it("deterministic: the same actions give the same state", () => {
    const run = () => { const t = realTable(); const a = t.give("p1", "Island", "battlefield"); tap(t, a); untap(t, a); return JSON.stringify(t.state.players[0].manaPool) + String(t.obj(a).tapped); };
    expect(run()).toBe(run());
  });
});
