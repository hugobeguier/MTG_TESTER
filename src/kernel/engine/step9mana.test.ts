// Kernel step 9: mana riders from real drafts (Path of Ancestry, Sunken Palace).
import { describe, expect, it } from "vitest";
import { filler, instant } from "./famkit";
import { cardUnsupported } from "./support";
import { realDef, realTable } from "./testdb";

const cards = { "Test Dragon": filler("Test Dragon", ["creature"], 2, 2, ["Dragon"]), "Test Elf": filler("Test Elf", ["creature"], 1, 1, ["Elf"]), "Test Cmdr": filler("Test Cmdr", ["creature"], 3, 3, ["Dragon"]) };

describe("step 9 mana riders", () => {
  it("both lands are fully supported", () => { for (const n of ["Path of Ancestry", "Sunken Palace"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); });
  const setup = (spellName: string) => {
    const t = realTable(["p1", "p2"], cards);
    const cmd = t.give("p1", "Test Cmdr", "command" as never); t.obj(cmd).isCommander = true; t.p("p1").colorIdentity = ["R"];
    const path = t.give("p1", "Path of Ancestry", "battlefield"); t.obj(path).tapped = false;
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", spellName, "hand") });
    return t;
  };
  it("Path of Ancestry: mana spent on a creature spell sharing a type with the commander scries", () => {
    const t = setup("Test Dragon");
    expect(t.state.triggerQueue.length + t.state.stack.length).toBeGreaterThan(1);
  });
  it("Path of Ancestry: no scry for a creature spell that shares no type", () => {
    const t = setup("Test Elf");
    expect(t.state.triggerQueue.length).toBe(0);
    expect(t.state.stack.length).toBe(1);
  });
  it("Sunken Palace: mana from its ability copies the spell it pays for", () => {
    const t = realTable(["p1", "p2"], { ...cards, "Draw One": instant("Draw One", "{U}", [{ kind: "draw_cards", who: "you", amount: 1 } as never]) });
    const pal = t.give("p1", "Sunken Palace", "battlefield"); t.obj(pal).tapped = false;
    t.give("p1", "Island", "battlefield"); t.give("p1", "Island", "battlefield");
    for (let i = 0; i < 7; i++) t.give("p1", "Test Elf", "graveyard");
    for (let i = 0; i < 5; i++) t.give("p1", "Island", "library");
    const a = realDef("Sunken Palace")!.kernel.abilities.filter((x) => x.kind === "mana")[1];
    t.ok({ type: "activateAbility", player: "p1", sourceId: pal, abilityId: a.id, color: "U" } as never);
    for (let i = 0; i < 3 && t.state.pending; i++) { const pd = t.state.pending as never as { kind: string; player: string; id: string; options?: Array<{ id: string }> }; t.ok(pd.kind === "choose_cards" ? { type: "answerDecision", player: pd.player, decisionId: pd.id, choice: { ids: pd.options!.slice(0, 7).map((o) => o.id) } } as never : { type: "answerDecision", player: pd.player, decisionId: pd.id, choice: { yes: true } } as never); }
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Draw One", "hand") });
    for (let i = 0; i < 12 && (t.state.pending || t.state.stack.length || t.state.triggerQueue.length); i++) { const pd = t.state.pending as never as { kind: string; player: string; id: string } | null; if (pd) t.ok({ type: "answerDecision", player: pd.player, decisionId: pd.id, choice: { yes: true } } as never); else if (t.state.stack.length) t.resolveTop(); else break; }
    expect(t.p("p1").hand.length).toBe(2);
  });
});
