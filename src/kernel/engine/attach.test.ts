import { describe, expect, it } from "vitest";
import { chars } from "./core";
import { CARDS } from "./testcards";
import { table, type Table } from "./testkit";
import type { CardDef, ObjId } from "./types";

const bear: CardDef = { name: "Test Bear", manaCost: "{1}{G}", types: ["creature"], subtypes: ["Bear"], power: 2, toughness: 2, kernel: { schemaVersion: 2, abilities: [] } };
const world = (players = ["p1", "p2"]): Table => table(players, { extra: { ...CARDS, "Test Bear": bear } });
const eff = (t: Table, id: ObjId) => chars({ s: t.state, events: [], defs: (n: string) => (n === "Test Bear" ? bear : undefined) ?? (undefined as never), scanned: 0 } as never, id);
const equip = (t: Table, who: string, eq: ObjId, ab: string, target: ObjId) => t.do({ type: "activateAbility", player: who, sourceId: eq, abilityId: ab, targets: { t1: [target] } });
const equipOk = (t: Table, who: string, eq: ObjId, ab: string, target: ObjId) => t.ok({ type: "activateAbility", player: who, sourceId: eq, abilityId: ab, targets: { t1: [target] } });
const kw = (t: Table, id: ObjId) => t.state.objects[id] && effKeywords(t, id);
function effKeywords(t: Table, id: ObjId): string[] {
  // read through the engine's own entry point via a no-op action result: use the Equipment's host check instead of recomputing chars here
  const o = t.obj(id);
  void o;
  return [];
}
void eff; void kw;

// effective characteristics through the real layer pipeline, using the table's card lookup
import { lookup } from "./testkit";
function chr(t: Table, id: ObjId) {
  const defs = (n: string) => (n === "Test Bear" ? bear : lookup(n) ?? CARDS[n]);
  return chars({ s: structuredClone(t.state), events: [], defs, scanned: 0 } as never, id);
}

describe("equip (Lightning Greaves, Shadowspear)", () => {
  it("Greaves: equip {0} at sorcery speed attaches it; the creature has haste and shroud", () => {
    const t = world();
    const greaves = t.give("p1", "Lightning Greaves", "battlefield");
    const cub = t.give("p1", "Test Bear", "battlefield");
    expect(chr(t, cub).keywords).not.toContain("shroud");
    equipOk(t, "p1", greaves, "a2", cub);
    expect(t.state.stack).toHaveLength(1);
    expect(t.obj(greaves).attachedTo).toBeUndefined(); // still on the stack: the attach happens on resolution
    t.pass("p1", "p2");
    expect(t.obj(greaves).attachedTo).toBe(cub);
    expect(chr(t, cub).keywords).toEqual(expect.arrayContaining(["haste", "shroud"]));
  });

  it("shroud is real: an opponent's Bolt cannot target the equipped creature", () => {
    const t = world();
    const greaves = t.give("p1", "Lightning Greaves", "battlefield");
    const cub = t.give("p1", "Test Bear", "battlefield");
    equipOk(t, "p1", greaves, "a2", cub); t.pass("p1", "p2");
    t.lands("p2", "Mountain", 1);
    const bolt = t.give("p2", "Lightning Bolt", "hand");
    t.state = { ...t.state, priority: "p2" };
    expect(t.do({ type: "castSpell", player: "p2", cardId: bolt, targets: { t1: [cub] } }).error?.code).toBe("illegal_target");
  });

  it("equip is sorcery speed: refused on the opponent's turn and with something on the stack", () => {
    const t = world();
    const greaves = t.give("p1", "Lightning Greaves", "battlefield");
    const cub = t.give("p1", "Test Bear", "battlefield");
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p1" };
    expect(equip(t, "p1", greaves, "a2", cub).error?.code).toBe("wrong_timing");
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p1" }, priority: "p1" };
    t.lands("p1", "Mountain", 1);
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: bolt, targets: { t1: ["p2"] } });
    expect(equip(t, "p1", greaves, "a2", cub).error?.code).toBe("wrong_timing");
  });

  it("only creatures you control can be equipped; only the controller may equip", () => {
    const t = world();
    const spear = t.give("p1", "Shadowspear", "battlefield");
    t.lands("p1", "Mountain", 2);
    const theirs = t.give("p2", "Test Bear", "battlefield");
    expect(equip(t, "p1", spear, "a3", theirs).error?.code).toBe("illegal_target");
    const mine = t.give("p1", "Test Bear", "battlefield");
    t.state = { ...t.state, priority: "p2" };
    expect(equip(t, "p2", spear, "a3", mine).error?.code).toBe("not_owner");
  });

  it("Shadowspear: +1/+1, trample and lifelink; equip {2} is paid", () => {
    const t = world();
    const spear = t.give("p1", "Shadowspear", "battlefield");
    t.lands("p1", "Mountain", 2);
    const cub = t.give("p1", "Test Bear", "battlefield");
    expect(equip(t, "p1", spear, "a3", cub).error).toBeUndefined();
    expect(t.state.battlefield.filter((id) => t.obj(id).tapped)).toHaveLength(2);
    t.pass("p1", "p2");
    const c = chr(t, cub);
    expect([c.power, c.toughness]).toEqual([3, 3]);
    expect(c.keywords).toEqual(expect.arrayContaining(["trample", "lifelink"]));
  });

  it("equip without enough mana fails and nothing moves", () => {
    const t = world();
    const spear = t.give("p1", "Shadowspear", "battlefield");
    t.give("p1", "Mountain", "battlefield");
    const cub = t.give("p1", "Test Bear", "battlefield");
    expect(equip(t, "p1", spear, "a3", cub).error?.code).toBe("cannot_pay");
    expect(t.state.stack).toHaveLength(0);
  });

  it("moving the Equipment to another creature: the first loses the bonus, the second gets it", () => {
    const t = world();
    const spear = t.give("p1", "Shadowspear", "battlefield");
    t.lands("p1", "Mountain", 4);
    const a = t.give("p1", "Test Bear", "battlefield"), b = t.give("p1", "Test Bear", "battlefield");
    equipOk(t, "p1", spear, "a3", a); t.pass("p1", "p2");
    equipOk(t, "p1", spear, "a3", b); t.pass("p1", "p2");
    expect(chr(t, a).power).toBe(2);
    expect(chr(t, b).power).toBe(3);
    expect(t.obj(spear).attachedTo).toBe(b);
  });

  it("the equipped creature leaving the battlefield leaves the Equipment unattached on the battlefield", () => {
    const t = world();
    const greaves = t.give("p1", "Lightning Greaves", "battlefield");
    const cub = t.give("p1", "Test Bear", "battlefield");
    equipOk(t, "p1", greaves, "a2", cub); t.pass("p1", "p2");
    const s = structuredClone(t.state);
    s.battlefield = s.battlefield.filter((id) => id !== cub); s.objects[cub].zone = "graveyard"; s.players[0].graveyard.push(cub); s.objects[cub].timestamp += 5;
    t.state = s;
    t.lands("p1", "Mountain", 1);
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: bolt, targets: { t1: ["p2"] } }); t.pass("p1", "p2"); // any settle runs the state-based actions
    expect(t.obj(greaves).zone).toBe("battlefield");
    expect(t.obj(greaves).attachedTo).toBeUndefined();
  });

  it("Equipment attached to something that is not a creature becomes unattached (704.5n)", () => {
    const t = world();
    const greaves = t.give("p1", "Lightning Greaves", "battlefield");
    const land = t.give("p1", "Island", "battlefield");
    t.state.objects[greaves].attachedTo = land; t.state.objects[greaves].attachedToTs = t.obj(land).timestamp;
    t.lands("p1", "Mountain", 1);
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: bolt, targets: { t1: ["p2"] } }); t.pass("p1", "p2");
    expect(t.obj(greaves).attachedTo).toBeUndefined();
  });

  it("lifelink from the equipment works in combat", () => {
    const t = world();
    const spear = t.give("p1", "Shadowspear", "battlefield");
    t.lands("p1", "Mountain", 2);
    const cub = t.give("p1", "Test Bear", "battlefield");
    equipOk(t, "p1", spear, "a3", cub); t.pass("p1", "p2");
    t.ok({ type: "advancePhase", player: "p1" }); // beginning of combat
    t.ok({ type: "advancePhase", player: "p1" }); // declare attackers
    t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: cub, defender: "p2" }] });
    for (let i = 0; i < 10 && t.state.turn.phase !== "end_of_combat"; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.p("p2").life).toBe(37);
    expect(t.p("p1").life).toBe(43);
  });

  it("is deterministic", () => {
    const run = () => { const t = world(); const g = t.give("p1", "Lightning Greaves", "battlefield"); const c = t.give("p1", "Test Bear", "battlefield"); equipOk(t, "p1", g, "a2", c); t.pass("p1", "p2"); return t.state; };
    expect(run()).toEqual(run());
  });
});

describe("Bloodthirsty Blade: attach to an opponent's creature, +2/+0 and goaded", () => {
  const setup = (players = ["p1", "p2"]) => {
    const t = world(players);
    t.lands("p1", "Mountain", 3);
    const blade = t.give("p1", "Bloodthirsty Blade", "battlefield");
    const theirs = t.give("p2", "Test Bear", "battlefield");
    return { t, blade, theirs };
  };

  it("targets only creatures an opponent controls and gives +2/+0", () => {
    const { t, blade, theirs } = setup();
    const mine = t.give("p1", "Test Bear", "battlefield");
    expect(equip(t, "p1", blade, "a2", mine).error?.code).toBe("illegal_target");
    equipOk(t, "p1", blade, "a2", theirs); t.pass("p1", "p2");
    expect(t.obj(blade).attachedTo).toBe(theirs);
    expect(chr(t, theirs).power).toBe(4);
    expect(t.obj(theirs).controller).toBe("p2"); // the creature stays with its controller
  });

  it("the goaded creature must attack each combat", () => {
    const { t, blade, theirs } = setup();
    equipOk(t, "p1", blade, "a2", theirs); t.pass("p1", "p2");
    t.state = { ...t.state, turn: { number: 2, active: "p2", phase: "beginning_of_combat" }, priority: "p2", combat: null };
    t.state.players[1].lastTurnStartTs = 0;
    t.ok({ type: "advancePhase", player: "p2" });
    expect(t.state.combat?.expect).toMatchObject({ kind: "attackers", player: "p2" });
    expect(t.do({ type: "declareAttackers", player: "p2", attackers: [] }).error?.code).toBe("attack_requirement");
    t.ok({ type: "declareAttackers", player: "p2", attackers: [{ id: theirs, defender: "p1" }] }); // the only opponent: allowed
    expect(t.state.combat!.attackers).toHaveLength(1);
  });

  it("in a 3-player game it must attack a player other than the goader if able", () => {
    const { t, blade, theirs } = setup(["p1", "p2", "p3"]);
    equipOk(t, "p1", blade, "a2", theirs); t.pass("p1", "p2", "p3");
    t.state = { ...t.state, turn: { number: 2, active: "p2", phase: "beginning_of_combat" }, priority: "p2", combat: null };
    t.state.players[1].lastTurnStartTs = 0;
    t.ok({ type: "advancePhase", player: "p2" });
    expect(t.do({ type: "declareAttackers", player: "p2", attackers: [{ id: theirs, defender: "p1" }] }).error?.code).toBe("illegal_attack");
    t.ok({ type: "declareAttackers", player: "p2", attackers: [{ id: theirs, defender: "p3" }] });
    expect(t.state.combat!.attackers[0].defender).toBe("p3");
  });
});

describe("living weapon (Bonehoard)", () => {
  it("creates a Germ and attaches to it; the Germ is X/X where X = creature cards in all graveyards", () => {
    const t = world();
    t.lands("p1", "Swamp", 4);
    t.give("p1", "Test Bear", "graveyard"); t.give("p2", "Test Bear", "graveyard");
    const bh = t.give("p1", "Bonehoard", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: bh });
    t.pass("p1", "p2"); // the Equipment resolves, its living-weapon trigger goes on the stack
    t.pass("p1", "p2");
    const germ = t.state.battlefield.map((id) => t.obj(id)).find((o) => o.token?.name === "Germ")!;
    expect(germ).toBeDefined();
    expect(t.obj(bh).attachedTo).toBe(germ.id);
    const c = chr(t, germ.id);
    expect([c.power, c.toughness]).toEqual([2, 2]);
  });

  it("with no creature cards in graveyards the 0/0 Germ dies and the Equipment stays", () => {
    const t = world();
    t.lands("p1", "Swamp", 4);
    const bh = t.give("p1", "Bonehoard", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: bh });
    t.pass("p1", "p2"); t.pass("p1", "p2");
    expect(t.state.battlefield.some((id) => t.obj(id).token?.name === "Germ")).toBe(false);
    expect(t.obj(bh).zone).toBe("battlefield");
    expect(t.obj(bh).attachedTo).toBeUndefined();
  });
});

describe("other equipment: Basilisk Collar, Swiftfoot Boots", () => {
  it("Collar gives deathtouch and lifelink; Boots give hexproof and haste", () => {
    const t = world();
    t.lands("p1", "Island", 4);
    const collar = t.give("p1", "Basilisk Collar", "battlefield"), boots = t.give("p1", "Swiftfoot Boots", "battlefield");
    const cub = t.give("p1", "Test Bear", "battlefield");
    equipOk(t, "p1", collar, "a2", cub); t.pass("p1", "p2");
    equipOk(t, "p1", boots, "a2", cub); t.pass("p1", "p2");
    expect(chr(t, cub).keywords).toEqual(expect.arrayContaining(["deathtouch", "lifelink", "hexproof", "haste"]));
  });

  it("hexproof from Boots stops only opponents' targeting", () => {
    const t = world();
    t.lands("p1", "Island", 2);
    const boots = t.give("p1", "Swiftfoot Boots", "battlefield");
    const cub = t.give("p1", "Test Bear", "battlefield");
    equipOk(t, "p1", boots, "a2", cub); t.pass("p1", "p2");
    t.lands("p2", "Mountain", 1);
    const bolt = t.give("p2", "Lightning Bolt", "hand");
    t.state = { ...t.state, priority: "p2" };
    expect(t.do({ type: "castSpell", player: "p2", cardId: bolt, targets: { t1: [cub] } }).error?.code).toBe("illegal_target");
    t.lands("p1", "Mountain", 1);
    const mybolt = t.give("p1", "Lightning Bolt", "hand");
    t.state = { ...t.state, priority: "p1" };
    expect(t.do({ type: "castSpell", player: "p1", cardId: mybolt, targets: { t1: [cub] } }).error).toBeUndefined();
  });
});
