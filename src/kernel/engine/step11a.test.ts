// Kernel step 11 (a): the Calling All Angels cards: Angel of the Ruins (plainscycling), Firemane Commando (attacked_defender), Merchant of Truth (granted exalted), Serra Avenger (turn_number + can't cast from hand).
import { describe, expect, it } from "vitest";
import { mk } from "./famkit";
import { drain, toAttackers } from "./step10kit";
import { cardUnsupported } from "./support";
import { charsOf, realDef, realTable } from "./testdb";

const names = ["Angel of the Ruins", "Firemane Commando", "Merchant of Truth", "Serra Avenger"];
describe("step 11a: supported", () => { for (const n of names) it(n, () => { expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); }); });

const bear = (n: string) => mk(n, { manaCost: "{1}", types: ["creature"], power: 1, toughness: 1 }, []);
const ready = (t: ReturnType<typeof realTable>, id: string) => { t.obj(id).controlledSince = -1; return id; };

describe("Angel of the Ruins: plainscycling", () => {
  it("discards, searches a Plains, and counts as cycling", () => {
    const t = realTable();
    const a = t.give("p1", "Angel of the Ruins", "hand");
    const plains = t.give("p1", "Plains", "library"); t.give("p1", "Island", "library");
    t.lands("p1", "Island", 2);
    const acts = t.do({ type: "activateAbility", player: "p1", sourceId: a, abilityId: "a3" } as never);
    expect(acts.error, acts.error?.message).toBeUndefined();
    drain(t, (p) => (p.kind === "choose_cards" ? { ids: [plains] } : undefined));
    expect(t.obj(plains).zone).toBe("hand");
    expect(t.obj(a).zone).toBe("graveyard");
  });
});

describe("Firemane Commando", () => {
  const cards = { A: bear("A"), B: bear("B") };
  const setup = () => {
    const t = realTable(["p1", "p2", "p3"], cards);
    t.give("p2", "Firemane Commando", "battlefield");
    const a = ready(t, t.give("p1", "A", "battlefield")), b = ready(t, t.give("p1", "B", "battlefield"));
    for (let i = 0; i < 3; i++) t.give("p1", "Island", "library");
    return { t, a, b };
  };
  it("the attacking player draws when none of the attackers attacked its controller", () => {
    const { t, a, b } = setup();
    toAttackers(t); t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: a, defender: "p3" }, { id: b, defender: "p3" }] }); drain(t);
    expect(t.p("p1").hand.length).toBe(1);
    expect(t.p("p2").hand.length).toBe(0);
  });
  it("does not draw when one of them attacked its controller", () => {
    const { t, a, b } = setup();
    toAttackers(t); t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: a, defender: "p3" }, { id: b, defender: "p2" }] }); drain(t);
    expect(t.p("p1").hand.length).toBe(0);
  });
  it("its controller draws on their own two-creature attack", () => {
    const t = realTable(["p1", "p2"], cards);
    t.give("p1", "Firemane Commando", "battlefield");
    const a = ready(t, t.give("p1", "A", "battlefield")), b = ready(t, t.give("p1", "B", "battlefield"));
    t.give("p1", "Island", "library");
    toAttackers(t); t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: a, defender: "p2" }, { id: b, defender: "p2" }] }); drain(t);
    expect(t.p("p1").hand.length).toBe(1);
  });
});

describe("Merchant of Truth: Clues have exalted", () => {
  const clue = mk("Test Clue", { types: ["artifact"], subtypes: ["Clue"] }, []);
  it("a lone attacker gets +1/+1 for each Clue", () => {
    const t = realTable(["p1", "p2"], { A: bear("A"), "Test Clue": clue });
    t.give("p1", "Merchant of Truth", "battlefield"); t.give("p1", "Test Clue", "battlefield"); t.give("p1", "Test Clue", "battlefield");
    const a = ready(t, t.give("p1", "A", "battlefield"));
    toAttackers(t); t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: a, defender: "p2" }] }); drain(t);
    expect(charsOf(t, a).power).toBe(3);
  });
  it("two attackers: no exalted", () => {
    const t = realTable(["p1", "p2"], { A: bear("A"), B: bear("B"), "Test Clue": clue });
    t.give("p1", "Merchant of Truth", "battlefield"); t.give("p1", "Test Clue", "battlefield");
    const a = ready(t, t.give("p1", "A", "battlefield")), b = ready(t, t.give("p1", "B", "battlefield"));
    toAttackers(t); t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: a, defender: "p2" }, { id: b, defender: "p2" }] }); drain(t);
    expect(charsOf(t, a).power).toBe(1);
  });
});

describe("Serra Avenger", () => {
  it("cannot be cast during your first three turns, can on the fourth", () => {
    const t = realTable();
    const s = t.give("p1", "Serra Avenger", "hand"); t.lands("p1", "Plains", 2);
    expect(t.do({ type: "castSpell", player: "p1", cardId: s }).error?.code).toBe("wrong_timing");
    t.state.turnsTaken = { p1: 4 };
    expect(t.do({ type: "castSpell", player: "p1", cardId: s }).error).toBeUndefined();
  });
});
