// Kernel step 6: optional replacement effects ("you may ...") through the replay protocol, and the optional "pay life or enters tapped" modify.
import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { fam, mk, sorcery } from "./famkit";
import { CARDS } from "./testcards";
import { realTable } from "./testdb";
import { eventsFor, viewFor } from "./view";
import type { Table } from "./testkit";

const shield = mk("Opt Shield", { manaCost: "{1}", types: ["enchantment"] }, [{ id: "a1", kind: "replacement", text: "You may have this enter tapped.", replacement: { event: "would_enter", optional: true, result: { mode: "modify", set: { tapped: true } } } }]);
const reader = mk("Careful Reader", { manaCost: "{1}", types: ["enchantment"] }, [{ id: "a1", kind: "replacement", text: "If you would draw a card, you may gain 2 life instead.", replacement: { event: "would_draw", optional: true, result: { mode: "instead", steps: [{ kind: "life_change", lifeDelta: 2, who: "you" }] } } }]);
const world = (): Table => fam({ "Opt Shield": shield, "Careful Reader": reader });

describe("optional replacement effects", () => {
  it("are supported", () => { expect(cardUnsupported(shield).all).toEqual([]); expect(cardUnsupported(reader).all).toEqual([]); });

  it("yes applies the replacement, no skips it (the permanent enters untapped)", () => {
    for (const yes of [true, false]) {
      const t = world(); t.give("p1", "Plains", "battlefield");
      const c = t.give("p1", "Opt Shield", "hand");
      t.ok({ type: "castSpell", player: "p1", cardId: c });
      const res = t.resolveTop();
      expect(res.pending).toMatchObject({ kind: "choose_yes_no", player: "p1" });
      t.answer(res, { yes });
      expect(t.obj(c).zone).toBe("battlefield");
      expect(t.obj(c).tapped).toBe(yes);
    }
  });

  it("only the affected player may answer; a bad answer is rejected and the question stays", () => {
    const t = world(); t.give("p1", "Plains", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Opt Shield", "hand") });
    const res = t.resolveTop();
    const wrong = t.do({ type: "answerDecision", player: "p2", decisionId: res.pending!.id, choice: { yes: true } });
    expect(wrong.error?.code).toBe("not_your_decision");
    const bad = t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["maybe"] } });
    expect(bad.error?.code).toBe("invalid_choice");
    expect(t.state.pending?.id).toBe(res.pending!.id);
    const wrongId = t.do({ type: "answerDecision", player: "p1", decisionId: "nope", choice: { yes: true } });
    expect(wrongId.error).toBeDefined();
  });

  it("replay is deterministic: the same answers always give the same state, events are not duplicated", () => {
    const run = () => {
      const t = world(); t.give("p1", "Plains", "battlefield");
      const c = t.give("p1", "Opt Shield", "hand");
      t.ok({ type: "castSpell", player: "p1", cardId: c });
      const res = t.resolveTop();
      const done = t.answer(res, { yes: true });
      return { state: JSON.stringify(t.state), ev: done.events.filter((e) => e.type === "replacement_applied").length };
    };
    const a = run(), b = run();
    expect(a.state).toBe(b.state);
    expect(a.ev).toBe(1);
  });

  it("an optional would_draw 'instead' effect: yes gains life and draws nothing, no draws the card", () => {
    for (const yes of [true, false]) {
      const t = fam({ "Opt Shield": shield, "Careful Reader": reader, "Draw One": sorcery("Draw One", "{U}", [{ kind: "draw_cards", amount: 1, who: "you" }]) });
      t.give("p1", "Careful Reader", "battlefield"); t.give("p1", "Fill A", "library"); t.give("p1", "Island", "battlefield");
      t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Draw One", "hand") });
      const res = t.resolveTop();
      expect(res.pending).toMatchObject({ kind: "choose_yes_no", player: "p1" });
      t.answer(res, { yes });
      expect(t.p("p1").life).toBe(yes ? 42 : 40);
      expect(t.p("p1").hand.length).toBe(yes ? 0 : 1);
      expect(t.state.pending).toBeNull();
    }
  });

  it("the pending question is visible to its owner and not leaked to others as a choice about hidden info", () => {
    const t = world(); t.give("p1", "Plains", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Opt Shield", "hand") });
    t.resolveTop();
    const v = viewFor(t.state, "p2");
    expect(JSON.stringify(v)).not.toContain('"replay"');
    expect(eventsFor(t.state, "p2", []).length).toBe(0);
  });
});

describe("Garden of Freyalise (optional pay 3 life, else tapped): real draft", () => {
  const NAME = "Disciple of Freyalise // Garden of Freyalise";
  const setup = (life?: number) => {
    const t = realTable();
    if (life !== undefined) t.p("p1").life = life;
    const id = t.give("p1", NAME, "hand");
    return { t, id };
  };
  it("pay life: untapped and 3 life lost; decline: tapped and no life lost", () => {
    for (const pay of [true, false]) {
      const { t, id } = setup();
      let res = t.ok({ type: "playLand", player: "p1", cardId: id, face: "Garden of Freyalise" } as never);
      if (!res.pending) res = t.resolveTop();
      expect(res.pending).toMatchObject({ kind: "choose_yes_no", player: "p1" });
      t.answer(res, { yes: pay });
      expect(t.obj(id).zone).toBe("battlefield");
      expect(t.obj(id).tapped).toBe(!pay);
      expect(t.p("p1").life).toBe(pay ? 37 : 40);
    }
  });
  it("a player who cannot afford the life is not asked", () => {
    const { t, id } = setup(2);
    const res = t.ok({ type: "playLand", player: "p1", cardId: id, face: "Garden of Freyalise" } as never);
    expect(res.pending).toBeUndefined();
    expect(t.obj(id).tapped).toBe(true);
    expect(t.p("p1").life).toBe(2);
  });
});
void CARDS;

describe("conditional target slots (Tear Asunder: the second slot exists only when kicked)", () => {
  const setup = () => { const t = realTable(); t.lands("p1", "Forest", 2); t.lands("p1", "Swamp", 2); return { t, spell: t.give("p1", "Tear Asunder", "hand"), ring: t.give("p2", "Sol Ring", "battlefield"), cub: t.give("p2", "Llanowar Elves", "battlefield") }; };
  it("explicit targets for the inactive slot are discarded, never asked", () => {
    const { t, spell, ring, cub } = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: spell, extras: ["c1"], targets: { t1: [ring], t2: [cub] } } as never);
    expect(t.state.stack[0].parts[0].targets).toEqual({ t1: [], t2: [cub] });
  });
  it("not kicked, nothing legal for t1: the cast is refused (the kicked slot does not rescue it)", () => {
    const t = realTable(); t.lands("p1", "Forest", 2);
    const spell = t.give("p1", "Tear Asunder", "hand"); t.give("p2", "Llanowar Elves", "battlefield");
    const res = t.do({ type: "castSpell", player: "p1", cardId: spell, extras: [] } as never);
    expect(res.error?.code ?? res.pending?.kind).toBeTruthy();
    expect(t.state.stack.length === 0 || t.state.pending !== null).toBe(true);
  });
  it("the schema accepts onlyIf and the engine reports its predicate support", () => {
    expect(cardUnsupported(realDef("Tear Asunder")!).all).toEqual([]);
  });
});
import { realDef } from "./testdb";

describe("Snarl lands (reveal a card from hand or enter tapped)", () => {
  const play = (hand: string[]) => {
    const t = realTable();
    for (const n of hand) t.give("p1", n, "hand");
    const land = t.give("p1", "Shineshadow Snarl", "hand");
    const res = t.do({ type: "playLand", player: "p1", cardId: land });
    return { t, land, res };
  };
  it("is supported (all three Snarls)", () => { for (const n of ["Shineshadow Snarl", "Necroblossom Snarl", "Frostboil Snarl"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); });
  it("with a matching card in hand you are asked; yes reveals it publicly (untapped), no enters tapped", () => {
    for (const yes of [true, false]) {
      const { t, land, res } = play(["Plains"]);
      expect(res.pending).toMatchObject({ kind: "choose_yes_no", player: "p1" });
      const done = t.answer(res, { yes });
      expect(t.obj(land).tapped).toBe(!yes);
      const revealed = done.events.filter((e) => e.type === "reveal");
      expect(revealed.length).toBe(yes ? 1 : 0);
    }
  });
  it("with no Plains or Swamp in hand nobody is asked: enters tapped", () => {
    const { t, land, res } = play(["Mountain", "Forest"]);
    expect(res.pending).toBeUndefined();
    expect(t.obj(land).tapped).toBe(true);
  });
  it("with two matching cards the player also chooses which to reveal", () => {
    const { t, res } = play(["Plains", "Swamp"]);
    let r2 = t.answer(res, { yes: true });
    expect(r2.pending).toMatchObject({ kind: "choose_cards", min: 1, max: 1 });
    expect(r2.pending!.options).toHaveLength(2);
    r2 = t.answer(r2, { ids: [r2.pending!.options[0].id] });
    expect(r2.events.some((e) => e.type === "reveal")).toBe(true);
  });
});

describe("hidden information still holds around the new decisions", () => {
  it("an optional-replacement question is shown to its owner only; the replay base state never reaches a view", async () => {
    const { viewResult } = await import("./view");
    const t = world(); t.give("p1", "Plains", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Opt Shield", "hand") });
    const res = t.resolveTop();
    expect((viewResult(res, "p1").pending as { options: unknown[] }).options).toHaveLength(2);
    expect((viewResult(res, "p2").pending as { hidden?: boolean }).hidden).toBe(true);
    expect(JSON.stringify(viewResult(res, "p2").state)).not.toContain("replay");
  });
  it("an opponent's hand stays a count while a reveal-from-hand question is open (Snarl)", async () => {
    const { viewFor } = await import("./view");
    const t = realTable();
    const p2card = t.give("p2", "Plains", "hand");
    t.give("p1", "Plains", "hand");
    const land = t.give("p1", "Shineshadow Snarl", "hand");
    const res = t.ok({ type: "playLand", player: "p1", cardId: land });
    expect(res.pending?.player).toBe("p1");
    const v = viewFor(t.state, "p1");
    expect(JSON.stringify(v)).not.toContain(`"${p2card}","cardName"`);
    expect(v.players.find((p) => p.id === "p2")!.hand).toEqual([]);
    expect(JSON.stringify(v.objects[p2card] ?? {})).not.toContain("Plains");
  });
  it("the proliferate choice for a hidden-zone-free state is visible only to the chooser", async () => {
    const { viewResult } = await import("./view");
    const t = fam({ Prolif: sorcery("Prolif", "{1}", [{ kind: "proliferate" } as never]) }); t.give("p1", "Plains", "battlefield");
    t.give("p1", "Fill A", "battlefield", { counters: { charge: 1 } });
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Prolif", "hand") });
    const res = t.resolveTop();
    expect((viewResult(res, "p2").pending as { hidden?: boolean }).hidden).toBe(true);
  });
});
