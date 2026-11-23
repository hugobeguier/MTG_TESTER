// Items 2 and 3 of the playtest: a USED tap can't be undone by hand (the T key), and Viridescent Bog's {1} is really paid. Real Oracle text from the catalog.
import { describe, expect, it } from "vitest";
import { bear, by, onBoard, real, seat, session } from "@/components/AppFlow.batch3Abilities.test";
import { addManaToPool, chooseManaSourcesForCost, emptyManaPool, isAvailableManaSource, spendManaSources } from "@/engine/mana";
import { untapForSeat } from "@/engine/turnFlow";
import { isRetractableManaTap, canManuallyUntap, markPermanentsUsed, tapPaidSignet, toggleTapManually, untapRefusalMessage } from "@/engine/tapUsed";

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
    expect(toggleTapManually(s, "a", "bog", [], noPool).refused).toBeTruthy();
    expect(toggleTapManually(s, "a", "sw", [], noPool).refused).toBeTruthy();
  });
});
describe("manual untap is only a take-back of unspent mana outside Sandbox mode", () => {
  const pool = addManaToPool(emptyManaPool(), "B", 1);
  const cardOf = (s: ReturnType<typeof session>, id: string) => onBoard(s, id);
  it("a land that ENTERED tapped (a tapland: no tapUsed, no mana record) cannot be untapped by hand", () => {
    for (const name of ["Temple of Malice", "Gruul Guildgate", "Blossoming Sands"]) {
      const s = session([seat("a", [real(name, "tl", { tapped: true })])]);
      const toggled = toggleTapManually(s, "a", "tl", [], emptyManaPool());
      expect(toggled.refused).toBe(untapRefusalMessage(name));
      expect(cardOf(toggled.session, "tl")?.tapped).toBe(true);
    }
  });
  it("a land tapped for mana whose mana is still floating CAN be untapped (take-back), and the mana comes out of the pool", () => {
    const s = session([seat("a", [real("Swamp", "sw", { tapped: true })])]);
    const toggled = toggleTapManually(s, "a", "sw", [{ cardId: "sw", color: "B", amount: 1 }], pool);
    expect(toggled.refused).toBeUndefined();
    expect(toggled.removeFromPool).toEqual({ color: "B", amount: 1 });
    expect(cardOf(toggled.session, "sw")?.tapped).toBe(false);
  });
  it("refused with a reason once that mana was spent (the contribution is gone / the pool is short / the source is marked used)", () => {
    const s = session([seat("a", [real("Swamp", "sw", { tapped: true })])]);
    expect(toggleTapManually(s, "a", "sw", [], pool).refused).toBe(untapRefusalMessage("Swamp")); // no record: not tapped for mana (entered tapped / ability)
    expect(toggleTapManually(s, "a", "sw", [{ cardId: "sw", color: "B", amount: 1 }], emptyManaPool()).refused).toMatch(/already spent/);
    const used = markPermanentsUsed(s, "a", ["sw"]);
    expect(toggleTapManually(used, "a", "sw", [{ cardId: "sw", color: "B", amount: 1 }], pool).refused).toMatch(/already spent/);
  });
  it("Sol Ring takes both {C} back; two lands tapped then one untapped retracts only that land's mana", () => {
    const ring = session([seat("a", [real("Sol Ring", "ring", { tapped: true })])]);
    const poolC = addManaToPool(emptyManaPool(), "C", 2);
    expect(toggleTapManually(ring, "a", "ring", [{ cardId: "ring", color: "C", amount: 2 }], poolC).removeFromPool).toEqual({ color: "C", amount: 2 });
    const two = session([seat("a", [real("Swamp", "s1", { tapped: true }), real("Swamp", "s2", { tapped: true })])]);
    const contributions = [{ cardId: "s1", color: "B" as const, amount: 1 }, { cardId: "s2", color: "B" as const, amount: 1 }];
    const poolBB = addManaToPool(addManaToPool(emptyManaPool(), "B", 1), "B", 1);
    expect(toggleTapManually(two, "a", "s1", contributions, poolBB).removeFromPool).toEqual({ color: "B", amount: 1 });
  });
  it("a creature (mana dork) tapped for mana can be taken back too", () => {
    const s = session([seat("a", [real("Llanowar Elves", "elf", { tapped: true })])]);
    expect(toggleTapManually(s, "a", "elf", [{ cardId: "elf", color: "G", amount: 1 }], addManaToPool(emptyManaPool(), "G", 1)).refused).toBeUndefined();
  });
  it("only a PURE mana tap leaves a take-back record: pain colour, Talisman colour and sacrifice mana do not; {C} on a Talisman or painland does", () => {
    for (const name of ["Caves of Koilos", "Talisman of Progress"]) {
      const card = real(name, "x");
      expect(isRetractableManaTap(card, "C"), name + " C").toBe(true);
      expect(isRetractableManaTap(card, name.startsWith("Caves") ? "W" : "U"), name + " coloured").toBe(false);
    }
    expect(isRetractableManaTap(real("Sol Ring", "r"), "C")).toBe(true);
    expect(isRetractableManaTap(real("Swamp", "sw"), "B")).toBe(true);
    expect(isRetractableManaTap(real("Swamp", "tr", { typeLine: "Artifact - Treasure", oracleText: "{T}, Sacrifice this artifact: Add one mana of any color." }), "B")).toBe(false);
  });
  it("an opponent's permanent: the toggle is keyed by seat, so seat b's land is not reachable through seat a", () => {
    const s = session([seat("a", []), seat("b", [real("Swamp", "bsw", { tapped: true })])]);
    expect(toggleTapManually(s, "a", "bsw", [{ cardId: "bsw", color: "B", amount: 1 }], pool).session).toBe(s);
  });
  it("used lands and creatures stay tapped", () => {
    const s = markPermanentsUsed(session([seat("a", [real("Swamp", "sw", { tapped: true }), bear("b2", { tapped: true, tapUsed: true }), bear("b1", { tapped: true })])]), "a", ["sw"]);
    for (const id of ["sw", "b2", "b1"]) expect(toggleTapManually(s, "a", id, [], emptyManaPool()).refused).toBeTruthy();
  });
  it("manually TAPPING an untapped permanent (any kind, summoning sick too) is still allowed", () => {
    const s = session([seat("a", [real("Priest of Forgotten Gods", "pr"), bear("b", { summoningSick: true })])]);
    for (const id of ["pr", "b"]) {
      const tapped = toggleTapManually(s, "a", id, [], emptyManaPool());
      expect(tapped.refused).toBeUndefined();
      expect(cardOf(tapped.session, id)).toMatchObject({ tapped: true, tapUsed: false });
      // and the tap cannot be undone by hand
      expect(toggleTapManually(tapped.session, "a", id, [], emptyManaPool()).refused).toBeTruthy();
    }
  });
  it("agent seats get no free untap either", () => {
    const s = session([seat("a", [bear("b", { tapped: true })], { kind: "agent" } as never)]);
    expect(toggleTapManually(s, "a", "b", [], emptyManaPool()).refused).toBeTruthy();
  });
  it("Sandbox mode may untap any tapped permanent", () => {
    const s = session([seat("a", [real("Temple of Malice", "tl", { tapped: true })])]);
    expect(cardOf(toggleTapManually(s, "a", "tl", [], emptyManaPool(), true).session, "tl")?.tapped).toBe(false);
  });
  it("canManuallyUntap still describes the sandbox undo rules", () => {
    expect(canManuallyUntap(real("Swamp", "sw", { tapped: true }), [{ cardId: "sw", color: "B", amount: 1 }], emptyManaPool()).ok).toBe(false);
  });
  it("the automatic payment (spendManaSources) marks its taps used", () => {
    const s = seat("a", [real("Mind Stone", "ms"), real("Swamp", "sw")]);
    expect(spendManaSources(s, ["sw"]).board.battlefield.find((c) => c.id === "sw")).toMatchObject({ tapped: true, tapUsed: true });
  });
  it("the untap step clears the used flag", () => {
    const s = session([seat("a", [real("Swamp", "sw", { tapped: true, tapUsed: true })])]);
    expect(onBoard(untapForSeat(s, "a"), "sw")).toMatchObject({ tapped: false, tapUsed: false });
    expect(by(s, "a")).toBeTruthy();
  });
});

describe("tapped-entry lands are recognised on every entry path", () => {
  it("Temple, guildgate and gain-land enter tapped; a basic does not; a check land follows the board", async () => {
    const { entersBattlefieldTapped } = await import("@/engine/lands");
    for (const name of ["Temple of Malice", "Gruul Guildgate", "Blossoming Sands"]) expect(entersBattlefieldTapped(real(name, "x"))).toBe(true);
    expect(entersBattlefieldTapped(real("Swamp", "x"))).toBe(false);
    const check = real("Drowned Catacomb", "dc");
    const none = seat("a", [check]);
    expect(entersBattlefieldTapped(check, none, [none])).toBe(true);
    const withSwamp = seat("a", [check, real("Swamp", "sw")]);
    expect(entersBattlefieldTapped(check, withSwamp, [withSwamp])).toBe(false);
  });
});
