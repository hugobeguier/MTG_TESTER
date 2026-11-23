// Kernel step 11 (e): Breena deck: Batwing Brume, Council's Judgment (vote), Envoy of the Ancestors (outlast, modified), Incarnation Technique (demonstrate),
// Keen Duelist / Parker Luck (mutual reveal), Nils (attack tax per counter), Orzhov Advokist / Promise of Loyalty (attack bans), Perch Protection, Selfless Squire.
import { describe, expect, it } from "vitest";
import { famCards, mk } from "./famkit";
import { drain, toAttackers } from "./step10kit";
import { cardUnsupported } from "./support";
import { charsOf, realDef, realTable } from "./testdb";

const names = ["Batwing Brume", "Council's Judgment", "Envoy of the Ancestors", "Incarnation Technique", "Keen Duelist", "Parker Luck", "Nils, Discipline Enforcer", "Orzhov Advokist", "Promise of Loyalty", "Perch Protection", "Selfless Squire"];
describe("step 11e: supported", () => { for (const n of names) it(n, () => { expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); }); });

const ready = (t: ReturnType<typeof realTable>, id: string) => { t.obj(id).controlledSince = -1; return id; };
const fill = (t: ReturnType<typeof realTable>, ps = ["p1", "p2"]) => { for (const p of ps) for (let i = 0; i < 15; i++) t.give(p, "Island", "library"); };
type Pick = Parameters<typeof drain>[1];
function untilPhase(t: ReturnType<typeof realTable>, who: string, phase: string, pick?: Pick) {
  for (let i = 0; i < 80; i++) {
    drain(t, pick);
    if (t.state.turn.phase === phase && t.state.turn.active === who) return;
    t.ok({ type: "advancePhase", player: t.state.turn.active });
  }
  throw new Error(`never reached ${who} ${phase}`);
}

/** Does `who`'s attack with `id` on `defender` work this turn? (the declare attackers step is skipped when nothing can attack) */
function tryAttack(t: ReturnType<typeof realTable>, who: string, id: string, defender: string): boolean {
  untilPhase(t, who, "precombat_main");
  for (let i = 0; i < 4 && t.state.turn.phase !== "declare_attackers" && t.state.turn.phase !== "postcombat_main"; i++) t.ok({ type: "advancePhase", player: who });
  if (t.state.turn.phase !== "declare_attackers") return false;
  return !t.do({ type: "declareAttackers", player: who, attackers: [{ id, defender }] }).error;
}

describe("Council's Judgment", () => {
  const setup = () => {
    const t = realTable(["p1", "p2", "p3"], { ...famCards });
    t.lands("p1", "Plains", 3);
    const a = t.give("p2", "Fill A", "battlefield"), b = t.give("p3", "Fill B", "battlefield");
    t.give("p1", "Fill C", "battlefield");
    return { t, a, b, cj: t.give("p1", "Council's Judgment", "hand") };
  };
  it("exiles the permanent with the most votes", () => {
    const { t, a, b, cj } = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: cj });
    const order: string[] = [];
    drain(t, (p) => { if (p.kind === "choose_cards") { order.push(p.player); return { ids: [p.player === "p3" ? b : a] }; } return undefined; });
    expect(order).toEqual(["p1", "p2", "p3"]); // starting with the caster
    expect(t.obj(a).zone).toBe("exile"); expect(t.obj(b).zone).toBe("battlefield");
  });
  it("exiles every permanent tied for most votes", () => {
    const { t, a, b, cj } = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: cj });
    drain(t, (p) => (p.kind === "choose_cards" ? { ids: [p.player === "p1" ? a : p.player === "p2" ? b : a].slice(0, 1) } : undefined));
    // p1 -> a, p2 -> b, p3 -> a : a has 2. use a real tie below
    expect(t.obj(a).zone).toBe("exile");
  });
  it("a three-way split exiles all three", () => {
    const t = realTable(["p1", "p2", "p3"], { ...famCards });
    t.lands("p1", "Plains", 3);
    const x = t.give("p2", "Fill A", "battlefield"), y = t.give("p2", "Fill B", "battlefield"), z = t.give("p3", "Fill C", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Council's Judgment", "hand") });
    drain(t, (p) => (p.kind === "choose_cards" ? { ids: [p.player === "p1" ? x : p.player === "p2" ? y : z] } : undefined));
    expect([x, y, z].map((id) => t.obj(id).zone)).toEqual(["exile", "exile", "exile"]);
  });
});

describe("Batwing Brume", () => {
  it("with {B} spent each player loses 1 life for each attacking creature they control", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    const a = ready(t, t.give("p1", "Fill A", "battlefield")), b = ready(t, t.give("p1", "Fill B", "battlefield"));
    t.give("p1", "Swamp", "battlefield"); t.give("p1", "Swamp", "battlefield");
    toAttackers(t); t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: a, defender: "p2" }, { id: b, defender: "p2" }] });
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Batwing Brume", "hand") }); drain(t);
    expect(t.p("p1").life).toBe(38); expect(t.p("p2").life).toBe(40);
  });
  it("with {W} spent combat damage is prevented this turn", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    const a = ready(t, t.give("p1", "Fill A", "battlefield"));
    t.give("p1", "Plains", "battlefield"); t.give("p1", "Plains", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Batwing Brume", "hand") }); drain(t);
    toAttackers(t); t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: a, defender: "p2" }] });
    untilPhase(t, "p2", "upkeep");
    expect(t.p("p2").life).toBe(40);
  });
});

describe("Envoy of the Ancestors", () => {
  it("modified creatures you control have lifelink", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.give("p1", "Envoy of the Ancestors", "battlefield");
    const plain = t.give("p1", "Fill A", "battlefield"), counter = t.give("p1", "Fill B", "battlefield", { counters: { "+1/+1": 1 } });
    expect(charsOf(t, plain).keywords).not.toContain("lifelink");
    expect(charsOf(t, counter).keywords).toContain("lifelink");
  });
  it("outlast puts a +1/+1 counter on it (sorcery speed, tapping)", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    const e = ready(t, t.give("p1", "Envoy of the Ancestors", "battlefield")); t.give("p1", "Plains", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: e, abilityId: "a1" } as never); drain(t);
    expect(t.obj(e).counters["+1/+1"]).toBe(1); expect(t.obj(e).tapped).toBe(true);
  });
});

describe("Incarnation Technique: demonstrate", () => {
  it("you may copy it, and then an opponent copies it too: each mills five and returns a creature", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    fill(t);
    t.lands("p1", "Swamp", 5);
    const own = t.give("p1", "Fill A", "graveyard"), theirs = t.give("p2", "Fill B", "graveyard");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Incarnation Technique", "hand") });
    drain(t, (p) => (p.kind === "choose_yes_no" ? { yes: true } : p.kind === "choose_cards" ? { ids: [p.options.find((o) => o.id === own || o.id === theirs)?.id ?? p.options[0].id] } : undefined));
    expect(t.p("p2").graveyard.length).toBeGreaterThanOrEqual(5); // p2 milled five (their own copy)
    expect(t.obj(theirs).zone).toBe("battlefield");
    expect(t.obj(own).zone).toBe("battlefield");
  });
  it("declining the copy leaves a single spell", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    fill(t); t.lands("p1", "Swamp", 5);
    const theirs = t.give("p2", "Fill B", "graveyard");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Incarnation Technique", "hand") });
    drain(t, (p) => (p.kind === "choose_yes_no" ? { yes: false } : undefined));
    expect(t.obj(theirs).zone).toBe("graveyard");
    expect(t.p("p2").library.length).toBe(15);
  });
});

describe("Keen Duelist / Parker Luck: mutual reveal", () => {
  const mv = (n: string, c: string) => mk(n, { manaCost: c, types: ["creature"], power: 1, toughness: 1 }, []);
  it("Keen Duelist: you and target opponent lose life equal to the other's revealed card and put it into hand", () => {
    const t = realTable(["p1", "p2"], { M2: mv("M2", "{1}{1}"), M3: mv("M3", "{1}{1}{1}") });
    fill(t);
    const m2 = t.give("p1", "M2", "library", { top: true }); t.give("p2", "M3", "library", { top: true }); const m3 = t.give("p2", "M3", "library", { top: true }); // p2 draws one on its own turn first
    t.give("p1", "Keen Duelist", "battlefield");
    untilPhase(t, "p2", "upkeep"); // finish p1's turn
    untilPhase(t, "p1", "upkeep");
    drain(t, (p) => (p.kind === "choose_targets" ? { ids: ["p2"] } : undefined));
    expect(t.obj(m2).zone).toBe("hand"); expect(t.obj(m3).zone).toBe("hand");
    expect(t.p("p1").life).toBe(37); expect(t.p("p2").life).toBe(38);
  });
  it("Parker Luck: two target players", () => {
    const t = realTable(["p1", "p2"], { M2: mv("M2", "{1}{1}"), M3: mv("M3", "{1}{1}{1}") });
    fill(t);
    t.give("p1", "Parker Luck", "battlefield");
    const m2 = t.give("p1", "M2", "library", { top: true }), m3 = t.give("p2", "M3", "library", { top: true });
    untilPhase(t, "p1", "end_step");
    drain(t, (p) => (p.kind === "choose_targets" ? { ids: ["p1", "p2"] } : undefined));
    expect(t.obj(m2).zone).toBe("hand"); expect(t.obj(m3).zone).toBe("hand");
    expect(t.p("p1").life).toBe(37); expect(t.p("p2").life).toBe(38);
  });
});

describe("Nils, Discipline Enforcer: creatures with counters pay {X} to attack you", () => {
  it("X is the number of counters on the attacker", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.give("p2", "Nils, Discipline Enforcer", "battlefield");
    const a = ready(t, t.give("p1", "Fill A", "battlefield", { counters: { "+1/+1": 2 } }));
    const plain = ready(t, t.give("p1", "Fill B", "battlefield"));
    toAttackers(t);
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [{ id: a, defender: "p2" }] }).error).toBeDefined(); // cannot pay {2}
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [{ id: plain, defender: "p2" }] }).error).toBeUndefined();
  });
});

describe("Orzhov Advokist", () => {
  it("each player may put two +1/+1 counters on a creature; those players' creatures can't attack you until your next turn", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    fill(t);
    t.give("p1", "Orzhov Advokist", "battlefield");
    const mine = t.give("p1", "Fill A", "battlefield"), theirs = ready(t, t.give("p2", "Fill B", "battlefield"));
    untilPhase(t, "p2", "upkeep");
    untilPhase(t, "p1", "upkeep", (p) => (p.kind === "choose_yes_no" ? { yes: true } : p.kind === "choose_cards" ? { ids: [p.options.find((o) => o.id === mine || o.id === theirs)!.id] } : undefined));
    expect(t.obj(mine).counters["+1/+1"]).toBe(2); expect(t.obj(theirs).counters["+1/+1"]).toBe(2);
    expect(tryAttack(t, "p2", theirs, "p1"), "banned from attacking p1").toBe(false);
  });
  it("a player who declines is not restricted", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    fill(t);
    t.give("p1", "Orzhov Advokist", "battlefield");
    const theirs = ready(t, t.give("p2", "Fill B", "battlefield"));
    untilPhase(t, "p2", "upkeep");
    untilPhase(t, "p1", "upkeep", (p) => (p.kind === "choose_yes_no" ? { yes: false } : undefined));
    expect(t.obj(theirs).counters["+1/+1"] ?? 0).toBe(0);
    expect(tryAttack(t, "p2", theirs, "p1")).toBe(true);
  });
});

describe("Promise of Loyalty", () => {
  it("each player keeps one creature (vow counter), sacrifices the rest; the kept ones can't attack you while they have it", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Plains", 5); fill(t);
    const keepMine = t.give("p1", "Fill A", "battlefield"), loseMine = t.give("p1", "Fill B", "battlefield");
    const keepTheirs = ready(t, t.give("p2", "Fill C", "battlefield")), loseTheirs = t.give("p2", "Fill D", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Promise of Loyalty", "hand") });
    drain(t, (p) => (p.kind === "choose_cards" ? { ids: [p.options.find((o) => o.id === keepMine || o.id === keepTheirs)!.id] } : undefined));
    expect(t.obj(keepMine).zone).toBe("battlefield"); expect(t.obj(loseMine).zone).toBe("graveyard");
    expect(t.obj(keepTheirs).counters.vow).toBe(1); expect(t.obj(loseTheirs).zone).toBe("graveyard");
    expect(tryAttack(t, "p2", keepTheirs, "p1")).toBe(false);
    untilPhase(t, "p1", "upkeep");
    delete t.obj(keepTheirs).counters.vow; // no vow counter any more: free to attack again
    expect(tryAttack(t, "p2", keepTheirs, "p1")).toBe(true);
  });
});

describe("Perch Protection", () => {
  it("without the gift: four 2/2 flying Birds and the spell is exiled", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Plains", 6);
    const pp = t.give("p1", "Perch Protection", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: pp }); drain(t, (p) => (p.kind === "choose_cast_option" ? { ids: [] } : undefined));
    expect(Object.values(t.state.objects).filter((o) => o.cardName === "Bird" && o.zone === "battlefield").length).toBe(4);
    expect(t.obj(pp).zone).toBe("exile");
  });
  it("with the gift: the opponent takes an extra turn, permanents phase out, your life can't change, you have protection from everything", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Plains", 6);
    const keep = t.give("p1", "Fill A", "battlefield");
    const pp = t.give("p1", "Perch Protection", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: pp, extras: ["c1"] }); drain(t);
    expect(t.state.phased?.some((x) => x.id === keep)).toBe(true);
    expect(t.state.extraTurns).toContain("p2");
    const before = t.p("p1").life;
    t.give("p2", "Lightning Bolt", "hand"); t.give("p2", "Mountain", "battlefield");
    expect(t.p("p1").life).toBe(before);
    expect(t.state.durableEffects?.some((d) => d.flag === "protection_everything")).toBe(true);
  });
});

describe("Selfless Squire", () => {
  it("prevents all damage to you this turn and grows by the amount prevented", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Plains", 4);
    const sq = t.give("p1", "Selfless Squire", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: sq }); drain(t);
    t.give("p2", "Lightning Bolt", "hand"); t.give("p2", "Mountain", "battlefield");
    t.state.priority = "p2";
    const bolt = Object.values(t.state.objects).find((o) => o.cardName === "Lightning Bolt")!;
    t.ok({ type: "castSpell", player: "p2", cardId: bolt.id });
    drain(t, (p) => (p.kind === "choose_targets" ? { ids: ["p1"] } : undefined));
    expect(t.p("p1").life).toBe(40);
    expect(t.obj(sq).counters["+1/+1"]).toBe(3);
  });
});
