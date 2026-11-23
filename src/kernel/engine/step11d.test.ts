// Kernel step 11 (d): Squirreled Away: Deep Forest Hermit (vanishing), Gourmand's Talent (class levels), Hazel of the Rootbloom (X mana), Insatiable Frugivore (repeat process),
// Rootcast Apprenticeship, Saw in Half (copy with set P/T from last-known information), The Odd Acorn Gang (granted activated ability).
import { describe, expect, it } from "vitest";
import { famCards, instant, mk } from "./famkit";
import { drain } from "./step10kit";
import { cardUnsupported } from "./support";
import { charsOf, realDef, realTable } from "./testdb";

const names = ["Deep Forest Hermit", "Gourmand's Talent", "Hazel of the Rootbloom", "Insatiable Frugivore", "Rootcast Apprenticeship", "Saw in Half", "The Odd Acorn Gang", "Scurry of Squirrels"];
describe("step 11d: supported", () => { for (const n of names) it(n, () => { expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); }); });

const squirrelTok = { name: "Squirrel", types: ["creature"], subtypes: ["Squirrel"], colors: ["green"], power: 1, toughness: 1, keywords: [] as string[] };
const token = (t: ReturnType<typeof realTable>, owner: string) => { const id = t.give(owner, "Fill A", "battlefield"); t.obj(id).token = structuredClone(squirrelTok) as never; t.obj(id).controlledSince = -1; return id; };

function untilUpkeep(t: ReturnType<typeof realTable>, who: string) {
  for (let i = 0; i < 60; i++) {
    drain(t);
    if (t.state.turn.phase === "upkeep" && t.state.turn.active === who) return;
    t.ok({ type: "advancePhase", player: t.state.turn.active });
  }
  throw new Error("never reached the upkeep");
}

describe("Deep Forest Hermit: vanishing 3", () => {
  it("enters with three time counters, four 1/1 Squirrels get +1/+1, sacrificed when the last counter goes", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Forest", 5);
    for (const p of ["p1", "p2"]) for (let i = 0; i < 15; i++) t.give(p, "Island", "library");
    const h = t.give("p1", "Deep Forest Hermit", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: h }); drain(t);
    expect(t.obj(h).counters.time).toBe(3);
    const sq = Object.values(t.state.objects).filter((o) => o.cardName === "Squirrel" && o.zone === "battlefield");
    expect(sq.length).toBe(4);
    expect(charsOf(t, sq[0].id).power).toBe(2);
    for (let n = 2; n >= 0; n--) { untilUpkeep(t, "p2"); untilUpkeep(t, "p1"); drain(t); expect(t.obj(h).counters.time ?? 0).toBe(n); }
    expect(t.obj(h).zone).toBe("graveyard");
  });
});

describe("Gourmand's Talent: a Class", () => {
  const heal = instant("Heal", "{W}", [{ kind: "life_change", who: "you", amount: 3 }]);
  const setup = () => {
    const t = realTable(["p1", "p2"], { Heal: heal, ...famCards });
    const c = t.give("p1", "Gourmand's Talent", "battlefield");
    t.lands("p1", "Forest", 6); t.lands("p1", "Plains", 4);
    return { t, c };
  };
  const doHeal = (t: ReturnType<typeof realTable>) => { t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Heal", "hand") }); drain(t); };
  const level = (t: ReturnType<typeof realTable>, c: string, id: "a3" | "a5") => { const r = t.do({ type: "activateAbility", player: "p1", sourceId: c, abilityId: id } as never); if (!r.error) drain(t); return r; };
  it("level 2: the first life gain each turn makes a 3/3 Raccoon", () => {
    const { t, c } = setup();
    expect(level(t, c, "a3").error).toBeUndefined();
    expect(t.obj(c).classLevel).toBe(2);
    doHeal(t); doHeal(t);
    expect(Object.values(t.state.objects).filter((o) => o.cardName === "Raccoon" && o.zone === "battlefield").length).toBe(1);
  });
  it("level 3 can only be gained from level 2; it puts +1/+1 counters on your creatures", () => {
    const { t, c } = setup();
    expect(level(t, c, "a5").error?.code).toBe("cannot_activate");
    level(t, c, "a3");
    expect(level(t, c, "a5").error).toBeUndefined();
    const bear = t.give("p1", "Fill A", "battlefield");
    doHeal(t);
    expect(t.obj(bear).counters["+1/+1"]).toBe(1);
  });
});

describe("Hazel of the Rootbloom: tap X tokens, add X mana", () => {
  it("asks X, which tokens, then the colors; pays 2 life", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    const h = t.give("p1", "Hazel of the Rootbloom", "battlefield"); t.obj(h).controlledSince = -1;
    const toks = [token(t, "p1"), token(t, "p1"), token(t, "p1")];
    const res = t.do({ type: "activateAbility", player: "p1", sourceId: h, abilityId: "a1" } as never);
    expect(res.error, res.error?.message).toBeUndefined();
    expect(t.state.pending!.kind).toBe("choose_number");
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { number: 2 } });
    expect(t.state.pending!.kind).toBe("choose_cards");
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: [toks[0], toks[2]] } });
    expect(t.state.pending!.kind).toBe("assign_mana");
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { assign: { R: 1, G: 1 } } });
    expect(t.p("p1").manaPool.R).toBe(1);
    expect(t.p("p1").manaPool.G).toBe(1);
    expect(t.p("p1").life).toBe(38);
    expect(t.obj(h).tapped).toBe(true);
    expect([t.obj(toks[0]).tapped, t.obj(toks[1]).tapped, t.obj(toks[2]).tapped]).toEqual([true, false, true]);
  });
});

describe("Insatiable Frugivore: repeat the process", () => {
  it("makes a Food each round and keeps going while three cards are exiled", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Swamp", 4);
    for (let i = 0; i < 6; i++) t.give("p1", "Island", "graveyard");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Insatiable Frugivore", "hand") });
    drain(t, (p) => (p.kind === "choose_yes_no" ? { yes: true } : undefined));
    expect(Object.values(t.state.objects).filter((o) => o.cardName === "Food" && o.zone === "battlefield").length).toBe(3);
    expect(t.p("p1").graveyard.length).toBe(0);
    expect(t.p("p1").exile.length).toBe(6);
  });
  it("stops when you decline", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Swamp", 4);
    for (let i = 0; i < 6; i++) t.give("p1", "Island", "graveyard");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Insatiable Frugivore", "hand") });
    drain(t, (p) => (p.kind === "choose_yes_no" ? { yes: false } : undefined));
    expect(Object.values(t.state.objects).filter((o) => o.cardName === "Food" && o.zone === "battlefield").length).toBe(1);
    expect(t.p("p1").graveyard.length).toBe(6);
  });
});

describe("Rootcast Apprenticeship: choose three modes", () => {
  it("can choose the same mode more than once", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Forest", 5);
    const bear = t.give("p1", "Fill A", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Rootcast Apprenticeship", "hand") });
    drain(t, (p) => (p.kind === "choose_modes" ? { ids: ["m3", "m3", "m1"] } : p.kind === "choose_targets" ? { ids: [p.options.find((o) => o.id === "p1" || o.id === bear)?.id ?? p.options[0].id] } : undefined));
    expect(Object.values(t.state.objects).filter((o) => o.cardName === "Squirrel" && o.zone === "battlefield").length).toBe(2);
  });
});

describe("Saw in Half", () => {
  it("destroys the creature and its controller gets two copies with half power and toughness, rounded up", () => {
    const big = mk("Big Guy", { manaCost: "{1}", types: ["creature"], power: 5, toughness: 3 }, []);
    const t = realTable(["p1", "p2"], { "Big Guy": big });
    const b = t.give("p2", "Big Guy", "battlefield");
    t.lands("p1", "Swamp", 3);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Saw in Half", "hand") });
    drain(t, (p) => (p.kind === "choose_targets" ? { ids: [b] } : undefined));
    expect(t.obj(b).zone).toBe("graveyard");
    const copies = Object.values(t.state.objects).filter((o) => o.cardName === "Big Guy" && o.zone === "battlefield");
    expect(copies.length).toBe(2);
    expect(copies.every((o) => o.controller === "p2")).toBe(true);
    expect(charsOf(t, copies[0].id).power).toBe(3);
    expect(charsOf(t, copies[0].id).toughness).toBe(2);
  });
});

describe("The Odd Acorn Gang", () => {
  it("Squirrels have the sorcery-speed pump ability", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    const g = t.give("p1", "The Odd Acorn Gang", "battlefield"); t.obj(g).controlledSince = -1;
    const s = token(t, "p1");
    const abilityId = `ga:${g}:x`;
    const r = t.do({ type: "activateAbility", player: "p1", sourceId: s, abilityId } as never);
    expect(r.error, r.error?.message).toBeUndefined();
    drain(t, (p) => (p.kind === "choose_targets" ? { ids: [s] } : undefined));
    expect(charsOf(t, s).power).toBe(3);
    expect(charsOf(t, s).keywords).toContain("trample");
  });
});
