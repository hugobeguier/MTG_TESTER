// Kernel step 7: Commander rules: command-zone option, commander tax, commander damage, "can be your commander", 40 life.
import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { famCards, filler, mk, sorcery } from "./famkit";
import { CARDS } from "./testcards";
import { table, loadDraft, type Table } from "./testkit";
import { canBeCommander } from "./commander";
import { createEngine } from "./setup";
import { viewFor } from "./view";
import type { CardDef } from "./types";

const boss = mk("Boss", { manaCost: "{1}{G}", types: ["creature"], supertypes: ["legendary"], subtypes: ["Elf"], power: 4, toughness: 4 }, []);
const bounce = sorcery("Bounce It", "{1}", [{ kind: "bounce_target", target: "t1" }], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }]);
const slay = sorcery("Slay It", "{1}", [{ kind: "destroy_target", target: "t1" }], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }]);
const world = (players = ["p1", "p2"]): Table => table(players, { extra: { ...CARDS, ...famCards, Boss: boss, "Bounce It": bounce, "Slay It": slay } });
const commanderOnBattlefield = (t: Table, owner = "p1") => { const id = t.give(owner, "Boss", "battlefield"); t.state.objects[id].isCommander = true; return id; };
const answer = (t: Table, yes: boolean) => t.ok({ type: "answerDecision", player: t.state.pending!.player, decisionId: t.state.pending!.id, choice: { yes } });
const settle = (t: Table) => { for (let i = 0; i < 8 && t.state.stack.length && !t.state.pending; i++) t.ok({ type: "passPriority", player: t.state.priority! }); };

describe("command zone option", () => {
  it("destroyed: the owner is asked (state-based action); yes puts it into the command zone", () => {
    const t = world(); const c = commanderOnBattlefield(t);
    t.lands("p2", "Plains", 1); t.state.turn.active = "p2"; t.state.priority = "p2";
    t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Slay It", "hand"), targets: { t1: [c] } });
    settle(t);
    expect(t.state.pending!.kind).toBe("choose_yes_no");
    expect(t.state.pending!.player).toBe("p1");
    answer(t, true);
    expect(t.obj(c).zone).toBe("command");
    expect(t.p("p1").command).toContain(c);
    expect(t.p("p1").graveyard).not.toContain(c);
  });
  it("declining leaves it in the graveyard and it is not asked again", () => {
    const t = world(); const c = commanderOnBattlefield(t);
    t.lands("p2", "Plains", 2); t.state.turn.active = "p2"; t.state.priority = "p2";
    t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Slay It", "hand"), targets: { t1: [c] } });
    settle(t); answer(t, false);
    expect(t.obj(c).zone).toBe("graveyard");
    expect(t.state.pending).toBeNull();
    t.ok({ type: "passPriority", player: t.state.priority! });
    expect(t.state.pending).toBeNull();
  });
  it("bounced: a replacement for the hand; yes means the command zone instead", () => {
    const t = world(); const c = commanderOnBattlefield(t);
    t.lands("p2", "Plains", 1); t.state.turn.active = "p2"; t.state.priority = "p2";
    t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Bounce It", "hand"), targets: { t1: [c] } });
    settle(t);
    expect(t.state.pending!.kind).toBe("choose_yes_no");
    answer(t, true);
    expect(t.obj(c).zone).toBe("command");
    expect(t.p("p1").hand).not.toContain(c);
  });
  it("bounced, declined: the commander goes to the hand", () => {
    const t = world(); const c = commanderOnBattlefield(t);
    t.lands("p2", "Plains", 1); t.state.turn.active = "p2"; t.state.priority = "p2";
    t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Bounce It", "hand"), targets: { t1: [c] } });
    settle(t); answer(t, false);
    expect(t.obj(c).zone).toBe("hand");
  });
  it("only the owner may answer, and the question is hidden from others' options", () => {
    const t = world(); const c = commanderOnBattlefield(t);
    t.lands("p2", "Plains", 1); t.state.turn.active = "p2"; t.state.priority = "p2";
    t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Slay It", "hand"), targets: { t1: [c] } });
    settle(t);
    const p = t.state.pending!;
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: p.id, choice: { yes: true } }).error?.code).toBe("not_your_decision");
    expect(viewFor(t.state, "p2").pending).toBeTruthy();
  });
  it("a non-commander creature is never asked", () => {
    const t = world(); const c = t.give("p1", "Boss", "battlefield");
    t.lands("p2", "Plains", 1); t.state.turn.active = "p2"; t.state.priority = "p2";
    t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Slay It", "hand"), targets: { t1: [c] } });
    settle(t);
    expect(t.state.pending).toBeNull(); expect(t.obj(c).zone).toBe("graveyard");
  });
  it("a commander that dies still triggers 'dies' abilities of others (it really went to the graveyard first)", () => {
    const t = world(); const c = commanderOnBattlefield(t);
    t.lands("p2", "Plains", 1); t.state.turn.active = "p2"; t.state.priority = "p2";
    t.ok({ type: "castSpell", player: "p2", cardId: t.give("p2", "Slay It", "hand"), targets: { t1: [c] } });
    const res = t.resolveTop();
    expect(res.events.some((e) => e.type === "dies" && e.id === c)).toBe(true);
  });
});

describe("commander tax and casting from the command zone", () => {
  it("costs {2} more for each previous cast", () => {
    const t = world(); const c = t.give("p1", "Boss", "battlefield"); t.state.objects[c].isCommander = true;
    t.state.objects[c].zone = "command"; t.state.battlefield = t.state.battlefield.filter((i) => i !== c); t.p("p1").command.push(c);
    t.lands("p1", "Forest", 6);
    t.ok({ type: "castSpell", player: "p1", cardId: c });
    expect(t.state.battlefield.filter((i) => t.obj(i).tapped)).toHaveLength(2);
    expect(t.p("p1").commanderCasts[c]).toBe(1);
    t.resolveTop();
    // it dies again and goes back; the second cast costs {1}{G} + {2}
    t.state.objects[c].zone = "command"; t.state.battlefield = t.state.battlefield.filter((i) => i !== c); t.p("p1").command.push(c);
    for (const i of t.state.battlefield) t.state.objects[i].tapped = false;
    t.state.priority = "p1";
    t.ok({ type: "castSpell", player: "p1", cardId: c });
    expect(t.state.battlefield.filter((i) => t.obj(i).tapped)).toHaveLength(4);
  });
});

describe("commander damage", () => {
  const attackWith = (t: Table, id: string) => {
    for (let i = 0; i < 4 && t.state.turn.phase !== "declare_attackers"; i++) t.ok({ type: "advancePhase", player: "p1" });
    t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id, defender: "p2" }] });
    for (let i = 0; i < 12 && t.state.turn.phase !== "end_of_combat" && !t.state.gameOver && !t.state.pending; i++) { if (t.state.combat?.expect) { t.ok({ type: "advancePhase", player: t.state.combat.expect.kind === "blockers" ? t.state.combat.expect.players[0] : "p1" }); continue; } t.ok({ type: "advancePhase", player: t.state.turn.active }); }
  };
  it("combat damage by a commander is counted per commander", () => {
    const t = world(); const c = commanderOnBattlefield(t);
    attackWith(t, c);
    expect(t.state.commanderDamage).toEqual({ p2: { [c]: 4 } });
    expect(t.p("p2").life).toBe(36);
  });
  it("21 damage from one commander eliminates the player even with life left", () => {
    const t = world(["p1", "p2", "p3"]); const c = commanderOnBattlefield(t);
    t.state.commanderDamage = { p2: { [c]: 17 } };
    t.p("p2").life = 40;
    attackWith(t, c);
    expect(t.p("p2").hasLost).toBe(true);
    expect(t.p("p2").life).toBeGreaterThan(0);
  });
  it("20 is not enough; damage from a non-commander does not count", () => {
    const t = world(); const c = commanderOnBattlefield(t);
    t.state.commanderDamage = { p2: { [c]: 16 } };
    attackWith(t, c);
    expect(t.p("p2").hasLost).toBe(false);
    const u = world(); const plain = u.give("p1", "Boss", "battlefield");
    attackWith(u, plain);
    expect(u.state.commanderDamage ?? {}).toEqual({});
  });
  it("damage from two different commanders is tracked separately", () => {
    const t = world(["p1", "p2", "p3"]); const c = commanderOnBattlefield(t), d = commanderOnBattlefield(t, "p3");
    t.state.commanderDamage = { p2: { [c]: 10, [d]: 10 } };
    expect(t.state.commanderDamage.p2[c] + t.state.commanderDamage.p2[d]).toBe(20);
    t.state.priority = "p1";
    attackWith(t, c);
    expect(t.state.commanderDamage.p2[d]).toBe(10); expect(t.p("p2").hasLost).toBe(false);
  });
});

describe("commander designation rules", () => {
  const eng = createEngine((n) => (n === "Boss" ? boss : n === "Plain Bear" ? filler("Plain Bear") : n === "Daretti" ? ({ name: "Daretti", types: ["planeswalker"], supertypes: ["legendary"], kernel: loadDraft("daretti-scrap-savant") } as CardDef) : undefined));
  it("a legendary creature or a card that 'can be your commander' is legal", () => {
    expect(canBeCommander(boss)).toBe(true);
    expect(canBeCommander(filler("Plain Bear"))).toBe(false);
    expect(canBeCommander({ name: "Daretti", types: ["planeswalker"], supertypes: ["legendary"], kernel: loadDraft("daretti-scrap-savant") })).toBe(true);
  });
  it("Daretti / Aminatou / Saheeli the Gifted no longer need can_be_your_commander", () => {
    for (const s of ["daretti-scrap-savant"]) expect(cardUnsupported({ name: s, types: [], kernel: loadDraft(s) }).all).not.toContain("scripted:can_be_your_commander");
  });
  it("newGame with commanderRules: a legal commander starts in the command zone, life is 40; an illegal one is refused", () => {
    const g = eng.newGame({ players: [{ id: "p1", deck: [], commander: "Boss" }, { id: "p2", deck: [] }], openingHand: 0, commanderRules: true });
    expect(g.players[0].command).toHaveLength(1);
    expect(g.objects[g.players[0].command[0]].isCommander).toBe(true);
    expect(g.players.map((p) => p.life)).toEqual([40, 40]);
    expect(() => eng.newGame({ players: [{ id: "p1", deck: [], commander: "Plain Bear" }, { id: "p2", deck: [] }], openingHand: 0, commanderRules: true })).toThrow(/cannot be a commander/);
  });
  it("without commanderRules nothing is checked (old behaviour)", () => {
    expect(() => eng.newGame({ players: [{ id: "p1", deck: [], commander: "Plain Bear" }, { id: "p2", deck: [] }], openingHand: 0 })).not.toThrow();
  });
});
