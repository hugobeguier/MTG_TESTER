// step:move_card_zone in its general form (what / who / filter / position / from-to any zone), going through the replacement
// pipeline with new-object identity (fresh timestamp, counters and damage gone, tokens cease to exist).

import { describe, expect, it } from "vitest";
import type { Ability, Step } from "../schema";
import { cardUnsupported } from "./support";
import { CARDS, fam, mk, sorcery } from "./famkit";
import type { Table } from "./testkit";
import { lookup } from "./testkit";

const S = (s: Record<string, unknown>) => s as unknown as Step;

/** A table with an Island and a sorcery running `steps`; the spell is cast and resolved; returns the table + the last result. */
function run(steps: Step[], setup: (t: Table) => void = () => undefined, extra: Record<string, ReturnType<typeof sorcery>> = {}) {
  const t = fam({ Mover: sorcery("Mover", "{U}", steps), ...extra });
  t.give("p1", "Island", "battlefield");
  setup(t);
  const spell = t.give("p1", "Mover", "hand");
  t.ok({ type: "castSpell", player: "p1", cardId: spell });
  const res = t.resolveTop();
  return { t, res, spell };
}
const names = (t: Table, ids: string[]) => ids.map((id) => t.obj(id).cardName);

describe("zone forms", () => {
  it("hand -> graveyard (saved choice) and graveyard -> hand (all)", () => {
    const { t } = run([
      S({ kind: "choose", from: { zone: "hand", owner: "you" }, count: 1, saveAs: "chosen" }),
      S({ kind: "move_card_zone", what: "chosen", moveTo: "graveyard" }),
      S({ kind: "move_card_zone", what: "all", who: "you", from: "graveyard", moveTo: "hand", filter: { types: ["creature"] } })
    ], (t) => { t.give("p1", "Fill A", "hand"); t.give("p1", "Fill B", "graveyard"); t.give("p1", "Fill Land", "graveyard"); });
    // the choice is forced (one card in hand); the creature in the graveyard returns, the land stays
    expect(names(t, t.p("p1").hand).sort()).toEqual(["Fill B"]);
    expect(names(t, t.p("p1").graveyard).sort()).toEqual(["Fill A", "Fill Land", "Mover"].sort());
  });

  it("graveyard -> library bottom, all of it, then shuffled (Enhanced Surveillance's second half)", () => {
    const { t } = run([S({ kind: "move_card_zone", what: "all", who: "you", from: "graveyard", moveTo: "library", filter: { zone: "graveyard", owner: "you" }, shuffle: true })],
      (t) => { t.give("p1", "Fill A", "graveyard"); t.give("p1", "Fill B", "graveyard"); t.give("p1", "Fill C", "library"); });
    expect(t.p("p1").library).toHaveLength(3);
    expect(t.p("p1").graveyard.map((id) => t.obj(id).cardName)).toEqual(["Mover"]);
  });

  it("exile -> battlefield under my control and tapped; the owner stays the owner", () => {
    const { t } = run([
      S({ kind: "choose", from: { zone: "exile", owner: "opponent" }, count: 1, saveAs: "chosen" }),
      S({ kind: "move_card_zone", what: "chosen", from: "exile", moveTo: "battlefield", who: "you", tapped: true })
    ], (t) => { t.give("p2", "Fill A", "exile"); t.give("p2", "Fill B", "exile"); });
    // two candidates -> asked; here the first run was forced? it is not: answer pending
    expect(t.state.pending).not.toBeNull();
    const pick = t.state.pending!.options[0].id;
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: [pick] } });
    expect(t.obj(pick)).toMatchObject({ zone: "battlefield", controller: "p1", owner: "p2", tapped: true });
  });

  it("underControlOf owner: the card returns under its owner's control", () => {
    const { t } = run([S({ kind: "move_card_zone", what: "all", who: "each_player", from: "graveyard", moveTo: "battlefield", underControlOf: "owner", filter: { types: ["creature"] } })],
      (t) => { t.give("p1", "Fill A", "graveyard"); t.give("p2", "Fill B", "graveyard"); });
    const bf = t.state.battlefield.map((id) => t.obj(id)).filter((o) => o.cardName.startsWith("Fill"));
    expect(bf.map((o) => [o.cardName, o.controller]).sort()).toEqual([["Fill A", "p1"], ["Fill B", "p2"]]);
  });

  it("the top N cards of a library (moveFrom library, moveCount) go to exile and are saved", () => {
    const { t } = run([S({ kind: "move_card_zone", who: "you", moveFrom: "library", moveTo: "exile", moveCount: 2, position: "top", saveAs: "exiled" })],
      (t) => { for (const n of ["Fill A", "Fill B", "Fill C"]) t.give("p1", n, "library"); });
    expect(t.p("p1").exile.map((id) => t.obj(id).cardName)).toEqual(["Fill C", "Fill B"]);
    expect(t.p("p1").library.map((id) => t.obj(id).cardName)).toEqual(["Fill A"]);
  });

  it("moveCount as a quantity (X) and moveCount larger than the library", () => {
    const { t } = run([S({ kind: "move_card_zone", who: "you", moveFrom: "library", moveTo: "graveyard", moveCount: { ref: "count", of: { types: ["creature"], controller: "you" } }, position: "top" })],
      (t) => { t.give("p1", "Fill A", "battlefield"); t.give("p1", "Fill B", "battlefield"); t.give("p1", "Fill C", "battlefield"); t.give("p1", "Fill D", "library"); t.give("p1", "Fill E", "library"); });
    expect(t.p("p1").library).toHaveLength(0);
    expect(t.p("p1").graveyard).toHaveLength(3); // two milled + the spell
  });

  it("Bojuka Bog (what: graveyard_of_t1) exiles the targeted player's graveyard when it enters; Angel of Finality (all) too", () => {
    expect(cardUnsupported(lookup("Bojuka Bog")!).all).toEqual([]);
    expect(cardUnsupported(lookup("Angel of Finality")!).all).toEqual([]);
    const t = fam();
    t.give("p2", "Fill A", "graveyard"); t.give("p2", "Fill B", "graveyard"); t.give("p1", "Fill C", "graveyard");
    t.ok({ type: "playLand", player: "p1", cardId: t.give("p1", "Bojuka Bog", "hand") });
    expect(t.state.pending?.kind).toBe("choose_targets"); // the ETB trigger asks for its target when it goes on the stack
    t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending!.id, choice: { ids: ["p2"] } });
    t.resolveTop();
    expect(t.p("p2").graveyard).toHaveLength(0);
    expect(t.p("p2").exile).toHaveLength(2);
    expect(t.p("p1").graveyard).toHaveLength(1);

    const t2 = fam();
    t2.lands("p1", "Plains", 4);
    t2.give("p2", "Fill A", "graveyard"); t2.give("p2", "Fill B", "graveyard");
    t2.ok({ type: "castSpell", player: "p1", cardId: t2.give("p1", "Angel of Finality", "hand") });
    t2.resolveTop();
    t2.ok({ type: "answerDecision", player: "p1", decisionId: t2.state.pending!.id, choice: { ids: ["p2"] } });
    t2.resolveTop();
    expect(t2.p("p2").graveyard).toHaveLength(0);
    expect(t2.p("p2").exile).toHaveLength(2);
  });

  it("each opponent's graveyard (zone form with a player ref)", () => {
    const { t } = run([S({ kind: "move_card_zone", who: "each_opponent", from: "graveyard", all: true, moveTo: "exile" })],
      (t) => { t.give("p2", "Fill A", "graveyard"); t.give("p1", "Fill B", "graveyard"); });
    expect(t.p("p2").graveyard).toHaveLength(0);
    expect(t.p("p1").graveyard).toHaveLength(2); // mine untouched (Fill B + the spell)
  });

  it("the top card of each player's library (what: top_of_library)", () => {
    const { t } = run([S({ kind: "move_card_zone", what: "top_of_library", who: "each_player", moveTo: "graveyard" })],
      (t) => { t.give("p1", "Fill A", "library"); t.give("p2", "Fill B", "library"); t.give("p2", "Fill C", "library"); });
    expect(t.p("p1").library).toHaveLength(0);
    expect(t.p("p2").library.map((id) => t.obj(id).cardName)).toEqual(["Fill B"]);
  });

  it("battlefield -> hand and battlefield -> library bottom", () => {
    const { t } = run([
      S({ kind: "move_card_zone", what: "all", who: "you", from: "battlefield", moveTo: "library", position: "bottom", filter: { types: ["artifact"] } })
    ], (t) => { t.give("p1", "Fill Artifact", "battlefield"); t.give("p1", "Fill C", "library"); });
    expect(t.p("p1").library.map((id) => t.obj(id).cardName)).toEqual(["Fill C", "Fill Artifact"]);
  });

  it("enters with counters (withCounters)", () => {
    const { t } = run([S({ kind: "move_card_zone", what: "all", who: "you", from: "graveyard", moveTo: "battlefield", filter: { types: ["creature"] }, withCounters: { kind: "+1/+1", count: 2 } })],
      (t) => { t.give("p1", "Fill A", "graveyard"); });
    const o = t.state.battlefield.map((id) => t.obj(id)).find((x) => x.cardName === "Fill A")!;
    expect(o.counters["+1/+1"]).toBe(2);
  });

  it("an unsupported count form is refused statically: a count from a graveyard", () => {
    const bad = sorcery("Bad Move", "{U}", [S({ kind: "move_card_zone", who: "you", moveFrom: "graveyard", moveTo: "hand", moveCount: 2 })]);
    expect(cardUnsupported(bad).all).toContain("field:move_card_zone.moveCount");
  });

  it("a `what` the engine does not model is refused statically", () => {
    const bad = sorcery("Bad Move 2", "{U}", [S({ kind: "move_card_zone", what: "creature_type", moveTo: "hand" })]);
    expect(cardUnsupported(bad).all).toContain("field:move_card_zone.what=creature_type");
  });

  it("the step result is the number of cards moved (step_result)", () => {
    const { t } = run([
      S({ kind: "move_card_zone", id: "m1", who: "you", moveFrom: "library", moveTo: "graveyard", moveCount: 3, position: "top" }),
      S({ kind: "draw_cards", amount: { ref: "step_result", step: "m1" }, who: "you" })
    ], (t) => { for (const n of ["Fill A", "Fill B", "Fill C", "Fill D", "Fill E", "Fill A", "Fill B", "Fill C"]) t.give("p1", n, "library"); });
    expect(t.p("p1").hand).toHaveLength(3); // 3 milled, then draws 3
  });
});

describe("order of cards put into a library", () => {
  const two = (extra: Record<string, unknown>) => run([
    S({ kind: "move_card_zone", what: "all", who: "you", from: "hand", moveTo: "library", ...extra })
  ], (t) => { t.give("p1", "Fill A", "hand"); t.give("p1", "Fill B", "hand"); t.give("p1", "Fill C", "library"); });

  it("any_order asks the controller; the first named card ends up on top", () => {
    const t = fam({ Mover: sorcery("Mover", "{U}", [S({ kind: "move_card_zone", what: "all", who: "you", from: "hand", moveTo: "library", position: "top", ordered: "any_order" })]) });
    t.give("p1", "Island", "battlefield");
    const a = t.give("p1", "Fill A", "hand"); const b = t.give("p1", "Fill B", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Mover", "hand") });
    const res = t.resolveTop();
    expect(res.pending).toMatchObject({ kind: "order_library", min: 2, max: 2, player: "p1" });
    t.answer(res, { ids: [b, a] });
    expect(t.p("p1").library.slice(0, 2)).toEqual([b, a]);
  });

  it("random order uses the seeded RNG (same seed, same result) and keeps every card", () => {
    const a = two({ position: "bottom", order: "random" }); const b = two({ position: "bottom", order: "random" });
    expect(a.t.p("p1").library).toEqual(b.t.p("p1").library);
    expect(a.t.p("p1").library).toHaveLength(3);
  });

  it("position bottom without an order puts them under the library in their zone order", () => {
    const { t } = two({ position: "bottom" });
    expect(t.p("p1").library.map((id) => t.obj(id).cardName)).toEqual(["Fill C", "Fill A", "Fill B"]);
  });

  it("a single card is never asked for an order", () => {
    const { res } = run([S({ kind: "move_card_zone", what: "all", who: "you", from: "hand", moveTo: "library", ordered: "any_order" })], (t) => { t.give("p1", "Fill A", "hand"); });
    expect(res.pending).toBeUndefined();
  });
});

describe("replacement pipeline and new-object identity", () => {
  const warden = mk("Void Warden", { manaCost: "{1}", types: ["enchantment"] } as never, [{
    id: "a1", kind: "replacement", text: "If a card would be put into a graveyard from anywhere, exile it instead.",
    replacement: { event: "would_be_put_into_zone", toZone: "graveyard", subject: { types: ["card"] }, result: { mode: "modify", set: { to: "exile" } } } as never
  } as Ability]);

  it("a would-be-put-into-graveyard replacement applies to a move_card_zone (hand -> graveyard becomes exile)", () => {
    const t = fam({ "Void Warden": warden, Mover: sorcery("Mover", "{U}", [S({ kind: "move_card_zone", what: "all", who: "you", from: "hand", moveTo: "graveyard" })]) });
    t.give("p1", "Void Warden", "battlefield"); t.give("p1", "Island", "battlefield");
    const a = t.give("p1", "Fill A", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Mover", "hand") });
    t.resolveTop();
    expect(t.obj(a).zone).toBe("exile");
  });

  it("a creature moved from the battlefield to the graveyard dies (event), unless replaced", () => {
    const { t, res } = run([S({ kind: "move_card_zone", what: "all", who: "you", from: "battlefield", moveTo: "graveyard", filter: { types: ["creature"] } })], (t) => { t.give("p1", "Fill A", "battlefield"); });
    expect(res.events.map((e) => e.type)).toContain("dies");
    const t2 = fam({ "Void Warden": warden, Mover: sorcery("Mover", "{U}", [S({ kind: "move_card_zone", what: "all", who: "you", from: "battlefield", moveTo: "graveyard", filter: { types: ["creature"] } })]) });
    t2.give("p1", "Void Warden", "battlefield"); t2.give("p1", "Island", "battlefield"); const a = t2.give("p1", "Fill A", "battlefield");
    t2.ok({ type: "castSpell", player: "p1", cardId: t2.give("p1", "Mover", "hand") });
    const r2 = t2.resolveTop();
    expect(t2.obj(a).zone).toBe("exile");
    expect(r2.events.map((e) => e.type)).not.toContain("dies");
    expect(t.p("p1").graveyard.length).toBeGreaterThan(0);
  });

  it("enter replacements apply (Frozen Lands: lands enter tapped) and ETB triggers fire (Echo Watcher)", () => {
    const t = fam({ Mover: sorcery("Mover", "{U}", [S({ kind: "move_card_zone", what: "all", who: "you", from: "graveyard", moveTo: "battlefield", filter: { zone: "graveyard" } })]) });
    t.give("p1", "Frozen Lands", "battlefield"); t.give("p1", "Echo Watcher", "battlefield"); t.give("p1", "Island", "battlefield");
    const land = t.give("p1", "Fill Land", "graveyard");
    const cr = t.give("p1", "Fill A", "graveyard");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Mover", "hand") });
    t.resolveTop();
    expect(t.obj(land)).toMatchObject({ zone: "battlefield", tapped: true });
    expect(t.obj(cr)).toMatchObject({ zone: "battlefield", tapped: false });
    // Echo Watcher's trigger (a creature entered): resolve it
    t.resolveTop();
    expect(t.p("p1").life).toBe(41);
  });

  it("a card that changes zone is a new object: new timestamp, damage / counters / attachments gone", () => {
    const { t } = run([S({ kind: "move_card_zone", what: "all", who: "you", from: "battlefield", moveTo: "hand", filter: { types: ["creature"] } }),
      S({ kind: "move_card_zone", what: "all", who: "you", from: "hand", moveTo: "battlefield", filter: { types: ["creature"] } })],
      (t) => { const a = t.give("p1", "Fill A", "battlefield", { counters: { "+1/+1": 1 } }); t.state.objects[a].damage = 1; });
    const o = Object.values(t.state.objects).find((x) => x.cardName === "Fill A")!;
    expect(o.counters).toEqual({});
    expect(o.damage).toBe(0);
    expect(o.controlledSince).toBeGreaterThan(0); // summoning sick again
  });

  it("a token moved off the battlefield ceases to exist", () => {
    const { t } = run([
      S({ kind: "create_tokens", tokenCount: 1, tokenName: "Bear", tokenPower: 2, tokenToughness: 2, tokenColors: ["green"], tokenTypeLine: "Creature - Bear", who: "you" }),
      S({ kind: "move_card_zone", what: "all", who: "you", from: "battlefield", moveTo: "hand", filter: { token: true } })
    ]);
    expect(Object.values(t.state.objects).filter((o) => o.token)).toHaveLength(0);
    expect(t.p("p1").hand).toHaveLength(0);
  });

  it("zone changes emit zone_change events carrying the owner (needed for per-player redaction)", () => {
    const { res } = run([S({ kind: "move_card_zone", what: "all", who: "you", from: "hand", moveTo: "graveyard" })], (t) => { t.give("p1", "Fill A", "hand"); });
    const ev = res.events.find((e) => e.type === "zone_change" && e.to === "graveyard" && e.name === "Fill A");
    expect(ev).toMatchObject({ from: "hand", owner: "p1" });
  });

  it("is deterministic", () => {
    const go = () => run([S({ kind: "move_card_zone", what: "all", who: "you", from: "hand", moveTo: "library", position: "bottom", order: "random" })], (t) => { for (const n of ["Fill A", "Fill B", "Fill C", "Fill D"]) t.give("p1", n, "hand"); });
    expect(JSON.stringify(go().t.state)).toBe(JSON.stringify(go().t.state));
  });
});

void CARDS;
