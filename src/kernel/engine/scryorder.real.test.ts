// Ordered placement with real drafted cards (aminatou deck): Otherworldly Gaze (surveil), Halimar Depths, Lim-Dûl's Vault, Aminatou, Veil Piercer (surveil trigger),
// the observer's default policy, and the card view a player gets for the options.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "../integration/testgame";
import { legalActions } from "./legal";
import { cardUnsupported } from "./support";
import { defaultAnswer } from "../observer/actions";
import { pendingFor } from "./view";
import { toTableState } from "../integration/tableState";
import { packKit } from "../integration/cardPack";
import { buildPack } from "../integration/nodePack";

const kit = packKit([buildPack("aminatou", { catalog: false })]);
const env = { ctx, display: kit.display };
const supported = (name: string) => { const d = ctx.cards(name); return !!d?.kernel?.abilities.length && cardUnsupported(d).all.length === 0; };

function library(t: ReturnType<typeof mini>, names: string[]) { return names.map((n) => t.give("p1", n, "library", { top: true })).reverse(); } // first name ends on top

describe("real drafts", () => {
  it("Otherworldly Gaze: surveil 3 puts one in the graveyard and orders the other two", () => {
    const t = mini();
    t.give("p1", "Island", "battlefield"); t.give("p1", "Island", "battlefield"); t.give("p1", "Island", "battlefield");
    t.give("p1", "Swamp", "library");
    const [f, m, p] = library(t, ["Forest", "Mountain", "Plains"]);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Otherworldly Gaze", "hand") });
    t.settle();
    const pend = t.state.pending!;
    expect(pend.kind).toBe("order_library");
    expect(pend.placement).toEqual({ to: "graveyard", stack: "top" });
    t.answer({ place: { toGraveyard: [m], top: [p, f] } });
    expect(t.state.players[0].library.slice(0, 2)).toEqual([p, f]);
    expect(t.state.objects[m].zone).toBe("graveyard");
  });

  it("Halimar Depths: ETB look at three, then put them back in the order chosen", () => {
    expect(supported("Halimar Depths")).toBe(true);
    const t = mini();
    t.give("p1", "Swamp", "library");
    const [a, b, c] = library(t, ["Forest", "Mountain", "Plains"]);
    t.ok({ type: "playLand", player: "p1", cardId: t.give("p1", "Halimar Depths", "hand") });
    t.settle();
    expect(t.state.pending).toMatchObject({ kind: "order_library", min: 3, max: 3, placement: { to: "none", stack: "top" } });
    t.answer({ place: { top: [c, a, b] } });
    expect(t.state.players[0].library.slice(0, 3)).toEqual([c, a, b]);
  });

  it("Lim-Dûl's Vault: asks the order of the five cards put back (declined repeats)", () => {
    expect(supported("Lim-Dûl's Vault")).toBe(true); // (a wrong card name here once made this test a silent no-op)
    const t = mini();
    t.give("p1", "Island", "battlefield"); t.give("p1", "Swamp", "battlefield");
    t.give("p1", "Plains", "library");
    library(t, ["Forest", "Mountain", "Plains", "Island", "Swamp"]);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Lim-Dûl's Vault", "hand") });
    t.settle();
    for (let i = 0; i < 6 && t.state.pending && t.state.pending.kind !== "order_library"; i++) t.answer(t.state.pending.kind === "choose_yes_no" ? { yes: false } : { ids: [] });
    expect(t.state.pending?.kind).toBe("order_library");
    const ids = t.state.pending!.options.map((o) => o.id);
    t.answer({ place: { top: [...ids].reverse() } });
    expect(t.state.players[0].library.slice(0, 5)).toEqual([...ids].reverse());
  });

  it("the observer default policy keeps every card on top in the current order (surveil: nothing binned; put-back: unchanged order)", () => {
    const t = mini();
    t.give("p1", "Swamp", "library");
    const [a, b, c] = library(t, ["Forest", "Mountain", "Plains"]);
    t.give("p1", "Island", "battlefield"); t.give("p1", "Island", "battlefield"); t.give("p1", "Island", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Otherworldly Gaze", "hand") });
    t.settle();
    const ans = defaultAnswer(t.state.pending!, t.state, "p1")!;
    t.answer(ans);
    expect(t.state.players[0].library.slice(0, 3)).toEqual([a, b, c]);
    expect(t.state.players[0].graveyard.filter((id) => t.state.objects[id].cardName !== "Otherworldly Gaze")).toEqual([]);
  });

  it("legalActions lists the decision with a keep-all-in-order choice; the opponent has none and cannot see the options", () => {
    const t = mini();
    t.give("p1", "Island", "battlefield"); t.give("p1", "Island", "battlefield"); t.give("p1", "Island", "battlefield");
    t.give("p1", "Swamp", "library");
    library(t, ["Forest", "Mountain", "Plains"]);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Otherworldly Gaze", "hand") });
    t.settle();
    const a = legalActions(t.state, "p1", ctx).find((x) => x.kind === "answerDecision")!;
    expect(a.pending?.kind).toBe("order_library");
    expect(a.choices?.some((c) => c.place?.top?.length === 3)).toBe(true);
    expect(legalActions(t.state, "p2", ctx).some((x) => x.kind === "answerDecision")).toBe(false);
    expect(pendingFor(t.state.pending, "p2")).toMatchObject({ hidden: true, options: [], optionCount: 3 });
    const mine = toTableState(t.state, "p1", env).decision!;
    expect(mine.kind).toBe("order_library");
    expect(mine.placement).toEqual({ to: "graveyard", stack: "top" });
    expect(mine.options.every((o) => o.card?.zone === "library")).toBe(true);
    const theirs = toTableState(t.state, "p2", env);
    expect(theirs.decision).toBeUndefined();
    expect(JSON.stringify(theirs)).not.toContain("Mountain");
  });
});
