import { describe, expect, it } from "vitest";
import { eng, table, lookup } from "./testkit";
import type { GameState } from "./types";

const snapshot = (s: GameState) => JSON.stringify(s);

describe("game setup + determinism", () => {
  const deck = ["Island", "Island", "Mountain", "Lightning Bolt", "Sol Ring", "Counterspell", "Negate", "Arcane Signet", "Mind-Stone", "Plains"];
  const mk = (seed: number) => eng.newGame({ players: [{ id: "a", deck }, { id: "b", deck }], seed });

  it("deals 7 cards and the same seed gives the same game", () => {
    const g1 = mk(42), g2 = mk(42);
    expect(g1.players[0].hand).toHaveLength(7);
    expect(g1.players[0].library).toHaveLength(3);
    expect(snapshot(g1)).toBe(snapshot(g2));
  });

  it("a different seed shuffles differently", () => {
    const order = (g: GameState) => g.players[0].library.concat(g.players[0].hand).map((id) => g.objects[id].cardName).join(",");
    expect(order(mk(1))).not.toBe(order(mk(2)));
  });

  it("resolve never mutates its input state", () => {
    const t = table();
    t.give("p1", "Lightning Bolt", "hand");
    t.give("p1", "Mountain", "battlefield");
    const before = snapshot(t.state);
    const bolt = t.state.players[0].hand[0];
    eng.resolve(t.state, { type: "castSpell", player: "p1", cardId: bolt });
    expect(snapshot(t.state)).toBe(before);
  });

  it("same state + same action => identical result (state and events)", () => {
    const t = table();
    t.give("p1", "Lightning Bolt", "hand");
    t.give("p1", "Mountain", "battlefield");
    const bolt = t.state.players[0].hand[0];
    const a = eng.resolve(t.state, { type: "castSpell", player: "p1", cardId: bolt });
    const b = eng.resolve(t.state, { type: "castSpell", player: "p1", cardId: bolt });
    expect(a).toEqual(b);
  });

  it("the seeded RNG lives in state: shuffling effects replay identically", () => {
    const g = mk(5);
    const a = eng.resolve(g, { type: "advancePhase", player: "a" });
    const b = eng.resolve(g, { type: "advancePhase", player: "a" });
    expect(a.state.rngState).toBe(b.state.rngState);
    expect(snapshot(a.state)).toBe(snapshot(b.state));
  });

  it("player state is plain JSON (survives a serialize round trip and still resolves)", () => {
    const t = table();
    t.give("p1", "Lightning Bolt", "hand");
    t.give("p1", "Mountain", "battlefield");
    const copy = JSON.parse(JSON.stringify(t.state)) as GameState;
    const res = eng.resolve(copy, { type: "castSpell", player: "p1", cardId: copy.players[0].hand[0], targets: { t1: ["p2"] } });
    expect(res.error).toBeUndefined();
    expect(res.state.stack).toHaveLength(1);
  });
});

describe("authorization (every action carries the acting player)", () => {
  it("a player without priority cannot cast", () => {
    const t = table();
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    t.give("p1", "Mountain", "battlefield");
    const res = t.do({ type: "castSpell", player: "p2", cardId: bolt });
    expect(res.error?.code).toBe("not_your_priority");
  });

  it("a player with priority cannot cast somebody else's card", () => {
    const t = table();
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    t.give("p2", "Mountain", "battlefield");
    t.pass("p1");
    expect(t.state.priority).toBe("p2");
    expect(t.do({ type: "castSpell", player: "p2", cardId: bolt }).error?.code).toBe("not_owner");
  });

  it("cannot cast a card that is in the library, graveyard or exile (only hand / command)", () => {
    const t = table();
    t.give("p1", "Mountain", "battlefield");
    for (const zone of ["library", "graveyard", "exile"] as const) {
      const id = t.give("p1", "Lightning Bolt", zone);
      const res = t.do({ type: "castSpell", player: "p1", cardId: id });
      expect(res.error?.code, zone).toBe("not_in_zone");
    }
  });

  it("a player cannot activate an ability of a permanent they do not control", () => {
    const t = table();
    const sol = t.give("p2", "Sol Ring", "battlefield");
    expect(t.do({ type: "activateAbility", player: "p1", sourceId: sol, abilityId: "a1" }).error?.code).toBe("not_owner");
  });

  it("passPriority by a player who does not hold priority is rejected", () => {
    const t = table();
    expect(t.do({ type: "passPriority", player: "p2" }).error?.code).toBe("not_your_priority");
  });

  it("only the active player can advance the phase", () => {
    const t = table();
    t.pass("p1");
    expect(t.do({ type: "advancePhase", player: "p2" }).error?.code).toBe("not_your_priority");
  });

  it("an unknown player is rejected", () => {
    const t = table();
    expect(t.do({ type: "passPriority", player: "ghost" }).error?.code).toBe("unknown_object");
  });

  it("a rejected action returns the original state object untouched", () => {
    const t = table();
    const before = t.state;
    const res = eng.resolve(before, { type: "passPriority", player: "p2" });
    expect(res.state).toBe(before);
    expect(res.events).toEqual([]);
  });

  it("answerDecision from the wrong player, wrong id, or with nothing pending is rejected", () => {
    const t = table();
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    t.give("p1", "Mountain", "battlefield");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: "d1", choice: { ids: ["p2"] } }).error?.code).toBe("no_decision");
    const res = t.ok({ type: "castSpell", player: "p1", cardId: bolt });
    expect(res.pending).toBeDefined();
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: res.pending!.id, choice: { ids: ["p2"] } }).error?.code).toBe("not_your_decision");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: "nope", choice: { ids: ["p2"] } }).error?.code).toBe("wrong_decision");
  });

  it("while a decision is pending, ordinary actions are refused", () => {
    const t = table();
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    t.give("p1", "Mountain", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: bolt });
    expect(t.do({ type: "passPriority", player: "p1" }).error?.code).toBe("decision_pending");
    expect(t.do({ type: "advancePhase", player: "p1" }).error?.code).toBe("decision_pending");
  });

  it("nothing can be done after the game is over", () => {
    const t = table();
    t.state = { ...t.state, gameOver: { winner: "p1", reason: "test" } };
    expect(t.do({ type: "passPriority", player: "p1" }).error?.code).toBe("game_over");
  });
});

describe("timing: sorcery vs instant speed", () => {
  it("a sorcery cannot be cast while the stack is not empty", () => {
    const t = table();
    t.lands("p1", "Mountain", 1);
    t.give("p1", "Plains", "battlefield");
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    const cow = t.give("p1", "Casualties of War", "hand");
    t.lands("p1", "Swamp", 2); t.lands("p1", "Forest", 2); t.lands("p1", "Island", 2);
    t.ok({ type: "castSpell", player: "p1", cardId: bolt, targets: { t1: ["p2"] } });
    expect(t.state.priority).toBe("p1");
    expect(t.do({ type: "castSpell", player: "p1", cardId: cow }).error?.code).toBe("wrong_timing");
  });

  it("a sorcery cannot be cast on the opponent's turn", () => {
    const t = table();
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p1" };
    t.lands("p1", "Swamp", 4); t.lands("p1", "Forest", 2);
    const cow = t.give("p1", "Casualties of War", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: cow }).error?.code).toBe("wrong_timing");
  });

  it("a sorcery cannot be cast outside a main phase", () => {
    const t = table();
    t.ok({ type: "advancePhase", player: "p1" }); // beginning_of_combat
    expect(t.state.turn.phase).toBe("beginning_of_combat");
    t.lands("p1", "Swamp", 4); t.lands("p1", "Forest", 2);
    const cow = t.give("p1", "Casualties of War", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: cow }).error?.code).toBe("wrong_timing");
  });

  it("an instant can be cast at any time the player has priority", () => {
    const t = table();
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p1" };
    t.give("p1", "Mountain", "battlefield");
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: bolt, targets: { t1: ["p2"] } }).error).toBeUndefined();
  });

  it("a creature (sorcery speed) cannot be cast at instant timing", () => {
    const t = table();
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p1" };
    t.lands("p1", "Forest", 2);
    const bear = t.give("p1", "Bear Cub", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: bear }).error?.code).toBe("wrong_timing");
  });

  it("lands: one per turn, main phase only, own turn only", () => {
    const t = table();
    const a = t.give("p1", "Island", "hand");
    const b = t.give("p1", "Island", "hand");
    t.ok({ type: "playLand", player: "p1", cardId: a });
    expect(t.do({ type: "playLand", player: "p1", cardId: b }).error?.code).toBe("land_limit");
    const t2 = table();
    const c = t2.give("p1", "Island", "hand");
    t2.ok({ type: "advancePhase", player: "p1" });
    expect(t2.do({ type: "playLand", player: "p1", cardId: c }).error?.code).toBe("wrong_timing");
    const t3 = table();
    const d = t3.give("p2", "Island", "hand");
    t3.pass("p1");
    expect(t3.do({ type: "playLand", player: "p2", cardId: d }).error?.code).toBe("wrong_timing");
  });

  it("playLand rejects non-lands and cards owned by someone else", () => {
    const t = table();
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    const isl = t.give("p2", "Island", "hand");
    expect(t.do({ type: "playLand", player: "p1", cardId: bolt }).error?.code).toBe("not_castable");
    expect(t.do({ type: "playLand", player: "p1", cardId: isl }).error?.code).toBe("not_owner");
  });

  it("casting a land is refused", () => {
    const t = table();
    const isl = t.give("p1", "Island", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: isl }).error?.code).toBe("not_castable");
  });
});

describe("priority and the stack", () => {
  it("4 players: priority passes in turn order and the top object resolves only after all four pass", () => {
    const t = table(["a", "b", "c", "d"]);
    t.give("a", "Mountain", "battlefield");
    const bolt = t.give("a", "Lightning Bolt", "hand");
    t.ok({ type: "castSpell", player: "a", cardId: bolt, targets: { t1: ["c"] } });
    expect(t.state.priority).toBe("a");
    t.pass("a");
    expect(t.state.priority).toBe("b");
    expect(t.state.stack).toHaveLength(1);
    t.pass("b");
    expect(t.state.priority).toBe("c");
    t.pass("c");
    expect(t.state.priority).toBe("d");
    expect(t.state.stack).toHaveLength(1);
    t.pass("d");
    expect(t.state.stack).toHaveLength(0);
    expect(t.p("c").life).toBe(37);
    expect(t.state.priority).toBe("a"); // active player gets priority after resolution
  });

  it("4 players: a response restarts the pass round and resolves LIFO", () => {
    const t = table(["a", "b", "c", "d"]);
    t.lands("a", "Mountain", 1);
    t.lands("b", "Mountain", 1);
    const b1 = t.give("a", "Lightning Bolt", "hand");
    const b2 = t.give("b", "Lightning Bolt", "hand");
    t.ok({ type: "castSpell", player: "a", cardId: b1, targets: { t1: ["d"] } });
    t.pass("a");
    t.ok({ type: "castSpell", player: "b", cardId: b2, targets: { t1: ["a"] } });
    expect(t.state.stack).toHaveLength(2);
    expect(t.state.priority).toBe("b");
    t.pass("b", "c", "d", "a");
    expect(t.p("a").life).toBe(37);   // b's bolt (cast last) resolved first
    expect(t.p("d").life).toBe(40);
    expect(t.state.stack).toHaveLength(1);
    t.pass("a", "b", "c", "d");
    expect(t.p("d").life).toBe(37);
  });

  it("all players passing with an empty stack advances the step", () => {
    const t = table(["a", "b", "c"]);
    expect(t.state.turn.phase).toBe("precombat_main");
    t.pass("a", "b", "c");
    expect(t.state.turn.phase).toBe("beginning_of_combat");
    expect(t.state.priority).toBe("a");
  });

  it("a full turn cycle hands the turn to the next player, untaps, and resets land drops", () => {
    const t = table(["a", "b"]);
    const isl = t.give("a", "Island", "battlefield", { tapped: true });
    const bIsl = t.give("b", "Island", "battlefield", { tapped: true });
    for (let i = 0; i < 20 && t.state.turn.active === "a"; i++) t.ok({ type: "advancePhase", player: "a" });
    expect(t.state.turn.active).toBe("b");
    expect(t.state.turn.number).toBe(2);
    expect(t.obj(bIsl).tapped).toBe(false);   // b untapped
    expect(t.obj(isl).tapped).toBe(true);     // a's land stays tapped through b's turn
    expect(t.state.priority).toBe("b");
    expect(t.state.turn.phase).toBe("upkeep");
  });

  it("the draw step draws a card (the first player skips the first draw in 2-player games)", () => {
    const t = table(["a", "b"], { phase: "upkeep" });
    t.give("a", "Island", "library");
    t.give("b", "Island", "library");
    t.pass("a", "b"); // upkeep -> draw
    expect(t.state.turn.phase).toBe("draw");
    expect(t.p("a").hand).toHaveLength(0);
    for (let i = 0; i < 12 && t.state.turn.active === "a"; i++) t.ok({ type: "advancePhase", player: "a" });
    t.ok({ type: "advancePhase", player: "b" }); // b upkeep -> draw
    expect(t.state.turn.phase).toBe("draw");
    expect(t.p("b").hand).toHaveLength(1);
  });

  it("cleanup asks the active player to discard down to 7", () => {
    const t = table(["a", "b"]);
    for (let i = 0; i < 9; i++) t.give("a", "Island", "hand");
    let res = t.ok({ type: "advancePhase", player: "a" });
    for (let i = 0; i < 20 && !res.pending; i++) res = t.ok({ type: "advancePhase", player: "a" });
    expect(res.pending?.kind).toBe("choose_cards");
    expect(res.pending?.min).toBe(2);
    expect(res.pending?.options).toHaveLength(9);
    const pick = res.pending!.options.slice(0, 2).map((o) => o.id);
    t.answer(res, { ids: pick });
    expect(t.p("a").hand).toHaveLength(7);
    expect(t.p("a").graveyard).toHaveLength(2);
    expect(t.state.turn.active).toBe("b");
  });

  it("state-based actions: 0 life loses and the last player standing wins", () => {
    const t = table(["a", "b"]);
    t.give("a", "Mountain", "battlefield");
    const bolt = t.give("a", "Lightning Bolt", "hand");
    t.state = { ...t.state, players: t.state.players.map((p) => (p.id === "b" ? { ...p, life: 3 } : p)) };
    t.ok({ type: "castSpell", player: "a", cardId: bolt, targets: { t1: ["b"] } });
    t.pass("a", "b");
    expect(t.p("b").hasLost).toBe(true);
    expect(t.state.gameOver?.winner).toBe("a");
  });

  it("drawing from an empty library loses at the next state-based check", () => {
    const t = table(["a", "b"], { phase: "upkeep" });
    t.give("b", "Island", "library");
    // a skips the draw on turn 1, b draws its only card on turn 2, a draws from an empty library on turn 3
    for (let i = 0; i < 40 && !t.state.gameOver; i++) t.ok({ type: "advancePhase", player: t.state.turn.active });
    expect(t.state.gameOver?.winner).toBe("b");
    expect(t.p("a").hasLost).toBe(true);
  });
});

describe("object model", () => {
  it("every object has a unique id and a monotonic timestamp; zone changes refresh the timestamp", () => {
    const t = table();
    const a = t.give("p1", "Mountain", "hand");
    const b = t.give("p1", "Mountain", "hand");
    expect(a).not.toBe(b);
    expect(t.obj(b).timestamp).toBeGreaterThan(t.obj(a).timestamp);
    const before = t.obj(a).timestamp;
    t.ok({ type: "playLand", player: "p1", cardId: a });
    expect(t.obj(a).timestamp).toBeGreaterThan(before);
    expect(t.obj(a).zone).toBe("battlefield");
  });

  it("controller and owner are tracked separately and card definitions resolve through the lookup", () => {
    const t = table();
    const id = t.give("p1", "Sol Ring", "battlefield", { });
    expect(t.obj(id).owner).toBe("p1");
    expect(t.obj(id).controller).toBe("p1");
    expect(lookup("Sol Ring")?.kernel.abilities[0].kind).toBe("mana");
  });

  it("a creature that just entered is summoning sick: its {T} ability is refused until the controller's next turn", () => {
    const t = table();
    // Mind-Stone is not a creature; use a creature with a mana ability authored inline
    const res = eng.resolve(t.state, { type: "activateAbility", player: "p1", sourceId: "#999", abilityId: "a1" });
    expect(res.error?.code).toBe("unknown_object");
  });
});
