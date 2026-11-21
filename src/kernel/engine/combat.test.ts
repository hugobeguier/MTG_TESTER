// Combat: turn structure, declarations, evasion, damage (first/double strike, trample, deathtouch, lifelink), restrictions and
// taxes, combat triggers, multiplayer, determinism. Real drafts (Ancient Copper Dragon, Vow of Malice, Utter Insignificance,
// Doubling Season, Lotus Shield) plus small hand-authored creatures for the keywords the drafts do not exercise.

import { describe, expect, it } from "vitest";
import type { Ability, StaticSpec } from "../schema";
import { CARDS } from "./testcards";
import { table, type Table } from "./testkit";
import type { CardDef, ObjId } from "./types";

const kw = (name: string): Ability => ({ id: "k:" + name, kind: "keyword", text: name, keyword: { name } });
const stat = (text: string, s: StaticSpec): Ability => ({ id: "s:" + text.slice(0, 12), kind: "static", text, static: s });
const trig = (text: string, trigger: NonNullable<Ability["trigger"]>, steps: NonNullable<Ability["steps"]>): Ability => ({ id: "t:" + text.slice(0, 12), kind: "triggered", text, trigger, steps });
const gain = (n: number) => [{ kind: "life_change" as const, lifeDelta: n, who: "you" as const }];

function creature(name: string, p: number, t: number, o: { kw?: string[]; abilities?: Ability[]; colors?: string[]; types?: string[]; subtypes?: string[] } = {}): CardDef {
  return { name, manaCost: "{1}", types: o.types ?? ["creature"], subtypes: o.subtypes, colors: o.colors, power: p, toughness: t, kernel: { schemaVersion: 2, abilities: [...(o.kw ?? []).map(kw), ...(o.abilities ?? [])] } };
}

const POOL: Record<string, CardDef> = Object.fromEntries([
  creature("Bear", 2, 2), creature("Chump", 1, 1), creature("Ogre", 3, 3), creature("Titan", 5, 5), creature("Wall", 0, 4, { kw: ["defender"] }),
  creature("Striker", 2, 2, { kw: ["first strike"] }), creature("Duelist", 3, 3, { kw: ["double strike"] }), creature("Rhino", 5, 5, { kw: ["trample"] }),
  creature("Reaper", 4, 4, { kw: ["deathtouch", "trample"] }), creature("Viper", 1, 1, { kw: ["deathtouch"] }), creature("Lifer", 3, 3, { kw: ["lifelink"] }),
  creature("Flyer", 2, 2, { kw: ["flying"] }), creature("Spider", 1, 3, { kw: ["reach"] }), creature("Menacer", 2, 2, { kw: ["menace"] }),
  creature("Vigil", 2, 2, { kw: ["vigilance"] }), creature("Hasty", 2, 2, { kw: ["haste"] }), creature("Rock", 2, 2, { kw: ["indestructible"] }),
  creature("Sneak", 2, 2, { kw: ["intimidate"], colors: ["R"] }), creature("Wraith", 2, 2, { kw: ["fear"], colors: ["B"] }), creature("Skulker", 3, 3, { kw: ["skulk"] }),
  creature("Ghost", 2, 2, { kw: ["unblockable"] }), creature("Red Imp", 1, 1, { colors: ["R"] }), creature("Black Imp", 1, 1, { colors: ["B"] }),
  creature("Golem", 1, 1, { types: ["artifact", "creature"] }), creature("Decoy", 3, 9, { kw: ["reach"], types: ["artifact", "creature"], colors: ["B", "R"] }), creature("Big Flyer", 4, 4, { kw: ["flying"] }),
  creature("Stuck", 2, 2, { abilities: [stat("This creature can't attack.", { affects: "self", modify: [{ cant: "attack" }] })] }),
  creature("Gate", 2, 2, { abilities: [stat("This creature can't block.", { affects: "self", modify: [{ cant: "block" }] })] }),
  creature("Charger", 2, 2, { abilities: [stat("This creature attacks each combat if able.", { affects: "self", modify: [{ mustAttack: true }] })] }),
  creature("Shadow", 2, 2, { abilities: [stat("This creature can't be blocked.", { affects: "self", modify: [{ cant: "be_blocked" }] })] }),
  creature("Bully", 3, 3, { abilities: [stat("This creature can't be blocked by creatures with power 2 or less.", { affects: "self", modify: [{ evasion: { cantBeBlockedBy: { types: ["creature"], power: { op: "<=", value: 2 } } } }] })] }),
  creature("Toll Blocker", 2, 2, { abilities: [stat("This creature can't block unless you pay {1}.", { affects: "self", modify: [{ blockTax: { cost: "{1}", per: "blocker" } }] })] }),
  creature("Sparker", 2, 2, { abilities: [trig("Whenever this creature attacks, you gain 1 life.", { event: "attack", subject: "self" }, gain(1))] }),
  creature("Guard", 2, 2, { abilities: [trig("Whenever this creature blocks, you gain 1 life.", { event: "block", subject: "self" }, gain(1))] }),
  creature("Martyr", 1, 4, { abilities: [trig("Whenever this creature is dealt damage, you gain 3 life.", { event: "dealt_damage", subject: "self" }, gain(3))] }),
  creature("Biter", 2, 2, { abilities: [trig("Whenever this creature deals combat damage to a player, you gain 4 life.", { event: "deals_combat_damage_to_player", subject: "self" }, gain(4))] }),
  creature("Cheerleader", 1, 1, { abilities: [trig("Whenever you attack with two or more creatures, you gain 5 life.", { event: "attack", whose: "yours", batch: true, minCount: 2 }, gain(5))] }),
  creature("Sentry", 1, 1, { abilities: [trig("Whenever a creature attacks you, you gain 1 life.", { event: "attack", subject: { types: ["creature"], controller: "opponent" }, defender: "you" }, gain(1))] }),
  creature("Warrior", 2, 2, { abilities: [trig("Whenever this creature attacks or blocks, you gain 1 life.", { event: "attack", subject: "self", alsoOn: [{ event: "block" }] }, gain(1))] }),
  creature("Soldier Maker", 1, 1, { abilities: [trig("Whenever this creature attacks, create a 1/1 Soldier.", { event: "attack", subject: "self" }, [{ kind: "create_tokens", tokenCount: 1, tokenName: "Soldier", tokenPower: 1, tokenToughness: 1, tokenColors: ["white"], tokenTypeLine: "Creature — Soldier" }])] }),
  { name: "Propaganda", manaCost: "{2}{U}", types: ["enchantment"], kernel: { schemaVersion: 2, abilities: [stat("Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.", { affects: { types: ["creature"], controller: "opponent" }, modify: [{ attackTax: { cost: "{2}", per: "attacker", protects: "you" } }] })] } },
  { name: "Ghostly Pacifier", manaCost: "{2}", types: ["enchantment"], kernel: { schemaVersion: 2, abilities: [stat("Creatures your opponents control can't attack.", { affects: { types: ["creature"], controller: "opponent" }, modify: [{ cant: "attack" }] })] } },
  { name: "Test Walker", manaCost: "{3}{U}", types: ["planeswalker"], kernel: { schemaVersion: 2, abilities: [] } },
  { name: "Relentless Assault", manaCost: "{2}{R}", types: ["sorcery"], kernel: { schemaVersion: 2, abilities: [{ id: "a1", kind: "spell_effect", text: "After this main phase, there is an additional combat phase.", steps: [{ kind: "extra_combat" }] }] } }
].map((c) => [c.name, c as CardDef]));

type T = Table;
const world = (players = ["p1", "p2"], extra: Record<string, CardDef> = {}): T => table(players, { extra: { ...CARDS, ...POOL, ...extra } });
const atk = (id: ObjId, defender: string) => ({ id, defender });
const toDeclareAttackers = (t: T, pl = "p1") => { for (let i = 0; i < 4 && t.state.turn.phase !== "declare_attackers"; i++) t.ok({ type: "advancePhase", player: pl }); };
const attackWith = (t: T, list: Array<[ObjId, string]>, pl = "p1") => { toDeclareAttackers(t, pl); return t.ok({ type: "declareAttackers", player: pl, attackers: list.map(([id, d]) => atk(id, d)) }); };
const block = (t: T, pl: string, blocks: Array<[ObjId, ObjId]>) => (t.state.turn.phase === "declare_attackers" && t.ok({ type: "advancePhase", player: t.state.turn.active }), t).ok({ type: "declareBlockers", player: pl, blocks: blocks.map(([blocker, attacker]) => ({ blocker, attacker })) });
/** advances (the active player passing with an empty stack) until end of combat or a decision */
const runToEnd = (t: T) => {
  const evs: Array<{ type: string; [k: string]: unknown }> = [];
  for (let i = 0; i < 12 && t.state.turn.phase !== "end_of_combat" && !t.state.pending && !t.state.combat?.expect && !t.state.gameOver && t.state.stack.length === 0; i++) evs.push(...t.ok({ type: "advancePhase", player: t.state.turn.active }).events);
  return evs;
};
const life = (t: T, p: string) => t.p(p).life;
const zone = (t: T, id: ObjId) => t.obj(id)?.zone;

describe("turn structure", () => {
  it("steps run beginning of combat -> declare attackers -> declare blockers -> combat damage -> end of combat", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    t.give("p2", "Chump", "battlefield");
    const phases: string[] = [];
    const note = (res: { events: Array<{ type: string; phase?: unknown }> }) => res.events.filter((e) => e.type === "phase_changed").forEach((e) => phases.push(String(e.phase)));
    note(t.ok({ type: "advancePhase", player: "p1" }));
    note(t.ok({ type: "advancePhase", player: "p1" }));
    expect(t.state.turn.phase).toBe("declare_attackers");
    expect(t.state.priority).toBeNull();
    expect(t.state.combat?.expect).toEqual({ kind: "attackers", player: "p1" });
    t.ok({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p2")] });
    expect(t.state.priority).toBe("p1");
    note(t.ok({ type: "advancePhase", player: "p1" }));
    expect(t.state.turn.phase).toBe("declare_blockers");
    expect(t.state.combat?.expect).toEqual({ kind: "blockers", players: ["p2"] });
    t.ok({ type: "declareBlockers", player: "p2", blocks: [] });
    note(t.ok({ type: "advancePhase", player: "p1" }));
    note(t.ok({ type: "advancePhase", player: "p1" }));
    expect(phases).toEqual(["beginning_of_combat", "declare_attackers", "declare_blockers", "combat_damage", "end_of_combat"]);
    expect(t.state.combat).not.toBeNull();
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.state.turn.phase).toBe("postcombat_main");
    expect(t.state.combat).toBeNull();
  });

  it("each step hands priority around the table: N players must all pass before the step ends", () => {
    const t = world(["p1", "p2", "p3"]);
    const a = t.give("p1", "Bear", "battlefield");
    attackWith(t, [[a, "p2"]]);
    expect(t.state.priority).toBe("p1");
    t.ok({ type: "passPriority", player: "p1" });
    expect(t.state.priority).toBe("p2");
    expect(t.state.turn.phase).toBe("declare_attackers");
    t.ok({ type: "passPriority", player: "p2" });
    t.ok({ type: "passPriority", player: "p3" });
    expect(t.state.turn.phase).toBe("declare_blockers"); // p2 has no creatures: nothing to declare, straight to priority
    expect(t.state.priority).toBe("p1");
    t.pass("p1", "p2", "p3");
    expect(t.state.turn.phase).toBe("combat_damage");
    expect(life(t, "p2")).toBe(38);
    t.pass("p1", "p2", "p3");
    expect(t.state.turn.phase).toBe("end_of_combat");
  });

  it("no legal attacker: declare attackers is skipped (and so are blockers and damage)", () => {
    const t = world();
    t.give("p1", "Wall", "battlefield");
    t.ok({ type: "advancePhase", player: "p1" });
    const res = t.ok({ type: "advancePhase", player: "p1" });
    expect(t.state.turn.phase).toBe("end_of_combat");
    expect(res.events.filter((e) => e.type === "phase_changed").map((e) => e.phase)).toEqual(["declare_attackers", "end_of_combat"]);
  });

  it("an empty declaration skips blockers and damage; advancePhase by the declaring player means 'no attack'", () => {
    const t = world();
    t.give("p1", "Bear", "battlefield");
    t.give("p2", "Bear", "battlefield");
    toDeclareAttackers(t);
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.state.turn.phase).toBe("end_of_combat");
    expect(life(t, "p2")).toBe(40);
  });

  it("while a declaration is pending nothing else is accepted, with a clear error", () => {
    const t = world();
    const bear = t.give("p1", "Bear", "battlefield");
    toDeclareAttackers(t);
    expect(t.do({ type: "passPriority", player: "p1" }).error?.code).toBe("declaration_pending");
    expect(t.do({ type: "castSpell", player: "p2", cardId: bear }).error?.code).toBe("declaration_pending");
    expect(t.do({ type: "advancePhase", player: "p2" }).error?.code).toBe("declaration_pending");
  });

  it("with no first or double striker there is no first-strike step; with one there is", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    attackWith(t, [[a, "p2"]]);
    const evs = runToEnd(t);
    expect(evs.filter((e) => e.type === "phase_changed").map((e) => e.phase)).not.toContain("first_strike_damage");
    const t2 = world();
    const s = t2.give("p1", "Striker", "battlefield");
    attackWith(t2, [[s, "p2"]]);
    const evs2 = runToEnd(t2);
    expect(evs2.filter((e) => e.type === "phase_changed").map((e) => e.phase)).toEqual(["declare_blockers", "first_strike_damage", "combat_damage", "end_of_combat"]);
  });

  it("extra combat phase: a second beginning of combat and a second attack in the same turn", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    t.give("p1", "Mountain", "battlefield"); t.give("p1", "Mountain", "battlefield"); t.give("p1", "Mountain", "battlefield");
    const spell = t.give("p1", "Relentless Assault", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: spell });
    t.resolveTop();
    expect(t.state.extraCombats).toBe(1);
    attackWith(t, [[a, "p2"]]);
    runToEnd(t);
    expect(life(t, "p2")).toBe(38);
    t.ok({ type: "advancePhase", player: "p1" }); // end of combat -> the extra combat
    expect(t.state.turn.phase).toBe("beginning_of_combat");
    expect(t.obj(a).tapped).toBe(true);
    t.obj(a).tapped = false;
    t.state = { ...t.state, objects: { ...t.state.objects, [a]: { ...t.state.objects[a], tapped: false } } };
    attackWith(t, [[a, "p2"]]);
    runToEnd(t);
    expect(life(t, "p2")).toBe(36);
  });
});

describe("attacking and blocking basics", () => {
  it("an unblocked attacker deals its power to the player and taps", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    const res = attackWith(t, [[a, "p2"]]);
    expect(t.obj(a).tapped).toBe(true);
    expect(res.events.map((e) => e.type)).toContain("attack");
    runToEnd(t);
    expect(life(t, "p2")).toBe(38);
  });

  it("a chump blocker takes the damage: the blocker dies, the player is untouched", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    const c = t.give("p2", "Chump", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[c, a]]);
    t.ok({ type: "advancePhase", player: "p1" });
    runToEnd(t);
    expect(life(t, "p2")).toBe(40);
    expect(zone(t, c)).toBe("graveyard");
    expect(t.obj(a).damage).toBe(1);
    expect(zone(t, a)).toBe("battlefield");
  });

  it("two equal creatures trade", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    const b = t.give("p2", "Bear", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[b, a]]);
    runToEnd(t);
    expect([zone(t, a), zone(t, b)]).toEqual(["graveyard", "graveyard"]);
  });

  it("a blocked attacker with no trample deals no damage to the player even when the blocker is gone", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    const c = t.give("p2", "Chump", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[c, a]]);
    t.state.objects[c].zone = "graveyard"; // removed from combat before damage (e.g. a removal spell in response)
    t.state.battlefield = t.state.battlefield.filter((x) => x !== c);
    t.state.players[1].graveyard.push(c);
    runToEnd(t);
    expect(life(t, "p2")).toBe(40);
  });

  it("damage stays marked until cleanup and is removed at end of turn", () => {
    const t = world();
    const a = t.give("p1", "Ogre", "battlefield");
    const c = t.give("p2", "Chump", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[c, a]]);
    runToEnd(t);
    expect(t.obj(a).damage).toBe(1);
    for (let i = 0; i < 12 && t.state.turn.number === 1; i++) t.ok({ type: "advancePhase", player: t.state.turn.active });
    expect(t.obj(a).damage).toBe(0);
  });

  it("vigilance: the attacker does not tap; without it the attacker taps", () => {
    const t = world();
    const v = t.give("p1", "Vigil", "battlefield");
    const b = t.give("p1", "Bear", "battlefield");
    attackWith(t, [[v, "p2"], [b, "p2"]]);
    expect(t.obj(v).tapped).toBe(false);
    expect(t.obj(b).tapped).toBe(true);
  });

  it("defender cannot attack; a tapped creature cannot attack", () => {
    const t = world();
    const w = t.give("p1", "Wall", "battlefield");
    const tapped = t.give("p1", "Bear", "battlefield", { tapped: true });
    const ok = t.give("p1", "Chump", "battlefield");
    toDeclareAttackers(t);
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(w, "p2")] }).error?.code).toBe("illegal_attack");
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(tapped, "p2")] }).error?.message).toMatch(/tapped/);
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(ok, "p2")] }).error).toBeUndefined();
  });

  it("a state that was rejected is returned untouched (nothing half-declared)", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    const w = t.give("p1", "Wall", "battlefield");
    toDeclareAttackers(t);
    const before = JSON.stringify(t.state);
    const res = t.do({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p2"), atk(w, "p2")] });
    expect(res.error?.code).toBe("illegal_attack");
    expect(JSON.stringify(t.state)).toBe(before);
    expect(t.obj(a).tapped).toBe(false);
  });
});

describe("damage assignment", () => {
  const dbl = () => {
    const t = world();
    const a = t.give("p1", "Ogre", "battlefield");
    const b1 = t.give("p2", "Chump", "battlefield");
    const b2 = t.give("p2", "Chump", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[b1, a], [b2, a]]);
    t.ok({ type: "advancePhase", player: "p1" });
    return { t, a, b1, b2 };
  };

  it("double block: the attacker's controller divides the damage (a pending decision)", () => {
    const { t, a, b1, b2 } = dbl();
    expect(t.state.turn.phase).toBe("combat_damage");
    const pend = t.state.pending!;
    expect(pend).toMatchObject({ kind: "assign_damage", player: "p1", amounts: { total: 3, trample: false } });
    expect(pend.options.map((o) => o.id)).toEqual([b1, b2]);
    expect(zone(t, b1)).toBe("battlefield"); // nothing dealt before the answer
    t.ok({ type: "answerDecision", player: "p1", decisionId: pend.id, choice: { assign: { [b1]: 1, [b2]: 2 } } });
    expect(zone(t, b1)).toBe("graveyard");
    expect(zone(t, b2)).toBe("graveyard");
    expect(t.obj(a).damage).toBe(2);
    expect(t.state.pending).toBeNull();
    expect(t.state.priority).toBe("p1");
  });

  it("assignment may leave one blocker alive (3 damage onto the first blocker)", () => {
    const { t, b1, b2 } = dbl();
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { assign: { [b1]: 3 } } });
    expect([zone(t, b1), zone(t, b2)]).toEqual(["graveyard", "battlefield"]);
  });

  it("a bad assignment, the wrong amount or the wrong player is rejected and the question stays open", () => {
    const { t, b1, b2 } = dbl();
    const id = t.state.pending!.id;
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: id, choice: { assign: { [b1]: 3 } } }).error?.code).toBe("not_your_decision");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: id, choice: { assign: { [b1]: 1, [b2]: 1 } } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: id, choice: { assign: { "#999": 3 } } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: id, choice: { assign: { [b1]: 4, [b2]: -1 } } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: id, choice: {} }).error?.code).toBe("invalid_choice");
    expect(t.state.pending?.id).toBe(id);
  });

  it("the blockers deal their damage to the attacker at the same time", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    const b1 = t.give("p2", "Ogre", "battlefield");
    const b2 = t.give("p2", "Chump", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[b1, a], [b2, a]]);
    t.ok({ type: "advancePhase", player: "p1" });
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { assign: { [b2]: 2 } } });
    expect(zone(t, a)).toBe("graveyard");
    expect(zone(t, b2)).toBe("graveyard");
    expect(zone(t, b1)).toBe("battlefield");
  });

  it("two multi-blocked attackers ask one after the other", () => {
    const t = world();
    const a1 = t.give("p1", "Ogre", "battlefield");
    const a2 = t.give("p1", "Ogre", "battlefield");
    const bs = [1, 2, 3, 4].map(() => t.give("p2", "Chump", "battlefield"));
    attackWith(t, [[a1, "p2"], [a2, "p2"]]);
    block(t, "p2", [[bs[0], a1], [bs[1], a1], [bs[2], a2], [bs[3], a2]]);
    t.ok({ type: "advancePhase", player: "p1" });
    const q1 = t.state.pending!;
    expect(q1.kind).toBe("assign_damage");
    t.ok({ type: "answerDecision", player: "p1", decisionId: q1.id, choice: { assign: { [bs[0]]: 2, [bs[1]]: 1 } } });
    expect(t.state.pending).not.toBeNull();
    expect(t.state.pending!.id).not.toBe(q1.id);
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { assign: { [bs[2]]: 3 } } });
    expect(bs.map((b) => zone(t, b))).toEqual(["graveyard", "graveyard", "graveyard", "battlefield"]);
  });
});

describe("first strike, double strike, trample, deathtouch, lifelink", () => {
  it("first strike kills the blocker before it deals damage", () => {
    const t = world();
    const a = t.give("p1", "Striker", "battlefield");
    const b = t.give("p2", "Bear", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[b, a]]);
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.state.turn.phase).toBe("first_strike_damage");
    expect(zone(t, b)).toBe("graveyard");
    runToEnd(t);
    expect(zone(t, a)).toBe("battlefield");
    expect(t.obj(a).damage).toBe(0);
  });

  it("first strike against first strike: both deal damage in the first step and both die", () => {
    const t = world();
    const a = t.give("p1", "Striker", "battlefield");
    const b = t.give("p2", "Striker", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[b, a]]);
    runToEnd(t);
    expect([zone(t, a), zone(t, b)]).toEqual(["graveyard", "graveyard"]);
  });

  it("a creature that dealt first-strike damage does not deal regular damage again (no double hit on the player)", () => {
    const t = world();
    const a = t.give("p1", "Striker", "battlefield");
    attackWith(t, [[a, "p2"]]);
    runToEnd(t);
    expect(life(t, "p2")).toBe(38);
  });

  it("double strike deals damage in both steps", () => {
    const t = world();
    const a = t.give("p1", "Duelist", "battlefield");
    attackWith(t, [[a, "p2"]]);
    runToEnd(t);
    expect(life(t, "p2")).toBe(34);
  });

  it("double strike vs a blocker: kills it in the first step, deals nothing more to the player (no trample)", () => {
    const t = world();
    const a = t.give("p1", "Duelist", "battlefield");
    const b = t.give("p2", "Ogre", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[b, a]]);
    runToEnd(t);
    expect(zone(t, b)).toBe("graveyard");
    expect(zone(t, a)).toBe("battlefield");
    expect(life(t, "p2")).toBe(40);
  });

  it("trample: excess damage goes to the player", () => {
    const t = world();
    const a = t.give("p1", "Rhino", "battlefield");
    const b = t.give("p2", "Bear", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[b, a]]);
    runToEnd(t);
    expect(zone(t, b)).toBe("graveyard");
    expect(life(t, "p2")).toBe(37);
  });

  it("trample accounts for damage already marked on the blocker", () => {
    const t = world();
    const a = t.give("p1", "Rhino", "battlefield");
    const b = t.give("p2", "Ogre", "battlefield");
    t.state.objects[b].damage = 2;
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[b, a]]);
    runToEnd(t);
    expect(life(t, "p2")).toBe(36); // only 1 more was needed for lethal: 4 tramples over
  });

  it("deathtouch + trample assigns only 1 to the blocker and the rest to the player", () => {
    const t = world();
    const a = t.give("p1", "Reaper", "battlefield");
    const b = t.give("p2", "Ogre", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[b, a]]);
    runToEnd(t);
    expect(zone(t, b)).toBe("graveyard");
    expect(life(t, "p2")).toBe(37);
    expect(t.obj(a).damage).toBe(3);
  });

  it("deathtouch kills any blocker with 1 damage", () => {
    const t = world();
    const a = t.give("p1", "Viper", "battlefield");
    const b = t.give("p2", "Titan", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[b, a]]);
    runToEnd(t);
    expect([zone(t, a), zone(t, b)]).toEqual(["graveyard", "graveyard"]);
  });

  it("trample + several blockers: the controller may send damage to the player only after lethal on every blocker", () => {
    const t = world();
    const a = t.give("p1", "Rhino", "battlefield");
    const b1 = t.give("p2", "Chump", "battlefield");
    const b2 = t.give("p2", "Bear", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[b1, a], [b2, a]]);
    t.ok({ type: "advancePhase", player: "p1" });
    const pend = t.state.pending!;
    expect(pend.amounts).toMatchObject({ total: 5, trample: true, lethal: { [b1]: 1, [b2]: 2 } });
    expect(pend.options.map((o) => o.id)).toContain("p2");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: pend.id, choice: { assign: { [b1]: 1, [b2]: 1, p2: 3 } } }).error?.code).toBe("invalid_choice");
    t.ok({ type: "answerDecision", player: "p1", decisionId: pend.id, choice: { assign: { [b1]: 1, [b2]: 2, p2: 2 } } });
    expect(life(t, "p2")).toBe(38);
  });

  it("only a trampler may assign to the defender", () => {
    const t = world();
    const a = t.give("p1", "Titan", "battlefield");
    const b1 = t.give("p2", "Chump", "battlefield");
    const b2 = t.give("p2", "Chump", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[b1, a], [b2, a]]);
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.state.pending!.options.map((o) => o.id)).not.toContain("p2");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { assign: { [b1]: 2, p2: 3 } } }).error?.code).toBe("invalid_choice");
  });

  it("lifelink gains life equal to the damage dealt (to a creature too)", () => {
    const t = world();
    const a = t.give("p1", "Lifer", "battlefield");
    attackWith(t, [[a, "p2"]]);
    runToEnd(t);
    expect(life(t, "p1")).toBe(43);
    const t2 = world();
    const a2 = t2.give("p1", "Lifer", "battlefield");
    const b = t2.give("p2", "Titan", "battlefield");
    attackWith(t2, [[a2, "p2"]]);
    block(t2, "p2", [[b, a2]]);
    runToEnd(t2);
    expect(life(t2, "p1")).toBe(43);
  });

  it("indestructible survives lethal damage; deathtouch cannot destroy it either", () => {
    const t = world();
    const a = t.give("p1", "Viper", "battlefield");
    const b = t.give("p2", "Rock", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[b, a]]);
    runToEnd(t);
    expect(zone(t, b)).toBe("battlefield");
    expect(zone(t, a)).toBe("graveyard");
  });

  it("combat damage goes through the replacement pipeline: Lotus Shield prevents it", () => {
    const t = world();
    t.give("p2", "Lotus Shield", "battlefield");
    const a = t.give("p1", "Bear", "battlefield");
    const res = attackWith(t, [[a, "p2"]]);
    expect(res.error).toBeUndefined();
    const evs = runToEnd(t);
    expect(life(t, "p2")).toBe(40);
    expect(evs.map((e) => e.type)).toContain("damage_prevented");
  });
});

describe("evasion and blocking restrictions", () => {
  // the Decoy can legally block anything these tests attack with, so the declare blockers step happens even when `blocker` can't block
  const setup = (attacker: string, blocker: string, decoy = true) => {
    const t = world();
    const a = t.give("p1", attacker, "battlefield");
    const b = t.give("p2", blocker, "battlefield");
    if (decoy) t.give("p2", "Decoy", "battlefield");
    attackWith(t, [[a, "p2"]]);
    t.ok({ type: "advancePhase", player: "p1" });
    return { t, a, b, tryBlock: () => t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b, attacker: a }] }) };
  };

  it("flying can't be blocked by a ground creature; reach and flying can", () => {
    expect(setup("Flyer", "Bear").tryBlock().error?.code).toBe("illegal_block");
    expect(setup("Flyer", "Spider").tryBlock().error).toBeUndefined();
    expect(setup("Flyer", "Big Flyer").tryBlock().error).toBeUndefined();
  });

  it("menace needs two blockers", () => {
    const t = world();
    const a = t.give("p1", "Menacer", "battlefield");
    const b1 = t.give("p2", "Bear", "battlefield");
    const b2 = t.give("p2", "Bear", "battlefield");
    attackWith(t, [[a, "p2"]]);
    t.ok({ type: "advancePhase", player: "p1" });
    const one = t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b1, attacker: a }] });
    expect(one.error?.code).toBe("illegal_block");
    expect(one.error?.message).toMatch(/menace/);
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b1, attacker: a }, { blocker: b2, attacker: a }] }).error).toBeUndefined();
  });

  it("intimidate: only artifact creatures and creatures sharing a color", () => {
    expect(setup("Sneak", "Bear").tryBlock().error?.code).toBe("illegal_block");
    expect(setup("Sneak", "Black Imp").tryBlock().error?.code).toBe("illegal_block");
    expect(setup("Sneak", "Red Imp").tryBlock().error).toBeUndefined();
    expect(setup("Sneak", "Golem").tryBlock().error).toBeUndefined();
  });

  it("fear: only artifact and black creatures; skulk: only creatures with power not greater", () => {
    expect(setup("Wraith", "Red Imp").tryBlock().error?.code).toBe("illegal_block");
    expect(setup("Wraith", "Black Imp").tryBlock().error).toBeUndefined();
    expect(setup("Skulker", "Titan").tryBlock().error?.code).toBe("illegal_block");
    expect(setup("Skulker", "Ogre").tryBlock().error).toBeUndefined();
  });

  it("'can't be blocked' (keyword and static) and static evasion vs small creatures", () => {
    // nobody can block them at all: the declare blockers step has no declaration
    expect(setup("Ghost", "Bear", false).t.state.combat?.expect).toBeNull();
    expect(setup("Shadow", "Titan", false).t.state.combat?.expect).toBeNull();
    expect(setup("Bully", "Bear").tryBlock().error?.code).toBe("illegal_block");
    expect(setup("Bully", "Ogre").tryBlock().error).toBeUndefined();
  });

  it("a creature that can't block, or is tapped, or is not yours, cannot block", () => {
    expect(setup("Bear", "Gate").tryBlock().error?.code).toBe("illegal_block");
    const { t, a } = setup("Bear", "Bear");
    const mine = t.give("p1", "Bear", "battlefield");
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: mine, attacker: a }] }).error?.message).toMatch(/not controlled/);
    const tapped = t.give("p2", "Bear", "battlefield", { tapped: true });
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: tapped, attacker: a }] }).error?.message).toMatch(/tapped/);
  });

  it("a creature blocks only attackers aimed at its controller (or their planeswalkers), one attacker each", () => {
    const t = world(["p1", "p2", "p3"]);
    const a1 = t.give("p1", "Bear", "battlefield");
    const a2 = t.give("p1", "Bear", "battlefield");
    const b = t.give("p2", "Ogre", "battlefield");
    t.give("p3", "Ogre", "battlefield");
    attackWith(t, [[a1, "p2"], [a2, "p3"]]);
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b, attacker: a2 }] }).error?.message).toMatch(/not attacking p2/);
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b, attacker: a1 }, { blocker: b, attacker: a1 }] }).error?.code).toBe("illegal_block");
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b, attacker: a1 }] }).error).toBeUndefined();
  });

  it("effective characteristics: a creature enchanted with Utter Insignificance has lost flying (and can be blocked by a ground creature)", () => {
    const t = world();
    const a = t.give("p1", "Flyer", "battlefield");
    const aura = t.give("p2", "Utter Insignificance", "battlefield");
    t.state.objects[aura].attachedTo = a;
    t.state.objects[aura].attachedToTs = t.obj(a).timestamp;
    const b = t.give("p2", "Bear", "battlefield");
    attackWith(t, [[a, "p2"]]);
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b, attacker: a }] }).error).toBeUndefined();
    runToEnd(t);
    expect(zone(t, a)).toBe("graveyard"); // base 1/1 now: the Bear's 2 damage kills it
  });

  it("a keyword granted until end of turn counts (flying from a rune), through the layers", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    t.state.effects.push({ id: "e1", timestamp: 99, objectId: a, objectTimestamp: t.obj(a).timestamp, grant: "flying", until: "end_of_turn" });
    const b = t.give("p2", "Ogre", "battlefield");
    t.give("p2", "Decoy", "battlefield");
    attackWith(t, [[a, "p2"]]);
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b, attacker: a }] }).error?.code).toBe("illegal_block");
  });
});

describe("summoning sickness, haste, can't attack, must attack", () => {
  it("a creature that came under your control this turn can't attack; haste exempts it", () => {
    const t = world();
    const sick = t.give("p1", "Bear", "battlefield", { fresh: true });
    const fast = t.give("p1", "Hasty", "battlefield", { fresh: true });
    toDeclareAttackers(t);
    const res = t.do({ type: "declareAttackers", player: "p1", attackers: [atk(sick, "p2")] });
    expect(res.error?.code).toBe("illegal_attack");
    expect(res.error?.message).toMatch(/summoning sick/);
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(fast, "p2")] }).error).toBeUndefined();
  });

  it("the predicate is 'controlled continuously since your most recent turn began': a creature played last turn may attack", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield", { fresh: true });
    for (let i = 0; i < 6; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
    for (let i = 0; i < 40 && !(t.state.turn.number === 3 && t.state.turn.phase === "precombat_main"); i++) t.ok({ type: "advancePhase", player: t.state.turn.active });
    expect(t.state.turn.active).toBe("p1");
    toDeclareAttackers(t);
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p2")] }).error).toBeUndefined();
  });

  it("an opponent's creature that you just gained can't attack either (control is what counts)", () => {
    const t = world();
    const a = t.give("p2", "Bear", "battlefield");
    t.give("p1", "Chump", "battlefield");
    t.state.objects[a].controller = "p1";
    t.state.objects[a].controlledSince = ++t.state.clock;
    toDeclareAttackers(t);
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p2")] }).error?.code).toBe("illegal_attack");
  });

  it("'can't attack' static and an opposing 'creatures can't attack' enchantment", () => {
    const t = world();
    const s = t.give("p1", "Stuck", "battlefield");
    const ok = t.give("p1", "Bear", "battlefield");
    toDeclareAttackers(t);
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(s, "p2")] }).error?.code).toBe("illegal_attack");
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(ok, "p2")] }).error).toBeUndefined();
    const t2 = world();
    t2.give("p2", "Ghostly Pacifier", "battlefield");
    t2.give("p1", "Bear", "battlefield");
    t2.ok({ type: "advancePhase", player: "p1" });
    t2.ok({ type: "advancePhase", player: "p1" });
    expect(t2.state.turn.phase).toBe("end_of_combat"); // nobody can attack: the step is skipped
  });

  it("vow-style: the enchanted creature can't attack the Aura's controller, but may attack another player", () => {
    const t = world(["p1", "p2", "p3"]);
    const mine = t.give("p2", "Bear", "battlefield");
    const vow = t.give("p1", "Vow of Malice", "battlefield");
    t.state.objects[vow].attachedTo = mine;
    t.state.objects[vow].attachedToTs = t.obj(mine).timestamp;
    t.state.turn = { ...t.state.turn, active: "p2" }; // p2's turn (their creatures have been theirs since before it began)
    t.state.priority = "p2";
    t.ok({ type: "advancePhase", player: "p2" });
    t.ok({ type: "advancePhase", player: "p2" });
    expect(t.state.combat?.expect).toEqual({ kind: "attackers", player: "p2" });
    const bad = t.do({ type: "declareAttackers", player: "p2", attackers: [atk(mine, "p1")] });
    expect(bad.error?.code).toBe("illegal_attack");
    expect(bad.error?.message).toMatch(/Vow of Malice/);
    expect(t.do({ type: "declareAttackers", player: "p2", attackers: [atk(mine, "p3")] }).error).toBeUndefined();
    expect(t.obj(mine).damage).toBe(0);
  });

  it("vow-style also protects the controller's planeswalkers", () => {
    const t = world(["p1", "p2", "p3"]);
    const mine = t.give("p2", "Bear", "battlefield");
    const vow = t.give("p1", "Vow of Malice", "battlefield");
    const pw = t.give("p1", "Test Walker", "battlefield", { counters: { loyalty: 4 } });
    t.state.objects[vow].attachedTo = mine;
    t.state.objects[vow].attachedToTs = t.obj(mine).timestamp;
    t.state.turn = { ...t.state.turn, active: "p2" };
    t.state.priority = "p2";
    toDeclareAttackers(t, "p2");
    expect(t.do({ type: "declareAttackers", player: "p2", attackers: [atk(mine, pw)] }).error?.code).toBe("illegal_attack");
  });

  it("must attack: leaving the creature out of the declaration is an error; attacking with it is fine", () => {
    const t = world();
    const c = t.give("p1", "Charger", "battlefield");
    const other = t.give("p1", "Bear", "battlefield");
    toDeclareAttackers(t);
    const res = t.do({ type: "declareAttackers", player: "p1", attackers: [atk(other, "p2")] });
    expect(res.error?.code).toBe("attack_requirement");
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [] }).error?.code).toBe("attack_requirement");
    expect(t.do({ type: "advancePhase", player: "p1" }).error?.code).toBe("attack_requirement");
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(c, "p2")] }).error).toBeUndefined();
  });

  it("must attack does not apply to a creature that can't attack (tapped)", () => {
    const t = world();
    t.give("p1", "Charger", "battlefield", { tapped: true });
    const other = t.give("p1", "Bear", "battlefield");
    toDeclareAttackers(t);
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(other, "p2")] }).error).toBeUndefined();
  });
});

describe("taxes", () => {
  it("propaganda-style: attacking costs {2} per attacker, paid by tapping lands", () => {
    const t = world();
    t.give("p2", "Propaganda", "battlefield");
    const a = t.give("p1", "Bear", "battlefield");
    const b = t.give("p1", "Ogre", "battlefield");
    t.lands("p1", "Island", 4);
    toDeclareAttackers(t);
    const res = t.ok({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p2"), atk(b, "p2")] });
    expect(res.events.map((e) => e.type)).toContain("tax_paid");
    expect(t.state.battlefield.filter((id) => t.obj(id).cardName === "Island" && t.obj(id).tapped)).toHaveLength(4);
  });

  it("without the mana the declaration is rejected (cannot_pay) and nothing taps; attacking with fewer creatures works", () => {
    const t = world();
    t.give("p2", "Propaganda", "battlefield");
    const a = t.give("p1", "Bear", "battlefield");
    const b = t.give("p1", "Ogre", "battlefield");
    t.lands("p1", "Island", 3);
    toDeclareAttackers(t);
    const res = t.do({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p2"), atk(b, "p2")] });
    expect(res.error?.code).toBe("cannot_pay");
    expect(t.obj(a).tapped).toBe(false);
    expect(t.state.battlefield.some((id) => t.obj(id).cardName === "Island" && t.obj(id).tapped)).toBe(false);
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p2")] }).error).toBeUndefined();
  });

  it("autoPay: false pays from the mana pool only", () => {
    const t = world();
    t.give("p2", "Propaganda", "battlefield");
    const a = t.give("p1", "Bear", "battlefield");
    t.lands("p1", "Island", 2);
    toDeclareAttackers(t);
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p2")], autoPay: false }).error?.code).toBe("cannot_pay");
    t.state.players[0].manaPool.U = 2;
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p2")], autoPay: false }).error).toBeUndefined();
    expect(t.p("p1").manaPool.U).toBe(0);
  });

  it("the tax protects only its controller: attacking a third player is free", () => {
    const t = world(["p1", "p2", "p3"]);
    t.give("p2", "Propaganda", "battlefield");
    const a = t.give("p1", "Bear", "battlefield");
    toDeclareAttackers(t);
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p3")] }).error).toBeUndefined();
  });

  it("block tax: a creature that must be paid for to block", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    const b = t.give("p2", "Toll Blocker", "battlefield");
    attackWith(t, [[a, "p2"]]);
    t.ok({ type: "advancePhase", player: "p1" });
    const no = t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b, attacker: a }] });
    expect(no.error?.code).toBe("cannot_pay");
    t.lands("p2", "Island", 1);
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b, attacker: a }] }).error).toBeUndefined();
  });
});

describe("authorization", () => {
  it("only the active player declares attackers", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    const b = t.give("p2", "Bear", "battlefield");
    toDeclareAttackers(t);
    expect(t.do({ type: "declareAttackers", player: "p2", attackers: [atk(b, "p1")] }).error?.code).toBe("not_your_declaration");
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(b, "p1")] }).error?.code).toBe("illegal_attack");
    expect(t.state.combat?.expect).toEqual({ kind: "attackers", player: "p1" });
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p2")] }).error).toBeUndefined();
  });

  it("declarations outside their step are rejected", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p2")] }).error?.code).toBe("not_declaring");
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [] }).error?.code).toBe("not_declaring");
    attackWith(t, [[a, "p2"]]);
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p2")] }).error?.code).toBe("not_declaring");
  });

  it("only a defending player with a legal block declares; the attacker's controller can't declare blockers for them", () => {
    const t = world(["p1", "p2", "p3"]);
    const a = t.give("p1", "Bear", "battlefield");
    const b2 = t.give("p2", "Bear", "battlefield");
    const b3 = t.give("p3", "Bear", "battlefield");
    attackWith(t, [[a, "p2"]]);
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.state.combat?.expect).toEqual({ kind: "blockers", players: ["p2"] });
    expect(t.do({ type: "declareBlockers", player: "p1", blocks: [] }).error?.code).toBe("not_your_declaration");
    expect(t.do({ type: "declareBlockers", player: "p3", blocks: [{ blocker: b3, attacker: a }] }).error?.code).toBe("not_your_declaration");
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b3, attacker: a }] }).error?.code).toBe("illegal_block");
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b2, attacker: a }, { blocker: b2, attacker: a }] }).error?.code).toBe("illegal_block");
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b2, attacker: a }] }).error).toBeUndefined();
  });

  it("bad attack declarations: unknown defender, attacking yourself, duplicates, a creature you don't control", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    const theirs = t.give("p2", "Bear", "battlefield");
    toDeclareAttackers(t);
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p1")] }).error?.code).toBe("illegal_attack");
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(a, "nobody")] }).error?.code).toBe("illegal_attack");
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(a, "p2"), atk(a, "p2")] }).error?.code).toBe("illegal_attack");
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk(theirs, "p2")] }).error?.code).toBe("illegal_attack");
    expect(t.do({ type: "declareAttackers", player: "p1", attackers: [atk("#9999", "p2")] }).error?.code).toBe("unknown_object");
  });
});

describe("combat triggers", () => {
  it("attacks: 'whenever this creature attacks' goes on the stack and resolves", () => {
    const t = world();
    const a = t.give("p1", "Sparker", "battlefield");
    attackWith(t, [[a, "p2"]]);
    expect(t.state.stack).toHaveLength(1);
    t.resolveTop();
    expect(life(t, "p1")).toBe(41);
  });

  it("blocks: 'whenever this creature blocks'", () => {
    const t = world();
    const a = t.give("p1", "Bear", "battlefield");
    const g = t.give("p2", "Guard", "battlefield");
    attackWith(t, [[a, "p2"]]);
    t.ok({ type: "advancePhase", player: "p1" });
    block(t, "p2", [[g, a]]);
    expect(t.state.stack).toHaveLength(1);
    t.resolveTop();
    expect(life(t, "p2")).toBe(41);
  });

  it("attacks or blocks (alsoOn)", () => {
    const t = world();
    const w = t.give("p1", "Warrior", "battlefield");
    attackWith(t, [[w, "p2"]]);
    t.resolveTop();
    expect(life(t, "p1")).toBe(41);
    const t2 = world();
    const a = t2.give("p1", "Bear", "battlefield");
    const w2 = t2.give("p2", "Warrior", "battlefield");
    attackWith(t2, [[a, "p2"]]);
    t2.ok({ type: "advancePhase", player: "p1" });
    block(t2, "p2", [[w2, a]]);
    t2.resolveTop();
    expect(life(t2, "p2")).toBe(41);
  });

  it("deals combat damage to a player: only when it hits a player, not a blocker", () => {
    const t = world();
    const a = t.give("p1", "Biter", "battlefield");
    attackWith(t, [[a, "p2"]]);
    runToEnd(t);
    expect(t.state.stack).toHaveLength(1);
    t.resolveTop();
    expect(life(t, "p1")).toBe(44);
    expect(life(t, "p2")).toBe(38);
    const t2 = world();
    const a2 = t2.give("p1", "Biter", "battlefield");
    const c = t2.give("p2", "Ogre", "battlefield");
    attackWith(t2, [[a2, "p2"]]);
    block(t2, "p2", [[c, a2]]);
    runToEnd(t2);
    expect(t2.state.stack).toHaveLength(0);
  });

  it("is dealt damage (even when the creature survives)", () => {
    const t = world();
    const a = t.give("p1", "Ogre", "battlefield");
    const m = t.give("p2", "Martyr", "battlefield");
    attackWith(t, [[a, "p2"]]);
    block(t, "p2", [[m, a]]);
    runToEnd(t);
    expect(zone(t, m)).toBe("battlefield");
    t.resolveTop();
    expect(life(t, "p2")).toBe(43);
  });

  it("batch attack trigger with minCount: only when two or more creatures attack", () => {
    const t = world();
    const c = t.give("p1", "Cheerleader", "battlefield");
    const b = t.give("p1", "Bear", "battlefield");
    attackWith(t, [[c, "p2"], [b, "p2"]]);
    expect(t.state.stack).toHaveLength(1);
    const t2 = world();
    const c2 = t2.give("p1", "Cheerleader", "battlefield");
    attackWith(t2, [[c2, "p2"]]);
    expect(t2.state.stack).toHaveLength(0);
  });

  it("attack trigger with defender: 'whenever a creature attacks you'", () => {
    const t = world(["p1", "p2", "p3"]);
    t.give("p2", "Sentry", "battlefield");
    const a = t.give("p1", "Bear", "battlefield");
    const b = t.give("p1", "Bear", "battlefield");
    attackWith(t, [[a, "p2"], [b, "p3"]]);
    expect(t.state.stack).toHaveLength(1);
  });

  it("Ancient Copper Dragon: combat damage to a player rolls a d20 (seeded) and makes that many Treasures", () => {
    const t = world();
    const d = t.give("p1", "Ancient Copper Dragon", "battlefield");
    attackWith(t, [[d, "p2"]]);
    runToEnd(t);
    expect(life(t, "p2")).toBe(34);
    expect(t.state.stack).toHaveLength(1);
    const res = t.resolveTop();
    const roll = res.events.find((e) => e.type === "die_rolled")!;
    expect(roll).toMatchObject({ sides: 20 });
    const n = roll.result as number;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(20);
    const treasures = t.state.battlefield.filter((id) => t.obj(id).cardName === "Treasure");
    expect(treasures).toHaveLength(n);
    expect(res.events.filter((e) => e.type === "token_created")).toHaveLength(n);
  });

  it("Ancient Copper Dragon: the same seed always rolls the same number; the tokens pass through replacement effects (Doubling Season)", () => {
    const run = (doubling: boolean) => {
      const t = world();
      if (doubling) t.give("p1", "Doubling Season", "battlefield");
      const d = t.give("p1", "Ancient Copper Dragon", "battlefield");
      attackWith(t, [[d, "p2"]]);
      runToEnd(t);
      const res = t.resolveTop();
      return { roll: res.events.find((e) => e.type === "die_rolled")!.result as number, treasures: t.state.battlefield.filter((id) => t.obj(id).cardName === "Treasure").length };
    };
    const a = run(false), b = run(false), c = run(true);
    expect(a).toEqual(b);
    expect(c.roll).toBe(a.roll);
    expect(c.treasures).toBe(a.roll * 2);
  });

  it("Ancient Copper Dragon blocked: no combat damage to a player, no trigger", () => {
    const t = world();
    const d = t.give("p1", "Ancient Copper Dragon", "battlefield");
    const s = t.give("p2", "Spider", "battlefield");
    attackWith(t, [[d, "p2"]]);
    block(t, "p2", [[s, d]]);
    runToEnd(t);
    expect(t.state.stack).toHaveLength(0);
  });
});

describe("planeswalkers and several players", () => {
  it("attacking a planeswalker removes loyalty; at 0 it dies", () => {
    const t = world();
    const pw = t.give("p2", "Test Walker", "battlefield", { counters: { loyalty: 3 } });
    const a = t.give("p1", "Bear", "battlefield");
    const b = t.give("p1", "Chump", "battlefield");
    attackWith(t, [[a, pw], [b, pw]]);
    runToEnd(t);
    expect(zone(t, pw)).toBe("graveyard");
    expect(life(t, "p2")).toBe(40);
  });

  it("the planeswalker's controller is the one who blocks for it", () => {
    const t = world(["p1", "p2", "p3"]);
    const pw = t.give("p2", "Test Walker", "battlefield", { counters: { loyalty: 5 } });
    const a = t.give("p1", "Ogre", "battlefield");
    const b = t.give("p2", "Chump", "battlefield");
    attackWith(t, [[a, pw]]);
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.state.combat?.expect).toEqual({ kind: "blockers", players: ["p2"] });
    block(t, "p2", [[b, a]]);
    runToEnd(t);
    expect(t.obj(pw).counters.loyalty).toBe(5);
    expect(zone(t, b)).toBe("graveyard");
  });

  it("4 players: different attackers at different defenders, each defender declares for their own creatures", () => {
    const t = world(["p1", "p2", "p3", "p4"]);
    const a = t.give("p1", "Ogre", "battlefield");
    const b = t.give("p1", "Bear", "battlefield");
    const c = t.give("p1", "Chump", "battlefield");
    const d2 = t.give("p2", "Chump", "battlefield");
    const d3 = t.give("p3", "Bear", "battlefield");
    t.give("p4", "Bear", "battlefield");
    attackWith(t, [[a, "p2"], [b, "p3"], [c, "p4"]]);
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.state.combat?.expect).toEqual({ kind: "blockers", players: ["p2", "p3", "p4"] });
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: d2, attacker: b }] }).error?.code).toBe("illegal_block");
    t.ok({ type: "declareBlockers", player: "p3", blocks: [{ blocker: d3, attacker: b }] });
    expect(t.state.combat?.expect).toEqual({ kind: "blockers", players: ["p2", "p4"] });
    t.ok({ type: "declareBlockers", player: "p2", blocks: [{ blocker: d2, attacker: a }] });
    t.ok({ type: "declareBlockers", player: "p4", blocks: [] });
    expect(t.state.combat?.expect).toBeNull();
    expect(t.state.priority).toBe("p1");
    runToEnd(t);
    expect(life(t, "p2")).toBe(40);
    expect(life(t, "p3")).toBe(40);
    expect(life(t, "p4")).toBe(39);
    expect([zone(t, d2), zone(t, a), zone(t, d3), zone(t, b)]).toEqual(["graveyard", "battlefield", "graveyard", "graveyard"]);
  });

  it("a player that is not attacked has nothing to declare, even with creatures", () => {
    const t = world(["p1", "p2", "p3"]);
    const a = t.give("p1", "Bear", "battlefield");
    t.give("p3", "Bear", "battlefield");
    attackWith(t, [[a, "p2"]]);
    t.ok({ type: "advancePhase", player: "p1" });
    expect(t.state.combat).not.toBeNull();
    expect(t.state.combat?.expect).toBeNull();
    expect(t.state.turn.phase).toBe("declare_blockers");
    expect(t.state.priority).toBe("p1");
  });

  it("a player who loses to combat damage ends the game for the last survivor", () => {
    const t = world();
    t.state.players[1].life = 2;
    const a = t.give("p1", "Bear", "battlefield");
    attackWith(t, [[a, "p2"]]);
    runToEnd(t);
    expect(t.state.gameOver).toMatchObject({ winner: "p1" });
  });
});

describe("determinism and loop guard", () => {
  it("the same game and the same actions give identical states and events", () => {
    const run = () => {
      const t = world();
      const a = t.give("p1", "Ancient Copper Dragon", "battlefield");
      const b = t.give("p1", "Ogre", "battlefield");
      const c1 = t.give("p2", "Chump", "battlefield");
      const c2 = t.give("p2", "Chump", "battlefield");
      const out: unknown[] = [];
      out.push(attackWith(t, [[a, "p2"], [b, "p2"]]).events);
      t.ok({ type: "advancePhase", player: "p1" });
      out.push(block(t, "p2", [[c1, b], [c2, b]]).events);
      const r = t.ok({ type: "advancePhase", player: "p1" });
      out.push(r.events);
      out.push(t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { assign: { [c1]: 1, [c2]: 2 } } }).events);
      out.push(t.resolveTop().events);
      return JSON.stringify([out, t.state]);
    };
    expect(run()).toBe(run());
  });

  it("a mandatory trigger loop started by an attack (attack trigger makes a token, Soldier Factory makes another) is cut off", () => {
    const t = world();
    t.give("p1", "Soldier Factory", "battlefield");
    const a = t.give("p1", "Soldier Maker", "battlefield");
    attackWith(t, [[a, "p2"]]);
    t.ok({ type: "passPriority", player: "p1" });
    const loop = t.do({ type: "passPriority", player: "p2", fastForward: true });
    expect(loop.error?.code).toBe("loop_detected");
    expect(loop.state.gameOver).toMatchObject({ draw: true });
  });
});
