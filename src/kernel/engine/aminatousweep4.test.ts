import { describe, expect, it } from "vitest";
import { G, base, lands, labelPick, abId, toUpkeep } from "./aminatoukit";

const toAttackers = (g: G) => { const a = g.s.turn.active; for (let i = 0; i < 4 && g.s.turn.phase !== "declare_attackers"; i++) g.do(a, { type: "advancePhase", player: a } as never); };

describe("aminatou sweep: set 4", () => {
  it("Inkshield: prevents combat damage and makes 2/1 flying Inklings per point prevented", () => {
    const m = base(); lands(m, "p1", "Plains", "Plains", "Swamp", "Swamp", "Island");
    const atk = m.give("p2", "Ledger Shredder", "battlefield"); const ink = m.give("p1", "Inkshield", "hand");
    m.state.turn.active = "p2"; m.state.priority = "p2"; const g = new G(m);
    toAttackers(g);
    g.do("p2", { type: "declareAttackers", player: "p2", attackers: [{ id: atk, defender: "p1" }] } as never);
    g.do("p2", { type: "passPriority", player: "p2" });
    g.cast("p1", ink);
    // continue combat to end
    for (let i = 0; i < 8 && g.s.turn.phase !== "end_of_combat" && g.s.turn.phase !== "postcombat_main"; i++) {
      if (g.s.combat?.expect) { const ex = g.s.combat.expect as never as { kind: string; players?: string[] }; if (ex.kind === "blockers") for (const p of ex.players!) g.do(p, { type: "declareBlockers", player: p, blocks: [] } as never); continue; }
      g.do("p2", { type: "advancePhase", player: "p2" } as never); g.drive();
    }
    expect(g.pl("p1").life, g.log().join("\n")).toBe(40);
    const inks = g.find("Inkling", "battlefield"); expect(inks, g.log().join("\n")).toHaveLength(1);
    expect(g.chars(inks[0]).power).toBe(2); expect(g.chars(inks[0]).toughness).toBe(1);
  });
  it("Propaganda / Sphere of Safety: attacking costs {2} / {X} per attacker", () => {
    for (const [name, mana] of [["Propaganda", 2], ["Sphere of Safety", 1]] as const) {
      const m = base(); m.give("p1", name, "battlefield"); if (name === "Sphere of Safety") m.give("p1", "Greed", "battlefield");
      const atk = m.give("p2", "Ledger Shredder", "battlefield"); lands(m, "p2", "Island", "Island");
      m.state.turn.active = "p2"; m.state.priority = "p2"; const g = new G(m);
      toAttackers(g);
      // Sphere: X = enchantments p1 controls = 2 (Sphere + Greed)
      g.do("p2", { type: "declareAttackers", player: "p2", attackers: [{ id: atk, defender: "p1" }], autoPay: true } as never);
      g.drive();
      expect(g.s.battlefield.filter((i) => g.obj(i).controller === "p2" && g.obj(i).cardName === "Island" && g.obj(i).tapped).length, name).toBe(name === "Propaganda" ? 2 : 2);
      void mana;
    }
  });
  it("Arcane Denial: counters, both draw at next upkeep (caster up to two, you one)", () => {
    const m = base(); lands(m, "p1", "Island", "Island"); const dn = m.give("p1", "Arcane Denial", "hand");
    lands(m, "p2", "Island", "Island"); const lt = m.give("p2", "Brainstorm", "hand");
    m.state.turn.active = "p2"; m.state.priority = "p2"; const g = new G(m);
    g.do("p2", { type: "castSpell", player: "p2", cardId: lt, autoPay: true } as never);
    g.do("p2", { type: "passPriority", player: "p2" } as never);
    g.cast("p1", dn, { targets: { t1: [lt] } });
    expect(g.zone(lt), g.log().join("\n")).toBe("graveyard");
    const h1 = g.pl("p1").hand.length, h2 = g.pl("p2").hand.length;
    const ans = (p: never) => ((p as { numeric?: boolean }).numeric ? { number: (p as { max: number }).max } : undefined);
    toUpkeep(g, "p1", ans as never);
    expect(g.pl("p1").hand.length - h1, "caster-side draw").toBe(1); expect(g.pl("p2").hand.length - h2, g.asked.join()).toBe(2);
  });
});
