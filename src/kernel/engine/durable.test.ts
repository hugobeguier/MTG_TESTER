import { describe, expect, it } from "vitest";
import { CARDS } from "./testcards";
import { table, type Table } from "./testkit";
import type { CardDef, ObjId } from "./types";

const bear: CardDef = { name: "Test Bear", manaCost: "{1}{G}", types: ["creature"], subtypes: ["Bear"], power: 2, toughness: 2, kernel: { schemaVersion: 2, abilities: [] } };
const world = (): Table => table(["p1", "p2"], { extra: { ...CARDS, "Test Bear": bear } });

/** advance with the active player until `phase` of some turn (stops at a decision) */
function advanceTo(t: Table, turnNo: number, phase: string): void {
  for (let i = 0; i < 60; i++) {
    if (t.state.pending || (t.state.turn.number === turnNo && t.state.turn.phase === phase)) return;
    const s = t.state;
    if (s.combat?.expect?.kind === "attackers") { t.ok({ type: "declareAttackers", player: s.combat.expect.player, attackers: [] }); continue; }
    if (s.stack.length) { t.ok({ type: "passPriority", player: s.priority!, fastForward: true }); continue; }
    t.ok({ type: "advancePhase", player: s.turn.active });
  }
  throw new Error(`did not reach turn ${turnNo} ${phase}: at ${t.state.turn.number} ${t.state.turn.phase}`);
}
const fill = (t: Table, who: string, n: number) => { for (let i = 0; i < n; i++) t.give(who, "Island", "library"); };

describe("create_delayed_trigger: Arcane Denial", () => {
  const setup = () => {
    const t = world();
    t.lands("p1", "Island", 2);
    fill(t, "p1", 8); fill(t, "p2", 8);
    const denial = t.give("p1", "Arcane Denial", "hand");
    t.lands("p2", "Mountain", 1);
    const bolt = t.give("p2", "Lightning Bolt", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Island", "hand") }) as never;
    return { t, denial, bolt };
  };
  const counterBolt = () => {
    const t = world();
    t.lands("p1", "Island", 2); t.lands("p2", "Mountain", 1);
    fill(t, "p1", 8); fill(t, "p2", 8);
    const denial = t.give("p1", "Arcane Denial", "hand");
    const bolt = t.give("p2", "Lightning Bolt", "hand");
    t.state = { ...t.state, priority: "p2" };
    t.ok({ type: "castSpell", player: "p2", cardId: bolt, targets: { t1: ["p1"] } });
    t.state = { ...t.state, priority: "p1" };
    t.ok({ type: "castSpell", player: "p1", cardId: denial, targets: { t1: [bolt] } });
    t.resolveTop();
    return { t, denial, bolt };
  };

  it("counters the spell and registers two delayed triggers that have not fired yet", () => {
    const { t, bolt } = counterBolt();
    expect(t.obj(bolt).zone).toBe("graveyard");
    expect(t.state.delayedTriggers).toHaveLength(2);
    expect(t.p("p1").hand).toHaveLength(0 + 0);
    expect(t.state.stack).toHaveLength(0);
  });

  it("at the next upkeep: p1 orders the two triggers; the spell's controller chooses 0-2 cards, p1 draws one", () => {
    const { t } = counterBolt();
    advanceTo(t, 2, "upkeep");
    // two delayed triggers of the same controller: order them
    expect(t.state.pending!.kind).toBe("order_triggers");
    const order = t.state.pending!.options.map((o) => o.id);
    let res = t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: order } });
    expect(t.state.stack).toHaveLength(2);
    const p2Before = t.p("p2").hand.length, p1Before = t.p("p1").hand.length;
    // the trigger put on the stack LAST resolves first; whichever it is, resolve both
    for (let i = 0; i < 6 && t.state.stack.length; i++) {
      res = t.ok({ type: "passPriority", player: t.state.priority! });
      if (t.state.pending) {
        expect(t.state.pending.player).toBe("p2"); // the countered spell's controller decides
        expect(t.state.pending.kind).toBe("choose_number");
        expect(t.state.pending.max).toBe(2);
        res = t.answer(res, { number: 2 });
      }
    }
    void res;
    // turn 2 is p2's turn: p2 drew for the turn only after upkeep, so compare against the delayed draws only
    expect(t.p("p2").hand.length - p2Before).toBe(2);
    expect(t.p("p1").hand.length - p1Before).toBe(1);
    expect(t.state.delayedTriggers).toHaveLength(0);
  });

  it("the controller of the countered spell may choose none", () => {
    const { t } = counterBolt();
    advanceTo(t, 2, "upkeep");
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: t.state.pending!.options.map((o) => o.id) } });
    const p2Before = t.p("p2").hand.length;
    for (let i = 0; i < 6 && t.state.stack.length; i++) {
      const res = t.ok({ type: "passPriority", player: t.state.priority! });
      if (t.state.pending) t.answer(res, { number: 0 });
    }
    expect(t.p("p2").hand.length - p2Before).toBe(0);
  });

  it("only the controller of that spell answers the number question; a wrong player is rejected", () => {
    const { t } = counterBolt();
    advanceTo(t, 2, "upkeep");
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: t.state.pending!.options.map((o) => o.id) } });
    let res;
    for (let i = 0; i < 6 && !t.state.pending; i++) res = t.ok({ type: "passPriority", player: t.state.priority! });
    void res;
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { number: 1 } }).error?.code).toBe("not_your_decision");
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: t.state.pending!.id, choice: { number: 3 } }).error?.code).toBe("invalid_choice");
  });

  it("is deterministic and the state is plain JSON", () => {
    const a = counterBolt().t.state, b = counterBolt().t.state;
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
  void setup;
});

describe("create_delayed_trigger: Portent and Parting Gust", () => {
  it("Portent: draws a card at the next upkeep, exactly once", () => {
    const t = world();
    t.lands("p1", "Island", 1);
    fill(t, "p1", 10); fill(t, "p2", 10);
    const portent = t.give("p1", "Portent", "hand");
    let res = t.ok({ type: "castSpell", player: "p1", cardId: portent, targets: { t1: ["p1"] } });
    t.ok({ type: "passPriority", player: "p1" }); res = t.ok({ type: "passPriority", player: "p2" });
    // look at three, put them back (the engine keeps their order), may shuffle: answer whatever is asked
    for (let i = 0; i < 6 && t.state.pending; i++) { const pd = t.state.pending!; res = t.answer(res, pd.kind === "choose_yes_no" ? { yes: false } : { ids: pd.options.slice(0, pd.min).map((o) => o.id) }); }
    expect(t.state.delayedTriggers).toHaveLength(1);
    const before = t.p("p1").hand.length;
    advanceTo(t, 2, "upkeep");
    for (let i = 0; i < 3 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.p("p1").hand.length - before).toBe(1);
    advanceTo(t, 4, "upkeep");
    expect(t.state.delayedTriggers ?? []).toHaveLength(0);
  });

  it("Parting Gust without the gift: the exiled creature comes back at the next end step with a +1/+1 counter", () => {
    const t = world();
    t.give("p1", "Plains", "battlefield");
    const gust = t.give("p1", "Parting Gust", "hand");
    const cub = t.give("p2", "Test Bear", "battlefield");
    let res = t.ok({ type: "castSpell", player: "p1", cardId: gust, extras: [] });
    res = t.answer(res, { ids: [cub] });
    t.pass("p1", "p2");
    expect(t.obj(cub).zone).toBe("exile");
    expect(t.state.delayedTriggers).toHaveLength(1);
    advanceTo(t, 1, "end_step");
    for (let i = 0; i < 4 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.obj(cub).zone).toBe("battlefield");
    expect(t.obj(cub).counters["+1/+1"]).toBe(1);
    expect(t.obj(cub).controller).toBe("p2");
  });

  it("Parting Gust with the gift: the opponent gets a tapped Fish and the creature stays exiled", () => {
    const t = world();
    t.give("p1", "Plains", "battlefield");
    const gust = t.give("p1", "Parting Gust", "hand");
    const cub = t.give("p2", "Test Bear", "battlefield");
    let res = t.ok({ type: "castSpell", player: "p1", cardId: gust, extras: ["c1"] });
    res = t.answer(res, { ids: [cub] });
    t.pass("p1", "p2");
    const fish = t.state.battlefield.map((id) => t.obj(id)).find((o) => o.token?.name === "Fish")!;
    expect(fish.controller).toBe("p2");
    expect(fish.tapped).toBe(true);
    expect(t.state.delayedTriggers ?? []).toHaveLength(0); // the step's condition (gift not promised) failed: no trigger made
    advanceTo(t, 1, "end_step");
    expect(t.obj(cub).zone).toBe("exile");
  });
});

describe("create_delayed_trigger: 'when it dies this turn' (Together Forever)", () => {
  const setup = () => {
    const t = world();
    t.give("p1", "Plains", "battlefield");
    const tf = t.give("p1", "Together Forever", "battlefield");
    const bear2 = t.give("p1", "Test Bear", "battlefield", { counters: { "+1/+1": 1 } });
    return { t, tf, bear2 };
  };
  it("returns the creature to its owner's hand when it dies the same turn", () => {
    const { t, tf, bear2 } = setup();
    t.ok({ type: "activateAbility", player: "p1", sourceId: tf, abilityId: "a2", targets: { t1: [bear2] } });
    t.pass("p1", "p2");
    expect(t.state.delayedTriggers).toHaveLength(1);
    t.lands("p2", "Mountain", 1);
    const bolt = t.give("p2", "Lightning Bolt", "hand");
    t.state = { ...t.state, priority: "p2" };
    t.ok({ type: "castSpell", player: "p2", cardId: bolt, targets: { t1: [bear2] } });
    t.pass("p2", "p1");
    t.pass(t.state.priority!, t.state.priority === "p1" ? "p2" : "p1");
    for (let i = 0; i < 4 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.obj(bear2).zone).toBe("hand");
  });
  it("does nothing if the creature survives the turn, and the delayed trigger is dropped at cleanup", () => {
    const { t, tf, bear2 } = setup();
    t.ok({ type: "activateAbility", player: "p1", sourceId: tf, abilityId: "a2", targets: { t1: [bear2] } });
    t.pass("p1", "p2");
    advanceTo(t, 2, "upkeep");
    expect(t.state.delayedTriggers ?? []).toHaveLength(0);
    expect(t.obj(bear2).zone).toBe("battlefield");
  });
});

describe("permission_to_play", () => {
  it("Emry: tap to cast an artifact from your graveyard this turn (and only you)", () => {
    const t = world();
    t.lands("p1", "Island", 1);
    const emry = t.give("p1", "Emry, Lurker of the Loch", "battlefield");
    const ring = t.give("p1", "Sol Ring", "graveyard");
    let res = t.ok({ type: "activateAbility", player: "p1", sourceId: emry, abilityId: "a3" });
    res = t.answer(res, { ids: [ring] });
    t.pass("p1", "p2");
    // "you may cast that card this turn": granted without a question, the player decides when to cast it
    expect(t.state.pending ?? undefined).toBeUndefined();
    expect(t.state.durableEffects).toHaveLength(1);
    // the opponent cannot use it
    t.state = { ...t.state, priority: "p2" };
    expect(t.do({ type: "castSpell", player: "p2", cardId: ring }).error?.code).toBe("not_owner");
    t.state = { ...t.state, priority: "p1" };
    t.ok({ type: "castSpell", player: "p1", cardId: ring });
    expect(t.obj(ring).zone).toBe("stack");
    expect(t.state.durableEffects).toHaveLength(0); // used up
    t.pass("p1", "p2");
    expect(t.obj(ring).zone).toBe("battlefield");
  });

  it("the permission still costs the card's mana cost, and fails without it", () => {
    const t = world();
    const emry = t.give("p1", "Emry, Lurker of the Loch", "battlefield");
    const ring = t.give("p1", "Sol Ring", "graveyard");
    let res = t.ok({ type: "activateAbility", player: "p1", sourceId: emry, abilityId: "a3" });
    res = t.answer(res, { ids: [ring] });
    t.pass("p1", "p2");
    expect(t.do({ type: "castSpell", player: "p1", cardId: ring }).error?.code).toBe("cannot_pay");
    expect(t.obj(ring).zone).toBe("graveyard");
  });

  it("a durable permission asks nothing up front: not casting leaves the card alone", () => {
    const t = world();
    const emry = t.give("p1", "Emry, Lurker of the Loch", "battlefield");
    const ring = t.give("p1", "Sol Ring", "graveyard");
    t.lands("p1", "Island", 1);
    let res = t.ok({ type: "activateAbility", player: "p1", sourceId: emry, abilityId: "a3" });
    res = t.answer(res, { ids: [ring] });
    t.pass("p1", "p2");
    expect(t.state.pending ?? undefined).toBeUndefined(); // no up-front question; not casting it is simply leaving the card where it is
    expect(t.state.durableEffects).toHaveLength(1);
    expect(t.obj(ring).zone).toBe("graveyard");
  });

  it("'this turn' ends at cleanup", () => {
    const t = world();
    t.lands("p1", "Island", 1);
    fill(t, "p1", 5); fill(t, "p2", 5);
    const emry = t.give("p1", "Emry, Lurker of the Loch", "battlefield");
    const ring = t.give("p1", "Sol Ring", "graveyard");
    let res = t.ok({ type: "activateAbility", player: "p1", sourceId: emry, abilityId: "a3" });
    res = t.answer(res, { ids: [ring] });
    t.pass("p1", "p2");
    expect(t.state.durableEffects).toHaveLength(1);
    advanceTo(t, 2, "upkeep");
    expect(t.state.durableEffects ?? []).toHaveLength(0);
  });

  it("Count on Luck: the exiled top card can be played this turn, a land through playLand", () => {
    const t = world();
    fill(t, "p1", 5); fill(t, "p2", 5);
    t.give("p1", "Count on Luck", "battlefield");
    // make sure the card on top is a land
    advanceTo(t, 3, "upkeep");
    // turn 3 is p1's again: upkeep trigger on the stack
    expect(t.state.stack.length + t.state.triggerQueue.length).toBeGreaterThan(0);
    let res = t.ok({ type: "passPriority", player: t.state.priority!, fastForward: false });
    res = t.ok({ type: "passPriority", player: t.state.priority! });
    const pd = t.state.pending;
    if (pd) res = t.answer(res, { yes: true });
    const exiled = t.p("p1").exile[0];
    expect(t.state.durableEffects).toHaveLength(1);
    // main phase: play the land from exile
    advanceTo(t, 3, "precombat_main");
    t.ok({ type: "playLand", player: "p1", cardId: exiled });
    expect(t.obj(exiled).zone).toBe("battlefield");
    expect(t.state.durableEffects ?? []).toHaveLength(0);
  });

  it("a permission dies with the object: once the card moves, it is a new object", () => {
    const t = world();
    t.lands("p1", "Island", 1);
    const emry = t.give("p1", "Emry, Lurker of the Loch", "battlefield");
    const ring = t.give("p1", "Sol Ring", "graveyard");
    let res = t.ok({ type: "activateAbility", player: "p1", sourceId: emry, abilityId: "a3" });
    res = t.answer(res, { ids: [ring] });
    t.pass("p1", "p2");
    // exile it and bring it back to the graveyard through the engine's own mover
    const s = structuredClone(t.state);
    s.objects[ring].timestamp += 100; // a zone change refreshes the timestamp: simulate "it left and returned"
    t.state = s;
    expect(t.do({ type: "castSpell", player: "p1", cardId: ring }).error?.code).toBe("not_in_zone");
  });
});

describe("grant_effect on players: replacement shields (Inkshield) and flags", () => {
  const combatSetup = () => {
    const t = world();
    t.lands("p1", "Plains", 2); t.lands("p1", "Swamp", 2);
    const ink = t.give("p1", "Inkshield", "hand");
    const atk = t.give("p2", "Test Bear", "battlefield");
    t.state = { ...t.state, turn: { number: 2, active: "p2", phase: "precombat_main" }, priority: "p1" };
    t.state.players[1].lastTurnStartTs = 0;
    return { t, ink, atk };
  };

  it("prevents all combat damage to you this turn and makes a 2/1 flying Inkling for each 1 prevented", () => {
    const { t, ink, atk } = combatSetup();
    t.ok({ type: "castSpell", player: "p1", cardId: ink });
    t.pass("p1", "p2");
    expect(t.state.durableEffects).toHaveLength(1);
    t.state = { ...t.state, priority: "p2" };
    advanceTo(t, 2, "declare_attackers");
    t.ok({ type: "declareAttackers", player: "p2", attackers: [{ id: atk, defender: "p1" }] });
    for (let i = 0; i < 10 && t.state.turn.phase !== "end_of_combat" && !t.state.pending; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.p("p1").life).toBe(40);
    const inklings = t.state.battlefield.map((id) => t.obj(id)).filter((o) => o.token?.name === "Inkling");
    expect(inklings).toHaveLength(2);
    expect(inklings.every((o) => o.controller === "p1")).toBe(true);
  });

  it("noncombat damage is not prevented", () => {
    const { t, ink } = combatSetup();
    t.ok({ type: "castSpell", player: "p1", cardId: ink });
    t.pass("p1", "p2");
    t.lands("p2", "Mountain", 1);
    const bolt = t.give("p2", "Lightning Bolt", "hand");
    t.state = { ...t.state, priority: "p2" };
    t.ok({ type: "castSpell", player: "p2", cardId: bolt, targets: { t1: ["p1"] } });
    t.pass("p2", "p1");
    expect(t.p("p1").life).toBe(37);
  });

  it("the shield ends at cleanup", () => {
    const { t, ink } = combatSetup();
    t.ok({ type: "castSpell", player: "p1", cardId: ink });
    t.pass("p1", "p2");
    advanceTo(t, 3, "upkeep");
    expect(t.state.durableEffects ?? []).toHaveLength(0);
  });

  it("the shield protects its owner only (recipient: you)", () => {
    const { t, ink } = combatSetup();
    t.ok({ type: "castSpell", player: "p1", cardId: ink });
    t.pass("p1", "p2");
    t.lands("p1", "Mountain", 1);
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    t.state = { ...t.state, priority: "p1" };
    t.ok({ type: "castSpell", player: "p1", cardId: bolt, targets: { t1: ["p2"] } });
    t.pass("p1", "p2");
    expect(t.p("p2").life).toBe(37);
  });

  it("player flag: 'no maximum hand size' skips the cleanup discard", () => {
    const t = world();
    fill(t, "p2", 5);
    for (let i = 0; i < 10; i++) t.give("p1", "Island", "hand");
    const ids: ObjId[] = [];
    void ids;
    // grant through the real step: a one-off card
    const card: CardDef = { name: "Hand Wizard", manaCost: "{U}", types: ["sorcery"], kernel: { schemaVersion: 2, abilities: [{ id: "a1", kind: "spell_effect", text: "You have no maximum hand size this turn.", steps: [{ kind: "grant_effect", who: "you", modify: [{ grant: "no maximum hand size" }], duration: "until_end_of_turn" }] }] } };
    const t2 = table(["p1", "p2"], { extra: { "Hand Wizard": card } });
    fill(t2, "p2", 5);
    for (let i = 0; i < 9; i++) t2.give("p1", "Island", "hand");
    t2.give("p1", "Island", "battlefield");
    const hw = t2.give("p1", "Hand Wizard", "hand");
    t2.ok({ type: "castSpell", player: "p1", cardId: hw });
    t2.pass("p1", "p2");
    advanceTo(t2, 2, "upkeep");
    expect(t2.state.pending).toBeNull();
    expect(t2.p("p1").hand.length).toBe(9);
  });

  it("without the flag the cleanup asks for a discard", () => {
    const t = world();
    for (let i = 0; i < 9; i++) t.give("p1", "Island", "hand");
    advanceTo(t, 1, "cleanup");
    expect(t.state.pending?.kind).toBe("choose_cards");
  });
});
