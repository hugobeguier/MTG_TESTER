// The trigger-ordering decision shows, per entry, the source card, the ability's full text and the card that caused it (Redress Fate returning several enchantments).
import { describe, expect, it } from "vitest";
import { ctx, mini } from "./testgame";
import { toTableState } from "./tableState";
import { packKit } from "./cardPack";
import { buildPack } from "./nodePack";
import { causeLine, entriesChoice, entryText, orderEntries } from "../../components/game/kernelDecisionView";

const kit = packKit([buildPack("aminatou", { catalog: false })]);
const env = { ctx, display: kit.display };

describe("order_triggers carries the source and cause cards", () => {
  it("Redress Fate: one entry per (source, entering enchantment), each with the full text and the entering card", () => {
    const t = mini();
    for (let i = 0; i < 8; i++) t.give("p1", "Plains", "battlefield");
    const dg = t.give("p1", "Doomwake Giant", "graveyard");
    const fear = t.give("p1", "Fear of Sleep Paralysis", "graveyard");
    t.give("p1", "Boon of the Spirit Realm", "graveyard");
    t.give("p2", "Plains", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Redress Fate", "hand") });
    t.settle();
    expect(t.state.pending?.kind).toBe("order_triggers");
    const d = toTableState(t.state, "p1", env).decision!;
    expect(d.options.length).toBe(9); // three sources x three entering enchantments
    for (const o of d.options) {
      expect(o.card).toBeDefined(); expect(o.causeCard).toBeDefined();
      expect(o.text!.length).toBeGreaterThan(40); // the full ability text, not a truncated label
      expect(causeLine(o)).toMatch(/^because .* entered the battlefield$/);
    }
    const doom = d.options.filter((o) => o.card!.name === "Doomwake Giant");
    expect(doom.map((o) => o.causeCard!.name).sort()).toEqual(["Boon of the Spirit Realm", "Doomwake Giant", "Fear of Sleep Paralysis"]);
    expect(entryText(doom[0])).toContain("Constellation");
    // all different causes: nothing is merged
    expect(orderEntries(d).length).toBe(9);
    // the opponent sees nothing of it
    expect(toTableState(t.state, "p2", env).decision).toBeUndefined();
    void dg; void fear;
    // answering with the entries in the shown order works
    const keys = orderEntries(d).map((e) => e.key).reverse();
    t.answer(entriesChoice(d, keys));
    expect(t.state.pending?.kind).not.toBe("order_triggers");
  });
});
