// "an opponent" in games with 3+ players (real drafts): the gift recipient, "target opponent", "an opponent has N cards", Breena's life comparison,
// the generic "who: opponent" decision, and the AI default for choosing a player.
import { describe, expect, it } from "vitest";
import { famCards, sorcery } from "./famkit";
import { drain } from "./step10kit";
import { realTable } from "./testdb";
import { defaultAnswer } from "../observer/actions";
import type { Step } from "../schema";

type T = ReturnType<typeof realTable>;
const seats = (n: number) => ["p1", "p2", "p3", "p4"].slice(0, n);
const world = (n: number, extra = {}): T => realTable(seats(n), { ...famCards, ...extra });
type Pending = NonNullable<T["state"]["pending"]>;
/** answer decisions: `pick` for choose_option / choose_targets (options are player ids), the default for the rest; every decision seen is logged as "kind:player:options" */
function play(t: T, who: string, seen: string[] = [], optionFor: Record<string, string> = {}) {
  drain(t, (p) => {
    seen.push(`${p.kind}:${p.player}:${p.options.map((o) => o.id).join(",")}`);
    const want = optionFor[p.kind];
    return want && p.options.some((o) => o.id === want) ? { ids: [want] } : undefined;
  });
  return seen;
}
const hand = (t: T, p: string) => t.p(p).hand.length;
/** `who` loses (0 life) while a spell is on the stack: the state-based actions run when the next player passes priority */
const leave = (t: T, who: string) => { t.state = { ...t.state, players: t.state.players.map((p) => (p.id === who ? { ...p, life: 0 } : p)) }; t.ok({ type: "passPriority", player: t.state.priority! }); };

describe("Scrapshooter (gift a card: the recipient draws when it enters)", () => {
  const setup = (n: number) => { const t = world(n); t.lands("p1", "Forest", 3); t.give("p2", "Sol Ring", "battlefield"); for (const p of seats(n)) for (let i = 0; i < 4; i++) t.give(p, "Island", "library"); return { t, c: t.give("p1", "Scrapshooter", "hand") }; };
  it("2 players: the only opponent is the recipient, nobody is asked who", () => {
    const { t, c } = setup(2);
    t.ok({ type: "castSpell", player: "p1", cardId: c, extras: ["c1"] });
    const seen = play(t, "p1");
    expect(seen.some((s) => s.startsWith("choose_option"))).toBe(false);
    expect(hand(t, "p2")).toBe(1); expect(hand(t, "p1")).toBe(0);
  });
  for (const n of [3, 4]) it(`${n} players: the caster chooses the recipient (only the caster is asked) and only that opponent draws`, () => {
    const { t, c } = setup(n);
    t.ok({ type: "castSpell", player: "p1", cardId: c, extras: ["c1"] });
    const seen = play(t, "p1", [], { choose_option: "p3" });
    const ask = seen.find((s) => s.startsWith("choose_option"))!;
    expect(ask.startsWith("choose_option:p1:")).toBe(true);
    expect(ask.split(":")[2]).toBe(seats(n).slice(1).join(","));
    expect(hand(t, "p3")).toBe(1);
    for (const p of seats(n).filter((x) => x !== "p3")) expect(hand(t, p), p).toBe(0);
  });
  it("no gift promised: nobody draws", () => {
    const { t, c } = setup(4);
    t.ok({ type: "castSpell", player: "p1", cardId: c }); play(t, "p1");
    for (const p of seats(4)) expect(hand(t, p)).toBe(0);
  });
  it("the recipient left the game before it entered: nothing happens and nothing throws", () => {
    const { t, c } = setup(3);
    const res = t.ok({ type: "castSpell", player: "p1", cardId: c, extras: ["c1"] });
    // answer the gift choice (p3) then take p3 out while the spell is on the stack
    const p = res.pending as Pending | undefined;
    if (p) t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: { ids: ["p3"] } });
    leave(t, "p3");
    play(t, "p1");
    expect(hand(t, "p2")).toBe(0);
    expect(t.state.players.find((x) => x.id === "p3")!.hasLost).toBe(true);
  });
  it("determinism: the same game gives the same state", () => {
    const run = () => { const { t, c } = setup(4); t.ok({ type: "castSpell", player: "p1", cardId: c, extras: ["c1"] }); play(t, "p1", [], { choose_option: "p4" }); return JSON.stringify(t.state.players.map((p) => [p.id, p.hand.length])); };
    expect(run()).toBe(run());
  });
});

describe("Parting Gust / Perch Protection (gift to an opponent of the caster's choice)", () => {
  for (const n of [2, 3, 4]) it(`Parting Gust, ${n} players: the chosen opponent gets the tapped Fish`, () => {
    const t = world(n); t.lands("p1", "Plains", 2);
    const gust = t.give("p1", "Parting Gust", "hand"); const bear = t.give("p2", "Fill A", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: gust, extras: ["c1"] });
    const seen = play(t, "p1", [], { choose_option: seats(n)[n - 1], choose_targets: bear });
    const fish = t.state.battlefield.map((id) => t.obj(id)).filter((o) => o.token?.name === "Fish");
    expect(fish).toHaveLength(1); expect(fish[0].controller).toBe(seats(n)[n - 1]); expect(fish[0].tapped).toBe(true);
    expect(seen.filter((s) => s.startsWith("choose_option")).length).toBe(n === 2 ? 0 : 1);
  });
  for (const n of [2, 3, 4]) it(`Perch Protection, ${n} players: the chosen opponent takes the extra turn`, () => {
    const t = world(n); t.lands("p1", "Plains", 6);
    const pp = t.give("p1", "Perch Protection", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: pp, extras: ["c1"] });
    play(t, "p1", [], { choose_option: seats(n)[n - 1] });
    expect(t.state.extraTurns).toEqual([seats(n)[n - 1]]);
  });
});

describe("Consumed by Greed (target opponent sacrifices)", () => {
  const setup = (n: number) => {
    const t = world(n); t.lands("p1", "Swamp", 3);
    for (const p of seats(n).slice(1)) t.give(p, "Fill B", "battlefield");
    return { t, c: t.give("p1", "Consumed by Greed", "hand") };
  };
  for (const n of [2, 3, 4]) it(`${n} players: the targeted opponent sacrifices, the others keep their creature`, () => {
    const { t, c } = setup(n);
    const victim = seats(n)[n - 1];
    t.ok({ type: "castSpell", player: "p1", cardId: c });
    const seen = play(t, "p1", [], { choose_targets: victim });
    expect(seen.find((s) => s.startsWith("choose_targets"))!.startsWith("choose_targets:p1:")).toBe(true);
    for (const p of seats(n).slice(1)) expect(t.state.battlefield.some((id) => t.obj(id).controller === p && t.obj(id).cardName === "Fill B"), p).toBe(p !== victim);
  });
  it("the targeted opponent left the game: the spell does nothing to anyone else", () => {
    const { t, c } = setup(4);
    const res = t.ok({ type: "castSpell", player: "p1", cardId: c, extras: [] });
    const p = res.pending as Pending; // first decision: the target player
    t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: { ids: ["p3"] } });
    leave(t, "p3");
    play(t, "p1");
    expect(t.state.battlefield.filter((id) => t.obj(id).cardName === "Fill B").length).toBe(2);
  });
});

describe("Sheoldred, the True Scriptures (only if an opponent has eight or more cards in their graveyard)", () => {
  const setup = (n: number, who: string, cards: number) => {
    const t = world(n); t.lands("p1", "Swamp", 5);
    const sh = t.give("p1", "Sheoldred // The True Scriptures", "battlefield"); t.obj(sh).controlledSince = -1;
    for (let i = 0; i < cards; i++) t.give(who, "Island", "graveyard");
    return { t, sh };
  };
  const tries = (t: T, sh: string) => !t.do({ type: "activateAbility", player: "p1", sourceId: sh, abilityId: "a3" }).error;
  for (const n of [2, 3, 4]) {
    it(`${n} players: any one opponent with 8 cards is enough`, () => { const { t, sh } = setup(n, seats(n)[n - 1], 8); expect(tries(t, sh)).toBe(true); });
    it(`${n} players: 7 cards is not enough`, () => { const { t, sh } = setup(n, seats(n)[n - 1], 7); expect(tries(t, sh)).toBe(false); });
  }
  it("cards split over two opponents do not add up", () => {
    const { t, sh } = setup(3, "p2", 5); for (let i = 0; i < 5; i++) t.give("p3", "Island", "graveyard");
    expect(tries(t, sh)).toBe(false);
  });
  it("your own graveyard does not count", () => { const { t, sh } = setup(3, "p1", 9); expect(tries(t, sh)).toBe(false); });
});

describe("Breena, the Demagogue (that opponent has more life than another of your opponents)", () => {
  const attack = (n: number, lives: Record<string, number>, defender: string, attackerId = "p2") => {
    const t = world(n); t.give("p1", "Breena, the Demagogue", "battlefield"); t.give("p1", "Fill A", "battlefield");
    const a = t.give(attackerId, "Fill B", "battlefield"); t.obj(a).controlledSince = -1;
    for (const p of seats(n)) for (let i = 0; i < 6; i++) t.give(p, "Island", "library");
    t.state = { ...t.state, turn: { ...t.state.turn, active: attackerId }, priority: attackerId, players: t.state.players.map((p) => ({ ...p, life: lives[p.id] ?? 40 })) };
    for (let i = 0; i < 6 && t.state.turn.phase !== "declare_attackers"; i++) t.ok({ type: "advancePhase", player: attackerId });
    t.ok({ type: "declareAttackers", player: attackerId, attackers: [{ id: a, defender }] });
    const before = hand(t, attackerId);
    drain(t);
    return { t, drew: hand(t, attackerId) - before };
  };
  it("2 players: there is no other opponent, so no trigger", () => { expect(attack(2, {}, "p1", "p2").drew).toBe(0); });
  it("4 players: the attacked opponent has more life than another opponent: the attacker draws", () => { expect(attack(4, { p3: 30, p4: 20 }, "p3").drew).toBe(1); });
  it("4 players: the attacked opponent does not have more life than another opponent: no draw", () => { expect(attack(4, { p2: 40, p3: 10, p4: 50 }, "p3", "p2").drew).toBe(0); });
  it("3 players: attacked p3 (40) vs p2 (10): the attacker p2 draws", () => { expect(attack(3, { p2: 10, p3: 40 }, "p3", "p2").drew).toBe(1); });
});

describe("generic 'who: opponent' step in a multiplayer game becomes a decision", () => {
  const drawOpp = sorcery("Draw Opp", "{1}", [{ kind: "draw_cards", who: "opponent", amount: 1 } as Step]);
  for (const n of [2, 3, 4]) it(`${n} players`, () => {
    const t = world(n, { "Draw Opp": drawOpp }); t.lands("p1", "Island", 1);
    for (const p of seats(n)) for (let i = 0; i < 4; i++) t.give(p, "Island", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Draw Opp", "hand") });
    const seen = play(t, "p1", [], { choose_option: seats(n)[n - 1] });
    expect(seen.filter((s) => s.startsWith("choose_option")).length).toBe(n === 2 ? 0 : 1);
    if (n > 2) expect(seen.find((s) => s.startsWith("choose_option"))!.startsWith("choose_option:p1:")).toBe(true);
    for (const p of seats(n)) expect(hand(t, p), p).toBe(p === seats(n)[n - 1] ? 1 : 0);
  });
});

describe("AI default when choosing a player", () => {
  const state = { players: [{ id: "p1", life: 40 }, { id: "p2", life: 30 }, { id: "p3", life: 12 }, { id: "p4", life: 40 }], objects: {} } as never;
  const pend = (title: string) => ({ kind: "choose_option", min: 1, max: 1, options: ["p2", "p3", "p4"].map((id) => ({ id, label: id })), prompt: { title, instruction: "Choose an opponent." } }) as never;
  it("harmful: the opponent with the most life (first in turn order on a tie)", () => { expect(defaultAnswer(pend("Choose"), state, "p1")).toEqual({ ids: ["p4"] }); });
  it("gift: the opponent with the least life", () => { expect(defaultAnswer(pend("X: promise a gift"), state, "p1")).toEqual({ ids: ["p3"] }); });
});
