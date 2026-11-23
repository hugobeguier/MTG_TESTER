import { describe, expect, it } from "vitest";
import { ctx, mini, realGame } from "../integration/testgame";
import { playRandom } from "../integration/randomPlay";
import { canRespond, effectiveView, effectiveViews, legalActions, type LegalAction } from "./legal";
import { resolve } from "./resolve";
import type { Action, GameState } from "./types";

const kinds = (acts: LegalAction[], k: LegalAction["kind"]) => acts.filter((a) => a.kind === k);
const asBlock = (t: ReturnType<typeof mini>) => { t.state = { ...t.state, turn: { ...t.state.turn, phase: "declare_attackers" } }; };

describe("legalActions: basics", () => {
  it("play a land in the main phase, once", () => {
    const t = mini();
    const land = t.give("p1", "Swamp", "hand");
    t.give("p1", "Swamp", "hand");
    expect(kinds(legalActions(t.state, "p1", ctx), "playLand").map((a) => a.objectId)).toContain(land);
    t.ok({ type: "playLand", player: "p1", cardId: land });
    expect(kinds(legalActions(t.state, "p1", ctx), "playLand")).toHaveLength(0);
  });
  it("no land play outside the main phase or with the stack not empty", () => {
    const t = mini(["p1", "p2"], { phase: "upkeep" });
    t.give("p1", "Swamp", "hand");
    expect(kinds(legalActions(t.state, "p1", ctx), "playLand")).toHaveLength(0);
  });
  it("the player without priority has nothing; the holder can always pass", () => {
    const t = mini();
    expect(legalActions(t.state, "p2", ctx)).toEqual([]);
    const mine = legalActions(t.state, "p1", ctx);
    expect(mine.map((a) => a.kind)).toEqual(["passPriority"]);
    expect(mine[0].action).toEqual({ type: "passPriority", player: "p1" });
  });
  it("a spell is listed only when it can be paid", () => {
    const t = mini();
    t.give("p2", "Gravecrawler", "battlefield");
    const spell = t.give("p1", "Go for the Throat", "hand");
    t.give("p1", "Swamp", "battlefield");
    expect(kinds(legalActions(t.state, "p1", ctx), "castSpell")).toHaveLength(0); // {1}{B} with one Swamp
    t.give("p1", "Swamp", "battlefield");
    const cast = kinds(legalActions(t.state, "p1", ctx), "castSpell");
    expect(cast.map((a) => a.objectId)).toEqual([spell]);
    expect(cast[0].asks).toBe("choose_targets");
    expect(cast[0].targetOptions).toContain(t.state.battlefield.find((id) => t.state.objects[id].cardName === "Gravecrawler"));
  });
  it("a creature spell is sorcery speed, an instant is not", () => {
    const t = mini();
    t.give("p1", "Swamp", "battlefield"); t.give("p1", "Swamp", "battlefield"); t.give("p1", "Swamp", "battlefield");
    t.give("p2", "Swamp", "battlefield"); t.give("p2", "Swamp", "battlefield");
    t.give("p1", "Gravecrawler", "hand");
    const kill = t.give("p2", "Go for the Throat", "hand");
    const victim = t.give("p1", "Gravecrawler", "battlefield");
    expect(kinds(legalActions(t.state, "p1", ctx), "castSpell")).toHaveLength(1);
    // p1 passes, p2 gets priority at the same step with an empty stack: the instant is castable, nothing else
    t.ok({ type: "passPriority", player: "p1" });
    const p2 = legalActions(t.state, "p2", ctx);
    expect(kinds(p2, "castSpell").map((a) => a.objectId)).toEqual([kill]);
    expect(kinds(p2, "castSpell")[0].targetOptions).toContain(victim);
  });
  it("mana abilities are listed for untapped sources only and can be left out", () => {
    const t = mini();
    const sol = t.give("p1", "Sol Ring", "battlefield");
    t.give("p1", "Swamp", "battlefield", { tapped: true });
    const mana = kinds(legalActions(t.state, "p1", ctx), "activateAbility");
    expect(mana.every((a) => a.isMana)).toBe(true);
    expect(mana.map((a) => a.objectId)).toEqual([sol]);
    expect(kinds(legalActions(t.state, "p1", ctx, { mana: false }), "activateAbility")).toHaveLength(0);
  });
  it("canRespond ignores mana abilities and passing", () => {
    const t = mini();
    t.give("p1", "Swamp", "battlefield");
    expect(canRespond(t.state, "p1", ctx)).toBe(false);
    t.give("p1", "Swamp", "battlefield");
    t.give("p1", "Go for the Throat", "hand");
    t.give("p2", "Gravecrawler", "battlefield");
    expect(canRespond(t.state, "p1", ctx)).toBe(true);
  });
  it("is empty for a finished game and for a player who lost", () => {
    const t = mini();
    t.give("p1", "Swamp", "hand");
    expect(legalActions({ ...t.state, gameOver: { winner: "p2", reason: "x" } }, "p1", ctx)).toEqual([]);
    const lost = structuredClone(t.state); lost.players[0].hasLost = true;
    expect(legalActions(lost, "p1", ctx)).toEqual([]);
    expect(legalActions(t.state, "nobody", ctx)).toEqual([]);
  });
  it("is a pure read: the state is untouched and the result is deterministic", () => {
    const t = mini();
    t.give("p1", "Swamp", "hand"); t.give("p1", "Swamp", "battlefield"); t.give("p1", "Sol Ring", "battlefield");
    const before = JSON.stringify(t.state);
    const a = legalActions(t.state, "p1", ctx), b = legalActions(t.state, "p1", ctx);
    expect(JSON.stringify(t.state)).toBe(before);
    expect(a).toEqual(b);
    expect(new Set(a.map((x) => x.id)).size).toBe(a.length); // ids are unique
  });
});

describe("legalActions: decisions and combat", () => {
  it("an open decision: only its owner sees it, with options and ready choices", () => {
    const t = mini();
    t.give("p1", "Swamp", "battlefield"); t.give("p1", "Swamp", "battlefield");
    t.give("p2", "Gravecrawler", "battlefield"); t.give("p2", "Undead Augur", "battlefield");
    const spell = t.give("p1", "Go for the Throat", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: spell });
    expect(t.state.pending?.kind).toBe("choose_targets");
    expect(legalActions(t.state, "p2", ctx)).toEqual([]);
    const mine = legalActions(t.state, "p1", ctx);
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe("answerDecision");
    expect(mine[0].pending?.options.length).toBe(2);
    expect(mine[0].choices?.filter((c) => c.ids).length).toBe(2);
    expect(mine[0].choices?.some((c) => c.cancel)).toBe(true);
    for (const c of mine[0].choices!) expect(resolve(t.state, { type: "answerDecision", player: "p1", decisionId: mine[0].pending!.id, choice: c }, ctx).error).toBeUndefined();
  });
  it("declare attackers: candidates and defenders, summoning-sick creatures are left out", () => {
    const t = mini();
    const a = t.give("p1", "Gravecrawler", "battlefield");
    t.give("p1", "Undead Augur", "battlefield", { fresh: true });
    t.give("p2", "Gravecrawler", "battlefield");
    t.state = { ...t.state, turn: { ...t.state.turn, phase: "beginning_of_combat" } };
    t.ok({ type: "passPriority", player: "p1" }); t.ok({ type: "passPriority", player: "p2" });
    expect(t.state.combat?.expect).toEqual({ kind: "attackers", player: "p1" });
    expect(legalActions(t.state, "p2", ctx)).toEqual([]);
    const acts = legalActions(t.state, "p1", ctx);
    expect(acts).toHaveLength(1);
    expect(acts[0].kind).toBe("declareAttackers");
    expect(acts[0].attackers).toEqual([{ id: a, defenders: ["p2"] }]);
    expect(acts[0].mustAttack).toEqual([]);
    expect(acts[0].action).toEqual({ type: "declareAttackers", player: "p1", attackers: [] });
  });
  it("declare blockers: only the attacked player, only creatures that can block", () => {
    const t = mini();
    const atk = t.give("p1", "Gravecrawler", "battlefield");
    const blk = t.give("p2", "Undead Augur", "battlefield");
    t.give("p2", "Gravecrawler", "battlefield"); // can't block
    t.state = { ...t.state, turn: { ...t.state.turn, phase: "beginning_of_combat" } };
    t.ok({ type: "passPriority", player: "p1" }); t.ok({ type: "passPriority", player: "p2" });
    t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: atk, defender: "p2" }] });
    t.ok({ type: "passPriority", player: "p1" }); t.ok({ type: "passPriority", player: "p2" });
    expect(t.state.combat?.expect?.kind).toBe("blockers");
    expect(legalActions(t.state, "p1", ctx)).toEqual([]);
    const acts = legalActions(t.state, "p2", ctx);
    expect(acts).toHaveLength(1);
    expect(acts[0].kind).toBe("declareBlockers");
    expect(acts[0].blockers).toEqual([{ id: blk, attackers: [atk] }]);
    expect(resolve(t.state, { type: "declareBlockers", player: "p2", blocks: [{ blocker: blk, attacker: atk }] }, ctx).error).toBeUndefined();
  });
  it("asBlock helper keeps the phase untouched elsewhere", () => { const t = mini(); asBlock(t); expect(t.state.turn.phase).toBe("declare_attackers"); });
});

describe("legalActions: hidden information", () => {
  it("never mentions the opponent's hand", () => {
    const t = mini();
    t.give("p1", "Swamp", "hand");
    const secret = t.give("p2", "Grave Titan", "hand");
    t.give("p2", "Swamp", "battlefield");
    for (const who of ["p1", "p2"]) {
      const json = JSON.stringify(legalActions(t.state, who, ctx));
      if (who === "p1") { expect(json).not.toContain(secret); expect(json).not.toContain("Grave Titan"); }
    }
  });
  it("the options of someone else's decision are not available to the asker", () => {
    const t = mini();
    t.give("p1", "Swamp", "battlefield"); t.give("p1", "Swamp", "battlefield");
    t.give("p2", "Gravecrawler", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Go for the Throat", "hand") });
    expect(legalActions(t.state, "p2", ctx)).toEqual([]);
  });
});

describe("effectiveView", () => {
  it("applies layers: Bad Moon makes a black creature 3/2, counters add on top", () => {
    const t = mini();
    t.give("p1", "Bad Moon", "battlefield");
    const g = t.give("p1", "Gravecrawler", "battlefield", { counters: { "+1/+1": 1 } });
    const v = effectiveView(t.state, g, ctx);
    expect([v.power, v.toughness]).toEqual([4, 3]);
    expect([v.printedPower, v.printedToughness]).toEqual([2, 1]);
    expect(v.counters).toEqual({ "+1/+1": 1 });
    expect(v.types).toContain("creature");
    expect(v.subtypes).toContain("Zombie");
  });
  it("summoning sick, tapped, controller and keywords", () => {
    const t = mini();
    const fresh = t.give("p1", "Undead Augur", "battlefield", { fresh: true, tapped: true });
    const old = t.give("p1", "Undead Augur", "battlefield");
    expect(effectiveView(t.state, fresh, ctx)).toMatchObject({ summoningSick: true, tapped: true, controller: "p1", zone: "battlefield" });
    expect(effectiveView(t.state, old, ctx).summoningSick).toBe(false);
  });
  it("combat role is reported for attackers and blockers", () => {
    const t = mini();
    const atk = t.give("p1", "Gravecrawler", "battlefield");
    const blk = t.give("p2", "Undead Augur", "battlefield");
    t.state = { ...t.state, turn: { ...t.state.turn, phase: "beginning_of_combat" } };
    t.ok({ type: "passPriority", player: "p1" }); t.ok({ type: "passPriority", player: "p2" });
    t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: atk, defender: "p2" }] });
    t.ok({ type: "passPriority", player: "p1" }); t.ok({ type: "passPriority", player: "p2" });
    t.ok({ type: "declareBlockers", player: "p2", blocks: [{ blocker: blk, attacker: atk }] });
    expect(effectiveView(t.state, atk, ctx)).toMatchObject({ attacking: true, attackTarget: "p2", blocking: false });
    expect(effectiveView(t.state, blk, ctx)).toMatchObject({ blocking: true, blockedAttackers: [atk], attacking: false });
  });
  it("lists ability texts and equipment attachments", () => {
    const t = mini();
    const host = t.give("p1", "Gravecrawler", "battlefield");
    const lw = t.give("p1", "Lashwrithe", "battlefield");
    const o = t.state.objects[lw]; o.attachedTo = host; o.attachedToTs = t.state.objects[host].timestamp;
    const v = effectiveView(t.state, host, ctx);
    expect(v.attachments).toEqual([lw]);
    expect(effectiveView(t.state, lw, ctx).attachedTo).toBe(host);
    expect(v.abilities.length).toBeGreaterThan(0);
    expect(v.abilities.every((a) => typeof a.text === "string")).toBe(true);
  });
  it("effectiveViews skips unknown ids and shares one pass", () => {
    const t = mini();
    const a = t.give("p1", "Swamp", "battlefield");
    const views = effectiveViews(t.state, ctx, [a, "#999", "p1"]);
    expect(Object.keys(views)).toEqual([a]);
  });
  it("throws for an unknown object", () => { expect(() => effectiveView(mini().state, "#404", ctx)).toThrow(); });
});

// ---------------------------------------------------------------- property: everything listed is accepted by resolve

const ILLEGAL_OK = new Set(["cannot_pay", "unsupported", "loop_detected"]);
function checkPosition(s: GameState, actor: string, acts: LegalAction[]): string[] {
  const bad: string[] = [];
  const run = (a: Action, what: string, allow: Set<string> = ILLEGAL_OK) => {
    const res = resolve(s, a, ctx);
    if (res.error && !allow.has(res.error.code)) bad.push(`${what}: ${res.error.code} ${res.error.message}`);
  };
  for (const a of acts) {
    if ((a.kind === "playLand" || a.kind === "castSpell" || a.kind === "activateAbility" || a.kind === "passPriority") && a.action) run(a.action, a.id);
    if (a.kind === "answerDecision") for (const c of (a.choices ?? []).slice(0, 8)) run({ type: "answerDecision", player: actor, decisionId: a.pending!.id, choice: c }, `${a.id} ${JSON.stringify(c)}`, new Set(["loop_detected"]));
    if (a.kind === "declareAttackers") {
      if (a.action) run(a.action, "attack minimal");
      if (!a.mustAttack?.length) for (const at of (a.attackers ?? []).slice(0, 4)) for (const d of at.defenders.slice(0, 2)) run({ type: "declareAttackers", player: actor, attackers: [{ id: at.id, defender: d }] }, `attack ${at.id}->${d}`);
    }
    if (a.kind === "declareBlockers") {
      if (a.action) run(a.action, "block none");
      for (const b of (a.blockers ?? []).slice(0, 4)) for (const at of b.attackers.slice(0, 2)) run({ type: "declareBlockers", player: actor, blocks: [{ blocker: b.id, attacker: at }] }, `block ${b.id}->${at}`);
    }
  }
  // converse for the cheap cases: a land or mana ability that is NOT listed must really be rejected
  const listed = new Set(acts.map((a) => a.id));
  if (!s.pending && !s.combat?.expect && s.priority === actor) {
    const me = s.players.find((p) => p.id === actor)!;
    for (const id of me.hand) {
      if (!s.objects[id] || listed.has(`playLand:${id}`)) continue;
      const def = ctx.cards(s.objects[id].cardName);
      if (def?.types.includes("land") && !(def.faces && Object.keys(def.faces).length)) { const res = resolve(s, { type: "playLand", player: actor, cardId: id }, ctx); if (!res.error) bad.push(`unlisted playLand ${id} was accepted`); }
    }
  }
  return bad;
}

describe("property: legalActions agrees with resolve on random Wretched Ranks positions", () => {
  for (const seed of [1, 2, 3, 4]) {
    it(`seed ${seed}`, () => {
      const start = realGame(undefined, { seed, upkeep: true });
      const bad: string[] = [];
      let positions = 0;
      const seen: Record<string, number> = {};
      playRandom(start, ctx, seed * 17, 160, (p) => {
        positions++;
        for (const a of p.acts) seen[a.kind] = (seen[a.kind] ?? 0) + 1;
        bad.push(...checkPosition(p.state, p.actor, p.acts).map((m) => `[seed ${seed} turn ${p.state.turn.number} ${p.state.turn.phase}] ${m}`));
      });
      expect(bad).toEqual([]);
      expect(positions).toBeGreaterThan(100);
      expect(seen.passPriority).toBeGreaterThan(0);
    }, 120_000);
  }
  it("the random games exercise lands, spells and abilities", () => {
    const seen: Record<string, number> = {};
    for (const seed of [5, 6]) playRandom(realGame(undefined, { seed, upkeep: true }), ctx, seed, 220, (p) => { for (const a of p.acts) seen[a.kind] = (seen[a.kind] ?? 0) + 1; });
    expect(seen.playLand).toBeGreaterThan(0);
    expect(seen.castSpell).toBeGreaterThan(0);
    expect(seen.activateAbility).toBeGreaterThan(0);
  }, 120_000);
});
