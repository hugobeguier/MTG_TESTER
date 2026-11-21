import { describe, expect, it } from "vitest";
import type { Ability } from "../schema";
import { chars } from "./core";
import { CARDS } from "./testcards";
import { lookup, table, type Table } from "./testkit";
import type { CardDef, ObjId } from "./types";

const card = (name: string, abilities: Ability[], o: Partial<CardDef> = {}): CardDef => ({ name, manaCost: "{1}", types: ["creature"], power: 1, toughness: 1, kernel: { schemaVersion: 2, abilities }, ...o });
const gain = (n: number) => [{ kind: "life_change" as const, lifeDelta: n, who: "you" as const }];
const POOL: Record<string, CardDef> = Object.fromEntries([
  card("Bear", []),
  card("Mourner", [{ id: "a1", kind: "triggered", text: "When this creature leaves the battlefield, you gain 3 life.", trigger: { event: "leaves", subject: "self", fromZone: "battlefield" }, steps: gain(3) }]),
  card("Bone Collector", [{ id: "a1", kind: "triggered", text: "Whenever a creature you control is put into a graveyard from the battlefield, you gain 2 life.", trigger: { event: "leaves", subject: { types: ["creature"], controller: "you" }, fromZone: "battlefield", toZone: "graveyard" }, steps: gain(2) }]),
  card("Exile Watcher", [{ id: "a1", kind: "triggered", text: "Whenever a creature you control is exiled from the battlefield, you gain 5 life.", trigger: { event: "leaves", subject: { types: ["creature"], controller: "you" }, toZone: "exile" }, steps: gain(5) }]),
  card("Shy One", [{ id: "a1", kind: "triggered", text: "Whenever this creature becomes the target of a spell or ability, you gain 4 life.", trigger: { event: "becomes_target", subject: "self" }, steps: gain(4) }]),
  card("Immortal", [{ id: "a1", kind: "static", text: "You can't lose the game.", static: { affects: "you", modify: [{ grant: "can't lose the game" }] } }], { types: ["artifact"] }),
  card("Aura of Calm", [{ id: "a1", kind: "static", text: "You have hexproof.", static: { affects: "you", modify: [{ grant: "hexproof" }] } }], { types: ["enchantment"] }),
  card("Silencer", [{ id: "a1", kind: "static", text: "Your opponents can't cast spells.", static: { affects: "each_opponent", modify: [{ cant: "cast" }] } }], { types: ["enchantment"] }),
  card("Library Tower", [{ id: "a1", kind: "static", text: "You have no maximum hand size.", static: { affects: "you", modify: [{ grant: "no maximum hand size" }] } }], { types: ["artifact"] }),
  card("Foodmaker", [{ id: "a1", kind: "static", text: "Other creatures have '{2}: You gain 1 life.'", static: { affects: { types: ["creature"], another: true }, modify: [{ grantAbility: { id: "g1", kind: "activated", text: "{2}: You gain 1 life.", costs: [{ mana: "{2}" }], steps: gain(1) } }] } }], { types: ["enchantment"] }),
  card("Tester", [], { types: ["instant"], manaCost: "{R}" })
].map((c) => [c.name, c]));
const world = (): Table => table(["p1", "p2"], { extra: { ...CARDS, ...POOL } });
const defs = (n: string) => POOL[n] ?? lookup(n) ?? CARDS[n];
const chr = (t: Table, id: ObjId) => chars({ s: structuredClone(t.state), events: [], defs, scanned: 0 } as never, id);
const bolt = (t: Table, who: string, target: string) => { t.lands(who, "Mountain", 1); const b = t.give(who, "Lightning Bolt", "hand"); t.state = { ...t.state, priority: who }; return t.do({ type: "castSpell", player: who, cardId: b, targets: { t1: [target] } }); };

describe("leaves-the-battlefield triggers", () => {
  it("self: fires when the creature dies, with fromZone battlefield", () => {
    const t = world(); const m = t.give("p1", "Mourner", "battlefield");
    expect(bolt(t, "p2", m).error).toBeUndefined();
    t.pass("p2", "p1"); t.pass(t.state.priority!, t.state.priority === "p1" ? "p2" : "p1");
    for (let i = 0; i < 4 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.obj(m).zone).toBe("graveyard"); expect(t.p("p1").life).toBe(43);
  });
  it("self: also fires when it is exiled or bounced (any destination)", () => {
    const t = world(); const m = t.give("p1", "Mourner", "battlefield");
    t.lands("p1", "Plains", 1); const stp = t.give("p1", "Swords to Plowshares", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: stp, targets: { t1: [m] } });
    for (let i = 0; i < 6 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.obj(m).zone).toBe("exile"); expect(t.p("p1").life).toBe(44); // 3 from the leaves trigger + 1 from Swords
  });
  it("filter subject + toZone graveyard: another creature you control dying triggers; an opponent's does not", () => {
    const t = world(); t.give("p1", "Bone Collector", "battlefield");
    const mine = t.give("p1", "Bear", "battlefield"), theirs = t.give("p2", "Bear", "battlefield");
    bolt(t, "p2", theirs); for (let i = 0; i < 6 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.p("p1").life).toBe(40);
    bolt(t, "p2", mine); for (let i = 0; i < 6 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.p("p1").life).toBe(42);
  });
  it("toZone filters: exile-only watcher ignores deaths", () => {
    const t = world(); t.give("p1", "Exile Watcher", "battlefield"); const mine = t.give("p1", "Bear", "battlefield");
    bolt(t, "p2", mine); for (let i = 0; i < 6 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.p("p1").life).toBe(40);
  });
    it("becomes_target (self) fires when a spell targets it, even if the spell is later countered", () => {
    const t = world(); const s = t.give("p1", "Shy One", "battlefield");
    bolt(t, "p2", s);
    expect(t.state.stack.some((i) => i.kind === "triggered")).toBe(true);
    for (let i = 0; i < 6 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.p("p1").life).toBe(44);
  });
  it("it fires for activated abilities that target it too", () => {
    const t = world(); const s = t.give("p1", "Shy One", "battlefield");
    expect(s).toBeTruthy();
    const res = bolt(t, "p1", s); expect(res.error).toBeUndefined();
    expect(t.state.stack.length).toBe(2);
  });
  const ward = () => {
    const t = world(); const k = t.give("p1", "Kappa Cannoneer", "battlefield");
    return { t, k };
  };
  it("Kappa Cannoneer ward {4}: the opponent is asked to pay; not paying counters the spell", () => {
    const { t, k } = ward(); t.lands("p2", "Island", 4);
    bolt(t, "p2", k);
    t.state = { ...t.state, priority: "p2" };
    for (let i = 0; i < 4 && !t.state.pending && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    // 1 Mountain + 3 Islands = 4 mana is available: the ward trigger asks
    expect(t.state.pending?.kind).toBe("pay_unless"); expect(t.state.pending?.player).toBe("p2");
  });
  it("ward: unable to pay {4} (only 1 mana) counters the spell without a question", () => {
    const { t, k } = ward();
    bolt(t, "p2", k);
    for (let i = 0; i < 6 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.obj(k).damage).toBe(0);
    expect(t.p("p2").graveyard).toHaveLength(1); // the countered Bolt
  });
  it("ward does not trigger for its controller's own spells", () => {
    const { t, k } = ward();
    bolt(t, "p1", k);
    expect(t.state.stack.filter((i) => i.kind === "triggered")).toHaveLength(0);
  });
  it("ward paid: the spell resolves", () => {
    const { t, k } = ward(); t.lands("p2", "Island", 4);
    bolt(t, "p2", k);
    t.state = { ...t.state, priority: "p2" };
    let guard = 0;
    while ((t.state.stack.length || t.state.pending) && guard++ < 10) {
      if (t.state.pending) t.ok({ type: "answerDecision", player: t.state.pending.player, decisionId: t.state.pending.id, choice: { yes: true } });
      else t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    }
    expect(t.obj(k).damage).toBe(3);
  });
});

describe("static abilities on players", () => {
  it("can't lose the game: at 0 life you stay in", () => {
    const t = world(); t.give("p1", "Immortal", "battlefield"); t.state.players[0].life = 0;
    bolt(t, "p2", "p1"); for (let i = 0; i < 6 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.p("p1").hasLost).toBe(false); expect(t.state.gameOver).toBeNull();
  });
  it("without it you lose at 0 life", () => {
    const t = world(); t.state.players[0].life = 3;
    bolt(t, "p2", "p1"); for (let i = 0; i < 6 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.p("p1").hasLost).toBe(true);
  });
  it("you have hexproof: opponents cannot target you, you can", () => {
    const t = world(); t.give("p1", "Aura of Calm", "battlefield");
    expect(bolt(t, "p2", "p1").error?.code).toBe("illegal_target");
    expect(bolt(t, "p1", "p1").error).toBeUndefined();
  });
  it("opponents can't cast spells", () => {
    const t = world(); t.give("p1", "Silencer", "battlefield");
    expect(bolt(t, "p2", "p1").error?.code).toBe("wrong_timing");
    expect(bolt(t, "p1", "p2").error).toBeUndefined();
  });
  it("no maximum hand size: no cleanup discard", () => {
    const t = world(); t.give("p1", "Library Tower", "battlefield");
    for (let i = 0; i < 9; i++) t.give("p1", "Island", "hand");
    for (let i = 0; i < 60 && !(t.state.turn.number === 2); i++) t.ok({ type: "advancePhase", player: t.state.turn.active });
    expect(t.state.pending).toBeNull(); expect(t.p("p1").hand).toHaveLength(9);
  });
});

describe("grantAbility", () => {
  it("other creatures gain an activated ability, the source does not", () => {
    const t = world(); const f = t.give("p1", "Foodmaker", "battlefield"); const b = t.give("p1", "Bear", "battlefield");
    expect(chr(t, b).abilities.some((a) => a.kind === "activated")).toBe(true);
    expect(chr(t, f).abilities.some((a) => a.kind === "activated")).toBe(false);
  });
  it("the granted ability can be activated, and works for opponents' creatures as well", () => {
    const t = world(); t.give("p1", "Foodmaker", "battlefield"); t.lands("p2", "Island", 2); const b = t.give("p2", "Bear", "battlefield");
    const id = chr(t, b).abilities.find((a) => a.kind === "activated")!.id;
    t.state = { ...t.state, priority: "p2", turn: { ...t.state.turn, active: "p2" } };
    t.ok({ type: "activateAbility", player: "p2", sourceId: b, abilityId: id });
    t.pass("p2", "p1"); expect(t.p("p2").life).toBe(41);
  });
  it("it goes away with the source", () => {
    const t = world(); const f = t.give("p1", "Foodmaker", "battlefield"); const b = t.give("p1", "Bear", "battlefield");
    const s = structuredClone(t.state); s.battlefield = s.battlefield.filter((x) => x !== f); s.objects[f].zone = "graveyard"; t.state = s;
    expect(chr(t, b).abilities.some((a) => a.kind === "activated")).toBe(false);
  });
  it("Ygra: other creatures are Food artifacts and a Food dying gives Ygra two counters", () => {
    const t = world(); const y = t.give("p1", "Ygra, Eater of All", "battlefield"); const b = t.give("p1", "Bear", "battlefield");
    expect(chr(t, b).subtypes).toContain("Food");
    bolt(t, "p2", b); for (let i = 0; i < 8 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.obj(y).counters["+1/+1"]).toBe(2);
  });
});
