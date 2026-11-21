import { describe, expect, it } from "vitest";
import { abilitiesOf } from "./core";
import { chars } from "./core";
import { canAttack, canBlock, spellCostDelta } from "./layers";
import { cardUnsupported } from "./support";
import { CARDS, defs, game, runOf } from "./testcards";
import type { Table } from "./testcards";
import type { ObjId } from "./types";

const view = (t: Table, id: ObjId) => chars(runOf(t.state), id);
const cast = (t: Table, who: string, id: ObjId, targets?: Record<string, string[]>) => t.ok({ type: "castSpell", player: who, cardId: id, targets });
const finish = (t: Table) => { while (t.state.stack.length) t.resolveTop(); };
const advanceTo = (t: Table, turn: number, phase: string) => {
  for (let i = 0; i < 60 && !(t.state.turn.number === turn && t.state.turn.phase === phase); i++) t.ok({ type: "advancePhase", player: t.state.turn.active });
};

describe("support: statics and replacements the engine now runs", () => {
  it("the drafted cards used below are fully supported (no unsupported ability)", () => {
    for (const n of ["Utter Insignificance", "Crucible of Fire", "Dragonstorm Globe", "Shivan Devastator", "Twinflame Tyrant", "Kalitas, Traitor of Ghet", "Angel of Vitality", "Draconic Visitor", "Academy Manufactor", "Arcane Sanctum", "Seraph of the Sword", "Carrion Feeder", "Spymaster's Vault"]) {
      const s = cardUnsupported(CARDS[n]);
      expect(s.all.filter((x) => !/^(trigger|keyword|mana|cost|step|field|predicate|quantity)/.test(x)), n).toEqual([]);
    }
    expect(cardUnsupported(CARDS["Utter Insignificance"]).all).toEqual([]);
    expect(cardUnsupported(CARDS["Draconic Visitor"]).all).toEqual([]);
    expect(cardUnsupported(CARDS["Academy Manufactor"]).all).toEqual([]);
    expect(cardUnsupported(CARDS["Crucible of Fire"]).all).toEqual([]);
  });
  it("vocabulary still without an implementation reports the detail (never silently skipped)", () => {
    expect(cardUnsupported(CARDS["Mycosynth Lattice"]).all).toContain("static:affects:each_player");
    expect(cardUnsupported(CARDS["Optional Shield"]).all).toEqual([]); // optional replacements run since step 6
  });
});

describe("layers: Utter Insignificance on Ancient Copper Dragon", () => {
  const setup = () => {
    const t = game();
    const dragon = t.give("p2", "Ancient Copper Dragon", "battlefield");
    t.lands("p1", "Island", 3);
    t.lands("p1", "Forest", 2);
    const aura = t.give("p1", "Utter Insignificance", "hand");
    const before = t.give("p1", "Haste Rune", "hand");
    const after = t.give("p1", "Trample Rune", "hand");
    const kill = t.give("p1", "Disenchant", "hand");
    t.lands("p1", "Plains", 1);
    return { t, dragon, aura, before, after, kill };
  };

  it("loses all abilities and becomes 1/1; a grant made AFTER is kept, one made BEFORE is lost; leaving restores everything", () => {
    const { t, dragon, aura, before, after, kill } = setup();
    expect(view(t, dragon)).toMatchObject({ power: 6, toughness: 5 });
    expect(view(t, dragon).keywords).toContain("flying");

    cast(t, "p1", before, { t1: [dragon] }); finish(t);            // haste, timestamp BEFORE the aura
    expect(view(t, dragon).keywords).toEqual(expect.arrayContaining(["flying", "haste"]));
    cast(t, "p1", aura, { t1: [dragon] }); finish(t);
    expect(t.obj(aura).zone).toBe("battlefield");
    expect(t.obj(aura).attachedTo).toBe(dragon);
    cast(t, "p1", after, { t1: [dragon] }); finish(t);              // trample, timestamp AFTER the aura

    const c = view(t, dragon);
    expect(c.power).toBe(1); expect(c.toughness).toBe(1);
    expect(c.keywords).toEqual(["trample"]);                         // no flying (printed), no haste (earlier), trample kept (later)
    expect(abilitiesOf(runOf(t.state), t.obj(dragon)).map((a) => a.keyword?.name)).toEqual(["trample"]); // and no triggered ability

    cast(t, "p1", kill, { t1: [aura] }); finish(t);
    expect(t.obj(aura).zone).toBe("graveyard");
    const back = view(t, dragon);
    expect(back).toMatchObject({ power: 6, toughness: 5 });
    expect(back.keywords).toEqual(expect.arrayContaining(["flying", "haste", "trample"]));
    expect(abilitiesOf(runOf(t.state), t.obj(dragon)).some((a) => a.kind === "triggered")).toBe(true);
  });

  it("the aura falls off (state-based action) when its creature dies", () => {
    const t = game();
    const bear = t.give("p2", "Bear Cub", "battlefield");
    t.lands("p1", "Island", 2); t.give("p1", "Mountain", "battlefield");
    const aura = t.give("p1", "Utter Insignificance", "hand");
    cast(t, "p1", aura, { t1: [bear] }); finish(t);
    expect(t.obj(aura).attachedTo).toBe(bear);
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    cast(t, "p1", bolt, { t1: [bear] }); finish(t);
    expect(t.obj(bear).zone).toBe("graveyard");
    expect(t.obj(aura).zone).toBe("graveyard"); // not attached to anything: put into the graveyard
  });

  it("a stripped permanent has no triggers: the same upkeep trigger fires without the aura and not with it", () => {
    const run = (withAura: boolean) => {
      const t = game();
      for (let i = 0; i < 6; i++) { t.give("p1", "Plains", "library"); t.give("p2", "Plains", "library"); }
      const pinger = t.give("p1", "Upkeep Pinger", "battlefield");
      if (withAura) {
        t.lands("p1", "Island", 2);
        const aura = t.give("p1", "Utter Insignificance", "hand");
        cast(t, "p1", aura, { t1: [pinger] }); finish(t);
      }
      advanceTo(t, 3, "upkeep");
      return t.state.stack.filter((i) => i.kind === "triggered").length;
    };
    expect(run(false)).toBe(1);
    expect(run(true)).toBe(0);
  });
});

describe("layers: anthems, counters, base P/T, conditions", () => {
  it("an anthem adds +1/+1 to the controller's creatures only; counters and the anthem stack on the base", () => {
    const t = game();
    const bear = t.give("p1", "Bear Cub", "battlefield", { counters: { "+1/+1": 1 } });
    const theirs = t.give("p2", "Bear Cub", "battlefield");
    t.give("p1", "Glorious Anthem", "battlefield");
    expect(view(t, bear)).toMatchObject({ power: 4, toughness: 4 });  // 2/2 + counter + anthem
    expect(view(t, theirs)).toMatchObject({ power: 2, toughness: 2 });
  });

  it("base P/T is set first (7b) whatever the timestamp, then the anthem and counters add (7c)", () => {
    for (const anthemFirst of [true, false]) {
      const t = game();
      t.lands("p1", "Island", 2);
      const bear = t.give("p1", "Bear Cub", "battlefield", { counters: { "+1/+1": 1 } });
      const shrink = t.give("p1", "Shrink", "hand");
      if (anthemFirst) t.give("p1", "Glorious Anthem", "battlefield");
      cast(t, "p1", shrink, { t1: [bear] }); finish(t);               // base 1/1 until end of turn
      if (!anthemFirst) t.give("p1", "Glorious Anthem", "battlefield");
      expect(view(t, bear), `anthemFirst=${anthemFirst}`).toMatchObject({ power: 3, toughness: 3 }); // 1/1 + counter + anthem
    }
  });

  it("a real draft anthem: Crucible of Fire gives Dragons +3/+3 (not other creatures, not opponents' Dragons)", () => {
    const t = game();
    const dragon = t.give("p1", "Ancient Copper Dragon", "battlefield");
    const bear = t.give("p1", "Bear Cub", "battlefield");
    const theirs = t.give("p2", "Ancient Copper Dragon", "battlefield");
    t.give("p1", "Crucible of Fire", "battlefield");
    expect(view(t, dragon)).toMatchObject({ power: 9, toughness: 8 });
    expect(view(t, bear)).toMatchObject({ power: 2, toughness: 2 });
    expect(view(t, theirs)).toMatchObject({ power: 6, toughness: 5 });
  });

  it("'while' conditions: Angel of Vitality gets +2/+2 only while its controller has 25 or more life", () => {
    const t = game();
    const angel = t.give("p1", "Angel of Vitality", "battlefield");
    expect(view(t, angel)).toMatchObject({ power: 4, toughness: 4 });
    t.state = { ...t.state, players: t.state.players.map((p) => (p.id === "p1" ? { ...p, life: 20 } : p)) };
    expect(view(t, angel)).toMatchObject({ power: 2, toughness: 2 });
  });

  it("a static in the graveyard works where the card says so (zone: graveyard)", () => {
    const t = game();
    const bear = t.give("p1", "Bear Cub", "battlefield");
    t.give("p1", "Graveyard Bard", "graveyard");
    t.give("p2", "Graveyard Bard", "hand");
    expect(view(t, bear)).toMatchObject({ power: 3, toughness: 3 });
  });
});

describe("layers: types, colors and abilities of whole classes", () => {
  it("Mycosynth Lattice: permanents are artifacts in addition, everything is colorless", () => {
    const t = game();
    const dragon = t.give("p1", "Ancient Copper Dragon", "battlefield");
    const inHand = t.give("p2", "Twinflame Tyrant", "hand");
    expect(view(t, inHand).colors.length).toBeGreaterThan(0);
    t.give("p1", "Mycosynth Lattice", "battlefield");
    const c = view(t, dragon);
    expect(c.types).toEqual(expect.arrayContaining(["creature", "artifact"]));
    expect(c.colors).toEqual([]);
    expect(view(t, inHand).colors).toEqual([]);
  });

  it("Urborg: every land is a Swamp and taps for {B} (the Plains pays the black in a real cast)", () => {
    const t = game();
    t.give("p1", "Urborg, Tomb of Yawgmoth", "battlefield");
    const plains = t.lands("p1", "Plains", 2);
    expect(view(t, plains[0]).subtypes).toEqual(expect.arrayContaining(["Plains", "Swamp"]));
    const rot = t.give("p1", "Mind Rot", "hand");
    t.give("p2", "Island", "hand");
    const res = t.do({ type: "castSpell", player: "p1", cardId: rot, targets: { t1: ["p2"] } });
    expect(res.error).toBeUndefined();
  });
});

describe("restrictions, land drops, cost changes", () => {
  it("'can't block' (Carrion Feeder) is readable by combat checks; others can block", () => {
    const t = game();
    const feeder = t.give("p1", "Carrion Feeder", "battlefield");
    const bear = t.give("p1", "Bear Cub", "battlefield");
    const r = runOf(t.state);
    expect(canBlock(r, feeder)).toBe(false);
    expect(canBlock(r, bear)).toBe(true);
    expect(canAttack(r, feeder)).toBe(true);
  });

  it("extraLandDrops: a second land can be played only with the static in play", () => {
    const t = game();
    const l1 = t.give("p1", "Forest", "hand"), l2 = t.give("p1", "Forest", "hand");
    t.ok({ type: "playLand", player: "p1", cardId: l1 });
    expect(t.do({ type: "playLand", player: "p1", cardId: l2 }).error?.code).toBe("land_limit");
    t.give("p1", "Explorer", "battlefield");
    t.ok({ type: "playLand", player: "p1", cardId: l2 });
  });

  it("cost modification: Inquisitive Glimmer makes enchantment spells you cast cost {1} less (real cast)", () => {
    const t = game();
    t.give("p1", "Inquisitive Glimmer", "battlefield");
    t.give("p1", "Island", "battlefield");                            // {1}{U} -> {U}
    const dragon = t.give("p2", "Ancient Copper Dragon", "battlefield");
    const aura = t.give("p1", "Utter Insignificance", "hand");
    cast(t, "p1", aura, { t1: [dragon] });
    expect(t.state.stack).toHaveLength(1);
    const t2 = game();
    t2.give("p1", "Island", "battlefield");
    const dragon2 = t2.give("p2", "Ancient Copper Dragon", "battlefield");
    const aura2 = t2.give("p1", "Utter Insignificance", "hand");
    expect(t2.do({ type: "castSpell", player: "p1", cardId: aura2, targets: { t1: [dragon2] } }).error?.code).toBe("cannot_pay");
  });

  it("affinity (the spell's own costReduction): Thought Monitor costs {1} less per artifact you control", () => {
    const t = game();
    t.give("p1", "Sol Ring", "battlefield"); t.give("p1", "Mind-Stone", "battlefield"); t.give("p2", "Sol Ring", "battlefield");
    const mon = t.give("p1", "Thought Monitor", "hand");
    expect(spellCostDelta(runOf(t.state), "p1", mon)).toBe(-2);
  });
});

describe("determinism and purity of the layer system", () => {
  it("chars() does not mutate the state and gives the same answer twice", () => {
    const t = game();
    t.give("p1", "Bear Cub", "battlefield");
    t.give("p1", "Glorious Anthem", "battlefield");
    const snap = JSON.stringify(t.state);
    const id = t.state.battlefield[0];
    expect(view(t, id)).toEqual(view(t, id));
    expect(JSON.stringify(t.state)).toBe(snap);
    expect(defs("Bear Cub")).toBeDefined();
  });
});
