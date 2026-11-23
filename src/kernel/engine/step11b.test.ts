// Kernel step 11 (b): Lathliss deck: Breaching Dragonstorm (move until, cast free or hand), Dragonhawk (saved_count), myriad (Goldlust Triad, Scurry of Squirrels).
import { describe, expect, it } from "vitest";
import { mk } from "./famkit";
import { drain, toAttackers } from "./step10kit";
import { cardUnsupported } from "./support";
import { realDef, realTable } from "./testdb";

const names = ["Breaching Dragonstorm", "Dragonhawk, Fate's Tempest", "Goldlust Triad", "Scurry of Squirrels"];
describe("step 11b: supported", () => { for (const n of names) it(n, () => { expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); }); });

const guy = (n: string, cost: string) => mk(n, { manaCost: cost, types: ["creature"], power: 2, toughness: 2 }, []);

describe("Breaching Dragonstorm", () => {
  const cards = { Cheap: guy("Cheap", "{2}"), Huge: guy("Huge", "{9}{9}") };
  const setup = (top: string) => {
    const t = realTable(["p1", "p2"], cards);
    t.give("p1", top, "library", { top: true }); const land = t.give("p1", "Island", "library", { top: true });
    t.lands("p1", "Mountain", 5);
    return { t, land };
  };
  it("exiles down to the first nonland card and casts it for free", () => {
    const { t, land } = setup("Cheap");
    const c = t.give("p1", "Breaching Dragonstorm", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: c });
    drain(t, (p) => (p.kind === "choose_yes_no" ? { yes: true } : undefined));
    expect(t.obj(land).zone).toBe("exile");
    const cheap = Object.values(t.state.objects).find((o) => o.cardName === "Cheap")!;
    expect(cheap.zone).toBe("battlefield");
  });
  it("declining puts that card into your hand", () => {
    const { t } = setup("Cheap");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Breaching Dragonstorm", "hand") });
    drain(t, (p) => (p.kind === "choose_yes_no" ? { yes: false } : undefined));
    const cheap = Object.values(t.state.objects).find((o) => o.cardName === "Cheap")!;
    expect(cheap.zone).toBe("hand");
  });
  it("a card with mana value over 8 goes to your hand without a question", () => {
    const { t } = setup("Huge");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Breaching Dragonstorm", "hand") });
    drain(t);
    const huge = Object.values(t.state.objects).find((o) => o.cardName === "Huge")!;
    expect(huge.zone).toBe("hand");
  });
});

describe("Dragonhawk, Fate's Tempest", () => {
  it("exiles X cards, and at your next end step deals 2 for each still exiled", () => {
    const big = mk("Big", { manaCost: "{1}", types: ["creature"], power: 4, toughness: 4 }, []);
    const t = realTable(["p1", "p2"], { Big: big });
    t.give("p1", "Big", "battlefield"); t.give("p1", "Big", "battlefield");
    for (let i = 0; i < 4; i++) t.give("p1", "Island", "library");
    t.give("p1", "Dragonhawk, Fate's Tempest", "hand"); t.lands("p1", "Mountain", 5);
    const hawk = Object.values(t.state.objects).find((o) => o.cardName === "Dragonhawk, Fate's Tempest")!;
    t.ok({ type: "castSpell", player: "p1", cardId: hawk.id });
    drain(t, (p) => (p.kind === "choose_yes_no" ? { yes: false } : undefined)); // do not play any of them
    expect(t.p("p1").exile.length).toBe(3); // the two 4/4s and Dragonhawk itself
    for (let i = 0; i < 12 && t.p("p2").life === 40 && t.state.turn.phase !== "end_step"; i++) t.ok({ type: "advancePhase", player: "p1" });
    drain(t);
    expect(t.p("p2").life).toBe(40 - 6);
  });
});

describe("Myriad", () => {
  it("Goldlust Triad: a tapped and attacking token for each other opponent, exiled at end of combat", () => {
    const t = realTable(["p1", "p2", "p3", "p4"]);
    const g = t.give("p1", "Goldlust Triad", "battlefield"); t.obj(g).controlledSince = -1;
    toAttackers(t);
    t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: g, defender: "p2" }] });
    drain(t, (p) => (p.kind === "choose_yes_no" ? { yes: true } : undefined));
    const tokens = Object.values(t.state.objects).filter((o) => o.cardName === "Goldlust Triad" && o.id !== g && o.zone === "battlefield");
    expect(tokens.length).toBe(2);
    expect(tokens.every((o) => o.tapped)).toBe(true);
    expect(t.state.combat!.attackers.map((a) => a.defender).sort()).toEqual(["p2", "p3", "p4"]);
    for (let i = 0; i < 8 && t.state.combat; i++) { t.ok({ type: "advancePhase", player: "p1" }); drain(t); }
    expect(Object.values(t.state.objects).filter((o) => o.cardName === "Goldlust Triad" && o.id !== g && o.zone === "battlefield").length).toBe(0);
  });
  it("Scurry of Squirrels: myriad twice makes two copies per other opponent", () => {
    const t = realTable(["p1", "p2", "p3"]);
    const g = t.give("p1", "Scurry of Squirrels", "battlefield"); t.obj(g).controlledSince = -1;
    toAttackers(t);
    t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: g, defender: "p2" }] });
    drain(t, (p) => (p.kind === "choose_yes_no" ? { yes: true } : undefined));
    expect(Object.values(t.state.objects).filter((o) => o.cardName === "Scurry of Squirrels" && o.id !== g && o.zone === "battlefield").length).toBe(2);
  });
});
