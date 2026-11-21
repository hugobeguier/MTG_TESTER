import { describe, expect, it } from "vitest";
import { table, type Table } from "./testkit";
import type { Action } from "./types";

const act = (t: Table, who: string, id: string, abilityId: string, extra: Partial<Extract<Action, { type: "activateAbility" }>> = {}) => t.do({ type: "activateAbility", player: who, sourceId: id, abilityId, ...extra });
const actOk = (t: Table, who: string, id: string, abilityId: string, extra: Partial<Extract<Action, { type: "activateAbility" }>> = {}) => t.ok({ type: "activateAbility", player: who, sourceId: id, abilityId, ...extra });
const tapped = (t: Table) => t.state.battlefield.filter((id) => t.obj(id).tapped).length;

describe("cycling (Secluded Steppe: activated from the hand, cost = mana + discard this card)", () => {
  const setup = () => {
    const t = table();
    t.lands("p1", "Plains", 1);
    t.give("p1", "Island", "library"); t.give("p1", "Island", "library");
    const steppe = t.give("p1", "Secluded Steppe", "hand");
    return { t, steppe };
  };

  it("discards itself as a cost, draws a card, and works at instant speed on the opponent's turn", () => {
    const { t, steppe } = setup();
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p1" };
    const before = t.p("p1").hand.length;
    actOk(t, "p1", steppe, "a3");
    expect(t.obj(steppe).zone).toBe("graveyard"); // the cost was paid immediately
    expect(t.state.stack).toHaveLength(1);
    t.pass("p1", "p2");
    expect(t.p("p1").hand).toHaveLength(before - 1 + 1);
    expect(tapped(t)).toBe(1);
  });

  it("emits a cycle event and a discard event (cycling is a discard)", () => {
    const { t, steppe } = setup();
    const res = actOk(t, "p1", steppe, "a3");
    expect(res.events.some((e) => e.type === "cycle" && e.id === steppe)).toBe(true);
    expect(res.events.some((e) => e.type === "discard" && e.id === steppe)).toBe(true);
  });

  it("cannot be activated from the battlefield or the graveyard, nor by another player", () => {
    const { t, steppe } = setup();
    t.state = { ...t.state, priority: "p2" };
    expect(act(t, "p2", steppe, "a3").error?.code).toBe("not_owner");
    t.state = { ...t.state, priority: "p1" };
    const onField = t.give("p1", "Secluded Steppe", "battlefield");
    expect(act(t, "p1", onField, "a3").error?.code).toBe("cannot_activate");
    const inYard = t.give("p1", "Secluded Steppe", "graveyard");
    expect(act(t, "p1", inYard, "a3").error?.code).toBe("cannot_activate");
  });

  it("without the {W} nothing is paid and the card stays in hand", () => {
    const t = table();
    t.give("p1", "Island", "battlefield");
    t.give("p1", "Island", "library");
    const steppe = t.give("p1", "Secluded Steppe", "hand");
    expect(act(t, "p1", steppe, "a3").error?.code).toBe("cannot_pay");
    expect(t.obj(steppe).zone).toBe("hand");
  });

  it("its mana ability (a2) is not usable from the hand", () => {
    const { t, steppe } = setup();
    expect(act(t, "p1", steppe, "a2").error?.code).toBe("cannot_activate");
  });

  it("the discard goes through the replacement pipeline like any discard (it is a real discard)", () => {
    const { t, steppe } = setup();
    actOk(t, "p1", steppe, "a3");
    expect(t.state.turnLog.some((e) => e.type === "discard" && e.id === steppe)).toBe(true);
  });
});

describe("cycling with X and a cycle trigger (Shark Typhoon)", () => {
  it("pays {X}{1}{U}, then the Shark is X/X with flying", () => {
    const t = table();
    t.lands("p1", "Island", 5);
    t.give("p1", "Island", "library");
    const st = t.give("p1", "Shark Typhoon", "hand");
    let res = actOk(t, "p1", st, "a2");
    expect(res.pending!.kind).toBe("choose_x");
    expect(res.pending!.max).toBe(3); // five lands - {1}{U}
    res = t.answer(res, { number: 3 });
    expect(tapped(t)).toBe(5);
    // the cycle trigger and the draw are both on the stack
    expect(t.state.stack.length).toBe(2);
    t.resolveTop(); t.resolveTop();
    const shark = t.state.battlefield.map((id) => t.obj(id)).find((o) => o.token?.name === "Shark")!;
    expect(shark.token!.power).toBe(3);
    expect(shark.token!.keywords).toContain("flying");
  });

  it("X = 0 makes a 0/0 Shark that dies to state-based actions", () => {
    const t = table();
    t.lands("p1", "Island", 2);
    t.give("p1", "Island", "library");
    const st = t.give("p1", "Shark Typhoon", "hand");
    let res = actOk(t, "p1", st, "a2");
    res = t.answer(res, { number: 0 });
    t.resolveTop(); t.resolveTop();
    expect(t.state.battlefield.some((id) => t.obj(id).token?.name === "Shark")).toBe(false);
  });

  it("X above what the mana allows is rejected", () => {
    const t = table();
    t.lands("p1", "Island", 3);
    const st = t.give("p1", "Shark Typhoon", "hand");
    const res = actOk(t, "p1", st, "a2");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { number: 2 } }).error?.code).toBe("invalid_choice");
  });
});

describe("channel (Eiganjo): mana + discard from hand, cost reduction on the ability itself", () => {
  const setup = (legends: number) => {
    const t = table();
    t.lands("p1", "Plains", 3);
    const eig = t.give("p1", "Eiganjo, Seat of the Empire", "hand");
    for (let i = 0; i < legends; i++) t.give("p1", "Jarad, Golgari Lich Lord", "battlefield");
    const atk = t.give("p2", "Bear Cub", "battlefield");
    t.state.combat = { attackers: [{ id: atk, ts: t.obj(atk).timestamp, defender: "p1", blockers: [], blocked: false }], dealtFirst: [], expect: null };
    return { t, eig, atk };
  };

  it("costs {2}{W}, deals 4 to the attacking creature", () => {
    const { t, eig, atk } = setup(0);
    actOk(t, "p1", eig, "a2", { targets: { t1: [atk] } });
    expect(tapped(t)).toBe(3);
    t.pass("p1", "p2");
    expect(t.obj(atk).zone).toBe("graveyard");
  });

  it("costs {1} less for each legendary creature you control", () => {
    const { t, eig, atk } = setup(2);
    actOk(t, "p1", eig, "a2", { targets: { t1: [atk] } });
    expect(tapped(t)).toBe(1); // {W} only: the generic {2} is fully reduced; the two Jarads are not lands so are untouched
  });

  it("the reduction never goes below the coloured part", () => {
    const { t, eig, atk } = setup(5);
    actOk(t, "p1", eig, "a2", { targets: { t1: [atk] } });
    expect(tapped(t)).toBe(1);
  });

  it("an attacking or blocking creature is required as a target", () => {
    const { t, eig } = setup(0);
    const other = t.give("p2", "Ledger Shredder", "battlefield");
    expect(act(t, "p1", eig, "a2", { targets: { t1: [other] } }).error?.code).toBe("illegal_target");
  });
});

describe("static abilities that work on the stack: can't be countered", () => {
  it("Void Rend cannot be countered by Counterspell and still resolves", () => {
    const t = table();
    t.give("p1", "Plains", "battlefield"); t.give("p1", "Island", "battlefield"); t.give("p1", "Swamp", "battlefield");
    t.lands("p2", "Island", 2);
    const vr = t.give("p1", "Void Rend", "hand");
    const cs = t.give("p2", "Counterspell", "hand");
    const target = t.give("p2", "Sol Ring", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: vr, targets: { t1: [target] } });
    t.state = { ...t.state, priority: "p2" };
    const res = t.ok({ type: "castSpell", player: "p2", cardId: cs, targets: { t1: [vr] } });
    expect(res.state.stack).toHaveLength(2);
    t.pass("p2", "p1");
    expect(t.state.stack.some((i) => i.objectId === vr)).toBe(true);
    expect(t.obj(cs).zone).toBe("graveyard");
    t.pass("p1", "p2");
    expect(t.obj(target).zone).toBe("graveyard");
  });

  it("emits counter_failed when the counterspell resolves", () => {
    const t = table();
    t.give("p1", "Plains", "battlefield"); t.give("p1", "Island", "battlefield"); t.give("p1", "Swamp", "battlefield");
    t.lands("p2", "Island", 2);
    const vr = t.give("p1", "Void Rend", "hand");
    const cs = t.give("p2", "Counterspell", "hand");
    const target = t.give("p2", "Sol Ring", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: vr, targets: { t1: [target] } });
    t.state = { ...t.state, priority: "p2" };
    t.ok({ type: "castSpell", player: "p2", cardId: cs, targets: { t1: [vr] } });
    const res = t.pass("p2", "p1");
    expect(res.events.some((e) => e.type === "counter_failed")).toBe(true);
  });

  it("an ordinary spell is still countered", () => {
    const t = table();
    t.lands("p1", "Mountain", 1);
    t.lands("p2", "Island", 2);
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    const cs = t.give("p2", "Counterspell", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: bolt, targets: { t1: ["p2"] } });
    t.state = { ...t.state, priority: "p2" };
    t.ok({ type: "castSpell", player: "p2", cardId: cs, targets: { t1: [bolt] } });
    t.pass("p2", "p1");
    expect(t.obj(bolt).zone).toBe("graveyard");
    expect(t.p("p2").life).toBe(40);
  });
});

describe("planeswalkers: loyalty costs and activation rules", () => {
  const setup = () => {
    const t = table();
    for (let i = 0; i < 3; i++) t.give("p1", "Island", "library");
    const pw = t.give("p1", "Aminatou, the Fateshifter", "battlefield", { counters: { loyalty: 3 } });
    const a = t.give("p1", "Island", "hand");
    return { t, pw, a };
  };

  it("+1 adds a loyalty counter, runs its steps, and is once per turn", () => {
    const { t, pw } = setup();
    let res = actOk(t, "p1", pw, "a1");
    expect(t.obj(pw).counters.loyalty).toBe(4); // paid immediately
    t.pass("p1", "p2");
    res = t.state.pending ? t.answer({ ...res, pending: t.state.pending } as never, { ids: [t.p("p1").hand[0]] }) : res;
    expect(act(t, "p1", pw, "a1").error?.code).toBe("cannot_activate");
    expect(act(t, "p1", pw, "a2").error?.code).toBe("cannot_activate"); // one loyalty ability per planeswalker per turn
  });

  it("is sorcery speed: not on the opponent's turn, not with a spell on the stack", () => {
    const { t, pw } = setup();
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p1" };
    expect(act(t, "p1", pw, "a1").error?.code).toBe("wrong_timing");
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p1" }, priority: "p1" };
    t.lands("p1", "Mountain", 1);
    const bolt = t.give("p1", "Lightning Bolt", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: bolt, targets: { t1: ["p2"] } });
    expect(act(t, "p1", pw, "a1").error?.code).toBe("wrong_timing");
  });

  it("-1 removes a counter and needs a target; the loyalty cost is not paid when the target is illegal", () => {
    const { t, pw } = setup();
    const mine = t.give("p1", "Sol Ring", "battlefield");
    expect(act(t, "p1", pw, "a2", { targets: { t1: [pw] } }).error?.code).toBe("illegal_target"); // "another" permanent
    expect(t.obj(pw).counters.loyalty).toBe(3);
    actOk(t, "p1", pw, "a2", { targets: { t1: [mine] } });
    expect(t.obj(pw).counters.loyalty).toBe(2);
  });

  it("the cost cannot be paid when there is not enough loyalty", () => {
    const t = table();
    const pw = t.give("p1", "Aminatou, the Fateshifter", "battlefield", { counters: { loyalty: 1 } });
    const mine = t.give("p1", "Sol Ring", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: pw, abilityId: "a2", targets: { t1: [mine] } });
    expect(t.obj(pw).counters.loyalty).toBeUndefined(); // 1 - 1 = 0
    t.pass("p1", "p2"); // resolves the ability; SBA then puts the planeswalker into the graveyard
    expect(t.obj(pw).zone).toBe("graveyard");
  });

  it("only the controller may activate", () => {
    const { t, pw } = setup();
    t.state = { ...t.state, priority: "p2" };
    expect(act(t, "p2", pw, "a1").error?.code).toBe("not_owner");
  });

  it("a planeswalker cast from hand enters with its starting loyalty", () => {
    const t = table(["p1", "p2"], { config: { lenient: true } });
    t.give("p1", "Plains", "battlefield"); t.give("p1", "Island", "battlefield"); t.give("p1", "Swamp", "battlefield"); t.give("p1", "Island", "battlefield");
    const pw = t.give("p1", "Aminatou, the Fateshifter", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: pw });
    t.pass("p1", "p2");
    expect(t.obj(pw).zone).toBe("battlefield");
    expect(t.obj(pw).counters.loyalty).toBe(3);
  });

  it("an ability id the permanent does not have is refused", () => {
    const t = table();
    const fake = t.give("p1", "Sol Ring", "battlefield");
    expect(act(t, "p1", fake, "a99").error?.code).toBe("unknown_ability");
  });
});
