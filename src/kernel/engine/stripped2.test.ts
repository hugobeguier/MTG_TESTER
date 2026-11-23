// "Loses all abilities" (Utter Insignificance) across every kind of ability a permanent generates, on REAL drafts: static anthems, triggers,
// mana abilities, cost reductions, cast permissions, attack taxes, target taxes, keywords, replacement effects, and abilities granted afterwards.
import { describe, expect, it } from "vitest";
import { mk } from "./famkit";
import { drain } from "./step10kit";
import { restrictionsOf, targetCostExtras } from "./layers";
import { CARDS } from "./testcards";
import { charsOf, ctxOf, realTable } from "./testdb";
import type { Table } from "./testkit";
import type { Run } from "./core";
import type { ObjId } from "./types";

const dragon = mk("Test Dragon", { manaCost: "{1}", types: ["creature"], subtypes: ["Dragon"], power: 2, toughness: 2 }, []);
const bear = mk("Bear", { manaCost: "{1}", types: ["creature"], power: 2, toughness: 2 }, []);
const whiteBear = mk("White Bear", { manaCost: "{W}", types: ["creature"], colors: ["W"], power: 2, toughness: 2 } as never, []);
const EXTRA = { "Test Dragon": dragon, Bear: bear, "White Bear": whiteBear, "Haste Rune": CARDS["Haste Rune"], "Trample Rune": CARDS["Trample Rune"] };
const mkTable = () => realTable(["p1", "p2"], EXTRA);
const run = (t: Table): Run => ({ s: structuredClone(t.state), events: [], defs: ctxOf(t).cards, scanned: 0 }) as never;

/** p1 casts Utter Insignificance on `target` (paying with two extra Islands) */
function strip(t: Table, target: ObjId): ObjId {
  t.lands("p1", "Island", 2);
  const aura = t.give("p1", "Utter Insignificance", "hand");
  t.ok({ type: "castSpell", player: "p1", cardId: aura, targets: { t1: [target] } }); drain(t);
  expect(t.obj(aura).attachedTo).toBe(target);
  return aura;
}

describe("stripped permanents: every ability class", () => {
  it("static anthem (Deathbringer Liege): the +1/+1 stops", () => {
    const t = mkTable();
    const liege = t.give("p1", "Deathbringer Liege", "battlefield");
    const wb = t.give("p1", "White Bear", "battlefield");
    expect(charsOf(t, wb).power).toBe(3);
    strip(t, liege);
    expect(charsOf(t, wb).power).toBe(2);
    expect(charsOf(t, liege)).toMatchObject({ power: 1, toughness: 1 });
  });

  it("keyword (Angelic Field Marshal flying)", () => {
    const t = mkTable();
    const m = t.give("p1", "Angelic Field Marshal", "battlefield");
    expect(charsOf(t, m).keywords).toContain("flying");
    strip(t, m);
    expect(charsOf(t, m).keywords).toEqual([]);
  });

  it("triggered (Esper Sentinel): no draw trigger when the opponent casts a noncreature spell", () => {
    const run1 = (stripped: boolean) => {
      const t = mkTable();
      const s = t.give("p1", "Esper Sentinel", "battlefield");
      if (stripped) strip(t, s);
      t.give("p2", "Mountain", "battlefield");
      t.state.priority = "p2"; t.state.turn.active = "p2";
      t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Lightning Bolt", "hand"), targets: { t1: [s] } });
      return t.state.stack.filter((i) => i.kind === "triggered").length;
    };
    expect(run1(false)).toBe(1);
    expect(run1(true)).toBe(0);
  });

  it("mana ability (Llanowar Elves): cannot be activated while stripped", () => {
    const t = mkTable();
    const e = t.give("p1", "Llanowar Elves", "battlefield"); t.obj(e).controlledSince = -1;
    expect(t.do({ type: "activateAbility", player: "p1", sourceId: e, abilityId: "a1" }).error).toBeUndefined();
    const t2 = mkTable();
    const e2 = t2.give("p1", "Llanowar Elves", "battlefield"); t2.obj(e2).controlledSince = -1;
    strip(t2, e2);
    expect(t2.do({ type: "activateAbility", player: "p1", sourceId: e2, abilityId: "a1" }).error).toBeTruthy();
  });

  it("cost reduction (Dragonspeaker Shaman): Dragon spells cost {2} less only while it has the ability", () => {
    const attempt = (stripped: boolean) => {
      const t = mkTable();
      const sh = t.give("p1", "Dragonspeaker Shaman", "battlefield");
      if (stripped) strip(t, sh);
      t.lands("p1", "Mountain", 4);
      return t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Ancient Copper Dragon", "hand") }).error;
    };
    expect(attempt(false)).toBeUndefined();
    expect(attempt(true)).toBeTruthy();
  });

  it("cast permission (Rivaz of the Claw): no Dragon from the graveyard while stripped", () => {
    const t = mkTable();
    const rv = t.give("p1", "Rivaz of the Claw", "battlefield");
    strip(t, rv);
    for (let i = 0; i < 4; i++) t.give("p1", "Island", "battlefield");
    const d = t.give("p1", "Test Dragon", "graveyard");
    expect(t.do({ type: "castSpell", player: "p1", cardId: d }).error).toBeTruthy();
  });

  it("attack tax (Archangel of Tithes): no tax on attackers while stripped", () => {
    const t = mkTable();
    const a = t.give("p1", "Archangel of Tithes", "battlefield");
    const att = t.give("p2", "Bear", "battlefield");
    expect(restrictionsOf(run(t), att).some((x) => x.kind === "attackTax")).toBe(true);
    strip(t, a);
    expect(restrictionsOf(run(t), att).some((x) => x.kind === "attackTax")).toBe(false);
  });

  it("granted static (Callaphe): the targeting tax it grants stops", () => {
    const t = mkTable();
    const c = t.give("p1", "Callaphe, Beloved of the Sea", "battlefield");
    const b = t.give("p1", "Bear", "battlefield");
    expect(targetCostExtras(run(t), "p2", [b]).generic).toBe(1);
    strip(t, c);
    expect(targetCostExtras(run(t), "p2", [b]).generic).toBe(0);
  });

  it("replacement effect (Giada): other Angels enter without the extra counter", () => {
    const enter = (stripped: boolean) => {
      const t = mkTable();
      const g = t.give("p1", "Giada, Font of Hope", "battlefield");
      if (stripped) strip(t, g);
      t.lands("p1", "Plains", 3);
      const a = t.give("p1", "Angel of Vitality", "hand");
      t.ok({ type: "castSpell", player: "p1", cardId: a }); drain(t);
      expect(t.obj(a).zone).toBe("battlefield");
      return t.obj(a).counters["+1/+1"] ?? 0;
    };
    expect(enter(false)).toBeGreaterThan(0);
    expect(enter(true)).toBe(0);
  });

  it("the Aura keeps its OWN abilities: its {2}{C} exile ability works and exiles the creature", () => {
    const t = mkTable();
    const m = t.give("p1", "Llanowar Elves", "battlefield");
    const aura = strip(t, m);
    t.give("p1", "Sol Ring", "battlefield");
    t.give("p1", "Island", "battlefield");
    const res = t.do({ type: "activateAbility", player: "p1", sourceId: aura, abilityId: "a4" });
    expect(res.error, res.error?.message).toBeUndefined();
    drain(t);
    expect(t.obj(m).zone).toBe("exile");
  });

  it("a creature that dies while stripped does not fire its own 'dies' trigger (Myr Retriever)", () => {
    const dies = (stripped: boolean) => {
      const t = mkTable();
      const r = t.give("p1", "Myr Retriever", "battlefield");
      t.give("p1", "Sol Ring", "graveyard");
      if (stripped) strip(t, r);
      t.give("p1", "Mountain", "battlefield");
      t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Lightning Bolt", "hand"), targets: { t1: [r] } });
      drain(t);
      expect(t.obj(r).zone).toBe("graveyard");
      return t.p("p1").hand.some((id) => t.obj(id).cardName === "Sol Ring");
    };
    expect(dies(false)).toBe(true);
    expect(dies(true)).toBe(false);
  });

  it("abilities granted AFTER the strip are kept, earlier ones lost (haste before, trample after)", () => {
    const t = mkTable();
    const b = t.give("p1", "Bear", "battlefield");
    t.lands("p1", "Forest", 2);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Haste Rune", "hand"), targets: { t1: [b] } }); drain(t);
    strip(t, b);
    t.give("p1", "Forest", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Trample Rune", "hand"), targets: { t1: [b] } }); drain(t);
    expect(charsOf(t, b).keywords).toEqual(["trample"]);
  });
});
