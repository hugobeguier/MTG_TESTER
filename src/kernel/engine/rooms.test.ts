// Rooms (CR 709.5, read from the real Comprehensive Rules; excerpts in docs/rooms-rules-notes.md): door state, characteristics, unlock actions, view data.
import { describe, expect, it } from "vitest";
import { famCards } from "./famkit";
import { drain } from "./step10kit";
import { legalActions } from "./legal";
import { charsOf, ctxOf, realTable } from "./testdb";
import { toSession } from "../integration/toSession";
import { roomDoorViews, lockedDoors } from "../../lib/roomDoors";
import type { CardFaceRecord } from "../../lib/types";

const faces: CardFaceRecord[] = [
  { name: "Secret Arcade", typeLine: "Enchantment — Room", oracleText: "", colors: ["W"], manaCost: "{4}{W}" },
  { name: "Dusty Parlor", typeLine: "Enchantment — Room", oracleText: "", colors: ["W"], manaCost: "{2}{W}" }
];
const display = (n: string) => (n === "Secret Arcade" ? { name: "Secret Arcade // Dusty Parlor", typeLine: "Enchantment — Room // Enchantment — Room", oracleText: "", manaValue: 8, colors: ["W"], faces } : undefined);
const redress = (t: ReturnType<typeof realTable>) => {
  t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Redress Fate", "hand") });
  for (let i = 0; i < 4 && t.state.stack.some((x) => x.kind === "spell") && !t.state.pending; i++) t.ok({ type: "passPriority", player: t.state.priority! });
};

describe("Rooms: door state (CR 709.5c-d)", () => {
  it("returned by Redress Fate (neither half cast): both doors locked, listed as one unlock action per door with its cost", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Plains", 20);
    const arc = t.give("p1", "Secret Arcade", "graveyard");
    t.give("p2", "Fill A", "battlefield");
    redress(t);
    drain(t);
    expect(t.obj(arc).zone).toBe("battlefield");
    expect(t.obj(arc).unlocked ?? []).toEqual([]);
    const c = charsOf(t, arc);
    expect(c.name).toBe(""); // a locked half has no name (709.5)
    expect(c.mv).toBe(0); expect(c.colors).toEqual([]); expect(c.types).toContain("enchantment");
    const acts = legalActions(t.state, "p1", ctxOf(t)).filter((a) => a.kind === "unlockDoor" && a.objectId === arc);
    expect(acts.map((a) => a.label).sort()).toEqual(["Unlock the Dusty Parlor door of Secret Arcade ({2}{W})", "Unlock the Secret Arcade door of Secret Arcade ({4}{W})"]);
  });
  it("a cast Room has only the cast door unlocked: its name and mana value are that half's", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Plains", 9);
    t.give("p2", "Fill A", "battlefield");
    const arc = t.give("p1", "Secret Arcade", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: arc, face: "Dusty Parlor" });
    drain(t);
    expect(t.obj(arc).unlocked).toEqual(["Dusty Parlor"]);
    expect(charsOf(t, arc).mv).toBe(3); // only the unlocked half's mana cost counts
  });
  it("view data: unlockedFaceIndices is [] for a locked Room, the unlocked indices otherwise, undefined off the battlefield", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    const arc = t.give("p1", "Secret Arcade", "battlefield");
    const card = () => toSession(t.state, "p1", { ctx: ctxOf(t), display } as never).seats.find((s) => s.id === "p1")!.board.battlefield.find((c) => c.typeLine.includes("Room"))!;
    expect(card().unlockedFaceIndices).toEqual([]);
    expect(lockedDoors(card()).map((d) => d.name)).toEqual(["Secret Arcade", "Dusty Parlor"]);
    void arc;
  });
});

describe("Rooms: unlock costs", () => {
  it("Inquisitive Glimmer: unlock costs you pay cost {1} less (generic only)", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Plains", 3);
    t.give("p1", "Inquisitive Glimmer", "battlefield");
    const arc = t.give("p1", "Secret Arcade", "battlefield");
    expect(t.do({ type: "unlockDoor", player: "p1", objectId: arc, face: "Dusty Parlor", autoPay: true }).error).toBeUndefined(); // {2}{W} -> {1}{W}
    expect(t.obj(arc).unlocked).toEqual(["Dusty Parlor"]);
    expect(t.state.battlefield.filter((id) => t.obj(id).cardName === "Plains" && t.obj(id).tapped)).toHaveLength(2);
  });
});

describe("Room lock overlay view model", () => {
  const base = { faces };
  it("no door state: no overlay (hand / graveyard / stack)", () => { expect(roomDoorViews({ ...base })).toBeUndefined(); expect(lockedDoors({ ...base })).toEqual([]); });
  it("both locked", () => { expect(lockedDoors({ ...base, unlockedFaceIndices: [] }).map((d) => d.index)).toEqual([0, 1]); });
  it("one unlocked: only the other door is locked, with an accessible label", () => {
    const l = lockedDoors({ ...base, unlockedFaceIndices: [1] });
    expect(l).toHaveLength(1); expect(l[0].name).toBe("Secret Arcade"); expect(l[0].ariaLabel).toBe("locked door: Secret Arcade");
  });
  it("fully unlocked: nothing locked", () => { expect(lockedDoors({ ...base, unlockedFaceIndices: [0, 1] })).toEqual([]); });
  it("not a Room: undefined", () => { expect(roomDoorViews({ faces: [{ ...faces[0], typeLine: "Creature" }, faces[1]], unlockedFaceIndices: [] })).toBeUndefined(); });
});
