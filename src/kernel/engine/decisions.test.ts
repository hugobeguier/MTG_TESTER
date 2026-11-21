// Decisions INSIDE replacement effects (replay protocol): shock lands ("pay 2 life? else enters tapped"), Thriving lands
// ("choose a color"). The events emitted before a question are delivered with the question and never again.

import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { CARDS, game } from "./testcards";

describe("decisions inside replacement effects", () => {
  it("shock land and Thriving land are fully supported by the engine now", () => {
    expect(cardUnsupported(CARDS["Godless Shrine"]).all).toEqual([]);
    expect(cardUnsupported(CARDS["Thriving Heath"]).all).toEqual([]);
  });

  describe("Godless Shrine (shock land)", () => {
    const setup = () => {
      const t = game();
      const land = t.give("p1", "Godless Shrine", "hand");
      const res = t.ok({ type: "playLand", player: "p1", cardId: land });
      return { t, land, res };
    };

    it("asks the controller before the land enters; the land stays in hand and the events so far are delivered", () => {
      const { t, land, res } = setup();
      expect(res.pending).toMatchObject({ kind: "choose_yes_no", player: "p1" });
      expect(res.pending!.prompt.instruction).toMatch(/lose 2 life/);
      expect(t.obj(land).zone).toBe("hand");
      expect(t.p("p1").life).toBe(40);
      expect(res.events.map((e) => e.type)).toEqual(["land_played"]);
      expect(t.state.pending?.id).toBe(res.pending!.id);
    });

    it("yes: pays 2 life, enters untapped; land_played is not delivered a second time", () => {
      const { t, land, res } = setup();
      const done = t.answer(res, { yes: true });
      expect(done.pending).toBeUndefined();
      expect(t.obj(land)).toMatchObject({ zone: "battlefield", tapped: false });
      expect(t.p("p1").life).toBe(38);
      const all = [...res.events, ...done.events].map((e) => e.type);
      expect(all.filter((x) => x === "land_played")).toHaveLength(1);
      expect(done.events.map((e) => e.type)).not.toContain("land_played");
      expect(all).toContain("zone_change");
      expect(all).toContain("life_loss");
      // seq numbers are one continuous sequence over both deliveries
      const seqs = [...res.events, ...done.events].map((e) => e.seq);
      expect(seqs).toEqual(seqs.map((_, i) => i));
      expect(t.state.priority).toBe("p1");
    });

    it("no: no life paid, enters tapped", () => {
      const { t, land, res } = setup();
      t.answer(res, { yes: false });
      expect(t.obj(land)).toMatchObject({ zone: "battlefield", tapped: true });
      expect(t.p("p1").life).toBe(40);
    });

    it("a bad answer or the wrong player is rejected and keeps the question open", () => {
      const { t, res } = setup();
      expect(t.do({ type: "answerDecision", player: "p2", decisionId: res.pending!.id, choice: { yes: true } }).error?.code).toBe("not_your_decision");
      expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["maybe"] } }).error?.code).toBe("invalid_choice");
      expect(t.do({ type: "passPriority", player: "p1" }).error?.code).toBe("decision_pending");
      expect(t.state.pending?.id).toBe(res.pending!.id);
    });

    it("is deterministic: identical runs give identical states and events", () => {
      const run = () => { const { t, res } = setup(); const done = t.answer(res, { yes: true }); return JSON.stringify([t.state, res.events, done.events]); };
      expect(run()).toBe(run());
    });

    it("the lands it taps for mana: an untapped shock land produces W or B", () => {
      const { t, land, res } = setup();
      t.answer(res, { yes: true });
      const r = t.ok({ type: "activateAbility", player: "p1", sourceId: land, abilityId: "a2", color: "B" });
      expect(t.p("p1").manaPool.B).toBe(1);
      expect(r.error).toBeUndefined();
    });
  });

  describe("Thriving Heath (enters tapped, choose a color)", () => {
    const setup = () => {
      const t = game();
      const land = t.give("p1", "Thriving Heath", "hand");
      const res = t.ok({ type: "playLand", player: "p1", cardId: land });
      return { t, land, res };
    };

    it("asks for a color other than white, remembers it, and the land enters tapped", () => {
      const { t, land, res } = setup();
      expect(res.pending).toMatchObject({ kind: "choose_color", player: "p1" });
      expect(res.pending!.options.map((o) => o.id)).toEqual(["U", "B", "R", "G"]);
      // the enters-tapped effect already applied before the question: its event is delivered now, not lost
      expect(res.events.map((e) => e.type)).toEqual(["land_played", "replacement_applied"]);
      const done = t.answer(res, { ids: ["B"] });
      expect(done.events.filter((e) => e.type === "replacement_applied")).toHaveLength(1); // the second effect (choose), not the first again
      expect(t.obj(land)).toMatchObject({ zone: "battlefield", tapped: true, chosen: { color: "B" } });
      expect(done.events.map((e) => e.type)).toContain("color_chosen");
      expect(done.events.map((e) => e.type)).not.toContain("land_played");
    });

    it("white is not a legal answer", () => {
      const { t, res } = setup();
      expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["W"] } }).error?.code).toBe("invalid_choice");
      expect(t.state.pending?.id).toBe(res.pending!.id);
    });

    it("with another enters-tapped effect in play the land still asks once and no event is delivered twice", () => {
      const t = game();
      t.give("p1", "Frozen Lands", "battlefield");
      t.give("p1", "Godless Shrine", "hand");
      const land = t.give("p1", "Thriving Heath", "hand");
      const res = t.ok({ type: "playLand", player: "p1", cardId: land });
      expect(res.pending!.kind).toBe("choose_color");
      const done = t.answer(res, { ids: ["G"] });
      expect(t.obj(land).tapped).toBe(true);
      expect([...res.events, ...done.events].filter((e) => e.type === "land_played")).toHaveLength(1);
    });
  });
});

describe("Academy Manufactor (draft fix: one of each per token, not a literal 1)", () => {
  it("two Treasures become two Clues, two Foods and two Treasures", () => {
    const t = game();
    t.give("p1", "Academy Manufactor", "battlefield");
    t.give("p1", "Doubling Season", "battlefield");
    t.lands("p1", "Island", 1);
    const maker = t.give("p1", "Treasure Maker", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: maker });
    let res = t.resolveTop();
    if (res.pending) res = t.answer(res, { ids: [res.pending.options[0].id] });
    const names = t.state.battlefield.map((id) => t.obj(id).cardName).filter((n) => ["Clue", "Food", "Treasure"].includes(n)).sort();
    expect(names).toEqual(["Clue", "Clue", "Food", "Food", "Treasure", "Treasure"]);
  });
});
