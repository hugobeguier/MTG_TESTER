// The events the stack log reads (stack item ids, causes, costs, replacement summaries, unless-pay outcomes, trigger order): raw engine output, no UI.
import { describe, expect, it } from "vitest";
import "./resolve";
import { mini } from "../integration/testgame";
import type { Choice, GameEvent, GameState } from "./types";

type M = ReturnType<typeof mini>;
const lib = (m: M) => { for (let i = 0; i < 6; i++) { m.give("p1", "Forest", "library"); m.give("p2", "Island", "library"); } };
const ofType = (evs: GameEvent[], t: string) => evs.filter((e) => e.type === t);

/** answer decisions with the first options (no to yes/no) and pass priority until the stack is empty; returns every event produced */
function run(m: M, first: GameEvent[] = []): GameEvent[] {
  const all = [...first];
  for (let i = 0; i < 80; i++) {
    const s: GameState = m.state;
    if (s.pending) {
      const p = s.pending;
      const choice: Choice = p.numeric ? { number: p.min } : p.kind === "choose_yes_no" || p.kind === "pay_unless" ? { yes: false } : { ids: p.options.slice(0, Math.max(p.min, 1)).map((o) => o.id) };
      all.push(...m.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice }).events);
      continue;
    }
    if (s.stack.length && s.priority) { all.push(...m.ok({ type: "passPriority", player: s.priority }).events); continue; }
    break;
  }
  return all;
}

describe("stack events", () => {
  it("a cast carries its stack item, depth, the cost paid and what was spent", () => {
    const m = mini();
    lib(m);
    m.give("p1", "Plains", "battlefield");
    const sw = m.give("p1", "Swords to Plowshares", "hand");
    m.give("p2", "Grizzly Bears", "battlefield");
    const evs = run(m, m.ok({ type: "castSpell", player: "p1", cardId: sw, autoPay: true }).events);
    const cast = ofType(evs, "cast")[0];
    expect(cast.item).toMatch(/^s\d+$/);
    expect(cast.depth).toBe(1);
    expect(cast.paid).toMatchObject({ mana: "{W}" });
    const resolving = ofType(evs, "resolving")[0];
    expect(resolving).toMatchObject({ item: cast.item, kind: "spell", controller: "p1", left: 0 });
    expect(evs.findIndex((e) => e.type === "resolving")).toBeLessThan(evs.findIndex((e) => e.type === "spell_resolved"));
    expect(ofType(evs, "spell_resolved")[0]).toMatchObject({ item: cast.item, left: 0 });
  });

  it("a trigger on the stack names its cause, its text and where it sits; the top resolves first", () => {
    const m = mini();
    lib(m);
    m.give("p2", "Esper Sentinel", "battlefield");
    m.give("p1", "Plains", "battlefield");
    const sw = m.give("p1", "Swords to Plowshares", "hand");
    m.give("p2", "Grizzly Bears", "battlefield");
    const evs = run(m, m.ok({ type: "castSpell", player: "p1", cardId: sw, autoPay: true }).events);
    const t = ofType(evs, "trigger_on_stack")[0];
    expect(t).toMatchObject({ controller: "p2", causeEvent: "cast", depth: 2 });
    expect(t.cause).toBe(ofType(evs, "cast")[0].id);
    expect(String(t.text)).toContain("Whenever an opponent casts their first noncreature spell");
    expect(ofType(evs, "resolving").map((e) => e.item)).toEqual([t.item, ofType(evs, "cast")[0].item]);
  });

  it("an 'unless pays' outcome is reported with the payer and the cost", () => {
    const m = mini();
    lib(m);
    m.give("p2", "Esper Sentinel", "battlefield");
    for (let i = 0; i < 3; i++) m.give("p1", "Plains", "battlefield");
    const sw = m.give("p1", "Swords to Plowshares", "hand");
    m.give("p2", "Grizzly Bears", "battlefield");
    const evs = run(m, m.ok({ type: "castSpell", player: "p1", cardId: sw, autoPay: true }).events);
    expect(ofType(evs, "unless_pay")).toEqual([expect.objectContaining({ payer: "p1", cost: "{1}", outcome: "declined" })]);
  });

  it("life changes carry the life total after the change", () => {
    const m = mini();
    lib(m);
    m.give("p1", "Plains", "battlefield");
    m.give("p2", "Grizzly Bears", "battlefield");
    const evs = run(m, m.ok({ type: "castSpell", player: "p1", cardId: m.give("p1", "Swords to Plowshares", "hand"), autoPay: true }).events);
    const gain = ofType(evs, "life_gain");
    expect(gain.length).toBeGreaterThan(0);
    expect(gain[0].life).toBe(m.state.players[0].life === gain[0].life || m.state.players[1].life === gain[0].life ? gain[0].life : -1);
    expect(typeof gain[0].life).toBe("number");
  });

  it("replacement effects say what they changed", () => {
    const m = mini();
    lib(m);
    m.give("p1", "Chatterfang, Squirrel General", "battlefield");
    m.give("p1", "Academy Manufactor", "battlefield");
    m.give("p1", "Forest", "battlefield");
    const goose = m.give("p1", "Gilded Goose", "hand");
    const evs = run(m, m.ok({ type: "castSpell", player: "p1", cardId: goose, autoPay: true }).events);
    const repl = ofType(evs, "replacement_applied");
    expect(repl.map((e) => e.event)).toEqual(["tokens", "tokens"]);
    expect(repl.every((e) => typeof e.text === "string" && (e.text as string).length > 10)).toBe(true);
    expect(repl.some((e) => e.from !== undefined && e.to !== undefined && (e.to as number) > (e.from as number))).toBe(true);
    expect(repl.some((e) => e.contested === 2)).toBe(true);
  });

  it("two triggers of one player: the order they chose is recorded and both get the ordered flag", () => {
    const m = mini();
    lib(m);
    m.give("p1", "Doomwake Giant", "battlefield");
    m.give("p1", "Sphere of Safety", "graveyard"); m.give("p1", "Greed", "graveyard");
    for (let i = 0; i < 8; i++) m.give("p1", "Plains", "battlefield");
    const evs = run(m, m.ok({ type: "castSpell", player: "p1", cardId: m.give("p1", "Redress Fate", "hand"), autoPay: true }).events);
    const ord = ofType(evs, "triggers_ordered");
    expect(ord).toHaveLength(1);
    expect((ord[0].order as unknown[]).length).toBe(2);
    expect(ofType(evs, "trigger_on_stack").every((e) => e.ordered === true)).toBe(true);
  });

  it("a fizzled spell names its stack item", () => {
    const m = mini();
    lib(m);
    m.give("p1", "Plains", "battlefield"); m.give("p2", "Plains", "battlefield");
    const bears = m.give("p2", "Grizzly Bears", "battlefield");
    const s1 = m.give("p1", "Swords to Plowshares", "hand"), s2 = m.give("p2", "Swords to Plowshares", "hand");
    const first = m.ok({ type: "castSpell", player: "p1", cardId: s1, autoPay: true, targets: { t1: [bears] } }).events;
    m.ok({ type: "passPriority", player: "p1" });
    const second = m.ok({ type: "castSpell", player: "p2", cardId: s2, autoPay: true, targets: { t1: [bears] } }).events;
    const evs = run(m, [...first, ...second]);
    const fizzled = ofType(evs, "spell_fizzled")[0];
    expect(fizzled.item).toBe(ofType(evs, "cast")[0].item);
  });
});
