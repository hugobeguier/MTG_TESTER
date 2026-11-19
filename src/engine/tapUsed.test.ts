// Items 2 and 3 of the playtest: a USED tap can't be undone by hand (the T key), and Viridescent Bog's {1} is really paid. Real Oracle text from the catalog.
import { describe, expect, it } from "vitest";
import { bear, by, onBoard, real, seat, session } from "@/components/AppFlow.batch3Abilities.test";
import { addManaToPool, chooseManaSourcesForCost, emptyManaPool, isAvailableManaSource, spendManaSources } from "@/engine/mana";
import { untapForSeat } from "@/engine/turnFlow";
import { canManuallyUntap, markPermanentsUsed, tapPaidSignet, tapRefusalMessage, toggleTapManually } from "@/engine/tapUsed";

const spell = (cost: number, manaCost: string) => real("Swamp", "spell", { manaValue: cost, manaCost, typeLine: "Sorcery" });

describe("Viridescent Bog: {1}, {T}: Add {B}{G}. really pays its {1}", () => {
  it("is no mana source on its own and pays no spell by itself (it used to be +1 free mana)", () => {
    const bog = real("Viridescent Bog", "bog");
    const alone = seat("a", [bog]);
    expect(isAvailableManaSource(bog, alone, [alone])).toBe(false);
    expect(chooseManaSourcesForCost(alone, spell(1, "{B}"), 1, undefined, [alone]).ok).toBe(false);
  });
  it("Bog + one Swamp make exactly two mana net (the Swamp pays the {1}), not three", () => {
    const bog = real("Viridescent Bog", "bog");
    const s = seat("a", [bog, real("Swamp", "sw")]);
    expect(chooseManaSourcesForCost(s, spell(2, "{1}{B}"), 2, undefined, [s]).ok).toBe(true);
    expect(chooseManaSourcesForCost(s, spell(3, "{2}{B}"), 3, undefined, [s]).ok).toBe(false);
  });
  it("manual tap: pool {1} + Bog => pool {B}{G} (the {1} is spent) and the Bog is used", () => {
    const bog = real("Viridescent Bog", "bog");
    const s = session([seat("a", [bog])]);
    const result = tapPaidSignet(s, "a", "bog", addManaToPool(emptyManaPool(), "C", 1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pool).toEqual({ W: 0, U: 0, B: 1, R: 0, G: 1, C: 0 });
    expect(onBoard(result.session, "bog")).toMatchObject({ tapped: true, tapUsed: true });
  });
  it("with an empty pool the Bog does nothing and stays untapped", () => {
    const s = session([seat("a", [real("Viridescent Bog", "bog")])]);
    expect(tapPaidSignet(s, "a", "bog", emptyManaPool()).ok).toBe(false);
    expect(onBoard(s, "bog")?.tapped).toBeFalsy();
  });
  it("the untap-and-retap exploit is closed: the used Bog (and the land whose mana paid its {1}) cannot be untapped", () => {
    const bog = real("Viridescent Bog", "bog");
    const swamp = real("Swamp", "sw", { tapped: true });
    let s = session([seat("a", [bog, swamp])]);
    const tapped = tapPaidSignet(s, "a", "bog", addManaToPool(emptyManaPool(), "B", 1));
    if (!tapped.ok) throw new Error("tap failed");
    s = markPermanentsUsed(tapped.session, "a", ["sw"]); // what the UI does when the Bog spends the pool: the contributing sources become used
    const noPool = emptyManaPool();
    expect(toggleTapManually(s, "a", "bog", [], noPool).refused).toBe(tapRefusalMessage("Viridescent Bog"));
    expect(toggleTapManually(s, "a", "sw", [], noPool).refused).toBe(tapRefusalMessage("Swamp"));
  });
});

describe("manual untap of a used permanent is refused (human seats)", () => {
  const pool = addManaToPool(emptyManaPool(), "B", 1);
  it("a land tapped by mistake whose mana still floats can be untapped, and takes its mana back out of the pool", () => {
    const s = session([seat("a", [real("Swamp", "sw", { tapped: true })])]);
    const toggled = toggleTapManually(s, "a", "sw", [{ cardId: "sw", color: "B", amount: 1 }], pool);
    expect(toggled.refused).toBeUndefined();
    expect(toggled.removeFromPool).toEqual({ color: "B", amount: 1 });
    expect(onBoard(toggled.session, "sw")?.tapped).toBe(false);
  });
  it("once its mana was spent or partly spent (marked used, record cleared) the land stays tapped", () => {
    const s = markPermanentsUsed(session([seat("a", [real("Swamp", "sw", { tapped: true })])]), "a", ["sw"]);
    const toggled = toggleTapManually(s, "a", "sw", [], emptyManaPool());
    expect(toggled.refused).toBe("Swamp was already used this turn and can't be untapped.");
    expect(onBoard(toggled.session, "sw")?.tapped).toBe(true);
  });
  it("a land whose floating mana is partly gone from the pool is refused even if a record remains", () => {
    const decision = canManuallyUntap(real("Swamp", "sw", { tapped: true }), [{ cardId: "sw", color: "B", amount: 1 }], emptyManaPool());
    expect(decision.ok).toBe(false);
  });
  it("a creature that paid its {T} ability cost cannot be untapped; one tapped by a misclick can", () => {
    const priest = real("Priest of Forgotten Gods", "pr");
    const lone = bear("b1", { tapped: true });
    const used = bear("b2", { tapped: true, tapUsed: true });
    const s = session([seat("a", [priest, lone, used])]);
    expect(toggleTapManually(s, "a", "b1", [], emptyManaPool()).session.seats[0].board.battlefield.find((c) => c.id === "b1")?.tapped).toBe(false);
    expect(toggleTapManually(s, "a", "b2", [], emptyManaPool()).refused).toBeTruthy();
    // a manual tap is never "used": it can be undone straight away
    const tapped = toggleTapManually(s, "a", "pr", [], emptyManaPool()).session;
    expect(onBoard(tapped, "pr")).toMatchObject({ tapped: true, tapUsed: false });
    expect(toggleTapManually(tapped, "a", "pr", [], emptyManaPool()).refused).toBeUndefined();
  });
  it("the automatic payment (spendManaSources) marks its taps used", () => {
    const stone = real("Mind Stone", "ms");
    const land = real("Swamp", "sw");
    const s = seat("a", [stone, land]);
    const spent = spendManaSources(s, ["sw"]);
    expect(spent.board.battlefield.find((c) => c.id === "sw")).toMatchObject({ tapped: true, tapUsed: true });
  });
  it("agents keep the free toggle", () => {
    const s = session([seat("a", [bear("b", { tapped: true, tapUsed: true })], { kind: "agent" } as never)]);
    expect(toggleTapManually(s, "a", "b", [], emptyManaPool()).refused).toBeUndefined();
  });
  it("the untap step clears the used flag", () => {
    const s = session([seat("a", [real("Swamp", "sw", { tapped: true, tapUsed: true })])]);
    expect(onBoard(untapForSeat(s, "a"), "sw")).toMatchObject({ tapped: false, tapUsed: false });
    expect(by(s, "a")).toBeTruthy();
  });
});
