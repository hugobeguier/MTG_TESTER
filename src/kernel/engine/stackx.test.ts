// Stack log shows the chosen X (spell and loyalty/activated ability), and Athreos / generic watchers see creatures that die in the same SBA batch.
import { describe, it, expect } from "vitest";
import { G, base, lands, abId, ids } from "./aminatoukit";

const cast = (g: G, p: string, id: string, x: number) =>
  g.cast(p, id, { x } as never, (pd) => (pd.kind === "choose_x" || pd.numeric ? { number: x } : undefined));

describe("stack log states X", () => {
  it("Toxic Deluge: the log line says X = 3 and -3/-3", () => {
    const m = base(); lands(m, "p1", "Swamp", "Swamp", "Swamp"); const td = m.give("p1", "Toxic Deluge", "hand"); m.give("p2", "Bear Cub", "battlefield");
    const g = new G(m);
    g.do("p1", { type: "castSpell", player: "p1", cardId: td, autoPay: true } as never);
    const p = g.s.pending!; expect(p.kind).toBe("choose_x");
    g.do("p1", { type: "answerDecision", player: "p1", decisionId: p.id, choice: { number: 3 } });
    expect(g.ks.stackLog("p1").groups.at(-1)!.title).toContain("Toxic Deluge (X = 3, so -3/-3)");
    const head = g.ks.stackLog("p1").groups.at(-1)!.lines.find((l) => l.head)!;
    expect(head.text).toContain("X = 3, so -3/-3"); expect(head.detail).toContain("[X = 3]");
    const panel = g.ks.tableState("p2").pendingAction as { message: string };
    expect(panel.message).toContain("X = 3, so -3/-3");
    g.drive();
    expect(g.find("Bear Cub", "graveyard")).toHaveLength(1);
  });
  it("Steel Hellkite {X} ability (same path as a loyalty -X): log and panel say X = 2", () => {
    const m = base(); lands(m, "p1", "Plains", "Plains", "Plains"); const hk = m.give("p1", "Steel Hellkite", "battlefield");
    const g = new G(m);
    g.do("p1", { type: "activateAbility", player: "p1", sourceId: hk, abilityId: abId("Steel Hellkite", /Destroy each nonland/), x: 2, autoPay: true } as never);
    if (g.s.pending?.numeric) g.do("p1", { type: "answerDecision", player: "p1", decisionId: g.s.pending.id, choice: { number: 2 } });
    expect(g.log().join("\n")).toContain("(X = 2)");
    expect((g.ks.tableState("p2").pendingAction as { message: string }).message).toContain("(X = 2)");
  });
});

describe("simultaneous death look-back", () => {
  it("Athreos (not a creature): Deluge kills coin-counter creatures, each returns under Athreos' controller", () => {
    const m = base(); lands(m, "p1", "Swamp", "Swamp", "Swamp", "Swamp");
    m.give("p1", "Athreos, Shroud-Veiled", "battlefield");
    m.give("p2", "Bear Cub", "battlefield", { counters: { coin: 1 } }); m.give("p2", "Ledger Shredder", "battlefield", { counters: { coin: 1 } });
    const td = m.give("p1", "Toxic Deluge", "hand"); const g = new G(m);
    cast(g, "p1", td, 4);
    expect(g.find("Athreos, Shroud-Veiled", "battlefield")).toHaveLength(1);
    const back = [...g.bf("Bear Cub"), ...g.bf("Ledger Shredder")];
    expect(back, g.log().join("\n")).toHaveLength(2);
    for (const b of back) expect(g.obj(b).controller).toBe("p1");
  });
  it("Athreos with devotion 7 is a 5/7 creature: -7/-7 kills it with the others, triggers still return the coin creatures", () => {
    const m = base(); lands(m, "p1", "Swamp", "Swamp", "Swamp", "Swamp");
    const ath = m.give("p1", "Athreos, Shroud-Veiled", "battlefield");
    for (let i = 0; i < 2; i++) m.give("p1", "Phyrexian Arena", "battlefield");
    m.give("p1", "Bitterblossom", "battlefield");
    m.give("p2", "Bear Cub", "battlefield", { counters: { coin: 1 } }); m.give("p2", "Ledger Shredder", "battlefield", { counters: { coin: 1 } });
    const td = m.give("p1", "Toxic Deluge", "hand"); const g = new G(m);
    expect(g.chars(ath).types).toContain("creature"); expect(g.chars(ath).toughness).toBe(7);
    cast(g, "p1", td, 7);
    expect(g.zone(ath), g.log().join("\n")).toBe("graveyard");
    const back = [...g.bf("Bear Cub"), ...g.bf("Ledger Shredder")];
    expect(back, g.log().join("\n")).toHaveLength(2);
    for (const b of back) expect(g.obj(b).controller).toBe("p1");
  });
  it("generic: a watcher dying in the same batch still sees the other creature die (Blood Artist x2)", () => {
    const m = base(); lands(m, "p1", "Swamp", "Swamp", "Swamp");
    m.give("p1", "Blood Artist", "battlefield"); m.give("p1", "Bear Cub", "battlefield"); m.give("p1", "Blood Artist", "battlefield");
    const td = m.give("p1", "Toxic Deluge", "hand"); const g = new G(m);
    const life0 = g.pl("p1").life;
    cast(g, "p1", td, 4);
    // Blood Artist saw all three die in the same batch (Cub and both Artists): 3 deaths x 2 watchers = 6 triggers
    expect(g.log().filter((l) => /^\d+\. Blood Artist: Whenever.*because/.test(l)).length, g.log().join("\n")).toBe(6);
  });
});
