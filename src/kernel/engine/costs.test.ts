// Activation costs that need a choice (sacrifice another, discard, exile from graveyard, tap other permanents, return to hand, life),
// asked as pending decisions before anything is paid; candidates from the current zones.

import { describe, expect, it } from "vitest";
import type { Cost, Step } from "../schema";
import { cardUnsupported } from "./support";
import { device, fam, mk } from "./famkit";
import type { Table } from "./testkit";
import { lookup } from "./testkit";

const S = (s: Record<string, unknown>) => s as unknown as Step;
const gain2 = [S({ kind: "life_change", who: "you", lifeDelta: 2 })];
const draw1 = [S({ kind: "draw_cards", who: "you", amount: 1 })];
const costs = (...c: Array<Record<string, unknown>>) => c as unknown as Cost[];

function with_(name: string, cs: Cost[], steps: Step[], setup: (t: Table) => void = () => undefined) {
  const t = fam({ [name]: device(name, { costs: cs, steps }) });
  t.give("p1", "Island", "battlefield");
  const dev = t.give("p1", name, "battlefield");
  setup(t);
  return { t, dev, act: () => t.do({ type: "activateAbility", player: "p1", sourceId: dev, abilityId: "a1" }) };
}

describe("sacrifice another permanent", () => {
  const sac = costs({ sacrifice: { types: ["creature"], controller: "you", another: true }, count: 1 });

  it("asks which creature to sacrifice (only others you control), before paying; the pick is sacrificed as a cost", () => {
    const { t, act } = with_("Sac Outlet", sac, gain2, (t) => { t.give("p1", "Fill A", "battlefield"); t.give("p1", "Fill B", "battlefield"); t.give("p2", "Fill C", "battlefield"); });
    const res = act();
    expect(res.pending).toMatchObject({ kind: "choose_cards", player: "p1", min: 1, max: 1, cancellable: true });
    expect(res.pending!.options.map((o) => o.label).sort()).toEqual(["Fill A", "Fill B"]);
    expect(t.state.stack).toHaveLength(0); // nothing paid yet
    const a = res.pending!.options[0].id;
    t.answer(res, { ids: [a] });
    expect(t.obj(a).zone).toBe("graveyard");
    expect(t.state.stack).toHaveLength(1);
    t.resolveTop();
    expect(t.p("p1").life).toBe(42);
  });

  it("a single candidate is taken without asking", () => {
    const { t, act } = with_("Sac Outlet", sac, gain2, (t) => { t.give("p1", "Fill A", "battlefield"); });
    const res = act();
    expect(res.pending).toBeUndefined();
    expect(t.state.stack).toHaveLength(1);
  });

  it("no candidate: cannot pay, nothing happens", () => {
    const { t, act } = with_("Sac Outlet", sac, gain2);
    const before = JSON.stringify(t.state);
    const res = act();
    expect(res.error?.code).toBe("cannot_pay");
    expect(JSON.stringify(t.state)).toBe(before);
  });

  it("cancelling the decision pays nothing", () => {
    const { t, act } = with_("Sac Outlet", sac, gain2, (t) => { t.give("p1", "Fill A", "battlefield"); t.give("p1", "Fill B", "battlefield"); });
    const res = act();
    t.answer(res, { cancel: true });
    expect(t.state.battlefield.filter((id) => t.obj(id).cardName.startsWith("Fill"))).toHaveLength(2);
    expect(t.state.pending).toBeNull();
  });

  it("rejects the wrong player, an opponent's creature, a stale decision id and the wrong count", () => {
    const { t, act } = with_("Sac Outlet", sac, gain2, (t) => { t.give("p1", "Fill A", "battlefield"); t.give("p1", "Fill B", "battlefield"); t.give("p2", "Fill C", "battlefield"); });
    const res = act();
    const theirs = t.state.battlefield.find((id) => t.obj(id).controller === "p2")!;
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: res.pending!.id, choice: { ids: [res.pending!.options[0].id] } }).error?.code).toBe("not_your_decision");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [theirs] } }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: "d77", choice: { ids: [res.pending!.options[0].id] } }).error?.code).toBe("wrong_decision");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: res.pending!.options.map((o) => o.id) } }).error?.code).toBe("invalid_choice");
    expect(t.state.pending?.id).toBe(res.pending!.id);
  });

  it("the sacrificed permanent's last-known power is readable by the ability ('sacrificed')", () => {
    const { t, act } = with_("Power Sac", [...costs({ mana: "{1}" }), ...sac], [S({ kind: "life_change", who: "each_opponent", lose: true, amount: { ref: "stat", of: "sacrificed", stat: "power" } })], (t) => { t.give("p1", "Big Elf", "battlefield"); t.give("p1", "Fill A", "battlefield"); });
    const res = act();
    const elf = res.pending!.options.find((o) => o.label === "Big Elf")!.id;
    t.answer(res, { ids: [elf] });
    t.resolveTop();
    expect(t.p("p2").life).toBe(36);
  });

  it("a sacrifice-another cost on a MANA ability is supported since step 6 (asked on activation)", () => {
    const bad = mk("Sac Mana", { manaCost: "{1}", types: ["artifact"] }, [{ id: "a1", kind: "mana", text: "x", costs: sac, mana: { produces: [{ colors: "{C}" }] } } as never]);
    expect(cardUnsupported(bad).all).not.toContain("cost:mana_ability_choice");
  });
});

describe("discard", () => {
  const disc = costs({ discard: { zone: "hand", owner: "you" }, count: 1 });

  it("lists only the player's hand (never the stack or other zones) and discards the chosen card through the discard pipeline", () => {
    const { t, act } = with_("Rummage", disc, draw1, (t) => { t.give("p1", "Fill A", "hand"); t.give("p1", "Fill B", "hand"); t.give("p1", "Fill C", "library"); t.give("p2", "Fill D", "hand"); });
    const res = act();
    expect(res.pending!.options.map((o) => o.label).sort()).toEqual(["Fill A", "Fill B"]);
    const done = t.answer(res, { ids: [res.pending!.options[0].id] });
    expect(done.events.map((e) => e.type)).toContain("discard");
    expect(t.p("p1").graveyard).toHaveLength(1);
    t.resolveTop();
    expect(t.p("p1").hand).toHaveLength(2); // one discarded, one drawn
  });

  it("an empty hand cannot pay", () => {
    const { act } = with_("Rummage", disc, draw1);
    expect(act().error?.code).toBe("cannot_pay");
  });

  it("discard 'hand' / a filtered discard (only lands)", () => {
    const { t, act } = with_("Land Rummage", costs({ discard: { zone: "hand", owner: "you", types: ["land"] }, count: 1 }), draw1, (t) => { t.give("p1", "Fill A", "hand"); t.give("p1", "Fill Land", "hand"); t.give("p1", "Plains", "hand"); });
    const res = act();
    expect(res.pending!.options.map((o) => o.label).sort()).toEqual(["Fill Land", "Plains"]);
    void t;
  });

  it("a discard X cost uses the chosen X (Gix shape)", () => {
    const { t, dev } = with_("X Discard", costs({ discard: { zone: "hand", owner: "you" }, count: { ref: "X" } }), draw1, (t) => { t.give("p1", "Fill A", "hand"); t.give("p1", "Fill B", "hand"); t.give("p1", "Fill C", "hand"); });
    const res = t.ok({ type: "activateAbility", player: "p1", sourceId: dev, abilityId: "a1", x: 2 });
    expect(res.pending).toMatchObject({ min: 2, max: 2 });
  });

  it("'discard self' (cycling) is implemented for activated abilities from the hand, not for mana abilities", () => {
    const c = mk("Cycler", { manaCost: "{1}", types: ["instant"] }, [{ id: "a1", kind: "activated", zone: "hand", text: "x", costs: costs({ discard: "self", count: 1 }), steps: draw1 } as never]);
    expect(cardUnsupported(c).all).not.toContain("cost:discard_self");
    const m = mk("Cycler2", { manaCost: "{1}", types: ["instant"] }, [{ id: "a1", kind: "mana", zone: "hand", text: "x", costs: costs({ discard: "self", count: 1 }), mana: { produces: [{ colors: "{B}" }] } } as never]);
    expect(cardUnsupported(m).all).toContain("cost:discard_self");
  });
});

describe("exile from graveyard, tap other permanents, return to hand, life", () => {
  it("exile three cards from your graveyard: you choose which (only yours)", () => {
    const { t, act } = with_("Gy Eater", costs({ exileFrom: "graveyard", what: { zone: "graveyard", owner: "you" }, count: 3 }), gain2, (t) => { for (const n of ["Fill A", "Fill B", "Fill C", "Fill D"]) t.give("p1", n, "graveyard"); t.give("p2", "Fill E", "graveyard"); });
    const res = act();
    expect(res.pending).toMatchObject({ min: 3, max: 3 });
    expect(res.pending!.options).toHaveLength(4);
    t.answer(res, { ids: res.pending!.options.slice(0, 3).map((o) => o.id) });
    expect(t.p("p1").exile).toHaveLength(3);
    expect(t.p("p1").graveyard).toHaveLength(1);
    expect(t.p("p2").graveyard).toHaveLength(1);
  });

  it("not enough cards in the graveyard cannot pay", () => {
    const { act } = with_("Gy Eater", costs({ exileFrom: "graveyard", what: { zone: "graveyard", owner: "you" }, count: 3 }), gain2, (t) => { t.give("p1", "Fill A", "graveyard"); });
    expect(act().error?.code).toBe("cannot_pay");
  });

  it("exile this permanent (Enhanced Surveillance shape): the source is exiled as a cost", () => {
    const { t, dev, act } = with_("Self Exile", costs({ exileFrom: "battlefield", what: "self", count: 1 }), gain2);
    act();
    expect(t.obj(dev).zone).toBe("exile");
  });

  it("Shimmer Dragon: tap two untapped artifacts, summoning sick or not (the cost is not the {T} symbol)", () => {
    expect(cardUnsupported(lookup("Shimmer Dragon")!).all).toEqual([]);
    const t = fam();
    t.give("p1", "Fill Artifact", "battlefield"); const sick = t.give("p1", "Esper Sentinel", "battlefield", { fresh: true }); t.give("p1", "Fill Artifact", "battlefield", { tapped: true });
    t.give("p1", "Fill A", "library");
    const dragon = t.give("p1", "Shimmer Dragon", "battlefield", { fresh: true });
    const res = t.do({ type: "activateAbility", player: "p1", sourceId: dragon, abilityId: "a3" });
    expect(res.error).toBeUndefined(); // exactly two untapped artifacts (one a fresh creature, still tappable): no choice, paid
    expect(t.obj(sick).tapped).toBe(true);
    expect(t.state.battlefield.filter((id) => t.obj(id).cardName === "Fill Artifact" && !t.obj(id).tapped)).toHaveLength(0);
    t.resolveTop();
    expect(t.p("p1").hand).toHaveLength(1);
  });

  it("tap other: the source itself is not a candidate, tapped permanents are not candidates", () => {
    const { t, act } = with_("Tapper", costs({ tapOther: { types: ["artifact"], controller: "you" }, count: 1 }), draw1, (t) => { t.give("p1", "Fill Artifact", "battlefield"); t.give("p1", "Fill Artifact", "battlefield", { tapped: true }); t.give("p1", "Fill A", "library"); });
    const res = act();
    expect(res.error).toBeUndefined();
    expect(res.pending).toBeUndefined(); // one untapped other artifact: forced
    expect(t.state.battlefield.filter((id) => t.obj(id).tapped)).toHaveLength(2);
  });

  it("return a permanent you control to hand (choice)", () => {
    const { t, act } = with_("Returner", costs({ returnToHand: { types: ["creature"], controller: "you" }, count: 1 }), gain2, (t) => { t.give("p1", "Fill A", "battlefield"); t.give("p1", "Fill B", "battlefield"); });
    const res = act();
    const a = res.pending!.options[0].id;
    t.answer(res, { ids: [a] });
    expect(t.obj(a).zone).toBe("hand");
  });

  it("pay life: a number or a quantity; not enough life cannot pay", () => {
    const { t, act } = with_("Pain", costs({ life: 3 }), draw1, (t) => { t.give("p1", "Fill A", "library"); });
    act();
    expect(t.p("p1").life).toBe(37);
    const poor = with_("Pain", costs({ life: 3 }), draw1, (t) => { t.p("p1").life = 2; });
    expect(poor.act().error?.code).toBe("cannot_pay");
    const q = with_("Pain X", costs({ life: { ref: "count", of: { types: ["creature"], controller: "you" } } }), draw1, (t) => { t.give("p1", "Fill A", "battlefield"); t.give("p1", "Fill B", "battlefield"); t.give("p1", "Fill C", "library"); });
    q.act();
    expect(q.t.p("p1").life).toBe(38);
  });

  it("paid life goes through the replacement pipeline (it is life loss: a Lotus-style effect would not stop paying, it is 'lose life' events)", () => {
    const { t, act } = with_("Pain", costs({ life: 3 }), draw1, (t) => { t.give("p1", "Fill A", "library"); });
    const res = act();
    expect(res.events.find((e) => e.type === "life_loss")).toMatchObject({ player: "p1", amount: 3 });
    void t;
  });

  it("costs paid in order with mana: the pending choice comes before the mana is spent", () => {
    const { t, act } = with_("Combo", costs({ mana: "{1}" }, { sacrifice: { types: ["creature"], controller: "you" }, count: 1 }), gain2, (t) => { t.give("p1", "Fill A", "battlefield"); t.give("p1", "Fill B", "battlefield"); });
    const res = act();
    expect(res.pending).toBeDefined();
    expect(t.state.battlefield.some((id) => t.obj(id).cardName === "Island" && t.obj(id).tapped)).toBe(false); // nothing tapped yet
    t.answer(res, { ids: [res.pending!.options[0].id] });
    expect(t.state.battlefield.some((id) => t.obj(id).cardName === "Island" && t.obj(id).tapped)).toBe(true);
  });

  it("is deterministic", () => {
    const go = () => { const { t, act } = with_("Sac Outlet", costs({ sacrifice: { types: ["creature"], controller: "you" }, count: 1 }), gain2, (t) => { t.give("p1", "Fill A", "battlefield"); t.give("p1", "Fill B", "battlefield"); }); const r = act(); t.answer(r, { ids: [r.pending!.options[1].id] }); return JSON.stringify(t.state); };
    expect(go()).toBe(go());
  });
});

void lookup;
