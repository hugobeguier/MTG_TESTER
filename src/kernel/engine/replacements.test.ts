import { describe, expect, it } from "vitest";
import { chars } from "./core";
import { dealDamage } from "./steps";
import { game, runOf } from "./testcards";
import type { Table } from "./testcards";
import type { GameState, ObjId } from "./types";

const cast = (t: Table, who: string, id: ObjId, extra: { targets?: Record<string, string[]>; x?: number } = {}) => t.ok({ type: "castSpell", player: who, cardId: id, ...extra });
const finish = (t: Table) => { for (let i = 0; i < 10 && t.state.stack.length && !t.state.pending; i++) t.resolveTop(); };
const BASICS = ["Island", "Plains", "Swamp", "Mountain", "Forest"];
const names = (t: Table, owner = "p1") => t.state.battlefield.map((id) => t.obj(id)).filter((o) => o.controller === owner && !BASICS.includes(o.cardName)).map((o) => o.cardName).sort();
const life = (t: Table, p: string) => t.p(p).life;
const view = (t: Table, id: ObjId) => chars(runOf(t.state), id);

describe("would_enter", () => {
  it("a drafted enters-tapped land (Arcane Sanctum) enters tapped, a basic enters untapped", () => {
    const t = game();
    const sanctum = t.give("p1", "Arcane Sanctum", "hand");
    t.ok({ type: "playLand", player: "p1", cardId: sanctum });
    expect(t.obj(sanctum).tapped).toBe(true);
    const t2 = game();
    const forest = t2.give("p1", "Forest", "hand");
    t2.ok({ type: "playLand", player: "p1", cardId: forest });
    expect(t2.obj(forest).tapped).toBe(false);
  });

  it("two enters-tapped effects (the land's own + Frozen Lands) give the same result in any order: no question", () => {
    const t = game();
    t.give("p2", "Frozen Lands", "battlefield");
    const sanctum = t.give("p1", "Arcane Sanctum", "hand");
    const res = t.ok({ type: "playLand", player: "p1", cardId: sanctum });
    expect(res.pending).toBeUndefined();
    expect(t.obj(sanctum).tapped).toBe(true);
  });

  it("'enters with additional counters': Dragonstorm Globe adds a +1/+1 counter to a Dragon (and not to a non-Dragon)", () => {
    const t = game();
    t.give("p1", "Dragonstorm Globe", "battlefield");
    t.lands("p1", "Mountain", 4);
    const whelp = t.give("p1", "Whelp", "hand");
    cast(t, "p1", whelp); finish(t);
    expect(t.obj(whelp).counters["+1/+1"]).toBe(1);
    expect(view(t, whelp)).toMatchObject({ power: 3, toughness: 3 });
    t.lands("p1", "Forest", 2);
    const bear = t.give("p1", "Bear Cub", "hand");
    cast(t, "p1", bear); finish(t);
    expect(t.obj(bear).counters["+1/+1"]).toBeUndefined();
  });

  it("'enters with X +1/+1 counters' (Shivan Devastator) reads the X it was cast with", () => {
    const t = game();
    t.lands("p1", "Mountain", 4);
    const hydra = t.give("p1", "Shivan Devastator", "hand");
    cast(t, "p1", hydra, { x: 3 }); finish(t);
    expect(t.obj(hydra).zone).toBe("battlefield");
    expect(t.obj(hydra).counters["+1/+1"]).toBe(3);
    expect(view(t, hydra)).toMatchObject({ power: 3, toughness: 3 });
  });
});

describe("would_create_token", () => {
  const withVisitor = () => {
    const t = game();
    t.give("p1", "Draconic Visitor", "battlefield");
    t.lands("p1", "Mountain", 3);
    t.lands("p2", "Mountain", 3);
    return t;
  };

  it("Draconic Visitor turns an artifact token (Treasure) into a 5/5 flying Dragon, for its controller only", () => {
    const t = withVisitor();
    const maker = t.give("p1", "Treasure Maker", "hand");
    cast(t, "p1", maker); finish(t);
    expect(names(t)).toEqual(["Dragon", "Draconic Visitor"].sort());
    const dragon = t.state.battlefield.find((id) => t.obj(id).token?.name === "Dragon")!;
    expect(view(t, dragon)).toMatchObject({ power: 5, toughness: 5, colors: ["red"] });
    expect(view(t, dragon).keywords).toContain("flying");
    expect(view(t, dragon).types).toContain("creature");
    expect(view(t, dragon).types).not.toContain("artifact");
    // the opponent's Treasure is untouched
    const theirs = t.give("p2", "Treasure Maker", "hand");
    t.state = { ...t.state, priority: "p2", passes: [] };
    cast(t, "p2", theirs); finish(t);
    expect(names(t, "p2")).toEqual(["Treasure"]);
  });

  it("a nonartifact token that Mycosynth Lattice makes an artifact is NOT replaced (judged on the token's own characteristics)", () => {
    const t = withVisitor();
    t.give("p2", "Mycosynth Lattice", "battlefield");
    const goblin = t.give("p1", "Goblin Maker", "hand");
    cast(t, "p1", goblin); finish(t);
    const tok = t.state.battlefield.find((id) => t.obj(id).token?.name === "Goblin")!;
    expect(tok).toBeDefined();
    expect(view(t, tok).types).toEqual(expect.arrayContaining(["creature", "artifact"]));   // an artifact now, thanks to Lattice
    expect(names(t)).not.toContain("Dragon");
    // ... but a Treasure (artifact by its own definition) still is replaced
    const maker = t.give("p1", "Treasure Maker", "hand");
    cast(t, "p1", maker); finish(t);
    expect(names(t)).toContain("Dragon");
    expect(names(t)).not.toContain("Treasure");
  });

  it("a doubler (modify count) multiplies the tokens", () => {
    const t = game();
    t.give("p1", "Doubling Season", "battlefield");
    t.lands("p1", "Mountain", 2);
    cast(t, "p1", t.give("p1", "Goblin Maker", "hand")); finish(t);
    expect(names(t).filter((n) => n === "Goblin")).toHaveLength(2);
  });

  describe("Chatterfang + Academy Manufactor: the order matters, so the affected player chooses", () => {
    const setup = () => {
      const t = game();
      const chatter = t.give("p1", "Chatterfang, Squirrel General", "battlefield");
      const manu = t.give("p1", "Academy Manufactor", "battlefield");
      t.lands("p1", "Mountain", 2);
      const maker = t.give("p1", "Treasure Maker", "hand");
      cast(t, "p1", maker);
      const res = t.resolveTop();
      return { t, chatter, manu, res };
    };
    const tokens = (t: Table) => t.state.battlefield.map((id) => t.obj(id)).filter((o) => o.token).map((o) => o.token!.name).sort();

    it("asks the token's controller with a prompt and one option per effect; nothing is created before the answer", () => {
      const { t, chatter, manu, res } = setup();
      expect(res.pending).toMatchObject({ kind: "order_replacements", player: "p1", min: 1, max: 1 });
      expect(res.pending!.options.map((o) => o.id).sort()).toEqual([`${chatter}:a2`, `${manu}:a1`].sort());
      expect(res.pending!.options[0].label).toMatch(/Chatterfang|Academy Manufactor/);
      expect(res.pending!.prompt.title).toMatch(/order/i);
      expect(tokens(t)).toEqual([]);
      expect(t.state.stack).toHaveLength(1); // still on the stack: the answer re-runs the resolution
      // wrong player / bad option are rejected and leave the question open
      expect(t.do({ type: "answerDecision", player: "p2", decisionId: res.pending!.id, choice: { ids: [`${chatter}:a2`] } }).error?.code).toBe("not_your_decision");
      expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["#999:a1"] } }).error?.code).toBe("invalid_choice");
      expect(t.state.pending?.id).toBe(res.pending!.id);
    });

    it("Chatterfang first: Treasure + Squirrel, then Manufactor turns the Treasure into Clue, Food, Treasure = 4 tokens", () => {
      const { t, chatter, res } = setup();
      const done = t.answer(res, { ids: [`${chatter}:a2`] });
      expect(done.pending).toBeUndefined();
      expect(tokens(t)).toEqual(["Clue", "Food", "Squirrel", "Treasure"]);
      expect(t.state.stack).toHaveLength(0);
      expect(done.events.filter((e) => e.type === "token_created")).toHaveLength(4);
    });

    it("Manufactor first: Clue, Food, Treasure, then Chatterfang adds one Squirrel per token = 6 tokens", () => {
      const { t, manu, res } = setup();
      t.answer(res, { ids: [`${manu}:a1`] });
      expect(tokens(t)).toEqual(["Clue", "Food", "Squirrel", "Squirrel", "Squirrel", "Treasure"]);
    });

    it("is deterministic: the same game and answers give identical states, and a failed attempt leaves the input untouched", () => {
      const run = () => {
        const { t, chatter, res } = setup();
        const before = JSON.stringify(t.state);
        t.answer(res, { ids: [`${chatter}:a2`] });
        return { final: JSON.stringify(t.state), before };
      };
      const a = run(), b = run();
      expect(a.final).toBe(b.final);
      const { t, res } = setup();
      const snap = JSON.stringify(t.state);
      t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["nope"] } });
      expect(JSON.stringify(t.state)).toBe(snap);
    });

    it("the created tokens carry their predefined abilities: a Treasure taps and sacrifices for mana", () => {
      const { t, chatter, res } = setup();
      t.answer(res, { ids: [`${chatter}:a2`] });
      const treasure = t.state.battlefield.find((id) => t.obj(id).token?.name === "Treasure")!;
      const before = t.p("p1").manaPool;
      expect(Object.values(before).reduce((a, b) => a + b, 0)).toBe(0);
      t.ok({ type: "activateAbility", player: "p1", sourceId: treasure, abilityId: "t:treasure", color: "G" });
      expect(t.p("p1").manaPool.G).toBe(1);
      expect(t.state.objects[treasure]).toBeUndefined(); // sacrificed: the token ceased to exist
    });
  });
});

describe("would_draw / would_gain_life / would_lose_life / discard", () => {
  it("'if you would draw, instead gain 2 life' replaces both cards of Study: no cards, +4 life", () => {
    const t = game();
    t.give("p1", "Spirit Ward", "battlefield");
    for (let i = 0; i < 3; i++) t.give("p1", "Plains", "library");
    t.give("p1", "Island", "battlefield");
    const study = t.give("p1", "Study", "hand");
    cast(t, "p1", study); finish(t);
    expect(t.p("p1").hand).toEqual([]);
    expect(t.p("p1").library).toHaveLength(3);
    expect(life(t, "p1")).toBe(44);
  });

  it("a draw prevention stops the draw, and it is not a failed draw from an empty library", () => {
    const t = game();
    t.give("p2", "Draw Ban", "battlefield");
    t.give("p1", "Island", "battlefield");
    const study = t.give("p1", "Study", "hand");
    cast(t, "p1", study); finish(t);
    expect(t.p("p1").drewFromEmpty).toBe(false);
    expect(t.state.gameOver).toBeNull();
  });

  it("Angel of Vitality: 'you gain that much plus 1 instead' (the nested life gain does not re-apply it)", () => {
    const t = game();
    t.give("p1", "Angel of Vitality", "battlefield");
    t.give("p1", "Plains", "battlefield");
    const g = t.give("p1", "Gain3", "hand");
    cast(t, "p1", g); finish(t);
    expect(life(t, "p1")).toBe(44);
    expect(life(t, "p2")).toBe(40);
  });

  it("'players can't discard' prevents a discard spell", () => {
    const t = game();
    t.give("p1", "Trauma Ward", "battlefield");
    t.lands("p1", "Swamp", 3);
    const rot = t.give("p1", "Mind Rot", "hand");
    const c1 = t.give("p2", "Island", "hand"), c2 = t.give("p2", "Island", "hand"), c3 = t.give("p2", "Island", "hand");
    cast(t, "p1", rot, { targets: { t1: ["p2"] } }); finish(t);
    expect(t.p("p2").hand.sort()).toEqual([c1, c2, c3].sort());
  });
});

describe("would_deal_damage, would_die, would_add_counters", () => {
  it("Twinflame Tyrant doubles damage a source you control deals to an opponent (not to you)", () => {
    const t = game();
    t.give("p1", "Twinflame Tyrant", "battlefield");
    t.give("p1", "Mountain", "battlefield");
    cast(t, "p1", t.give("p1", "Lightning Bolt", "hand"), { targets: { t1: ["p2"] } }); finish(t);
    expect(life(t, "p2")).toBe(34);
    const t2 = game();
    t2.give("p2", "Twinflame Tyrant", "battlefield");
    t2.give("p1", "Mountain", "battlefield");
    cast(t2, "p1", t2.give("p1", "Lightning Bolt", "hand"), { targets: { t1: ["p2"] } }); finish(t2);
    expect(life(t2, "p2")).toBe(37);
  });

  it("Seraph of the Sword: combat damage to it is prevented, noncombat damage is not", () => {
    const t = game();
    const seraph = t.give("p1", "Seraph of the Sword", "battlefield");
    const r = runOf(t.state);
    dealDamage(r, undefined, undefined, seraph, 2, true);
    expect(r.s.objects[seraph].damage).toBe(0);
    dealDamage(r, undefined, undefined, seraph, 2, false);
    expect(r.s.objects[seraph].damage).toBe(2);
  });

  it("Kalitas: an opponent's nontoken creature that would die is exiled instead and you get a Zombie", () => {
    const t = game();
    t.give("p1", "Kalitas, Traitor of Ghet", "battlefield");
    const bear = t.give("p2", "Bear Cub", "battlefield");
    const mine = t.give("p1", "Bear Cub", "battlefield");
    t.give("p1", "Mountain", "battlefield");
    t.give("p1", "Mountain", "battlefield");
    cast(t, "p1", t.give("p1", "Lightning Bolt", "hand"), { targets: { t1: [bear] } }); finish(t);
    expect(t.obj(bear).zone).toBe("exile");
    expect(names(t)).toContain("Zombie");
    cast(t, "p1", t.give("p1", "Lightning Bolt", "hand"), { targets: { t1: [mine] } }); finish(t);
    expect(t.obj(mine).zone).toBe("graveyard");                 // my own creature dies normally
    expect(names(t).filter((n) => n === "Zombie")).toHaveLength(1);
  });

  it("a counter modifier (Hardened Scales style) makes 2 counters into 3", () => {
    const t = game();
    t.give("p1", "Hardened Scales", "battlefield");
    t.give("p1", "Forest", "battlefield");
    const bear = t.give("p1", "Bear Cub", "battlefield");
    cast(t, "p1", t.give("p1", "Grow", "hand"), { targets: { t1: [bear] } }); finish(t);
    expect(t.obj(bear).counters["+1/+1"]).toBe(3);
  });
});

describe("guards", () => {
  it("the loop guard still cuts off a mandatory trigger loop with replacement effects and statics in play", () => {
    const t = game({ config: { maxEventsPerPass: 400 } });
    t.give("p1", "Frozen Lands", "battlefield");
    t.give("p1", "Glorious Anthem", "battlefield");
    t.lands("p1", "Plains", 2);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Soldier Factory", "hand") });
    t.pass("p1");
    const res = t.do({ type: "passPriority", player: "p2", fastForward: true });
    expect(res.error?.code).toBe("loop_detected");
    expect(res.state.gameOver?.draw).toBe(true);
  });
});

// keep the type import used
export type { GameState };
