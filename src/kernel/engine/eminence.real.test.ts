// The Ur-Dragon's eminence (real draft): "As long as The Ur-Dragon is in the command zone or on the battlefield, other Dragon spells you cast cost {1} less."
// The observer found the kernel refusing Dragon casts the legacy engine paid one mana less for: the static only worked on the battlefield.
import { describe, expect, it } from "vitest";
import { legalActions } from "./legal";
import { ctxOf, realTable } from "./testdb";
import type { Table } from "./testkit";

const castable = (t: Table, who: string, id: string) => legalActions(t.state, who, ctxOf(t)).some((a) => a.kind === "castSpell" && a.objectId === id);
function toCommandZone(t: Table, id: string, owner = "p1") {
  const s = structuredClone(t.state); const p = s.players.find((x) => x.id === owner)!;
  p.hand = p.hand.filter((x) => x !== id); p.command.push(id); s.objects[id].zone = "command"; s.objects[id].isCommander = true; t.state = s;
}
describe("The Ur-Dragon eminence", () => {
  it.each(["command", "battlefield"])("from the %s: a 6-mana Dragon (Ramos) is castable with 5 lands, not with 4; a non-Dragon is not cheaper", (zone) => {
    const t = realTable(["p1", "p2"]);
    const u = t.give("p1", "The Ur-Dragon", zone === "command" ? "hand" : "battlefield");
    if (zone === "command") toCommandZone(t, u);
    const lands = t.lands("p1", "Mountain", 4);
    const ramos = t.give("p1", "Ramos, Dragon Engine", "hand");
    expect(castable(t, "p1", ramos)).toBe(false); // 4 lands
    t.lands("p1", "Mountain", 1);
    expect(castable(t, "p1", ramos)).toBe(true); // 5 lands: {6} costs {5}; exactly one less, not two
    void lands;
    const t2 = realTable(["p1", "p2"]);
    const u2 = t2.give("p1", "The Ur-Dragon", zone === "command" ? "hand" : "battlefield");
    if (zone === "command") toCommandZone(t2, u2);
    t2.lands("p1", "Forest", 2);
    expect(castable(t2, "p1", t2.give("p1", "Cultivate", "hand"))).toBe(false); // {2}{G} with 2 lands: a sorcery is not reduced
  });
  it("without The Ur-Dragon five lands cannot cast Ramos; the opponent's Dragons are not reduced", () => {
    const t = realTable(["p1", "p2"]);
    t.lands("p1", "Mountain", 5);
    expect(castable(t, "p1", t.give("p1", "Ramos, Dragon Engine", "hand"))).toBe(false);
    const u = t.give("p2", "The Ur-Dragon", "battlefield"); void u;
    expect(castable(t, "p1", t.give("p1", "Ramos, Dragon Engine", "hand"))).toBe(false);
  });
});
