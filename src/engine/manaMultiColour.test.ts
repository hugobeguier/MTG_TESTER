// Legacy regression (found by the kernel observer, round 1): a bounce land's "{T}: Add {U}{R}" was credited as two mana of ONE colour, so
// Izzet Boilerworks + a Mountain paid {X}{U}{U} (X=1). It makes one {U} and one {R}.
import { describe, expect, it } from "vitest";
import { chooseManaSourcesForCost } from "@/engine/mana";
import type { PlayerSeat, VisibleCard } from "@/lib/types";

const card = (o: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard => ({ oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...o });
const seat = (battlefield: VisibleCard[]): PlayerSeat => ({ id: "s", name: "S", kind: "agent", life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield } });
const boilerworks = () => card({ id: "bw", name: "Izzet Boilerworks", typeLine: "Land", oracleText: "This land enters tapped.\nWhen this land enters, return a land you control to its owner's hand.\n{T}: Add {U}{R}." });
const mountain = (id: string) => card({ id, name: "Mountain", typeLine: "Basic Land — Mountain", oracleText: "({T}: Add {R}.)" });
const island = (id: string) => card({ id, name: "Island", typeLine: "Basic Land — Island", oracleText: "({T}: Add {U}.)" });
const spell = (manaCost: string, manaValue: number) => card({ id: "spell", name: "Test Spell", typeLine: "Sorcery", manaCost, manaValue, zone: "hand" });

describe("a two-colour tap covers one pip of each colour", () => {
  it("Boilerworks + Mountain cannot pay {X}{U}{U} with X=1 (only one blue mana)", () => {
    const s = seat([boilerworks(), mountain("m1")]);
    expect(chooseManaSourcesForCost(s, spell("{X}{U}{U}", 2), 3, undefined, [s]).ok).toBe(false);
  });
  it("Boilerworks + Island pays {U}{U}{R}: the bounce land makes the {U} and the {R}", () => {
    const s = seat([boilerworks(), island("i1")]);
    const r = chooseManaSourcesForCost(s, spell("{U}{U}{R}", 3), 3, undefined, [s]);
    expect(r.ok).toBe(true);
    expect(r.sourceIds.sort()).toEqual(["bw", "i1"]);
  });
  it("Boilerworks alone still pays {U}{R}, and its second mana is not lost to a generic cost", () => {
    const s = seat([boilerworks(), mountain("m1")]);
    expect(chooseManaSourcesForCost(s, spell("{U}{R}", 2), 2, undefined, [s]).sourceIds).toEqual(["bw"]);
    expect(chooseManaSourcesForCost(s, spell("{1}{U}", 2), 2, undefined, [s]).sourceIds).toEqual(["bw"]);
  });
});
