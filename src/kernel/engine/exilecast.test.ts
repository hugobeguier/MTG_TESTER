// "You may cast the exiled card": resolution-time (Mind's Dilation) vs durable (Gix) permissions, on the real drafts.
import { describe, expect, it } from "vitest";
import { filler } from "./famkit";
import { legalActions } from "./legal";
import { ctxOf, realTable } from "./testdb";
import type { Table } from "./testkit";

const extra = { "Fill Artifact": filler("Fill Artifact", ["artifact"], 0, 0) };

/** p2 casts a spell on its own turn while p1 controls Mind's Dilation and `top` is p2's top card; returns the table paused at p1's decision. */
function dilation(top: string) {
  const t = realTable(["p1", "p2"], extra);
  t.give("p1", "Mind's Dilation", "battlefield");
  t.lands("p2", "Island", 3);
  t.give("p2", top, "library");
  const id = t.give("p2", "Fill Artifact", "hand");
  t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p2", stack: [], passes: [] };
  t.ok({ type: "castSpell", player: "p2", cardId: id });
  const res = t.resolveTop();
  return { t, res };
}
const casts = (t: Table, from: string) => t.state.stack.filter((s) => s.kind === "spell" && (s as { from?: string }).from === from);

describe("Mind's Dilation: 'you may cast it' while the trigger resolves", () => {
  it("a nonland card gets a real yes/no (prompt names the card text, not 'linked_exile'); yes casts it free from exile", () => {
    const { t, res } = dilation("Eternal Witness");
    expect(res.pending).toMatchObject({ kind: "choose_yes_no", player: "p1" });
    expect(res.pending!.prompt.instruction).not.toMatch(/linked_exile|you may play/);
    expect(t.state.stack).toHaveLength(1);
    const r2 = t.answer(res, { yes: true });
    expect(r2.events.some((e) => e.type === "cast" && (e as { name?: string }).name === "Eternal Witness")).toBe(true);
    expect(t.state.stack.map((s) => s.kind)).toEqual(["spell", "spell"]);
  });
  it("no leaves the card in exile; nothing can cast it later (the text allows it only during the resolution)", () => {
    const { t, res } = dilation("Eternal Witness");
    t.answer(res, { yes: false });
    const wit = t.p("p2").exile[0];
    expect(t.obj(wit).cardName).toBe("Eternal Witness");
    expect(t.state.stack).toHaveLength(1);
    expect(t.state.durableEffects ?? []).toHaveLength(0);
    expect(t.do({ type: "castSpell", player: "p1", cardId: wit }).error).toBeTruthy();
  });
  it("a land is exiled with no question and no play", () => {
    const { t, res } = dilation("Forest");
    expect(res.pending).toBeUndefined();
    expect(t.p("p2").exile.map((i) => t.obj(i).cardName)).toEqual(["Forest"]);
  });
  it("instants/sorceries/artifacts are cast the same way (Cultivate sorcery, Sol Ring artifact) regardless of the timing", () => {
    for (const c of ["Cultivate", "Sol Ring"]) {
      const { t, res } = dilation(c);
      expect(res.pending).toMatchObject({ kind: "choose_yes_no" });
      t.answer(res, { yes: true });
      expect(t.state.stack.map((s) => s.kind)).toEqual(["spell", "spell"]);
    }
  });
  it("a later trigger offers only the card exiled by that resolution, not an older linked land", () => {
    const t = realTable(["p1", "p2"], extra);
    t.give("p1", "Mind's Dilation", "battlefield");
    t.lands("p2", "Island", 3);
    t.give("p2", "Forsaken Monument", "library");
    t.give("p2", "Forest", "library");

    const castOnNewTurn = () => {
      const id = t.give("p2", "Fill Artifact", "hand");
      t.state = { ...t.state, turn: { ...t.state.turn, active: "p2", number: t.state.turn.number + 1 }, priority: "p2", stack: [], passes: [], turnLog: [] } as never;
      t.ok({ type: "castSpell", player: "p2", cardId: id });
      return t.resolveTop();
    };

    expect(castOnNewTurn().pending).toBeUndefined();
    expect(t.p("p2").exile.map((id) => t.obj(id).cardName)).toEqual(["Forest"]);

    const offer = castOnNewTurn();
    expect(offer.pending).toMatchObject({ kind: "choose_yes_no", player: "p1" });
    const cast = t.answer(offer, { yes: true });
    expect(cast.events.some((event) => event.type === "cast" && (event as { name?: string }).name === "Forsaken Monument")).toBe(true);
    expect(t.p("p2").exile.map((id) => t.obj(id).cardName)).toEqual(["Forest"]);
  });
  it("an empty library does not re-offer a card linked by an earlier trigger", () => {
    const t = realTable(["p1", "p2"], extra);
    t.give("p1", "Mind's Dilation", "battlefield");
    t.lands("p2", "Island", 3);
    t.give("p2", "Forsaken Monument", "library");

    const castOnNewTurn = () => {
      const id = t.give("p2", "Fill Artifact", "hand");
      t.state = { ...t.state, turn: { ...t.state.turn, active: "p2", number: t.state.turn.number + 1 }, priority: "p2", stack: [], passes: [], turnLog: [] } as never;
      t.ok({ type: "castSpell", player: "p2", cardId: id });
      return t.resolveTop();
    };

    const first = castOnNewTurn();
    expect(first.pending).toMatchObject({ kind: "choose_yes_no" });
    t.answer(first, { yes: false });
    expect(castOnNewTurn().pending).toBeUndefined();
    expect(t.p("p2").exile.map((id) => t.obj(id).cardName)).toEqual(["Forsaken Monument"]);
  });
});

/** Gix (durable): "you may play lands and cast spells from among cards exiled this way without paying their mana costs". */
function gix(top = "Eternal Witness") {
  const t = realTable(["p1", "p2"], extra);
  const g = t.give("p1", "Gix, Yawgmoth Praetor", "battlefield");
  t.lands("p1", "Swamp", 7);
  t.give("p1", "Fill Artifact", "hand");
  t.give("p2", "Forest", "library"); t.give("p2", "Fill Artifact", "library"); t.give("p2", top, "library");
  const ab = [...(t.state.objects[g] ? [1] : [])]; void ab;
  return { t, g };
}
function gixExile(top: string) {
  const { t, g } = gix(top);
  const abId = ctxOf(t).cards("Gix, Yawgmoth Praetor")!.kernel.abilities.find((a) => a.kind === "activated")!.id;
  t.ok({ type: "activateAbility", player: "p1", sourceId: g, abilityId: abId, x: 1, targets: { t1: ["p2"] } } as never);
  for (let i = 0; i < 4 && !t.state.stack.length && t.state.pending; i++) t.answer({ pending: t.state.pending } as never, { ids: [t.p("p1").hand[0]] });
  t.resolveTop();
  return { t, card: t.p("p2").exile[0] };
}
describe("Gix: more timing", () => {
  it("an instant exiled this way can be cast on the opponent's turn (its own timing)", () => {
    const { t, card } = gixExile("Swords to Plowshares");
    expect(t.obj(card).cardName).toBe("Swords to Plowshares");
    t.give("p2", "Fill Artifact", "battlefield");
    const s0 = t.state;
    t.state = { ...s0, turn: { ...s0.turn, active: "p2", number: s0.turn.number + 3 }, priority: "p1" };
    expect(legalActions(t.state, "p1", ctxOf(t)).some((a) => a.kind === "castSpell" && a.objectId === card)).toBe(true);
  });
  it("the permission is gone once the card leaves exile (a new object)", () => {
    const { t, card } = gixExile("Eternal Witness");
    const s = structuredClone(t.state);
    s.objects[card].timestamp += 100;
    t.state = s;
    expect(legalActions(t.state, "p1", ctxOf(t)).some((a) => a.kind === "castSpell" && a.objectId === card)).toBe(false);
  });
});
describe("Gix: a durable permission for the cards exiled this way", () => {
  it("exiled cards stay castable (no up-front question), at sorcery timing only, owner only, and the permission dies when the card leaves exile", () => {
    const { t, g } = gix();
    const abId = ctxOf(t).cards("Gix, Yawgmoth Praetor")!.kernel.abilities.find((a) => a.kind === "activated")!.id;
    t.ok({ type: "activateAbility", player: "p1", sourceId: g, abilityId: abId, x: 1, targets: { t1: ["p2"] } } as never);
    let res = t.state.pending ? t.answer({ pending: t.state.pending } as never, { ids: [t.p("p1").hand[0]] }) : undefined; void res;
    for (let i = 0; i < 4 && !t.state.stack.length && t.state.pending; i++) t.answer({ pending: t.state.pending } as never, { ids: [t.p("p1").hand[0]] });
    t.resolveTop();
    expect(t.state.pending ?? undefined).toBeUndefined();
    const ex = t.p("p2").exile;
    expect(ex.map((i) => t.obj(i).cardName)).toEqual(["Eternal Witness"]);
    expect(t.state.durableEffects).toHaveLength(1);
    const wit = ex[0];
    // castable from exile by p1 only
    expect(legalActions(t.state, "p1", ctxOf(t)).some((a) => a.kind === "castSpell" && a.objectId === wit)).toBe(true);
    expect(legalActions(t.state, "p2", ctxOf(t)).some((a) => a.kind === "castSpell" && a.objectId === wit)).toBe(false);
    expect(t.do({ type: "castSpell", player: "p2", cardId: wit }).error).toBeTruthy();
    // a creature: not on the opponent's turn (sorcery timing)
    const s0 = t.state;
    t.state = { ...s0, turn: { ...s0.turn, active: "p2" }, priority: "p1" };
    expect(t.do({ type: "castSpell", player: "p1", cardId: wit }).error).toBeTruthy();
    t.state = s0;
    // another turn later (permission persists), then cast it for free
    t.state = { ...t.state, turn: { ...t.state.turn, number: t.state.turn.number + 2 } };
    t.ok({ type: "castSpell", player: "p1", cardId: wit });
    expect(t.state.stack.some((s) => s.kind === "spell")).toBe(true);
    expect(t.p("p1").hand.length).toBe(0); // paid no mana: the lands are the only cost it did not take
    expect(t.state.durableEffects ?? []).toHaveLength(0); // used up
  });
});

describe("Mind's Dilation: when the trigger fires (real draft)", () => {
  const setup = (players = ["p1", "p2", "p3"]) => {
    const t = realTable(players, extra);
    t.give("p1", "Mind's Dilation", "battlefield");
    for (const p of players) { t.lands(p, "Island", 4); t.give(p, "Forest", "library"); t.give(p, "Forest", "library"); }
    return t;
  };
  const cast = (t: Table, who: string, active: string, name = "Fill Artifact"): number => {
    const id = t.give(who, name, "hand");
    t.state = { ...t.state, turn: { ...t.state.turn, active: who }, priority: who, passes: [], stack: [], pending: null as never };
    const before = 0; void active;
    t.ok({ type: "castSpell", player: who, cardId: id });
    return t.state.stack.filter((s) => s.kind === "triggered").length - before;
  };
  it("fires on an opponent's first spell of the turn, exiling THEIR top card; not on the second; not on the controller's own spells", () => {
    const t = setup();
    expect(cast(t, "p1", "p1")).toBe(0); // own spell
    expect(cast(t, "p2", "p2", "Sol Ring")).toBe(1); // opponent's first (any type)
    t.resolveTop();
    expect(t.state.stack.filter((s) => s.kind === "triggered")).toHaveLength(0);
    expect(t.p("p2").exile).toHaveLength(1);
    expect(t.p("p3").exile).toHaveLength(0);
    t.state = { ...t.state, stack: [], pending: null as never };
    expect(cast(t, "p2", "p2")).toBe(0); // their second
  });
  it("counts per caster: the opponent's first spell still triggers after the controller and another opponent cast one this turn", () => {
    const t = setup();
    cast(t, "p1", "p3"); t.state = { ...t.state, stack: [] };
    cast(t, "p2", "p3"); t.state = { ...t.state, stack: [] };
    expect(cast(t, "p3", "p3")).toBe(1);
  });
});
