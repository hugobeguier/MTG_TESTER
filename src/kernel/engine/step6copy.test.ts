// Kernel step 6: becoming / entering as a copy (layer 1) with real drafts.
import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { charsOf, realDef, realTable } from "./testdb";
import { mk } from "./famkit";

const bear = mk("Grizzly Test", { manaCost: "{1}{G}", types: ["creature"], subtypes: ["Bear"], power: 2, toughness: 2 }, []);
const finish = (t: ReturnType<typeof realTable>, yes = true) => { for (let i = 0; i < 12 && (t.state.stack.length || t.state.pending); i++) { const p = t.state.pending; if (p) { t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: p.kind === "choose_yes_no" ? { yes } : { ids: [p.options[0].id] } }); } else t.pass(t.state.priority!); } };

describe("Cursed Mirror (enters as a copy of a creature until end of turn, with haste)", () => {
  it("is fully supported", () => { expect(cardUnsupported(realDef("Cursed Mirror")!).all).toEqual([]); });
  it("yes: it is a copy of the chosen creature with haste; at cleanup it is an artifact again", () => {
    const t = realTable(["p1", "p2"], { "Grizzly Test": bear });
    const target = t.give("p2", "Grizzly Test", "battlefield");
    t.lands("p1", "Mountain", 3);
    const mirror = t.give("p1", "Cursed Mirror", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: mirror });
    finish(t, true);
    const c = charsOf(t, mirror);
    expect(c.name).toBe("Grizzly Test");
    expect(c.types).toContain("creature");
    expect(c.keywords).toContain("haste");
    expect([c.power, c.toughness]).toEqual([2, 2]);
    expect(t.obj(target).zone).toBe("battlefield");
    // end of turn: the copy ends
    for (let i = 0; i < 40 && t.state.turn.number === 1; i++) { if (t.state.pending) break; t.ok({ type: "advancePhase", player: t.state.turn.active }); }
    expect(charsOf(t, mirror).name).toBe("Cursed Mirror");
  });
  it("no: it stays a Cursed Mirror (and still taps for {R})", () => {
    const t = realTable(["p1", "p2"], { "Grizzly Test": bear });
    t.give("p2", "Grizzly Test", "battlefield"); t.lands("p1", "Mountain", 3);
    const mirror = t.give("p1", "Cursed Mirror", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: mirror });
    finish(t, false);
    expect(charsOf(t, mirror).name).toBe("Cursed Mirror");
    expect(charsOf(t, mirror).types).toEqual(["artifact"]);
  });
  it("with no creature on the battlefield nothing is asked for the copy", () => {
    const t = realTable(); t.lands("p1", "Mountain", 3);
    const mirror = t.give("p1", "Cursed Mirror", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: mirror });
    finish(t, true);
    expect(charsOf(t, mirror).name).toBe("Cursed Mirror");
  });
});

describe("Estrid's Invocation (enters as a copy of an enchantment you control)", () => {
  it("is fully supported", () => { expect(cardUnsupported(realDef("Estrid's Invocation")!).all).toEqual([]); });
  it("copies the chosen enchantment and gains the upkeep exile-and-return ability", () => {
    const t = realTable(); t.lands("p1", "Island", 3);
    const ench = t.give("p1", "Crucible of Fire", "battlefield");
    const inv = t.give("p1", "Estrid's Invocation", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: inv });
    finish(t, true);
    const c = charsOf(t, inv);
    expect(c.name).toBe("Crucible of Fire");
    expect(c.abilities.some((a) => a.id === "copy:added" || a.text.includes("exile this enchantment"))).toBe(true);
  });
  it("declining keeps Estrid's Invocation itself", () => {
    const t = realTable(); t.lands("p1", "Island", 3);
    t.give("p1", "Crucible of Fire", "battlefield");
    const inv = t.give("p1", "Estrid's Invocation", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: inv });
    finish(t, false);
    expect(charsOf(t, inv).name).toBe("Estrid's Invocation");
  });
});
