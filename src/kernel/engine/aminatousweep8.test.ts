import { describe, expect, it } from "vitest";
import { G, base, lands } from "./aminatoukit";

const J = (g: G) => g.log().join(String.fromCharCode(10));
const putBack = (p: { kind: string; min: number; options: Array<{ id: string; label: string }> }) => (p.kind === "choose_cards" && p.options.some((o) => /Island|Swamp/.test(o.label)) ? { ids: p.options.filter((o) => /Island|Swamp/.test(o.label)).slice(0, p.min).map((o) => o.id) } : undefined);

function scene(transformed: boolean) {
  const m = base(); lands(m, "p1", "Plains", "Plains"); lands(m, "p2", "Island");
  const h = m.give("p1", "Heliod, the Radiant Dawn", "battlefield"); if (transformed) m.state.objects[h].face = "Heliod, the Warped Eclipse";
  const sig = m.give("p1", "Sigil of the Empty Throne", "hand"); const bs = m.give("p2", "Brainstorm", "hand");
  m.state.turn.active = "p2"; m.state.priority = "p2";
  const g = new G(m);
  g.cast("p2", bs, {}, putBack as never); // p2 draws three cards on its own turn
  return { g, sig };
}
describe("aminatou sweep: set 8", () => {
  it("Heliod, the Warped Eclipse: flash + {1} less per card the opponents drew this turn", () => {
    const { g, sig } = scene(true);
    g.s.priority = "p1";
    g.cast("p1", sig);
    expect(g.zone(sig), J(g)).toBe("battlefield");
  });
  it("Heliod, the Radiant Dawn (front face): no flash, no discount", () => {
    const { g, sig } = scene(false);
    g.s.priority = "p1";
    expect(() => g.cast("p1", sig)).toThrow();
  });
});

describe("aminatou sweep: commander colour identity", () => {
  it("Command Tower / Arcane Signet make only W/U/B for an Aminatou commander", () => {
    for (const n of ["Command Tower", "Arcane Signet"]) {
      for (const [col, ok] of [["W", true], ["U", true], ["B", true], ["R", false], ["G", false]] as const) {
        const m = base(); m.state.players[0].colorIdentity = ["W", "U", "B"]; const c = m.give("p1", n, "battlefield"); const g = new G(m);
        const ab = (g.pl("p1") && (g.s.objects[c] ? 1 : 0)) ? "a1" : "a1"; // the only mana ability
        let refused = false;
        try { g.do("p1", { type: "activateAbility", player: "p1", sourceId: c, abilityId: ab, color: col } as never); g.drive(); } catch { refused = true; }
        const pool = JSON.stringify(g.pl("p1").manaPool);
        expect(refused ? false : new RegExp(`"${col}":1`).test(pool), `${n} ${col} ${pool}`).toBe(ok);
      }
    }
  });
  it("Esper Sentinel: paying X = its power prevents the draw; only the first noncreature spell counts", () => {
    const m = base(); m.give("p1", "Esper Sentinel", "battlefield"); lands(m, "p2", "Island", "Island", "Island"); const a = m.give("p2", "Brainstorm", "hand"); const b = m.give("p2", "Ponder", "hand");
    m.state.turn.active = "p2"; m.state.priority = "p2"; const g = new G(m);
    const h = g.pl("p1").hand.length;
    g.cast("p2", a, {}, ((p: { kind: string; min: number; options: Array<{ id: string; label: string }> }) => (p.kind === "pay_unless" || p.kind === "choose_yes_no" ? { yes: true } : p.options.some((o) => /Island|Swamp/.test(o.label)) ? { ids: p.options.filter((o) => /Island|Swamp/.test(o.label)).slice(0, p.min).map((o) => o.id) } : undefined)) as never);
    expect(g.pl("p1").hand.length, g.log().join(String.fromCharCode(10))).toBe(h);
    g.cast("p2", b, {}, ((p: { kind: string }) => (p.kind === "pay_unless" ? { yes: false } : undefined)) as never);
    expect(g.pl("p1").hand.length).toBe(h);
  });
});
