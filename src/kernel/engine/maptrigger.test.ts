// Archaeomancer's Map ("Whenever a land an opponent controls enters, if that player controls more lands than you, ...") on the REAL draft, 2 and 4 players.
// User report: "it still triggers when the opponent whose turn it is does not have more lands than I do" (the cause was a stale browser pack: see packfresh.test.ts).
import { describe, expect, it } from "vitest";
import { drain } from "./step10kit";
import { realTable } from "./testdb";

type T = ReturnType<typeof realTable>;
const pending = (t: T) => t.state.triggerQueue.length + t.state.stack.length + (t.state.pending ? 1 : 0);
/** `lands`: how many lands each player has BEFORE the land drop; the active player then plays a land. Returns what was put on the stack / asked. */
function scenario(players: string[], lands: Record<string, number>, active: string, lander: string = active) {
  const t = realTable(players);
  t.give("p1", "Archaeomancer's Map", "battlefield");
  for (const [p, n] of Object.entries(lands)) t.lands(p, "Island", n);
  t.state.turn.active = active; t.state.priority = active;
  t.ok({ type: "playLand", player: lander, cardId: t.give(lander, "Island", "hand") });
  return t;
}
const P2 = ["p1", "p2"], P4 = ["p1", "p2", "p3", "p4"];

describe("Archaeomancer's Map: the opponent whose turn it is", () => {
  for (const [name, players] of [["2 players", P2], ["4 players", P4]] as const) {
    describe(name, () => {
      it("fewer lands after the drop: no trigger", () => { expect(pending(scenario(players, { p1: 5, p2: 2 }, "p2"))).toBe(0); });
      it("equal lands after the drop: no trigger", () => { expect(pending(scenario(players, { p1: 3, p2: 2 }, "p2"))).toBe(0); });
      it("more lands after the drop: triggers once and offers the land", () => {
        const t = scenario(players, { p1: 3, p2: 3 }, "p2");
        expect(pending(t)).toBe(1);
        const hand = t.give("p1", "Forest", "hand");
        const kinds: string[] = [];
        drain(t, (p) => { kinds.push(p.kind); return p.kind === "choose_yes_no" ? { yes: true } : undefined; });
        expect(t.obj(hand).zone).toBe("battlefield");
      });
      it("the entering land counts: one fewer before, equal after = no trigger; one more before the drop than you = trigger", () => {
        expect(pending(scenario(players, { p1: 4, p2: 3 }, "p2"))).toBe(0);
        expect(pending(scenario(players, { p1: 4, p2: 4 }, "p2"))).toBe(1);
      });
      it("never asks the controller anything when the condition is false", () => {
        const t = scenario(players, { p1: 6, p2: 1 }, "p2");
        t.give("p1", "Forest", "hand");
        drain(t, (p) => { throw new Error("unexpected decision " + p.kind); });
        expect(t.state.pending).toBeFalsy();
      });
    });
  }
  it("4 players: only the opponent whose land entered is compared (others being bigger or smaller changes nothing)", () => {
    expect(pending(scenario(P4, { p1: 3, p2: 1, p3: 9, p4: 9 }, "p2"))).toBe(0); // p3 and p4 are far ahead, but p2 (2 lands) is not
    expect(pending(scenario(P4, { p1: 3, p2: 3, p3: 0, p4: 0 }, "p2"))).toBe(1);
    expect(pending(scenario(P4, { p1: 3, p2: 0, p3: 3, p4: 0 }, "p3"))).toBe(1); // p3 is the active player here
  });
  it("a land entering under an opponent who is NOT the active player (instant-speed Evolving Wilds on someone else's turn): only that opponent's count matters", () => {
    for (const [p2lands, expected] of [[1, 0], [3, 1]] as const) {
      const t = realTable(P4);
      t.give("p1", "Archaeomancer's Map", "battlefield");
      t.lands("p1", "Island", 3); t.lands("p2", "Island", p2lands); t.lands("p3", "Island", 9);
      for (let i = 0; i < 3; i++) t.give("p2", "Island", "library");
      t.give("p2", "Island", "library");
      const wilds = t.give("p2", "Evolving Wilds", "battlefield");
      t.give("p1", "Forest", "hand");
      t.state.turn.active = "p3"; t.state.priority = "p2";
      t.ok({ type: "activateAbility", player: "p2", sourceId: wilds, abilityId: "a1" });
      const asked: string[] = [];
      drain(t, (p) => { asked.push(p.kind + ":" + p.player); return p.kind === "choose_yes_no" ? { yes: true } : p.kind === "choose_cards" && p.player === "p2" ? { ids: p.options.slice(0, 1).map((o) => o.id) } : undefined; });
      // p2 has p2lands + Wilds (sacrificed) + the fetched basic: p2lands+1 vs your 3
      expect(asked.filter((x) => x.endsWith(":p1")).length > 0).toBe(expected === 1);
    }
  });
  it("lands you control entering never trigger it", () => {
    expect(pending(scenario(P2, { p1: 0, p2: 9 }, "p1"))).toBe(0);
  });
  it("is checked again on resolution: you catch up before it resolves, so nothing is asked", () => {
    const t = scenario(P4, { p1: 3, p2: 3 }, "p2");
    expect(pending(t)).toBe(1);
    t.give("p1", "Island", "battlefield"); t.give("p1", "Island", "battlefield");
    t.give("p1", "Forest", "hand");
    drain(t, (p) => { throw new Error("no decision expected: " + p.kind); });
    expect(pending(t)).toBe(0);
  });
});

describe("lands entering from a spell", () => {
  it("Cultivate cast by an opponent: the land that enters is compared with your lands", () => {
    for (const [p1lands, expected] of [[5, false], [3, true]] as const) {
      const t = realTable(P4);
      t.give("p1", "Archaeomancer's Map", "battlefield");
      t.lands("p1", "Island", p1lands); t.lands("p2", "Forest", 3); // p2: 3 lands + the one Cultivate puts onto the battlefield = 4
      t.give("p2", "Forest", "library"); t.give("p2", "Forest", "library");
      t.give("p1", "Forest", "hand");
      t.state.turn.active = "p2"; t.state.priority = "p2";
      t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Cultivate", "hand") });
      const asked: string[] = [];
      drain(t, (p) => { asked.push(p.kind + ":" + p.player); return p.kind === "choose_yes_no" ? { yes: true } : p.kind === "choose_cards" && p.player === "p2" ? { ids: p.options.slice(0, 1).map((o) => o.id) } : undefined; });
      expect(asked.some((x) => x.endsWith(":p1"))).toBe(expected);
    }
  });
});

describe("intervening if: what is said about a trigger that does not happen (CR 603.4)", () => {
  it("condition false when the land enters: it never triggers and (outside debug mode) leaves no event at all", () => {
    const t = realTable(P2);
    t.give("p1", "Archaeomancer's Map", "battlefield"); t.lands("p1", "Island", 5); t.lands("p2", "Island", 1);
    t.state.turn.active = "p2"; t.state.priority = "p2";
    const res = t.ok({ type: "playLand", player: "p2", cardId: t.give("p2", "Island", "hand") });
    expect(res.events.some((e) => e.type === "trigger_not_triggered" || e.type === "trigger_fizzled")).toBe(false);
  });
  it("debug mode: the same case leaves a 'did not trigger' event with the numbers", () => {
    const t = realTable(P2);
    t.state.config.sandbox = true;
    t.give("p1", "Archaeomancer's Map", "battlefield"); t.lands("p1", "Island", 5); t.lands("p2", "Island", 1);
    t.state.turn.active = "p2"; t.state.priority = "p2";
    const res = t.ok({ type: "playLand", player: "p2", cardId: t.give("p2", "Island", "hand") });
    const ev = res.events.find((e) => e.type === "trigger_not_triggered") as { facts?: { left: { n: number }; right: { n: number } } } | undefined;
    expect(ev?.facts?.left.n).toBe(2);
    expect(ev?.facts?.right.n).toBe(5);
  });
});
