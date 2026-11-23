// Kernel step 9: cumulative upkeep (Mystic Remora), phasing (Vanishing), exploit (Sidisi), unless-sacrifice (Ygra's ward).
import { describe, expect, it } from "vitest";
import { filler } from "./famkit";
import { cardUnsupported } from "./support";
import { realDef, realTable, charsOf } from "./testdb";
import type { Table } from "./testkit";

const cards = { "Test Elf": filler("Test Elf", ["creature"], 1, 1, ["Elf"]) };
const rt = () => realTable(["p1", "p2"], cards);
const settle = (t: Table, pick?: (o: Array<{ id: string }>) => string, yes = true) => { for (let i = 0; i < 25; i++) { const p = t.state.pending as never as { kind: string; player: string; id: string; options?: Array<{ id: string }> } | null; if (p) t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: p.kind === "choose_yes_no" || p.kind === "pay_unless" ? { yes, ids: [yes ? "yes" : "no"] } : { ids: [pick ? pick(p.options!) : p.options![0].id] } } as never); else if (t.state.stack.length) t.resolveTop(); else if (t.state.triggerQueue.length) t.ok({ type: "passPriority", player: t.state.priority! }); else break; } };
const toUpkeep = (t: Table, pid: string) => { const n0 = t.state.turn.number; for (let i = 0; i < 200 && !(t.state.turn.active === pid && t.state.turn.number > n0 && t.state.turn.phase === "upkeep"); i++) { if (t.state.pending) settle(t); else t.ok({ type: "passPriority", player: t.state.priority! }); } };

describe("step 9 keywords", () => {
  it("all four cards are supported", () => { for (const n of ["Mystic Remora", "Vanishing", "Sidisi, Undead Vizier", "Ygra, Eater of All"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); });

  it("cumulative upkeep: a counter each upkeep, the cost grows, not paying sacrifices", () => {
    const t = rt(); const rem = t.give("p1", "Mystic Remora", "battlefield"); for (let i = 0; i < 20; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
    for (let i = 0; i < 4; i++) t.give("p1", "Island", "battlefield");
    toUpkeep(t, "p1");
    settle(t); // the trigger resolves; the {1} is paid
    expect(t.obj(rem).counters.age).toBe(1);
    expect(t.p("p1").manaPool.W + t.p("p1").manaPool.U).toBe(0);
    expect(t.obj(rem).zone).toBe("battlefield");
  });

  it("phasing: Vanishing phases the creature (and itself) out; they return in the controller's untap step", () => {
    const t = rt(); const e = t.give("p1", "Test Elf", "battlefield"); const v = t.give("p1", "Vanishing", "battlefield");
    t.obj(v).attachedTo = e; t.obj(v).attachedToTs = t.obj(e).timestamp;
    t.give("p1", "Island", "battlefield"); t.give("p1", "Island", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: v, abilityId: "a2" }); settle(t);
    expect(t.state.battlefield).not.toContain(e);
    expect(t.state.battlefield).not.toContain(v);
    expect(t.state.phased?.length).toBe(2);
  });

  it("exploit: Sidisi may sacrifice a creature when it enters and then tutors", () => {
    const t = rt(); const elf = t.give("p1", "Test Elf", "battlefield");
    for (let i = 0; i < 5; i++) t.give("p1", "Swamp", "battlefield");
    const lib = t.give("p1", "Island", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Sidisi, Undead Vizier", "hand") });
    settle(t, (o) => (o.find((x) => x.id === lib) ?? o.find((x) => x.id === elf) ?? o[0]).id);
    expect(t.obj(elf).zone).toBe("graveyard");
    expect(t.obj(lib).zone).toBe("hand");
  });

  it("devour: Ribtruss Roaster enters with a counter for each creature sacrificed", () => {
    expect(cardUnsupported(realDef("Ribtruss Roaster")!).all).toEqual([]);
    const t = rt(); const e1 = t.give("p1", "Test Elf", "battlefield"), e2 = t.give("p1", "Test Elf", "battlefield");
    for (let i = 0; i < 6; i++) t.give("p1", "Forest", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Ribtruss Roaster", "hand") });
    for (let i = 0; i < 6; i++) { const p = t.state.pending as never as { kind: string; player: string; id: string; options: Array<{ id: string }> } | null; if (p) t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: { ids: [e1, e2] } } as never); else if (t.state.stack.length) t.resolveTop(); else break; }
    const roaster = t.state.battlefield.map((id) => t.obj(id)).find((o) => o.cardName === "Ribtruss Roaster")!;
    expect(roaster.counters["+1/+1"]).toBe(2);
    expect([t.obj(e1).zone, t.obj(e2).zone]).toEqual(["graveyard", "graveyard"]);
  });

  it("morph: Grim Haruspex is cast face down for {3} as a nameless 2/2 and turns face up for its morph cost", () => {
    expect(cardUnsupported(realDef("Grim Haruspex")!).all).toEqual([]);
    const t = rt();
    for (let i = 0; i < 4; i++) t.give("p1", "Swamp", "battlefield");
    const card = t.give("p1", "Grim Haruspex", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: card, option: "morph" }); t.resolveTop();
    expect(t.obj(card).faceDown).toBe(true);
    expect(charsOf(t, card)).toMatchObject({ name: "", power: 2, toughness: 2 });
    t.ok({ type: "turnFaceUp", player: "p1", objectId: card }); // a special action: no stack
    expect(t.state.stack.length).toBe(0);
    expect(t.obj(card).faceDown).toBeFalsy();
    expect(charsOf(t, card).name).toBe("Grim Haruspex");
  });

  it("prepared: a prepared Eccentric Pestfinder casts a copy of Turn Stones once", () => {
    for (const n of ["Eccentric Pestfinder // Turn Stones", "Stensian Sanguinist // Exsanguinate"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]);
    const t = rt(); const pf = t.give("p1", "Eccentric Pestfinder // Turn Stones", "battlefield");
    for (let i = 0; i < 4; i++) { t.give("p1", "Forest", "battlefield"); t.give("p1", "Swamp", "battlefield"); }
    t.obj(pf).prepared = true;
    t.ok({ type: "castPrepared", player: "p1", objectId: pf });
    expect(t.state.stack.length).toBe(1); // a real spell on the stack: it can be responded to / countered
    expect(t.state.objects[t.state.stack[0].objectId!].isCopy).toBe(true);
    expect(t.obj(pf).prepared).toBeFalsy();
    settle(t);
    expect(t.state.battlefield.map((id) => t.obj(id).cardName)).toContain("Pest");
    expect(() => t.ok({ type: "castPrepared", player: "p1", objectId: pf })).toThrow();
  });
});
