import { describe, expect, it } from "vitest";
import { table, type Table } from "./testkit";
import type { Action, StackItem } from "./types";

const cast = (t: Table, who: string, id: string, extra: Partial<Extract<Action, { type: "castSpell" }>> = {}) => t.ok({ type: "castSpell", player: who, cardId: id, ...extra });
const stackControllers = (t: Table): string[] => t.state.stack.map((i: StackItem) => i.controller);

describe("Ledger Shredder: cast trigger + connive", () => {
  const setup = () => {
    const t = table();
    const shredder = t.give("p1", "Ledger Shredder", "battlefield");
    t.lands("p1", "Island", 3);
    const peek1 = t.give("p1", "Curious Peek", "hand");
    const peek2 = t.give("p1", "Curious Peek", "hand");
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    const land = t.give("p1", "Mountain", "hand");
    return { t, shredder, peek1, peek2, bolt, land };
  };

  it("the first spell each turn does not trigger; the second does and goes on top of the stack", () => {
    const { t, peek1, peek2 } = setup();
    cast(t, "p1", peek1);
    expect(t.state.stack).toHaveLength(1);
    cast(t, "p1", peek2);
    // stack: peek1, peek2, trigger (top)
    expect(t.state.stack.map((i) => i.kind)).toEqual(["spell", "spell", "triggered"]);
  });

  it("the discard prompt excludes the spell that is on the stack and only lists cards in hand", () => {
    const { t, shredder, peek1, peek2, bolt, land } = setup();
    for (let i = 0; i < 3; i++) t.give("p1", "Plains", "library");
    cast(t, "p1", peek1);
    cast(t, "p1", peek2);
    // resolve the connive trigger: draw, then discard
    const res = t.pass("p1", "p2");
    expect(res.pending?.kind).toBe("choose_cards");
    expect(res.pending?.player).toBe("p1");
    const ids = res.pending!.options.map((o) => o.id);
    expect(ids).not.toContain(peek2); // the second spell is on the stack
    expect(ids).not.toContain(peek1); // so is the first
    expect(ids).toContain(bolt);
    expect(ids).toContain(land);
    expect(ids).toHaveLength(3); // bolt, land and the card just drawn
    for (const id of ids) expect(t.state.players[0].hand).toContain(id);
    expect(res.pending!.prompt.title).toBe("Ledger Shredder: connive");
    expect(t.obj(shredder).counters["+1/+1"]).toBeUndefined();
  });

  it("discarding a nonland card puts a +1/+1 counter on the Shredder", () => {
    const { t, shredder, peek1, peek2, bolt } = setup();
    t.give("p1", "Plains", "library");
    cast(t, "p1", peek1); cast(t, "p1", peek2);
    const res = t.pass("p1", "p2");
    t.answer(res, { ids: [bolt] });
    expect(t.obj(shredder).counters["+1/+1"]).toBe(1);
    expect(t.obj(bolt).zone).toBe("graveyard");
  });

  it("discarding a land gives no counter", () => {
    const { t, shredder, peek1, peek2, land } = setup();
    t.give("p1", "Plains", "library");
    cast(t, "p1", peek1); cast(t, "p1", peek2);
    const res = t.pass("p1", "p2");
    t.answer(res, { ids: [land] });
    expect(t.obj(shredder).counters["+1/+1"]).toBeUndefined();
  });

  it("a card on the stack or in the graveyard can never be chosen, even by id", () => {
    const { t, peek1, peek2 } = setup();
    t.give("p1", "Plains", "library");
    cast(t, "p1", peek1); cast(t, "p1", peek2);
    const res = t.pass("p1", "p2");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [peek2] } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["#9999"] } }).error?.code).toBe("invalid_choice");
  });

  it("each player's second spell triggers it (an opponent's second spell too), and its controller connives", () => {
    const { t, shredder } = setup();
    t.lands("p2", "Island", 2);
    const a = t.give("p2", "Curious Peek", "hand");
    const b = t.give("p2", "Curious Peek", "hand");
    t.give("p1", "Plains", "library");
    t.pass("p1");
    cast(t, "p2", a);
    cast(t, "p2", b);
    const trig = t.state.stack[t.state.stack.length - 1];
    expect(trig.kind).toBe("triggered");
    expect(trig.controller).toBe("p1");
    expect(trig.sourceId).toBe(shredder);
  });

  it("two spells from different players do not count as 'their second spell'", () => {
    const { t, peek1 } = setup();
    t.lands("p2", "Island", 1);
    const b = t.give("p2", "Curious Peek", "hand");
    cast(t, "p1", peek1);
    t.pass("p1");
    cast(t, "p2", b);
    expect(t.state.stack.every((i) => i.kind === "spell")).toBe(true);
  });

  it("a new turn resets the count (the log is per turn)", () => {
    const { t, peek1 } = setup();
    cast(t, "p1", peek1);
    t.answer(t.pass("p1", "p2"), { yes: false }); // resolves; decline the may-draw
    for (let i = 0; i < 12 && t.state.turn.number === 1; i++) t.ok({ type: "advancePhase", player: "p1" });
    expect(t.state.turn.number).toBe(2);
    expect(t.state.turnLog.filter((e) => e.type === "cast")).toHaveLength(0);
  });
});

describe("Mazemind Tome (counters as costs, scry)", () => {
  it("{2},{T}, put a page counter: draw a card", () => {
    const t = table();
    const tome = t.give("p1", "Mazemind Tome", "battlefield");
    t.lands("p1", "Island", 2);
    t.give("p1", "Plains", "library");
    t.ok({ type: "activateAbility", player: "p1", sourceId: tome, abilityId: "a2" });
    expect(t.obj(tome).tapped).toBe(true);
    expect(t.obj(tome).counters.page).toBe(1);
    expect(t.state.stack).toHaveLength(1); // not a mana ability: uses the stack
    t.pass("p1", "p2");
    expect(t.p("p1").hand).toHaveLength(1);
  });

  it("scry 1: a pending decision over the top card of the library, can bottom it", () => {
    const t = table();
    const tome = t.give("p1", "Mazemind Tome", "battlefield");
    const top = t.give("p1", "Plains", "library");
    const second = t.give("p1", "Island", "library", { top: false });
    t.ok({ type: "activateAbility", player: "p1", sourceId: tome, abilityId: "a1" });
    const res = t.pass("p1", "p2");
    expect(res.pending).toMatchObject({ kind: "choose_cards", min: 0, max: 1 });
    expect(res.pending!.options.map((o) => o.id)).toEqual([top]);
    t.answer(res, { ids: [top] });
    expect(t.p("p1").library).toEqual([second, top]);
  });

  it("a tapped Tome cannot be activated (cost cannot be paid) and nothing changes", () => {
    const t = table();
    const tome = t.give("p1", "Mazemind Tome", "battlefield", { tapped: true });
    const before = t.state;
    const res = t.do({ type: "activateAbility", player: "p1", sourceId: tome, abilityId: "a1" });
    expect(res.error?.code).toBe("cannot_pay");
    expect(res.state).toBe(before);
  });

  it("casting Mazemind Tome is refused: its state trigger (a3) needs trigger:unspecified", () => {
    const t = table();
    t.lands("p1", "Island", 2);
    const tome = t.give("p1", "Mazemind Tome", "hand");
    const res = t.do({ type: "castSpell", player: "p1", cardId: tome });
    expect(res.error?.code).toBe("unsupported");
    expect(res.error?.capability).toContain("trigger:unspecified");
  });

  it("lenient mode lets it through but reports every ignored ability as an event (never silent)", () => {
    const t = table(["p1", "p2"], { config: { lenient: true } });
    t.lands("p1", "Island", 2);
    const tome = t.give("p1", "Mazemind Tome", "hand");
    const res = t.ok({ type: "castSpell", player: "p1", cardId: tome });
    const ignored = res.events.filter((e) => e.type === "unsupported_ignored");
    expect(ignored.length).toBeGreaterThan(0);
    expect(JSON.stringify(ignored)).toContain("trigger:unspecified");
  });
});

describe("ETB / dies triggers", () => {
  it("Ravenous Chupacabra: the ETB trigger asks for a target (opponent's creatures only) after the spell resolves", () => {
    const t = table();
    t.lands("p1", "Swamp", 4);
    const mine = t.give("p1", "Bear Cub", "battlefield");
    const theirs = t.give("p2", "Bear Cub", "battlefield");
    const chup = t.give("p1", "Ravenous Chupacabra", "hand");
    cast(t, "p1", chup);
    const res = t.pass("p1", "p2");
    expect(t.obj(chup).zone).toBe("battlefield");
    expect(res.pending?.kind).toBe("choose_targets");
    expect(res.pending?.player).toBe("p1");
    expect(res.pending!.options.map((o) => o.id)).toEqual([theirs]);
    expect(res.pending!.options.map((o) => o.id)).not.toContain(mine);
    expect(res.pending!.options.map((o) => o.id)).not.toContain(chup);
    t.answer(res, { ids: [theirs] });
    expect(t.state.stack).toHaveLength(1);
    expect(t.state.stack[0].kind).toBe("triggered");
    t.pass("p1", "p2");
    expect(t.obj(theirs).zone).toBe("graveyard");
  });

  it("with no legal target the trigger is removed from the game (no prompt)", () => {
    const t = table();
    t.lands("p1", "Swamp", 4);
    const chup = t.give("p1", "Ravenous Chupacabra", "hand");
    cast(t, "p1", chup);
    const res = t.pass("p1", "p2");
    expect(res.pending).toBeUndefined();
    expect(res.events.map((e) => e.type)).toContain("trigger_removed");
    expect(t.state.stack).toHaveLength(0);
  });

  it("trigger target legality is rechecked on resolution (target left: trigger fizzles)", () => {
    const t = table();
    t.lands("p1", "Swamp", 4);
    t.give("p2", "Plains", "battlefield");
    const theirs = t.give("p2", "Bear Cub", "battlefield");
    const swords = t.give("p2", "Swords to Plowshares", "hand");
    const chup = t.give("p1", "Ravenous Chupacabra", "hand");
    cast(t, "p1", chup);
    let res = t.pass("p1", "p2");
    res = t.answer(res, { ids: [theirs] });
    t.pass("p1");
    cast(t, "p2", swords, { targets: { t1: [theirs] } });
    t.pass("p2", "p1");
    const r2 = t.resolveTop();
    expect(r2.events.map((e) => e.type)).toContain("spell_fizzled");
  });

  it("Midnight Reaper: dies trigger for your nontoken creatures draws and costs 1 life; opponents' creatures do not trigger it", () => {
    const t = table();
    t.give("p1", "Midnight Reaper", "battlefield");
    const mine = t.give("p1", "Bear Cub", "battlefield");
    const theirs = t.give("p2", "Bear Cub", "battlefield");
    t.give("p1", "Plains", "library");
    t.lands("p1", "Mountain", 2);
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    const bolt2 = t.give("p1", "Lightning Bolt", "hand");
    cast(t, "p1", bolt, { targets: { t1: [theirs] } });
    t.pass("p1", "p2");
    expect(t.obj(theirs).zone).toBe("graveyard");
    expect(t.state.stack).toHaveLength(0);
    cast(t, "p1", bolt2, { targets: { t1: [mine] } });
    t.pass("p1", "p2");
    expect(t.obj(mine).zone).toBe("graveyard");
    expect(t.state.stack).toHaveLength(1);
    expect(t.state.stack[0].kind).toBe("triggered");
    t.pass("p1", "p2");
    expect(t.p("p1").life).toBe(39);
    expect(t.p("p1").hand).toHaveLength(1);
  });

  it("Plaguecrafter: each player sacrifices; a player with a choice is asked, with only their own creatures as options", () => {
    const t = table();
    t.lands("p1", "Swamp", 3);
    const a = t.give("p2", "Bear Cub", "battlefield");
    const b = t.give("p2", "Bear Cub", "battlefield");
    const pc = t.give("p1", "Plaguecrafter", "hand");
    cast(t, "p1", pc);
    let res = t.pass("p1", "p2");
    expect(res.pending).toBeUndefined();
    expect(t.state.stack[0].kind).toBe("triggered");
    res = t.pass("p1", "p2");
    expect(res.pending).toMatchObject({ kind: "choose_cards", player: "p2" });
    expect(res.pending!.options.map((o) => o.id).sort()).toEqual([a, b].sort());
    t.answer(res, { ids: [a] });
    expect(t.obj(a).zone).toBe("graveyard");
    expect(t.obj(pc).zone).toBe("graveyard"); // p1's only creature was Plaguecrafter itself
  });

  it("an ability on the stack still resolves after its source left the battlefield (Mind-Stone sacrifice)", () => {
    const t = table();
    const stone = t.give("p1", "Mind-Stone", "battlefield");
    t.give("p1", "Island", "battlefield");
    t.give("p1", "Plains", "library");
    t.ok({ type: "activateAbility", player: "p1", sourceId: stone, abilityId: "a2" });
    expect(t.obj(stone).zone).toBe("graveyard");
    t.pass("p1", "p2");
    expect(t.p("p1").hand).toHaveLength(1);
  });
});

describe("APNAP ordering of triggers", () => {
  const extra = undefined;
  void extra;

  it("triggers from several players go on the stack in turn order starting with the active player (so the last player's resolves first)", () => {
    const t = table(["a", "b", "c"]);
    for (const p of ["a", "b", "c"]) t.give(p, "Echo Watcher", "battlefield");
    t.lands("a", "Forest", 2);
    const cub = t.give("a", "Bear Cub", "hand");
    cast(t, "a", cub);
    t.pass("a", "b", "c");
    expect(t.obj(cub).zone).toBe("battlefield");
    expect(stackControllers(t)).toEqual(["a", "b", "c"]);
    t.pass("a", "b", "c"); // c's trigger resolves first
    expect(t.p("c").life).toBe(41);
    expect(t.state.stack.map((i) => i.controller)).toEqual(["a", "b"]);
  });

  it("when the non-active player is first in turn order the order rotates from the active player", () => {
    const t = table(["a", "b", "c"]);
    t.state = { ...t.state, turn: { ...t.state.turn, active: "b" }, priority: "b" };
    for (const p of ["a", "b", "c"]) t.give(p, "Echo Watcher", "battlefield");
    t.lands("b", "Forest", 2);
    const cub = t.give("b", "Bear Cub", "hand");
    cast(t, "b", cub);
    t.pass("b", "c", "a");
    expect(stackControllers(t)).toEqual(["b", "c", "a"]);
  });

  it("a player controlling several triggers gets an ordering decision; the first chosen goes on the stack first", () => {
    const t = table();
    const w1 = t.give("p1", "Echo Watcher", "battlefield");
    const w2 = t.give("p1", "Echo Watcher", "battlefield");
    t.give("p2", "Echo Watcher", "battlefield");
    t.lands("p1", "Forest", 2);
    const cub = t.give("p1", "Bear Cub", "hand");
    cast(t, "p1", cub);
    const res = t.pass("p1", "p2");
    expect(res.pending?.kind).toBe("order_triggers");
    expect(res.pending?.player).toBe("p1");
    expect(res.pending!.options).toHaveLength(2);
    const [first, second] = res.pending!.options.map((o) => o.id);
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [first, first] } }).error?.code).toBe("invalid_choice");
    const srcOf = Object.fromEntries(t.state.triggerQueue.map((q) => [q.id, q.sourceId]));
    t.answer(res, { ids: [second, first] });
    expect(t.state.pending).toBeNull();
    expect(t.state.stack.map((i) => i.controller)).toEqual(["p1", "p1", "p2"]);
    const placed = t.state.stack.slice(0, 2).map((i) => i.sourceId);
    expect(new Set(placed)).toEqual(new Set([w1, w2]));
    // the order the player chose is the placement order (first chosen = bottom)
    expect(placed).toEqual([srcOf[second], srcOf[first]]);
  });

  it("the active player gets priority after all triggers are placed", () => {
    const t = table(["a", "b"]);
    for (const p of ["a", "b"]) t.give(p, "Echo Watcher", "battlefield");
    t.lands("a", "Forest", 2);
    const cub = t.give("a", "Bear Cub", "hand");
    cast(t, "a", cub);
    t.pass("a", "b");
    expect(t.state.priority).toBe("a");
    expect(t.state.stack).toHaveLength(2);
  });
});

describe("summoning sickness and activated abilities", () => {
  it("a creature that just arrived cannot use a {T} ability; one that has been there can", () => {
    const t = table();
    const fresh = t.give("p1", "Llanowar Elves", "battlefield", { fresh: true });
    const old = t.give("p1", "Llanowar Elves", "battlefield");
    expect(t.do({ type: "activateAbility", player: "p1", sourceId: fresh, abilityId: "a1" }).error?.code).toBe("cannot_activate");
    t.ok({ type: "activateAbility", player: "p1", sourceId: old, abilityId: "a1" });
    expect(t.p("p1").manaPool.G).toBe(1);
  });

  it("summoning sickness wears off when its controller's next turn begins", () => {
    const t = table(["a", "b"]);
    const elf = t.give("a", "Llanowar Elves", "battlefield", { fresh: true });
    for (let i = 0; i < 4; i++) { t.give("a", "Island", "library"); t.give("b", "Island", "library"); }
    for (let i = 0; i < 40 && t.state.turn.number < 3; i++) t.ok({ type: "advancePhase", player: t.state.turn.active });
    expect(t.state.turn.active).toBe("a");
    t.ok({ type: "activateAbility", player: "a", sourceId: elf, abilityId: "a1" });
    expect(t.p("a").manaPool.G).toBe(1);
  });
});
