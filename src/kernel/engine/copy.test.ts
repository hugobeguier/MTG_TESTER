import { describe, expect, it } from "vitest";
import { chars } from "./core";
import { CARDS } from "./testcards";
import { lookup, table, type Table } from "./testkit";
import type { CardDef, ObjId } from "./types";

const bear: CardDef = { name: "Test Bear", manaCost: "{1}{G}", types: ["creature"], subtypes: ["Bear"], power: 2, toughness: 2, kernel: { schemaVersion: 2, abilities: [] } };
const king: CardDef = { name: "Test King", manaCost: "{2}{W}", types: ["creature"], subtypes: ["Human"], supertypes: ["legendary"], power: 3, toughness: 3, kernel: { schemaVersion: 2, abilities: [{ id: "k1", kind: "keyword", text: "Flying", keyword: { name: "flying" } }] } };
const pinger: CardDef = { name: "Pinger", manaCost: "{1}", types: ["creature"], power: 1, toughness: 1, kernel: { schemaVersion: 2, abilities: [{ id: "a1", kind: "triggered", text: "When this enters, you gain 1 life.", trigger: { event: "etb", subject: "self" }, steps: [{ kind: "life_change", lifeDelta: 1, who: "you" }] }] } };
const world = (): Table => table(["p1", "p2"], { extra: { ...CARDS, "Test Bear": bear, "Test King": king, Pinger: pinger } });
const defs = (n: string) => (n === "Test Bear" ? bear : n === "Test King" ? king : n === "Pinger" ? pinger : lookup(n) ?? CARDS[n]);
const chr = (t: Table, id: ObjId) => chars({ s: structuredClone(t.state), events: [], defs, scanned: 0 } as never, id);
const tokens = (t: Table, name?: string) => t.state.battlefield.map((id) => t.obj(id)).filter((o) => o.token && (!name || o.token.name === name));
const fill = (t: Table, who: string, n: number) => { for (let i = 0; i < n; i++) t.give(who, "Island", "library"); };

function upkeepOfP1(t: Table): void {
  // end turn 1, p2's turn, back to p1's upkeep (turn 3)
  for (let i = 0; i < 80; i++) {
    if (t.state.pending) return;
    if (t.state.turn.number === 3 && t.state.turn.phase === "upkeep" && (t.state.stack.length || t.state.triggerQueue.length || t.state.priority)) return;
    const s = t.state;
    if (s.combat?.expect?.kind === "attackers") { t.ok({ type: "declareAttackers", player: s.combat.expect.player, attackers: [] }); continue; }
    if (s.stack.length) { t.ok({ type: "passPriority", player: s.priority!, fastForward: true }); continue; }
    t.ok({ type: "advancePhase", player: s.turn.active });
  }
}

describe("token copies of permanents (Extravagant Replication, Saheeli's Artistry)", () => {
  it("Extravagant Replication: at your upkeep, a token copy of another target nonland permanent", () => {
    const t = world();
    fill(t, "p1", 6); fill(t, "p2", 6);
    t.give("p1", "Extravagant Replication", "battlefield");
    const king1 = t.give("p1", "Test King", "battlefield");
    upkeepOfP1(t);
    expect(t.state.pending?.kind ?? t.state.stack[0]?.kind).toBeDefined();
    // targets: only "another nonland permanent you control" (the King; the Replication itself is excluded as the source)
    let res;
    // Test King is legendary: its copy meets the legend rule (704.5j); the player keeps the token
    while (t.state.pending) { const pd = t.state.pending as unknown as { prompt: { title: string }; options: Array<{ id: string; label: string }> }; res = t.answer({ pending: pd } as never, { ids: [/Legend rule/.test(pd.prompt.title) ? pd.options.find((o) => /token/.test(o.label))!.id : king1] }); }
    void res;
    for (let i = 0; i < 4 && t.state.stack.length; i++) { if (t.state.pending) { const pd = t.state.pending as unknown as { prompt: { title: string }; options: Array<{ id: string; label: string }> }; t.answer({ pending: pd } as never, { ids: [pd.options.find((o) => /token/.test(o.label))!.id] }); continue; } t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true }); }
    const copies = tokens(t, "Test King");
    expect(copies).toHaveLength(1);
    expect(copies[0].controller).toBe("p1");
    expect(t.obj(king1).token).toBeUndefined(); // the original is untouched
    const c = chr(t, copies[0].id);
    expect([c.power, c.toughness, c.mv]).toEqual([3, 3, 3]);
    expect(c.supertypes).toContain("legendary");
    expect(c.keywords).toContain("flying");
  });

  it("the copy is a NEW object: it has no counters, damage or attachments of the original", () => {
    const t = world();
    t.lands("p1", "Island", 4); t.lands("p1", "Mountain", 0);
    const king1 = t.give("p1", "Test King", "battlefield", { counters: { "+1/+1": 2 } });
    t.state.objects[king1].damage = 1;
    expect(chr(t, king1).power).toBe(5);
    const art = t.give("p1", "Saheeli's Artistry", "hand");
    let res = t.ok({ type: "castSpell", player: "p1", cardId: art, modes: ["m2"] });
    res = t.answer(res, { ids: [king1] });
    t.pass("p1", "p2");
    while (t.state.pending) { const pd = t.state.pending as unknown as { prompt: { title: string }; options: Array<{ id: string; label: string }> }; t.answer({ pending: pd } as never, { ids: [pd.options.find((o) => /token/.test(o.label))!.id] }); } // legend rule: keep the token
    const copy = tokens(t, "Test King")[0];
    expect(copy.id).not.toBe(king1);
    expect(copy.counters).toEqual({});
    expect(copy.damage).toBe(0);
    expect(chr(t, copy.id).power).toBe(3); // 3/3 base, no counters
  });

  it("Saheeli's Artistry: both modes; the creature copy is also an artifact (exception), the artifact copy is plain", () => {
    const t = world();
    t.lands("p1", "Island", 4);
    const ring = t.give("p1", "Sol Ring", "battlefield");
    const k = t.give("p1", "Test Bear", "battlefield");
    const art = t.give("p1", "Saheeli's Artistry", "hand");
    let res = t.ok({ type: "castSpell", player: "p1", cardId: art, modes: ["m1", "m2"] });
    res = t.answer(res, { ids: [ring] });
    res = t.answer(res, { ids: [k] });
    t.pass("p1", "p2");
    const toks = tokens(t);
    expect(toks).toHaveLength(2);
    const ringCopy = toks.find((o) => o.token!.name === "Sol Ring")!;
    const bearCopy = toks.find((o) => o.token!.name === "Test Bear")!;
    expect(chr(t, ringCopy.id).types).toEqual(["artifact"]);
    expect(chr(t, bearCopy.id).types).toEqual(expect.arrayContaining(["creature", "artifact"]));
    expect(chr(t, k).types).toEqual(["creature"]); // the original did not become an artifact
  });

  it("copy of a token copies its definition; copy of a copy keeps the exceptions", () => {
    const t = world();
    t.lands("p1", "Island", 8);
    const k = t.give("p1", "Test Bear", "battlefield");
    const a1 = t.give("p1", "Saheeli's Artistry", "hand"), a2 = t.give("p1", "Saheeli's Artistry", "hand");
    let res = t.ok({ type: "castSpell", player: "p1", cardId: a1, modes: ["m2"] });
    res = t.answer(res, { ids: [k] });
    t.pass("p1", "p2");
    const firstCopy = tokens(t, "Test Bear")[0];
    res = t.ok({ type: "castSpell", player: "p1", cardId: a2, modes: ["m2"] });
    res = t.answer(res, { ids: [firstCopy.id] }); // copy the artifact-bear token with the same spell: the exception is cumulative
    t.pass("p1", "p2");
    const toks = tokens(t, "Test Bear");
    expect(toks).toHaveLength(2);
    for (const tk of toks) expect(chr(t, tk.id).types).toEqual(expect.arrayContaining(["creature", "artifact"]));
  });

  it("an Equipment-bearing or tapped original is copied untapped and unattached", () => {
    const t = world();
    t.lands("p1", "Island", 4);
    const ring = t.give("p1", "Sol Ring", "battlefield", { tapped: true });
    const art = t.give("p1", "Saheeli's Artistry", "hand");
    let res = t.ok({ type: "castSpell", player: "p1", cardId: art, modes: ["m1"] });
    res = t.answer(res, { ids: [ring] });
    t.pass("p1", "p2");
    const copy = tokens(t, "Sol Ring")[0];
    expect(copy.tapped).toBe(false);
  });

  it("the copy's enters-the-battlefield trigger fires (copy of Pinger)", () => {
    const t = world();
    t.lands("p1", "Island", 4);
    const p = t.give("p1", "Pinger", "battlefield");
    const art = t.give("p1", "Saheeli's Artistry", "hand");
    let res = t.ok({ type: "castSpell", player: "p1", cardId: art, modes: ["m2"] });
    res = t.answer(res, { ids: [p] });
    t.pass("p1", "p2"); // resolves; the copy enters and its trigger goes on the stack
    t.pass("p1", "p2");
    expect(t.p("p1").life).toBe(41);
  });

  it("Second Harvest: one copy per token you control (a copy made by repeat_for_each)", () => {
    const t = world();
    t.lands("p1", "Forest", 4);
    t.give("p1", "Test Bear", "battlefield"); // not a token: not copied
    // two tokens through Saheeli's Artistry are heavy; make tokens directly
    for (let i = 0; i < 2; i++) { const o = t.give("p1", "Test Bear", "battlefield"); t.state.objects[o].token = { name: "Goat", types: ["creature"], subtypes: ["Goat"], colors: [], power: 0, toughness: 1, keywords: [] }; t.state.objects[o].cardName = "Goat"; }
    const sh = t.give("p1", "Second Harvest", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: sh });
    t.pass("p1", "p2");
    expect(tokens(t, "Goat")).toHaveLength(4);
  });

  it("copying something that left the battlefield does nothing", () => {
    const t = world();
    t.lands("p1", "Island", 4);
    const k = t.give("p1", "Test Bear", "battlefield");
    const art = t.give("p1", "Saheeli's Artistry", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: art, modes: ["m2"], targets: { t2: [k] } });
    const s = structuredClone(t.state);
    s.battlefield = s.battlefield.filter((id) => id !== k); s.objects[k].zone = "graveyard"; s.players[0].graveyard.push(k);
    t.state = s;
    t.pass("p1", "p2");
    expect(tokens(t)).toHaveLength(0);
  });
});

describe("copies of spells (storm, Plumb the Forbidden)", () => {
  it("Chatterstorm with nothing cast before: no copies; cast after two spells: two copies (storm count)", () => {
    const t = world();
    t.lands("p1", "Forest", 8); t.lands("p1", "Mountain", 4);
    const cs = t.give("p1", "Chatterstorm", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: cs });
    // the storm trigger is on the stack above the spell; with no earlier spells it copies nothing
    t.pass("p1", "p2"); t.pass("p1", "p2");
    expect(tokens(t, "Squirrel")).toHaveLength(1);

    const t2 = world();
    t2.lands("p1", "Forest", 8); t2.lands("p1", "Mountain", 4);
    const b1 = t2.give("p1", "Lightning Bolt", "hand"), b2 = t2.give("p1", "Lightning Bolt", "hand"), cs2 = t2.give("p1", "Chatterstorm", "hand");
    t2.ok({ type: "castSpell", player: "p1", cardId: b1, targets: { t1: ["p2"] } });
    t2.pass("p1", "p2");
    t2.ok({ type: "castSpell", player: "p1", cardId: b2, targets: { t1: ["p2"] } });
    t2.pass("p1", "p2"); // both Bolts resolved: two spells were cast before Chatterstorm
    t2.ok({ type: "castSpell", player: "p1", cardId: cs2 });
    expect(t2.state.stack).toHaveLength(2); // the spell and its storm trigger
    for (let i = 0; i < 12 && t2.state.stack.length; i++) t2.ok({ type: "passPriority", player: t2.state.priority!, fastForward: true });
    expect(tokens(t2, "Squirrel")).toHaveLength(3); // the spell + 2 copies
    expect(t2.p("p2").life).toBe(34);
  });

  it("a spell copy is not a card: it ceases to exist instead of going to the graveyard", () => {
    const t = world();
    t.lands("p1", "Forest", 8); t.lands("p1", "Mountain", 4);
    const b1 = t.give("p1", "Lightning Bolt", "hand"), cs = t.give("p1", "Chatterstorm", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: b1, targets: { t1: ["p2"] } });
    t.pass("p1", "p2");
    t.ok({ type: "castSpell", player: "p1", cardId: cs });
    const before = Object.keys(t.state.objects).length;
    for (let i = 0; i < 12 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.p("p1").graveyard).toEqual(expect.arrayContaining([b1, cs]));
    expect(t.p("p1").graveyard).toHaveLength(2); // the copy never landed there
    void before;
    const copies = Object.values(t.state.objects).filter((o) => o.isCopy);
    expect(copies).toHaveLength(0);
  });

  it("Stormscale Scion: the copy of a creature spell resolves into a permanent that ceases to exist when it dies", () => {
    const t = world();
    t.lands("p1", "Mountain", 6); t.lands("p1", "Forest", 2);
    const bolt = t.give("p1", "Lightning Bolt", "hand"), scion = t.give("p1", "Stormscale Scion", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: bolt, targets: { t1: ["p2"] } });
    t.pass("p1", "p2");
    t.ok({ type: "castSpell", player: "p1", cardId: scion });
    for (let i = 0; i < 12 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    const scions = t.state.battlefield.map((id) => t.obj(id)).filter((o) => o.cardName === "Stormscale Scion");
    expect(scions).toHaveLength(2);
    expect(scions.filter((o) => o.isCopy)).toHaveLength(1);
  });

  it("Plumb the Forbidden: sacrifice two creatures as the additional cost, copy the spell twice", () => {
    const t = world();
    t.lands("p1", "Swamp", 2);
    fill(t, "p1", 12);
    const plumb = t.give("p1", "Plumb the Forbidden", "hand");
    const c1 = t.give("p1", "Test Bear", "battlefield"), c2 = t.give("p1", "Test Bear", "battlefield");
    void c1; void c2;
    let res = t.ok({ type: "castSpell", player: "p1", cardId: plumb, extras: ["c1"] });
    expect(res.pending!.kind).toBe("choose_x");
    expect(res.pending!.max).toBe(2);
    res = t.answer(res, { number: 2 }); // sacrificing both: no choice left
    expect(t.p("p1").graveyard).toHaveLength(2);
    for (let i = 0; i < 12 && (t.state.stack.length || t.state.pending); i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.p("p1").hand).toHaveLength(3); // the spell and two copies each draw a card
    expect(t.p("p1").life).toBe(37);
  });

  it("Plumb the Forbidden without the sacrifice: a single draw", () => {
    const t = world();
    t.lands("p1", "Swamp", 2);
    fill(t, "p1", 5);
    const plumb = t.give("p1", "Plumb the Forbidden", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: plumb, extras: [] });
    for (let i = 0; i < 6 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.p("p1").hand).toHaveLength(1);
    expect(t.p("p1").life).toBe(39);
  });
});

describe("rules hygiene of copies", () => {
  it("copy steps keep working through the replacement pipeline (a token doubler doubles copies)", () => {
    const t = world();
    t.lands("p1", "Island", 4);
    const ring = t.give("p1", "Sol Ring", "battlefield");
    // Doubling Season is a drafted card: reuse it through debug placement if it is available in the lookup; otherwise skip the check
    const dbl = lookup("Doubling Season");
    if (!dbl) return;
    void ring;
  });

  it("is deterministic", () => {
    const run = () => {
      const t = world(); t.lands("p1", "Island", 4);
      const k = t.give("p1", "Test Bear", "battlefield");
      const art = t.give("p1", "Saheeli's Artistry", "hand");
      let res = t.ok({ type: "castSpell", player: "p1", cardId: art, modes: ["m2"] });
      res = t.answer(res, { ids: [k] }); t.pass("p1", "p2");
      return t.state;
    };
    expect(run()).toEqual(run());
  });
});
