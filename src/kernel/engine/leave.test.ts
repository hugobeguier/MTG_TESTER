// A player leaving the game (CR 800.4a): what they own leaves with them, what they control but do not own goes back, their stack items cease to exist.
import { describe, expect, it } from "vitest";
import { filler } from "./famkit";
import { realTable } from "./testdb";
import type { Table } from "./testkit";

const cards = { "Test Elf": filler("Test Elf", ["creature"], 1, 1, ["Elf"]), "Fill Artifact": filler("Fill Artifact", ["artifact"], 0, 0) };
const three = () => realTable(["p1", "p2", "p3"], cards);
/** `who` dies to a state-based action: the active player plays a land, and the action settles */
const kill = (t: Table, who = "p1") => { t.state = { ...t.state, players: t.state.players.map((p) => (p.id === who ? { ...p, life: 0 } : p)) }; t.ok({ type: "playLand", player: t.state.turn.active, cardId: t.give(t.state.turn.active, "Island", "hand") }); };

describe("a player who loses leaves the game", () => {
  it("their Aura on someone else's creature is gone: the creature is no longer enchanted", () => {
    const t = three();
    const elf = t.give("p2", "Test Elf", "battlefield");
    const aura = t.give("p1", "Fill Artifact", "battlefield"); t.obj(aura).attachedTo = elf; t.obj(aura).attachedToTs = t.obj(elf).timestamp;
    const mine = t.give("p1", "Test Elf", "battlefield"); const inHand = t.give("p1", "Test Elf", "hand"); const inYard = t.give("p1", "Test Elf", "graveyard");
    kill(t);
    expect(t.state.players.find((p) => p.id === "p1")!.hasLost).toBe(true);
    for (const id of [aura, mine, inHand, inYard]) expect(t.state.objects[id], id).toBeUndefined();
    expect(t.state.battlefield).toEqual([elf]);
    expect(Object.values(t.state.objects).some((o) => o.attachedTo === elf)).toBe(false);
    expect(t.state.gameOver).toBeNull(); // two players remain
  });

  it("their cards on other players' sides leave too (a creature of theirs someone else controls)", () => {
    const t = three();
    const stolen = t.give("p1", "Test Elf", "battlefield"); t.obj(stolen).controller = "p2";
    kill(t);
    expect(t.state.objects[stolen]).toBeUndefined(); expect(t.state.battlefield).not.toContain(stolen);
  });

  it("a permanent they control but do not own returns to its owner (control effect ends)", () => {
    const t = three();
    const theirs = t.give("p3", "Test Elf", "battlefield"); t.obj(theirs).controller = "p1";
    kill(t);
    expect(t.obj(theirs).controller).toBe("p3"); expect(t.state.battlefield).toContain(theirs);
  });

  it("their spells on the stack cease to exist (they never resolve and are not put in a graveyard)", () => {
    const t = three(); t.lands("p1", "Island", 2);
    const a = t.give("p1", "Fill Artifact", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: a });
    const [item] = t.state.stack;
    const b = t.give("p1", "Fill Artifact", "hand");
    // a second p1 item above it (as if p1 had responded): p1 dies while resolving it
    t.obj(b).zone = "stack"; t.state.players[0].hand = t.state.players[0].hand.filter((x) => x !== b);
    t.state = { ...t.state, stack: [...t.state.stack, { ...item, id: "sx", objectId: b, sourceId: b }], players: t.state.players.map((p) => (p.id === "p1" ? { ...p, life: 0 } : p)) };
    for (let i = 0; i < 3; i++) t.ok({ type: "passPriority", player: t.state.priority! });
    expect(t.state.stack).toEqual([]);
    expect(t.state.objects[a]).toBeUndefined(); expect(t.state.battlefield).toEqual([]);
  });

  it("when the active player loses, their turn ends and the next living player takes the next turn", () => {
    const t = three();
    for (let i = 0; i < 3; i++) t.give("p1", "Island", "library");
    expect(t.state.turn.active).toBe("p1");
    kill(t, "p1");
    for (let i = 0; i < 30 && t.state.turn.active === "p1"; i++) t.ok({ type: "passPriority", player: t.state.priority! });
    expect(t.state.turn.active).toBe("p2");
  });

  it("the game ends when one player remains", () => {
    const t = realTable(["p1", "p2"], cards);
    kill(t, "p1");
    expect(t.state.gameOver).toMatchObject({ winner: "p2" });
  });
});
