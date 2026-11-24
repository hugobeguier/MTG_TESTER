// Free casts and alternative costs through the cast-option stage with the REAL drafts, manual payment on (the user's bug: Omniscience out, the pay banner opened anyway).
import { describe, expect, it } from "vitest";
import { legalActions } from "./legal";
import { mk } from "./famkit";
import { ctxOf, realTable } from "./testdb";
import type { Table } from "./testkit";

const tax = mk("Tax Rock", { manaCost: "{1}", types: ["artifact"] }, [{ id: "a1", kind: "static", text: "Creature spells cost {2} more", static: { affects: "each_player", modify: [{ costMod: { filter: { types: ["creature"] }, delta: 2 } }] } } as never]);
const manual = (n = 2): Table => { const t = realTable(["p1", "p2", "p3", "p4"].slice(0, n), { "Tax Rock": tax }); t.state.config.manualPay = ["p1"]; t.state.turn.phase = "postcombat_main"; return t; };
const lands = (t: Table, n = 8) => { for (let i = 0; i < n; i++) t.give("p1", ["Plains", "Island", "Swamp"][i % 3], "battlefield"); };
const opts = (t: Table) => (t.state.pending as never as { options: Array<{ id: string; label: string }> }).options;
const legal = (t: Table) => legalActions(t.state, "p1", ctxOf(t) as never);

/** cast a card the way the UI does until it settles; `way` answers the cast-option question ("free" = the first option offered), targets get the first option */
function cast(t: Table, id: string, way: "free" | "normal" | "ask" = "free") {
  let res = t.do({ type: "castSpell", player: "p1", cardId: id } as never);
  for (let i = 0; i < 6 && t.state.pending; i++) {
    const p = t.state.pending as never as { kind: string; id: string; options: Array<{ id: string }> };
    if (p.kind === "choose_cast_option") { if (way === "ask") return res; res = t.do({ type: "answerDecision", player: "p1", decisionId: p.id, choice: { ids: [way === "normal" ? "normal" : p.options[0].id] } } as never); if (res.error) throw new Error(res.error.message); }
    else if (p.kind === "choose_targets") res = t.do({ type: "answerDecision", player: "p1", decisionId: p.id, choice: { ids: [p.options[0].id] } } as never);
    else break;
  }
  return res;
}

describe("Omniscience (cast spells from your hand without paying their mana costs)", () => {
  for (const name of ["Esper Sentinel", "Blasphemous Edict", "Timely Ward", "Swords to Plowshares"]) {
    for (const phase of ["precombat_main", "postcombat_main"] as const) {
      it(`${name} in ${phase}: the free way is offered first and no payment is asked`, () => {
        const t = manual(); lands(t); t.state.turn.phase = phase;
        t.give("p1", "Omniscience", "battlefield"); t.give("p2", "Ledger Shredder", "battlefield");
        const c = t.give("p1", name, "hand");
        cast(t, c, "ask");
        expect(t.state.pending?.kind).toBe("choose_cast_option");
        expect(opts(t).map((o) => o.label)).toEqual(["Cast without paying its mana cost (Omniscience)", "Pay its mana cost"]);
        cast(t, c, "free");
        expect(t.state.pending?.kind).not.toBe("pay_mana");
        expect(t.state.stack.length).toBe(1);
        expect(Object.values(t.p("p1").manaPool).reduce((a, b) => a + b, 0)).toBe(0);
      });
    }
  }
  it("choosing to pay normally still works (the pay banner opens for the full cost)", () => {
    const t = manual(); lands(t); t.give("p1", "Omniscience", "battlefield");
    const c = t.give("p1", "Esper Sentinel", "hand");
    cast(t, c, "normal");
    expect(t.state.pending?.kind).toBe("pay_mana");
  });
  it("an instant on an opponent's turn is free too", () => {
    const t = manual(); t.state.turn.active = "p2"; t.state.turn.phase = "precombat_main"; t.state.priority = "p1";
    t.give("p1", "Omniscience", "battlefield");
    const c = t.give("p1", "Swords to Plowshares", "hand"); t.give("p2", "Ledger Shredder", "battlefield");
    cast(t, c, "free");
    expect(t.state.pending?.kind).not.toBe("pay_mana");
    expect(t.state.stack.length).toBe(1);
  });
  it("the legal list marks the free way (free: true) and labels it with its source", () => {
    const t = manual(); lands(t); t.give("p1", "Omniscience", "battlefield");
    const c = t.give("p1", "Timely Ward", "hand"); t.give("p2", "Ledger Shredder", "battlefield");
    const ways = legal(t).filter((a) => a.kind === "castSpell" && a.objectId === c);
    expect(ways.map((a) => [a.free ?? false, a.label])).toContainEqual([true, "Cast Timely Ward without paying its mana cost (Omniscience)"]);
    expect(ways.some((a) => !a.free)).toBe(true);
  });
  it("what is not waived is still owed and the banner says so (a cost increase)", () => {
    const t = manual(); lands(t); t.give("p1", "Omniscience", "battlefield"); t.give("p2", "Tax Rock", "battlefield");
    const c = t.give("p1", "Esper Sentinel", "hand");
    t.give("p1", "Esper Sentinel", "hand");
    cast(t, c, "free");
    expect(t.state.pending?.kind).toBe("pay_mana");
    const pay = (t.state.pending as never as { pay: { cost: string; parts: Array<{ label: string }> } }).pay;
    expect(pay.cost).toBe("{2}");
    expect(pay.parts.map((p) => p.label)).toEqual(["Mana cost waived by Omniscience", "Cost increases"]);
  });
});

describe("One with the Multiverse (once each turn, from hand or library top)", () => {
  it("free once, then the next card is paid normally; 4 players", () => {
    const t = manual(4); lands(t); t.give("p1", "One with the Multiverse", "battlefield");
    const a = t.give("p1", "Esper Sentinel", "hand"), b = t.give("p1", "Esper Sentinel", "hand");
    cast(t, a, "ask");
    expect(opts(t)[0].label).toBe("Cast without paying its mana cost (One with the Multiverse)");
    cast(t, a, "free");
    expect(t.state.stack.length).toBe(1);
    cast(t, b, "ask");
    expect(t.state.pending?.kind).not.toBe("choose_cast_option"); // no free way left
  });
});

describe("Dracogenesis / Rivaz of the Claw / Demon of Fate's Design / Flawless Maneuver", () => {
  it("Dracogenesis: a Dragon is free, a non-Dragon is not offered the free way", () => {
    const t = manual(); lands(t); t.give("p1", "Dracogenesis", "battlefield");
    const d = t.give("p1", "Ancient Gold Dragon", "hand"), e = t.give("p1", "Esper Sentinel", "hand");
    cast(t, d, "ask");
    expect(opts(t)[0].label).toBe("Cast without paying its mana cost (Dracogenesis)");
    cast(t, d, "free");
    expect(t.state.pending?.kind).not.toBe("pay_mana");
    expect(legal(t).filter((a) => a.kind === "castSpell" && a.objectId === e).some((a) => a.free)).toBe(false);
  });
  it("Rivaz of the Claw: a Dragon from the graveyard once each turn, not asked for mana by the free option", () => {
    const t = manual(); lands(t); t.give("p1", "Rivaz of the Claw", "battlefield");
    const d = t.give("p1", "Ancient Gold Dragon", "graveyard");
    cast(t, d, "free");
    expect(t.obj(d).zone).toBe("stack");
  });
  it("Demon of Fate's Design: an enchantment for life equal to its mana value, no mana asked", () => {
    const t = manual(); t.give("p1", "Demon of Fate's Design", "battlefield");
    const c = t.give("p1", "Timely Ward", "hand"); t.give("p2", "Ledger Shredder", "battlefield");
    const life = t.p("p1").life;
    cast(t, c, "ask");
    expect(opts(t).map((o) => o.label)).toContain("Pay life equal to its mana value instead of its mana cost (Demon of Fate's Design)");
    const way = opts(t).find((o) => o.id.startsWith("lifecast1:"))!.id;
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: [way] } } as never);
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: [(t.state.pending as never as { options: Array<{ id: string }> }).options[0].id] } } as never);
    expect(t.state.pending?.kind).not.toBe("pay_mana");
    expect(t.p("p1").life).toBeLessThan(life);
  });
  it("Flawless Maneuver with a commander: the free way is offered and costs nothing", () => {
    const t = manual();
    const cmd = t.give("p1", "Ledger Shredder", "battlefield"); t.state.objects[cmd].isCommander = true;
    const c = t.give("p1", "Flawless Maneuver", "hand");
    cast(t, c, "ask");
    expect(opts(t).map((o) => o.label)).toEqual(["Cast without paying its mana cost", "Pay its mana cost"]);
    cast(t, c, "free");
    expect(t.state.pending?.kind).not.toBe("pay_mana");
    expect(t.state.stack.length).toBe(1);
  });
  it("Rishkar's Expertise: the free cast of a spell with mana value 5 or less never opens the pay banner", () => {
    const t = manual(); lands(t); for (const id of t.lands("p1", "Forest", 6)) t.ok({ type: "activateAbility", player: "p1", sourceId: id, abilityId: "a1" } as never); // the {4}{G}{G} of Rishkar's Expertise, tapped by hand
    const big = t.give("p1", "Ledger Shredder", "battlefield");
    void big;
    const rx = t.give("p1", "Rishkar's Expertise", "hand");
    const target = t.give("p1", "Esper Sentinel", "hand");
    for (let i = 0; i < 3; i++) t.give("p1", "Island", "library");
    cast(t, rx, "normal");
    for (let i = 0; i < 12 && t.state.pending?.kind !== "pay_mana" && (t.state.stack.length || t.state.pending); i++) {
      const p = t.state.pending as never as { kind: string; id: string; player: string; options?: Array<{ id: string }> } | null;
      if (p) { const ids = p.kind === "choose_cast_option" || p.kind === "choose_cards" || p.kind === "choose_option" || p.kind === "choose_yes_no" ? [p.options![0].id] : []; t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: { ids } } as never); }
      else t.resolveTop();
    }
    expect(t.state.pending?.kind).not.toBe("pay_mana");
    expect(["stack", "battlefield"]).toContain(t.obj(target).zone);
  });
});
