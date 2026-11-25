// Owner vs controller (CR 108.3, 400.3): a card always goes to its OWNER's graveyard / hand / library / exile, even when someone else controlled it;
// "return ... from your graveyard to the battlefield" puts it under the control of the player who resolved the ability.
import { describe, expect, it } from "vitest";
import { filler } from "./famkit";
import { realTable } from "./testdb";
import type { Table } from "./testkit";

const extra = { "Fill Artifact": filler("Fill Artifact", ["artifact"], 0, 0), "Fill Creature": filler("Fill Creature", ["creature"], 2, 2) };
const P4 = ["p1", "p2", "p3", "p4"];
const turnOf = (t: Table, p: string) => { t.state = { ...t.state, turn: { ...t.state.turn, active: p }, priority: p, stack: [], passes: [], pending: null as never }; };
/** cast a one-target spell from `hand` by `caster` at `target`, answering every question with `answer`, and resolve it */
function castAt(t: Table, caster: string, name: string, target: string, answer: unknown = { yes: false }) {
  const c = t.give(caster, name, "hand");
  turnOf(t, caster);
  let c0 = t.ok({ type: "castSpell", player: caster, cardId: c, targets: { t1: [target] } } as never);
  for (let i = 0; i < 4 && c0.pending; i++) c0 = t.answer(c0, (c0.pending.kind === "choose_cast_option" ? { ids: [] } : answer) as never);
  for (let n = 0; n < 6 && t.state.stack.length; n++) { let r = t.resolveTop(); for (let i = 0; i < 4 && r.pending; i++) r = t.answer(r, answer as never); }
}
const libs = (t: Table) => P4.forEach((p) => { for (let i = 0; i < 6; i++) t.give(p, "Forest", "library"); });
/** p2's creature, stolen by p1 (control set directly; ownership never changes) */
function stolen(card = "Fill Creature") {
  const t = realTable(P4, extra); libs(t);
  const id = t.give("p2", card, "battlefield");
  t.state.objects[id].controller = "p1";
  return { t, id };
}

describe("Mind's Dilation: Thought Monitor taken from p2, then Daretti", () => {
  it("cast free by p1 (owner stays p2), destroyed -> p2's graveyard, Daretti (p2) returns it under p2's control", () => {
    const t = realTable(P4, extra); libs(t);
    t.give("p1", "Mind's Dilation", "battlefield");
    t.lands("p2", "Island", 3);
    t.give("p2", "Forest", "library"); t.give("p2", "Forest", "library");
    const mon = t.give("p2", "Thought Monitor", "library");
    const fa = t.give("p2", "Fill Artifact", "hand");
    turnOf(t, "p2");
    t.ok({ type: "castSpell", player: "p2", cardId: fa });
    const res = t.resolveTop();
    expect(t.obj(mon).zone).toBe("exile");
    let r = t.answer(res, { yes: true });
    expect(t.obj(mon).owner).toBe("p2");
    for (let i = 0; i < 6 && t.state.stack.length; i++) { r = t.resolveTop(); if (r.pending) r = t.answer(r, { ids: r.pending.options.slice(0, r.pending.min || 1).map((o) => o.id) } as never); }
    expect(t.obj(mon).zone).toBe("battlefield");
    expect(t.obj(mon).owner).toBe("p2");
    expect(t.obj(mon).controller).toBe("p1");
    t.lands("p1", "Forest", 3);
    castAt(t, "p1", "Beast Within", mon);
    expect(t.obj(mon).zone).toBe("graveyard");
    expect(t.p("p2").graveyard).toContain(mon);
    expect(t.p("p1").graveyard).not.toContain(mon);
    const d = t.give("p2", "Daretti, Scrap Savant", "battlefield");
    const sacr = t.give("p2", "Fill Artifact", "battlefield");
    turnOf(t, "p2");
    t.state.objects[d].counters = { loyalty: 5 };
    t.ok({ type: "activateAbility", player: "p2", sourceId: d, abilityId: "a2", targets: { t1: [mon] } } as never);
    for (let i = 0; i < 6 && t.state.pending; i++) t.answer({ pending: t.state.pending } as never, { ids: [sacr] });
    let rr = t.resolveTop();
    for (let i = 0; i < 4 && rr.pending; i++) rr = t.answer(rr, { ids: [sacr] } as never);
    expect(t.obj(mon).zone).toBe("battlefield");
    expect(t.obj(mon).controller).toBe("p2");
    expect(t.obj(mon).owner).toBe("p2");
  });
  it("Daretti's target list: only the resolving player's OWN graveyard (a card owned by someone else is never offered)", () => {
    const t = realTable(P4, extra); libs(t);
    const mine = t.give("p2", "Fill Artifact", "graveyard"); const theirs = t.give("p1", "Fill Artifact", "graveyard");
    const d = t.give("p2", "Daretti, Scrap Savant", "battlefield"); t.give("p2", "Fill Artifact", "battlefield");
    turnOf(t, "p2"); t.state.objects[d].counters = { loyalty: 5 };
    expect(t.do({ type: "activateAbility", player: "p2", sourceId: d, abilityId: "a2", targets: { t1: [theirs] } } as never).error).toBeTruthy();
    expect(t.do({ type: "activateAbility", player: "p2", sourceId: d, abilityId: "a2", targets: { t1: [mine] } } as never).error).toBeFalsy();
  });
});

describe("a permanent controlled by someone else goes to its OWNER's zones", () => {
  it("destroyed -> owner's graveyard", () => {
    const { t, id } = stolen(); t.lands("p1", "Forest", 3);
    castAt(t, "p1", "Beast Within", id);
    expect(t.p("p2").graveyard).toContain(id); expect(t.p("p1").graveyard).not.toContain(id); expect(t.obj(id).controller).toBe("p2");
  });
  it("sacrificed by its controller -> owner's graveyard", () => {
    const { t, id } = stolen("Fill Artifact"); const d = t.give("p1", "Daretti, Scrap Savant", "battlefield"); t.give("p1", "Fill Artifact", "battlefield");
    t.state.objects[d].counters = { loyalty: 5 }; turnOf(t, "p1");
    const sac = id; t.ok({ type: "activateAbility", player: "p1", sourceId: d, abilityId: "a2", targets: { t1: [t.give("p1", "Fill Artifact", "graveyard")] } } as never);
    let r = t.resolveTop(); for (let i = 0; i < 4 && r.pending; i++) r = t.answer(r, { ids: [sac] } as never);
    expect(t.p("p2").graveyard).toContain(sac); expect(t.p("p1").graveyard).not.toContain(sac);
  });
  it("exiled (Path to Exile) -> owner's exile", () => {
    const { t, id } = stolen(); t.lands("p1", "Plains", 2);
    castAt(t, "p1", "Path to Exile", id, { yes: false });
    expect(t.p("p2").exile).toContain(id); expect(t.p("p1").exile).not.toContain(id);
  });
  it("'return target creature to its owner's hand' -> owner's hand", () => {
    const { t, id } = stolen(); t.lands("p1", "Island", 2);
    const sb = t.give("p1", "Aether Spellbomb", "battlefield"); turnOf(t, "p1");
    t.ok({ type: "activateAbility", player: "p1", sourceId: sb, abilityId: "a1", targets: { t1: [id] } } as never); t.resolveTop();
    expect(t.p("p2").hand).toContain(id); expect(t.p("p1").hand).not.toContain(id);
  });
  it("shuffled into the library (Chaos Warp) -> owner's library", () => {
    const { t, id } = stolen(); t.lands("p1", "Mountain", 3);
    castAt(t, "p1", "Chaos Warp", id, { yes: true });
    expect(t.p("p2").library).toContain(id); expect(t.p("p1").library).not.toContain(id);
  });
  it("leaves p1's control when it leaves play: back on the battlefield later it is under its owner's control", () => {
    const { t, id } = stolen(); t.lands("p1", "Forest", 3);
    castAt(t, "p1", "Beast Within", id);
    expect(t.obj(id).controller).toBe("p2");
  });
});

describe("Daretti: the interactive target question", () => {
  it("offers only the activating player's own graveyard artifacts", () => {
    const t = realTable(P4, extra); libs(t);
    const mine = t.give("p2", "Fill Artifact", "graveyard"); t.give("p1", "Fill Artifact", "graveyard"); t.give("p3", "Fill Artifact", "graveyard");
    const d = t.give("p2", "Daretti, Scrap Savant", "battlefield"); t.give("p2", "Fill Artifact", "battlefield");
    turnOf(t, "p2"); t.state.objects[d].counters = { loyalty: 5 };
    const res = t.do({ type: "activateAbility", player: "p2", sourceId: d, abilityId: "a2" } as never);
    expect(res.pending?.kind).toBe("choose_targets");
    expect(res.pending!.options.map((o) => o.id)).toEqual([mine]);
  });
});

describe("'under its owner's control' wording on a stolen permanent", () => {
  it("Malakir Rebirth: the creature dies, returns under its OWNER's control (not the thief's)", () => {
    const { t, id } = stolen(); t.lands("p1", "Swamp", 2);
    castAt(t, "p1", "Malakir Rebirth // Malakir Mire", id, { yes: false });
    expect(t.obj(id).controller).toBe("p1");
    t.lands("p3", "Forest", 3);
    castAt(t, "p3", "Beast Within", id);
    expect(t.obj(id).zone).toBe("battlefield");
    expect(t.obj(id).owner).toBe("p2");
    expect(t.obj(id).controller).toBe("p2");
  });
  it("Parting Gust (no gift): exiled, returns at the next end step under its OWNER's control", () => {
    const { t, id } = stolen(); t.lands("p1", "Plains", 3);
    castAt(t, "p1", "Parting Gust", id, { yes: false });
    expect(t.p("p2").exile).toContain(id);
    for (let i = 0; i < 40 && !(t.obj(id)?.zone === "battlefield"); i++) {
      const s = t.state;
      if (s.pending) { t.answer({ pending: s.pending } as never, { yes: false }); continue; }
      if (s.combat?.expect?.kind === "attackers") { t.ok({ type: "declareAttackers", player: s.combat.expect.player, attackers: [] }); continue; }
      if (s.stack.length) { t.ok({ type: "passPriority", player: s.priority!, fastForward: true }); continue; }
      t.ok({ type: "advancePhase", player: s.turn.active });
    }
    expect(t.obj(id).zone).toBe("battlefield");
    expect(t.obj(id).controller).toBe("p2");
  });
});
