import { describe, expect, it } from "vitest";
import type { Ability } from "../schema";
import { chars } from "./core";
import { CARDS } from "./testcards";
import { lookup, table, type Table } from "./testkit";
import type { CardDef, ObjId } from "./types";

const bear: CardDef = { name: "Test Bear", manaCost: "{1}{G}", types: ["creature"], subtypes: ["Bear"], power: 2, toughness: 2, kernel: { schemaVersion: 2, abilities: [] } };
const elf: CardDef = { name: "Test Elf", manaCost: "{1}{G}", types: ["creature"], subtypes: ["Elf"], power: 1, toughness: 1, kernel: { schemaVersion: 2, abilities: [] } };
const gain = (n: number) => [{ kind: "life_change" as const, lifeDelta: n, who: "you" as const }];
const fa = (face: string, a: Ability): Ability => ({ ...a, face });
const mdfc: CardDef = {
  name: "Spell Side", manaCost: "{1}{R}", types: ["sorcery"], layout: "modal_dfc",
  faces: { "Land Side": { types: ["land"], subtypes: [] } },
  kernel: { schemaVersion: 2, abilities: [
    fa("Spell Side", { id: "a1", kind: "spell_effect", text: "You gain 3 life.", steps: gain(3) }),
    fa("Land Side", { id: "a2", kind: "mana", text: "{T}: Add {R}.", costs: [{ tap: "self" }], mana: { produces: [{ colors: "{R}" }] } })
  ] }
};
const split: CardDef = {
  name: "Fire", manaCost: "{1}{R}", types: ["instant"], layout: "split",
  faces: { Ice: { manaCost: "{1}{U}", types: ["sorcery"] } },
  kernel: { schemaVersion: 2, abilities: [
    fa("Fire", { id: "a1", kind: "spell_effect", text: "Fire: you gain 2 life.", steps: gain(2) }),
    fa("Ice", { id: "a2", kind: "spell_effect", text: "Ice: you gain 5 life.", steps: gain(5) })
  ] }
};
const world = (): Table => table(["p1", "p2"], { extra: { ...CARDS, "Test Bear": bear, "Test Elf": elf, "Spell Side": mdfc, Fire: split } });
const defs = (n: string) => ({ "Test Bear": bear, "Test Elf": elf, "Spell Side": mdfc, Fire: split } as Record<string, CardDef>)[n] ?? lookup(n) ?? CARDS[n];
const chr = (t: Table, id: ObjId) => chars({ s: structuredClone(t.state), events: [], defs, scanned: 0 } as never, id);
const tapped = (t: Table) => t.state.battlefield.filter((id) => t.obj(id).tapped).length;
const finish = (t: Table, n = 8) => { for (let i = 0; i < n && (t.state.stack.length || t.state.pending); i++) { if (t.state.pending) t.ok({ type: "answerDecision", player: t.state.pending.player, decisionId: t.state.pending.id, choice: { ids: [] } }); else t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true }); } };

describe("modal double-faced cards: choose the face on cast", () => {
  it("a spell front with a land back has only one castable face: no question, it costs its mana and gains 3", () => {
    const t = world(); t.lands("p1", "Mountain", 2); const c = t.give("p1", "Spell Side", "hand");
    const res = t.ok({ type: "castSpell", player: "p1", cardId: c });
    expect(res.pending).toBeUndefined();
    expect(tapped(t)).toBe(2); t.pass("p1", "p2"); expect(t.p("p1").life).toBe(43);
  });
  it("the face can be preset in the action", () => {
    const t = world(); t.lands("p1", "Mountain", 2); const c = t.give("p1", "Spell Side", "hand");
    const res = t.ok({ type: "castSpell", player: "p1", cardId: c, face: "Spell Side" });
    expect(res.pending).toBeUndefined(); expect(t.obj(c).face).toBe("Spell Side");
  });
  it("an unknown face is rejected and nothing moves", () => {
    const t = world(); const c = t.give("p1", "Spell Side", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: c, face: "Nope" }).error?.code).toBe("invalid_choice");
    expect(t.obj(c).zone).toBe("hand");
  });
  it("the land face cannot be cast (lands are played)", () => {
    const t = world(); t.lands("p1", "Mountain", 2); const c = t.give("p1", "Spell Side", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: c, face: "Land Side" }).error?.code).toBe("invalid_choice");
  });
  it("playLand with the land face: it enters as a land with the back face's mana ability only", () => {
    const t = world(); const c = t.give("p1", "Spell Side", "hand");
    t.ok({ type: "playLand", player: "p1", cardId: c, face: "Land Side" });
    expect(t.obj(c).zone).toBe("battlefield"); expect(chr(t, c).types).toEqual(["land"]);
    expect(chr(t, c).abilities.map((a) => a.id)).toEqual(["a2"]);
    t.ok({ type: "activateAbility", player: "p1", sourceId: c, abilityId: "a2" });
    expect(t.p("p1").manaPool.R).toBe(1);
  });
  it("playLand without a face plays the front face: a sorcery is not a land", () => {
    const t = world(); const c = t.give("p1", "Spell Side", "hand");
    expect(t.do({ type: "playLand", player: "p1", cardId: c }).error?.code).toBe("not_castable");
  });
  it("in hand and in the graveyard the card shows its front face", () => {
    const t = world(); const c = t.give("p1", "Spell Side", "hand");
    t.ok({ type: "playLand", player: "p1", cardId: c, face: "Land Side" });
    expect(chr(t, c).name).toBe("Land Side");
    const s = structuredClone(t.state); s.battlefield = []; s.objects[c].zone = "graveyard"; s.objects[c].face = undefined; t.state = s;
    expect(chr(t, c).types).toEqual(["sorcery"]);
  });
  it("only the owner chooses; a wrong player's answer is refused", () => {
    const t = world(); t.lands("p1", "Mountain", 2); const c = t.give("p1", "Fire", "hand");
    const res = t.ok({ type: "castSpell", player: "p1", cardId: c });
    expect(res.pending!.options.map((o) => o.id)).toEqual(["Fire", "Ice"]);
    expect(t.do({ type: "answerDecision", player: "p2", decisionId: res.pending!.id, choice: { ids: ["Fire"] } }).error?.code).toBe("not_your_decision");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["Zzz"] } }).error?.code).toBe("invalid_choice");
  });
  it("cancelling the face question returns the card", () => {
    const t = world(); const c = t.give("p1", "Fire", "hand");
    const res = t.ok({ type: "castSpell", player: "p1", cardId: c });
    t.ok({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { cancel: true } });
    expect(t.obj(c).zone).toBe("hand");
  });
});

describe("split cards: each face has its own cost, type (timing) and effect", () => {
  it("Fire is an instant for {1}{R}: castable on the opponent's turn; Ice is a sorcery for {1}{U}", () => {
    const t = world(); t.lands("p1", "Mountain", 2); t.lands("p1", "Island", 2);
    const c = t.give("p1", "Fire", "hand");
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p1" };
    expect(t.do({ type: "castSpell", player: "p1", cardId: c, face: "Ice" }).error?.code).toBe("wrong_timing");
    const res = t.ok({ type: "castSpell", player: "p1", cardId: c, face: "Fire" });
    expect(res.pending).toBeUndefined(); t.pass("p1", "p2"); expect(t.p("p1").life).toBe(42);
  });
  it("Ice at sorcery speed costs {1}{U} and gains 5", () => {
    const t = world(); t.lands("p1", "Island", 2); const c = t.give("p1", "Fire", "hand");
    let res = t.ok({ type: "castSpell", player: "p1", cardId: c });
    res = t.answer(res, { ids: ["Ice"] });
    expect(tapped(t)).toBe(2); t.pass("p1", "p2"); expect(t.p("p1").life).toBe(45);
  });
  it("choosing a face whose timing is wrong is refused and the question stays open", () => {
    const t = world(); t.lands("p1", "Island", 2); const c = t.give("p1", "Fire", "hand");
    t.state = { ...t.state, turn: { ...t.state.turn, active: "p2" }, priority: "p1" };
    const res = t.ok({ type: "castSpell", player: "p1", cardId: c });
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["Ice"] } }).error?.code).toBe("wrong_timing");
    expect(t.state.pending?.id).toBe(res.pending!.id);
  });
  it("the spell on the stack shows only the chosen face's abilities", () => {
    const t = world(); t.lands("p1", "Island", 2); const c = t.give("p1", "Fire", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: c, face: "Ice" });
    expect(chr(t, c).abilities.map((a) => a.id)).toEqual(["a2"]);
  });
});

describe("transforming double-faced cards (Westvale Abbey, Deathbonnet Sprout)", () => {
  const abbey = () => {
    const t = world(); t.lands("p1", "Plains", 5); const a = t.give("p1", "Westvale Abbey", "battlefield");
    for (let i = 0; i < 6; i++) t.give("p1", "Test Bear", "battlefield");
    return { t, a };
  };
  it("the front face is a land with its three abilities", () => {
    const { t, a } = abbey(); const c = chr(t, a);
    expect(c.types).toEqual(["land"]); expect(c.name).toBe("Westvale Abbey"); expect(c.abilities.map((x) => x.id)).toEqual(["a1", "a2", "a3"]);
  });
  it("sacrificing five creatures transforms it into a 9/7 flying lifelink indestructible haste Demon", () => {
    const { t, a } = abbey();
    const res = t.ok({ type: "activateAbility", player: "p1", sourceId: a, abilityId: "a3" });
    expect(res.pending!.kind).toBe("choose_cards") ;
  });
  it("after the transform: new characteristics, no mana ability, the SAME object (same id)", () => {
    const { t, a } = abbey();
    let res = t.ok({ type: "activateAbility", player: "p1", sourceId: a, abilityId: "a3" });
    res = t.answer(res, { ids: res.pending!.options.map((o) => o.id).slice(0, 5) });
    t.pass("p1", "p2");
    const c = chr(t, a);
    expect(t.obj(a).face).toBe("Ormendahl, Profane Prince");
    expect([c.name, c.power, c.toughness]).toEqual(["Ormendahl, Profane Prince", 9, 7]);
    expect(c.types).toEqual(["creature"]); expect(c.supertypes).toContain("legendary");
    expect(c.keywords).toEqual(expect.arrayContaining(["flying", "lifelink", "indestructible", "haste"]));
    expect(c.abilities.some((x) => x.kind === "mana")).toBe(false);
    expect(t.obj(a).tapped).toBe(false); // "then untap it"
    expect(t.state.battlefield).toContain(a);
  });
  it("a transformed card that leaves the battlefield returns with its front face", () => {
    const { t, a } = abbey();
    let res = t.ok({ type: "activateAbility", player: "p1", sourceId: a, abilityId: "a3" });
    res = t.answer(res, { ids: res.pending!.options.map((o) => o.id).slice(0, 5) }); t.pass("p1", "p2");
    t.lands("p2", "Mountain", 1); const sw = t.give("p2", "Swords to Plowshares", "hand");
    t.state = { ...t.state, priority: "p2" }; void sw;
    const s = structuredClone(t.state); s.battlefield = s.battlefield.filter((x) => x !== a); s.objects[a].zone = "graveyard"; s.objects[a].face = undefined; t.state = s;
    expect(chr(t, a).types).toEqual(["land"]);
  });
  it("Deathbonnet Sprout transforms at upkeep when three creature cards are in the graveyard", () => {
    const t = world(); const s = t.give("p1", "Deathbonnet Sprout", "battlefield");
    for (let i = 0; i < 3; i++) t.give("p1", "Test Bear", "graveyard");
    for (let i = 0; i < 4; i++) t.give("p1", "Island", "library");
    t.state = { ...t.state, turn: { number: 3, active: "p1", phase: "untap" } };
    t.ok({ type: "advancePhase", player: "p1" }); // untap -> upkeep is entered by the turn structure; make it explicit
    for (let i = 0; i < 3 && t.obj(s).face === undefined; i++) { if (t.state.stack.length) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true }); else t.ok({ type: "advancePhase", player: "p1" }); }
    expect(t.obj(s).face).toBe("Deathbonnet Hulk");
  });
  it("a card with no faces ignores transform", () => {
    const t = world(); const b = t.give("p1", "Test Bear", "battlefield");
    expect(chr(t, b).name).toBe("Test Bear");
  });
});

describe("choose: creature type, card name, player, opponent", () => {
  const incubator = () => {
    const t = world(); t.lands("p1", "Island", 6); t.lands("p1", "Forest", 4);
    const inc = t.give("p1", "Urza's Incubator", "hand");
    let res = t.ok({ type: "castSpell", player: "p1", cardId: inc }); t.pass("p1", "p2");
    return { t, inc, res };
  };
  it("Urza's Incubator asks for a creature type as it enters, and remembers it on the permanent", () => {
    const { t, inc } = incubator();
    expect(t.state.pending!.kind).toBe("choose_option");
    expect(t.state.pending!.options.map((o) => o.id)).toEqual(expect.arrayContaining(["Elf", "Human", "Dragon"]));
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: ["Elf"] } });
    expect(t.obj(inc).chosen?.type).toBe("Elf"); expect(t.obj(inc).zone).toBe("battlefield");
  });
  it("an option that is not offered is refused", () => {
    const { t } = incubator();
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: ["Zzyzx"] } }).error?.code).toBe("invalid_choice");
  });
  it("chosenType filter: creature spells of that type cost {2} less, others do not", () => {
    const { t } = incubator();
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: ["Elf"] } });
    for (const sid of t.state.battlefield) t.state.objects[sid].tapped = false;
    t.state = { ...t.state, priority: "p1" };
    const e = t.give("p1", "Test Elf", "hand"), b = t.give("p1", "Test Bear", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: e }); expect(tapped(t)).toBe(1); // {1}{G} minus {2}: only {G} is left
    t.pass("p1", "p2");
    const before = tapped(t);
    t.ok({ type: "castSpell", player: "p1", cardId: b });
    expect(tapped(t) - before).toBe(2);
  });
  it("Patchwork Banner: creatures of the chosen type get +1/+1", () => {
    const t = world(); t.lands("p1", "Island", 3);
    const bn = t.give("p1", "Patchwork Banner", "hand"); const bear1 = t.give("p1", "Test Bear", "battlefield"), elf1 = t.give("p1", "Test Elf", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: bn }); t.pass("p1", "p2");
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: ["Bear"] } });
    expect(chr(t, bear1).power).toBe(3); expect(chr(t, elf1).power).toBe(1);
  });
  it("Herald's Horn works the same way and is deterministic", () => {
    const run = () => { const t = world(); t.lands("p1", "Island", 3); const h = t.give("p1", "Herald's Horn", "hand"); t.ok({ type: "castSpell", player: "p1", cardId: h }); t.pass("p1", "p2"); t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: ["Zombie"] } }); return t.state; };
    expect(run()).toEqual(run());
  });
  it("choose player / opponent / card name / card type through a one-off card", () => {
    const pick = (choice: "player" | "opponent" | "card_name" | "card_type" | "basic_land_type", extra: Ability["steps"] = []): CardDef => ({
      name: `Pick ${choice}`, manaCost: "{U}", types: ["sorcery"],
      kernel: { schemaVersion: 2, abilities: [{ id: "a1", kind: "spell_effect", text: "choose", steps: [{ kind: "choose", choice, who: "you" }, ...(extra ?? [])] }] }
    });
    const cards: Record<string, CardDef> = Object.fromEntries((["player", "opponent", "card_name", "card_type", "basic_land_type"] as const).map((c) => [`Pick ${c}`, pick(c, c === "player" || c === "opponent" ? [{ kind: "life_change", lifeDelta: -3, who: "that_player" }] : [])]));
    for (const c of ["player", "opponent"] as const) {
      const t = table(["p1", "p2", "p3"], { extra: cards }); t.give("p1", "Island", "battlefield");
      const id = t.give("p1", `Pick ${c}`, "hand");
      t.ok({ type: "castSpell", player: "p1", cardId: id }); t.pass("p1", "p2", "p3");
      expect(t.state.pending!.options.map((o) => o.id)).toEqual(c === "player" ? ["p1", "p2", "p3"] : ["p2", "p3"]);
      t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: ["p3"] } });
      expect(t.p("p3").life).toBe(37);
    }
    for (const [c, expectOpt] of [["card_name", "Island"], ["card_type", "Creature"], ["basic_land_type", "Swamp"]] as const) {
      const t = table(["p1", "p2"], { extra: cards }); t.give("p1", "Island", "battlefield");
      const id = t.give("p1", `Pick ${c}`, "hand");
      t.ok({ type: "castSpell", player: "p1", cardId: id }); t.pass("p1", "p2");
      expect(t.state.pending!.options.map((o) => o.id)).toContain(expectOpt);
    }
  });
  it("choosing an opponent in a 2-player game is automatic", () => {
    const card: CardDef = { name: "Pick Opp", manaCost: "{U}", types: ["sorcery"], kernel: { schemaVersion: 2, abilities: [{ id: "a1", kind: "spell_effect", text: "x", steps: [{ kind: "choose", choice: "opponent", who: "you" }, { kind: "life_change", lifeDelta: -2, who: "that_player" }] }] } };
    const t = table(["p1", "p2"], { extra: { "Pick Opp": card } }); t.give("p1", "Island", "battlefield");
    const id = t.give("p1", "Pick Opp", "hand"); t.ok({ type: "castSpell", player: "p1", cardId: id }); t.pass("p1", "p2");
    expect(t.state.pending).toBeNull(); expect(t.p("p2").life).toBe(38);
  });
});

// Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun is a TRANSFORMING card: the land back is reached only by transforming on the battlefield, never played or cast.
describe("transforming card with a land back face", () => {
  const rites: CardDef = {
    name: "Rites Front", manaCost: "{2}{G}", types: ["enchantment"], layout: "transform",
    faces: { "Cradle Back": { types: ["land"], subtypes: [] } },
    kernel: { schemaVersion: 2, abilities: [fa("Rites Front", { id: "a1", kind: "spell_effect", text: "gain 1", steps: gain(1) }), fa("Cradle Back", { id: "a2", kind: "mana", text: "{T}: Add {G}.", costs: [{ tap: "self" }], mana: { produces: [{ colors: "{G}" }] } })] }
  };
  const w = () => table(["p1", "p2"], { extra: { ...CARDS, "Rites Front": rites } });
  it("playLand with the land back is refused, and the front enchantment is not a land", () => {
    const t = w(); const c = t.give("p1", "Rites Front", "hand");
    expect(t.do({ type: "playLand", player: "p1", cardId: c, face: "Cradle Back" }).error?.code).toBe("invalid_choice");
    expect(t.do({ type: "playLand", player: "p1", cardId: c }).error?.code).toBe("not_castable");
    expect(t.obj(c).zone).toBe("hand");
  });
  it("casting with the land back is refused", () => {
    const t = w(); t.lands("p1", "Forest", 3); const c = t.give("p1", "Rites Front", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: c, face: "Cradle Back" }).error).toBeDefined();
  });
});
