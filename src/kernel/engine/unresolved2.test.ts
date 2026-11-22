// Continue mode, part 2: continuous abilities, costs, cast options, determinism, redaction.
import { describe, expect, it } from "vitest";
import { table } from "./testkit";
import { CONT, cast, castAndResolve, mk, perm, setup, spell, unres } from "./unresolvedkit";
import { eventsFor, viewFor } from "./view";
import type { GameEvent } from "./types";

const oddStatic = { kind: "static", text: "Odd Static gets teleported.", static: { affects: "self", modify: [{ teleport: true }] } };
const oddRepl = { kind: "replacement", text: "If you would become tapped, prevent it.", replacement: { event: "would_become_tapped", result: { mode: "prevent" } } };

describe("continue mode: continuous abilities are reported once and ignored", () => {
  const withStatic = perm("Odd Static", [oddStatic]);
  const withTrigger = perm("Odd Trigger", [{ kind: "triggered", text: "Whenever the moon rises, gain 5 life.", trigger: { event: "becomes_blighted" }, steps: [{ kind: "life_change", lifeDelta: 5, who: "you" }] }]);
  const withRepl = perm("Odd Replacement", [oddRepl]);
  const withKw = perm("Odd Keyword", [{ kind: "keyword", text: "Annihilator 2", keyword: { name: "annihilator", param: 2 } }], ["creature"]);

  it("an unsupported static ability is reported when the permanent enters, never again, and does not stop anything", () => {
    const t = setup([withStatic]);
    const { id, events } = castAndResolve(t, "Odd Static");
    const u = unres(events);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ card: "Odd Static", abilityKind: "static", capability: "static:teleport", effect: "ignored", clause: "Odd Static gets teleported." });
    expect(t.obj(id).zone).toBe("battlefield");
    const again: GameEvent[] = [];
    for (let i = 0; i < 5; i++) again.push(...t.ok({ type: "advancePhase", player: t.state.priority ?? "p1" }).events);
    expect(unres(again)).toHaveLength(0);
  });
  it("an unsupported trigger event never fires and is reported once on entering", () => {
    const t = setup([withTrigger]);
    const life = t.p("p1").life;
    const { events } = castAndResolve(t, "Odd Trigger");
    expect(unres(events).map((e) => e.capability)).toEqual(["trigger:becomes_blighted"]);
    expect(unres(events)[0].effect).toBe("ignored");
    expect(t.state.stack).toHaveLength(0);
    expect(t.p("p1").life).toBe(life);
  });
  it("an unsupported replacement effect is ignored (reported once) and the permanent behaves normally", () => {
    const t = setup([withRepl]);
    const { id, events } = castAndResolve(t, "Odd Replacement");
    expect(unres(events).map((e) => e.capability)).toEqual(["replacement:would_become_tapped"]);
    expect(t.obj(id).zone).toBe("battlefield");
  });
  it("an unsupported keyword ability is reported once when its permanent enters", () => {
    const t = setup([withKw]);
    const { events } = castAndResolve(t, "Odd Keyword");
    expect(unres(events).map((e) => e.capability)).toEqual(["keyword:annihilator"]);
  });
  it("a permanent placed straight on the battlefield is reported on the first pass that looks at it, once", () => {
    const t = setup([withStatic]);
    const id = t.give("p1", "Odd Static", "battlefield");
    const evs: GameEvent[] = [];
    for (let i = 0; i < 4; i++) evs.push(...t.ok({ type: "advancePhase", player: t.state.priority ?? "p1" }).events);
    expect(unres(evs).length).toBe(1);
    expect(t.obj(id).zone).toBe("battlefield");
  });
  it("a scripted marker the engine does not know on a triggered ability: ignored and reported", () => {
    const c = perm("Odd Script", [{ kind: "triggered", text: "Whenever you do the thing.", trigger: { event: "etb", subject: "self" }, scripted: { handler: "do_the_thing" }, steps: [{ kind: "life_change", lifeDelta: 1, who: "you" }] }]);
    const t = setup([c]);
    const { events } = castAndResolve(t, "Odd Script");
    expect(unres(events).map((e) => e.capability)).toEqual(["scripted:do_the_thing"]);
  });
  it("a trigger with a supported frame but an unsupported step fires, runs the supported step, skips and reports the other", () => {
    const c = perm("Half Trigger", [{ kind: "triggered", text: "When this enters, gain 3 life and goad everything.", trigger: { event: "etb", subject: "self" }, steps: [{ kind: "life_change", lifeDelta: 3, who: "you" }, { kind: "goad_everything", target: "self" }] }]);
    const t = setup([c]);
    const life = t.p("p1").life;
    const { events } = castAndResolve(t, "Half Trigger");
    expect(unres(events)).toHaveLength(1);
    expect(unres(events)[0]).toMatchObject({ capability: "step:goad_everything", effect: "skipped", abilityKind: "triggered" });
    expect(t.p("p1").life).toBe(life + 3);
  });
  it("two unsupported abilities on one card give two events; strict mode refuses the card outright", () => {
    const c = perm("Two Odd", [oddStatic, oddRepl]);
    const t = setup([c]);
    const { events } = castAndResolve(t, "Two Odd");
    expect(unres(events)).toHaveLength(2);
    const s = setup([c], { mode: "error" });
    const id = s.give("p1", "Two Odd", "hand");
    expect(s.do({ type: "castSpell", player: "p1", cardId: id }).error?.code).toBe("unsupported");
  });
  it("a token created with an unsupported ability exists and reports that ability", () => {
    const c = spell("Odd Tokens", [{ kind: "create_tokens", tokenCount: 1, tokenName: "Oddling", tokenPower: 1, tokenToughness: 1, tokenColors: ["blue"], tokenTypeLine: "Creature — Odd", tokenAbilities: [{ id: "k1", kind: "static", text: "Oddling is odd.", static: { affects: "self", modify: [{ teleport: true }] } }] }]);
    const t = setup([c]);
    const { events } = castAndResolve(t, "Odd Tokens");
    expect(t.state.battlefield.filter((id) => t.obj(id).token)).toHaveLength(1);
    const u = unres(events);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ card: "Oddling", capability: "static:teleport" });
  });
});

describe("continue mode: costs are never silently free", () => {
  const costly = perm("Odd Engine", [{ kind: "activated", text: "{T}, Discard a card at random: gain 4 life.", costs: [{ tap: "self" }, { unsupported: "discard a card at random" }], steps: [{ kind: "life_change", lifeDelta: 4, who: "you" }] }], ["artifact"], "{1}");
  it("an activated ability with an unsupported cost is not performed: no tap, no stack item, the player keeps priority, one event", () => {
    const t = setup([costly]);
    const id = t.give("p1", "Odd Engine", "battlefield");
    const life = t.p("p1").life;
    const res = t.ok({ type: "activateAbility", player: "p1", sourceId: id, abilityId: "a1" });
    const u = unres(res.events);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ card: "Odd Engine", effect: "not_performed", capability: "cost:unsupported", clause: "{T}, Discard a card at random: gain 4 life." });
    expect(res.events.filter((e) => e.type !== "unresolved")).toHaveLength(0);
    expect(t.obj(id).tapped).toBe(false);
    expect(t.state.stack).toHaveLength(0);
    expect(t.state.priority).toBe("p1");
    expect(t.p("p1").life).toBe(life);
  });
  it("strict mode refuses the same activation with error code unsupported", () => {
    const t = setup([costly], { mode: "error" });
    const id = t.give("p1", "Odd Engine", "battlefield");
    expect(t.do({ type: "activateAbility", player: "p1", sourceId: id, abilityId: "a1" }).error?.code).toBe("unsupported");
  });
  it("an unsupported cost kind (not just the 'unsupported' marker) also means not performed", () => {
    const c = perm("Odd Cost Kind", [{ kind: "activated", text: "Pay a moonbeam: gain 1 life.", costs: [{ moonbeam: 1 }], steps: [{ kind: "life_change", lifeDelta: 1, who: "you" }] }], ["artifact"], "{1}");
    const t = setup([c]);
    const id = t.give("p1", "Odd Cost Kind", "battlefield");
    const res = t.ok({ type: "activateAbility", player: "p1", sourceId: id, abilityId: "a1" });
    expect(unres(res.events)[0]).toMatchObject({ effect: "not_performed", capability: "cost:moonbeam" });
    expect(t.state.stack).toHaveLength(0);
  });
  it("a supported activated ability whose STEP is unsupported is performed (cost paid, on the stack); the step is skipped when it resolves", () => {
    const c = perm("Odd Pinger", [{ kind: "activated", text: "{T}: Goad everything and gain 2 life.", costs: [{ tap: "self" }], steps: [{ kind: "goad_everything", target: "self" }, { kind: "life_change", lifeDelta: 2, who: "you" }] }], ["artifact"], "{1}");
    const t = setup([c]);
    const id = t.give("p1", "Odd Pinger", "battlefield");
    const life = t.p("p1").life;
    const res = t.ok({ type: "activateAbility", player: "p1", sourceId: id, abilityId: "a1" });
    expect(unres(res.events)).toHaveLength(0);
    expect(t.obj(id).tapped).toBe(true);
    expect(t.state.stack).toHaveLength(1);
    const evs = t.resolveTop().events;
    expect(unres(evs).map((e) => e.capability)).toEqual(["step:goad_everything"]);
    expect(t.p("p1").life).toBe(life + 2);
  });
  it("a mana ability the engine cannot run is not performed, and automatic payment never uses it", () => {
    const rock = perm("Odd Rock", [{ kind: "mana", text: "{T}: Add X mana of any one color.", costs: [{ tap: "self" }], mana: { produces: [{ anyColorAmount: 2 }] } }], ["artifact"], "{1}");
    const spellC = spell("Needs Blue", [{ kind: "life_change", lifeDelta: 1, who: "you" }], {}, "{U}");
    const t = table(["p1", "p2"], { extra: { "Odd Rock": rock, "Needs Blue": spellC }, config: CONT });
    const id = t.give("p1", "Odd Rock", "battlefield");
    const res = t.ok({ type: "activateAbility", player: "p1", sourceId: id, abilityId: "a1" });
    expect(unres(res.events)[0]).toMatchObject({ effect: "not_performed" });
    expect(t.obj(id).tapped).toBe(false);
    const sp = t.give("p1", "Needs Blue", "hand");
    const cast1 = t.do({ type: "castSpell", player: "p1", cardId: sp });
    expect(cast1.error?.code).not.toBe("unsupported");
    expect(t.obj(id).tapped).toBe(false);
  });
  it("an unsupported cast option is not offered (never free); casting the normal way works and the option is reported", () => {
    const c = mk("Overload Spell", ["instant"], [{ kind: "spell_effect", steps: [{ kind: "life_change", lifeDelta: 2, who: "you" }] }], { manaCost: "{U}", castOptions: [{ id: "c1", kind: "overload", from: "hand", cost: [{ mana: "{3}{U}" }], replacesManaCost: true, optional: true }] });
    const t = setup([c]);
    const id = t.give("p1", "Overload Spell", "hand");
    const life = t.p("p1").life;
    const res = t.ok({ type: "castSpell", player: "p1", cardId: id });
    expect(res.pending).toBeUndefined();
    expect(unres(res.events)).toHaveLength(1);
    expect(unres(res.events)[0]).toMatchObject({ capability: "cast_option:overload", effect: "not_performed" });
    t.resolveTop();
    expect(t.p("p1").life).toBe(life + 2);
  });
  it("an unsupported optional extra cost (kicker with an unsupported cost) is not offered; the spell is cast without it", () => {
    const c = mk("Kicker Odd", ["instant"], [{ kind: "spell_effect", steps: [{ kind: "life_change", lifeDelta: 2, who: "you" }] }], { manaCost: "{U}", castOptions: [{ id: "c1", kind: "kicker", from: "hand", cost: [{ unsupported: "sacrifice a moon" }], replacesManaCost: false, optional: true }] });
    const t = setup([c]);
    const id = t.give("p1", "Kicker Odd", "hand");
    const res = t.ok({ type: "castSpell", player: "p1", cardId: id });
    expect(res.pending).toBeUndefined();
    expect(unres(res.events)[0]).toMatchObject({ effect: "not_performed" });
    expect(t.state.stack).toHaveLength(1);
  });
  it("a cost that throws only while being paid (unparsable mana symbol) leaves the state untouched and is reported as not performed", () => {
    const c = perm("Bad Symbol", [{ kind: "activated", text: "{Q}: gain 1 life.", costs: [{ mana: "{Q}" }], steps: [{ kind: "life_change", lifeDelta: 1, who: "you" }] }], ["artifact"], "{1}");
    const t = setup([c]);
    const id = t.give("p1", "Bad Symbol", "battlefield");
    const before = JSON.stringify(t.state);
    const res = t.ok({ type: "activateAbility", player: "p1", sourceId: id, abilityId: "a1" });
    expect(unres(res.events)).toHaveLength(1);
    expect(unres(res.events)[0]).toMatchObject({ effect: "not_performed" });
    expect(JSON.stringify(t.state)).toBe(before);
  });
});

describe("continue mode: determinism, silence and redaction", () => {
  const odd = spell("Odd Spell", [{ kind: "life_change", lifeDelta: 2, who: "you" }, { kind: "goad_everything", target: "self" }]);
  const run = () => {
    const t = setup([odd, perm("Odd Static", [oddStatic])]);
    const a = castAndResolve(t, "Odd Spell");
    const b = castAndResolve(t, "Odd Static");
    return { events: [...a.events, ...b.events], state: t.state };
  };
  it("the same state + actions + seed give identical events and states", () => {
    const x = run(), y = run();
    expect(JSON.stringify(x.events)).toBe(JSON.stringify(y.events));
    expect(JSON.stringify(x.state)).toBe(JSON.stringify(y.state));
  });
  it("replaying one action from the same input state gives the same events", () => {
    const t = setup([odd]);
    const id = t.give("p1", "Odd Spell", "hand");
    const s0 = structuredClone(t.state);
    const r1 = t.ok({ type: "castSpell", player: "p1", cardId: id });
    t.state = s0;
    const r2 = t.ok({ type: "castSpell", player: "p1", cardId: id });
    expect(JSON.stringify(r1.events)).toBe(JSON.stringify(r2.events));
  });
  it("fully supported cards produce no unresolved event at all (continue mode)", () => {
    const t = table(["p1", "p2"], { config: CONT });
    t.lands("p1", "Mountain", 3);
    const sol = t.give("p1", "Sol Ring", "hand");
    const evs: GameEvent[] = [];
    evs.push(...t.ok({ type: "castSpell", player: "p1", cardId: sol }).events);
    evs.push(...t.resolveTop().events);
    evs.push(...t.ok({ type: "advancePhase", player: "p1" }).events);
    expect(unres(evs)).toHaveLength(0);
  });
  it("the unresolved event of a hidden-zone card is redacted for the other player, public for its owner", () => {
    const c = perm("Secret Cycler", [{ kind: "activated", text: "Cycling {Z}", zone: "hand", costs: [{ unsupported: "secret" }], steps: [] }], ["creature"]);
    const t = setup([c]);
    const id = t.give("p1", "Secret Cycler", "hand");
    const res = t.ok({ type: "activateAbility", player: "p1", sourceId: id, abilityId: "a1" });
    expect(unres(res.events)).toHaveLength(1);
    const mine = unres(eventsFor(t.state, "p1", res.events))[0];
    expect(mine.card).toBe("Secret Cycler");
    const theirs = unres(eventsFor(t.state, "p2", res.events))[0];
    expect(theirs).toBeDefined();
    expect(JSON.stringify(theirs)).not.toContain("Secret Cycler");
    expect(JSON.stringify(theirs)).not.toContain("secret");
    expect(theirs.hidden).toBe(true);
  });
  it("the event of a public card (battlefield / stack) is visible to everyone", () => {
    const t = setup([odd]);
    const { events } = castAndResolve(t, "Odd Spell");
    const theirs = unres(eventsFor(t.state, "p2", events));
    expect(theirs).toHaveLength(1);
    expect(theirs[0].card).toBe("Odd Spell");
    expect(theirs[0].hidden).toBeUndefined();
  });
  it("viewFor never exposes the report bookkeeping", () => {
    const t = setup([perm("Odd Static", [oddStatic])]);
    castAndResolve(t, "Odd Static");
    expect(t.state.unresolvedSeen).toBeDefined();
    expect(viewFor(t.state, "p2")).not.toHaveProperty("unresolvedSeen");
  });
  it("cast() helper sanity: the spell goes on the stack with its cast event", () => {
    const t = setup([odd]);
    const { res } = cast(t, "Odd Spell");
    expect(res.events.some((e) => e.type === "cast")).toBe(true);
  });
});
