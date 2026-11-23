// Kernel step 10 (b): casting permissions (Rivaz, Demon of Fate's Design, Timely Ward), stun counters (Fear of Sleep Paralysis), Rooms-inert markers.
import { describe, expect, it } from "vitest";
import { instant, mk } from "./famkit";
import { drain } from "./step10kit";
import { cardUnsupported } from "./support";
import { charsOf, realDef, realTable } from "./testdb";
import type { Table } from "./testkit";

const names = ["Rivaz of the Claw", "Demon of Fate's Design", "Timely Ward", "Fear of Sleep Paralysis", "Inquisitive Glimmer", "Callaphe, Beloved of the Sea"];
describe("step 10b: supported", () => { for (const n of names) it(n, () => { expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); }); });

const dragon = mk("Test Dragon", { manaCost: "{1}", types: ["creature"], subtypes: ["Dragon"], power: 2, toughness: 2 }, []);
const bear = mk("Bear", { manaCost: "{1}", types: ["creature"], power: 2, toughness: 2 }, []);
const ench = mk("Test Aura Thing", { manaCost: "{3}{U}", types: ["enchantment"] }, []);

describe("Rivaz of the Claw", () => {
  it("casts a Dragon creature spell from the graveyard once per turn, and only Dragons", () => {
    const t = realTable(["p1", "p2"], { "Test Dragon": dragon, "Bear": bear });
    t.give("p1", "Rivaz of the Claw", "battlefield");
    for (let i = 0; i < 4; i++) t.give("p1", "Island", "battlefield");
    const d1 = t.give("p1", "Test Dragon", "graveyard"), d2 = t.give("p1", "Test Dragon", "graveyard"), b = t.give("p1", "Bear", "graveyard");
    expect(t.do({ type: "castSpell", player: "p1", cardId: b }).error).toBeTruthy();
    t.ok({ type: "castSpell", player: "p1", cardId: d1 }); drain(t);
    expect(t.obj(d1).zone).toBe("battlefield");
    expect(charsOf(t, d1).abilities.some((a) => a.kind === "triggered" && a.trigger?.event === "dies")).toBe(true); // "gains: when this dies, exile it"
    expect(t.do({ type: "castSpell", player: "p1", cardId: d2 }).error).toBeTruthy(); // once per turn
  });
});

describe("Demon of Fate's Design", () => {
  it("casts an enchantment by paying life equal to its mana value, once per turn", () => {
    const t = realTable(["p1", "p2"], { "Test Aura Thing": ench });
    t.give("p1", "Demon of Fate's Design", "battlefield");
    const e1 = t.give("p1", "Test Aura Thing", "hand"), e2 = t.give("p1", "Test Aura Thing", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: e1, option: "lifecast1:" + t.state.battlefield[0] }); drain(t);
    expect(t.obj(e1).zone).toBe("battlefield");
    expect(t.p("p1").life).toBe(36);
    expect(t.do({ type: "castSpell", player: "p1", cardId: e2 }).error).toBeTruthy(); // no mana, and the life option is spent
  });
});

describe("Timely Ward: flash if it targets a commander", () => {
  it("is castable at instant speed only when the target is a commander", () => {
    const t = realTable(["p1", "p2"], { "Bear": bear });
    t.state.turn.active = "p2"; t.state.priority = "p1";
    t.give("p1", "Plains", "battlefield"); t.give("p1", "Plains", "battlefield"); t.give("p1", "Plains", "battlefield"); t.give("p1", "Plains", "battlefield");
    const cmd = t.give("p2", "Bear", "battlefield"); t.obj(cmd).isCommander = true;
    const plain = t.give("p2", "Bear", "battlefield");
    const w = t.give("p1", "Timely Ward", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: w, targets: { t1: [plain] } }).error?.code).toBe("wrong_timing");
    expect(t.do({ type: "castSpell", player: "p1", cardId: w, targets: { t1: [cmd] } }).error).toBeUndefined();
  });
});

const endTurns = (t: Table, n: number): void => { for (let i = 0; i < 40 && t.state.turn.number < n; i++) { if (t.state.pending) drain(t); else t.ok({ type: "advancePhase", player: t.state.turn.active }); } };
describe("stun counters / Fear of Sleep Paralysis", () => {
  const setup = () => { const t = realTable(["p1", "p2"], { "Bear": bear }); for (let i = 0; i < 12; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); } return t; };
  it("a stun counter is removed instead of untapping", () => {
    const t = setup(); const b = t.give("p2", "Bear", "battlefield", { tapped: true, counters: { stun: 1 } });
    endTurns(t, 3); // p2's untap step happens in turn 2
    expect(t.obj(b).tapped).toBe(true); expect(t.obj(b).counters.stun ?? 0).toBe(0);
    endTurns(t, 5);
    expect(t.obj(b).tapped).toBe(false);
  });
  it("with Fear of Sleep Paralysis the stun counter stays and the creature stays tapped", () => {
    const t = setup(); t.give("p1", "Fear of Sleep Paralysis", "battlefield");
    const b = t.give("p2", "Bear", "battlefield", { tapped: true, counters: { stun: 1 } });
    endTurns(t, 5);
    expect(t.obj(b).tapped).toBe(true); expect(t.obj(b).counters.stun).toBe(1);
  });
});
