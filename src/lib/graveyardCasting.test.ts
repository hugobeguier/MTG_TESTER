import { describe, expect, it } from "vitest";
import { graveyardCastPermission, parseFlashbackCost, parseGraveyardCastGrantAbility, parseStaticGraveyardCast } from "./graveyardCasting";

const army = { typeLine: "Sorcery", oracleText: "Create thirteen tapped 2/2 black Zombie creature tokens.\nFlashback {7}{B}{B}{B} (You may cast this card from your graveyard for its flashback cost. Then exile it.)" };
const moan = { typeLine: "Sorcery", oracleText: "Create two 2/2 black Zombie creature tokens.\nFlashback {5}{B}{B} (You may cast this card from your graveyard for its flashback cost. Then exile it.)" };
const gravecrawler = { typeLine: "Creature — Zombie", oracleText: "This creature can't block.\nYou may cast this card from your graveyard as long as you control a Zombie." };
const zombie = { typeLine: "Creature — Zombie" };
const human = { typeLine: "Creature — Human" };
const ctx = (battlefield: Array<{ typeLine: string }>, turn = 3) => ({ seatId: "a", turn, controllerBattlefield: battlefield });

describe("graveyard casting permissions", () => {
  it("reads flashback costs", () => {
    expect(parseFlashbackCost(army.oracleText)).toBe("{7}{B}{B}{B}");
    expect(parseFlashbackCost(moan.oracleText)).toBe("{5}{B}{B}");
    expect(parseFlashbackCost("Draw a card.")).toBeUndefined();
  });

  it("flashback: cast for the flashback cost and exile afterwards", () => {
    expect(graveyardCastPermission(moan, ctx([]))).toEqual({ kind: "flashback", costText: "{5}{B}{B}", exileAfter: true });
  });

  it("Gravecrawler: castable only while you control a Zombie, and it isn't exiled", () => {
    expect(parseStaticGraveyardCast(gravecrawler.oracleText)).toEqual({ requiredType: "zombie" });
    expect(graveyardCastPermission(gravecrawler, ctx([zombie]))).toEqual({ kind: "static", exileAfter: false });
    expect(graveyardCastPermission(gravecrawler, ctx([human]))).toBeUndefined();
    expect(graveyardCastPermission(gravecrawler, ctx([]))).toBeUndefined();
  });

  it("Zul Ashur's grant lasts one turn and one player", () => {
    const granted = { typeLine: "Creature — Zombie", oracleText: "", graveyardCastGrant: { seatId: "a", turn: 3 } };
    expect(graveyardCastPermission(granted, ctx([]))).toEqual({ kind: "granted", exileAfter: false });
    expect(graveyardCastPermission(granted, ctx([], 4))).toBeUndefined();
    expect(graveyardCastPermission({ ...granted, graveyardCastGrant: { seatId: "b", turn: 3 } }, ctx([]))).toBeUndefined();
    expect(parseGraveyardCastGrantAbility("{T}: You may cast target Zombie creature card from your graveyard this turn.")).toEqual({ cardMatcher: "zombie creature" });
  });

  it("an ordinary card has no graveyard permission, and lands are never cast", () => {
    expect(graveyardCastPermission({ typeLine: "Instant", oracleText: "Draw a card." }, ctx([]))).toBeUndefined();
    expect(graveyardCastPermission({ typeLine: "Land", oracleText: "Flashback {1}" }, ctx([]))).toBeUndefined();
  });
});
