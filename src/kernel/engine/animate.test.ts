// Every drafted "becomes a creature / becomes an artifact" effect does what its oracle text says (types in layer 4, base P/T in 7b, keywords in 6, duration).
import { describe, expect, it } from "vitest";
import { legalActions } from "./legal";
import { chars } from "./core";
import { ctx, mini } from "@/kernel/integration/testgame";
import type { Action } from "./types";

const charsOf = (s: unknown, id: string) => chars({ s: structuredClone(s), events: [], defs: ctx.cards, scanned: 0 } as never, id);
type T = ReturnType<typeof mini>;
function use(t: T, src: string, match: RegExp, answers: string[][] = []) {
  const la = legalActions(t.state, "p1", ctx).find((a) => a.kind === "activateAbility" && a.objectId === src && match.test(a.label));
  if (!la) throw new Error(`no ability matching ${match} on ${src}: ${legalActions(t.state, "p1", ctx).filter((a) => a.objectId === src).map((a) => a.label).join(" | ")}`);
  t.ok({ ...(la.action as Action), autoPay: true } as never);
  for (const ids of answers) if (t.state.pending) t.answer({ ids } as never);
  while (t.state.pending) t.answer({ ids: t.state.pending.options.slice(0, t.state.pending.min).map((o) => o.id) } as never);
  t.settle();
}
const endTurn = (t: T) => { const s = structuredClone(t.state); t.state = s; for (let i = 0; i < 14 && t.state.turn.phase !== "cleanup" && t.state.turn.number === s.turn.number; i++) t.ok({ type: "advancePhase", player: t.state.turn.active } as never); };

describe("animate effects of the drafts", () => {
  it("Hissing Quagmire: until end of turn a 2/2 black and green Elemental creature with deathtouch, still a land", () => {
    const t = mini(["p1", "p2"]); const l = t.give("p1", "Hissing Quagmire", "battlefield");
    for (const n of ["Swamp", "Forest", "Swamp"]) t.give("p1", n, "battlefield");
    use(t, l, /becomes a 2\/2/);
    const c = charsOf(t.state, l);
    expect(c.types).toEqual(expect.arrayContaining(["land", "creature"])); expect([c.power, c.toughness]).toEqual([2, 2]);
    expect(c.keywords).toContain("deathtouch"); expect(c.subtypes).toContain("Elemental"); expect(c.colors.sort()).toEqual(["black", "green"]);
    for (let i = 0; i < 16 && charsOf(t.state, l).types.includes("creature"); i++) t.ok({ type: "advancePhase", player: t.state.turn.active } as never);
    expect(charsOf(t.state, l).types).not.toContain("creature"); // reverted at the cleanup step
  });
  it("Memnarch: target permanent becomes an artifact in addition to its other types, with no end", () => {
    const t = mini(["p1", "p2"]); const m = t.give("p1", "Memnarch", "battlefield"); const e = t.give("p2", "Sigil of the Empty Throne", "battlefield");
    for (const n of ["Island", "Island", "Island"]) t.give("p1", n, "battlefield");
    use(t, m, /target permanent becomes an artifact/i, [[e]]);
    expect(charsOf(t.state, e).types).toEqual(expect.arrayContaining(["enchantment", "artifact"]));
    endTurn(t);
    expect(charsOf(t.state, e).types).toContain("artifact");
  });
  it("Sarkhan the Masterless +1: each planeswalker you control becomes a 4/4 red Dragon creature with flying until end of turn", () => {
    const t = mini(["p1", "p2"]); const s = t.give("p1", "Sarkhan the Masterless", "battlefield"); const o = t.give("p1", "Aminatou, the Fateshifter", "battlefield"); const theirs = t.give("p2", "Aminatou, the Fateshifter", "battlefield"); for (const id of [o, theirs]) t.state.objects[id].counters = { loyalty: 5 };
    use(t, s, /\+1/);
    for (const id of [s, o]) { const c = charsOf(t.state, id); expect(c.types).toEqual(expect.arrayContaining(["planeswalker", "creature"])); expect([c.power, c.toughness]).toEqual([4, 4]); expect(c.keywords).toContain("flying"); expect(c.subtypes).toContain("Dragon"); expect(c.colors).toEqual(["red"]); }
    expect(charsOf(t.state, theirs).types).not.toContain("creature");
  });
  it("Starfield of Nyx: with five enchantments every other non-Aura enchantment is a creature with base P/T = mana value", () => {
    const t = mini(["p1", "p2"]); const sf = t.give("p1", "Starfield of Nyx", "battlefield"); const sig = [1, 2, 3, 4].map(() => t.give("p1", "Sigil of the Empty Throne", "battlefield"));
    const theirs = t.give("p2", "Sigil of the Empty Throne", "battlefield");
    for (const id of sig) { const c = charsOf(t.state, id); expect(c.types).toContain("creature"); expect([c.power, c.toughness]).toEqual([5, 5]); }
    expect(charsOf(t.state, sf).types).not.toContain("creature"); expect(charsOf(t.state, theirs).types).not.toContain("creature");
    t.state = { ...t.state, battlefield: t.state.battlefield.filter((i) => i !== sig[0]) } as never; // only four enchantments left
    expect(charsOf(t.state, sig[1]).types).not.toContain("creature");
  });
  for (const vehicle of ["Cultivator's Caravan", "Skysovereign, Consul Flagship"]) it(`${vehicle}: crew 3 (tap creatures of total power 3) makes it an artifact creature until end of turn`, () => {
    const t = mini(["p1", "p2"]); const v = t.give("p1", vehicle, "battlefield"); const crew = [1, 2, 3].map(() => t.give("p1", "Ledger Shredder", "battlefield")); t.give("p2", "Island", "library");
    expect(charsOf(t.state, v).types).not.toContain("creature");
    use(t, v, /crew/i, [crew]);
    expect(charsOf(t.state, v).types).toEqual(expect.arrayContaining(["artifact", "creature"]));
    for (let i = 0; i < 16 && charsOf(t.state, v).types.includes("creature") && !t.state.pending; i++) t.ok({ type: "advancePhase", player: t.state.turn.active } as never);
    expect(charsOf(t.state, v).types).not.toContain("creature");
  });
  it("Shifting Woodland: delirium (four card types in your graveyard) gates it; it becomes a copy of the target graveyard permanent card until end of turn", () => {
    const t = mini(["p1", "p2"]); const w = t.give("p1", "Shifting Woodland", "battlefield"); for (let i = 0; i < 4; i++) t.give("p1", "Forest", "battlefield"); t.give("p2", "Island", "library");
    for (const n of ["Ledger Shredder", "Counterspell", "Plains"]) t.give("p1", n, "graveyard");
    const listed = () => legalActions(t.state, "p1", ctx).some((a) => a.kind === "activateAbility" && a.objectId === w && /copy of target/.test(a.label));
    expect(listed()).toBe(false); // creature, instant, land: three types
    const sol = t.give("p1", "Sol Ring", "graveyard");
    expect(listed()).toBe(true);
    use(t, w, /copy of target/, [[sol]]);
    expect(charsOf(t.state, w).name).toBe("Sol Ring");
    for (let i = 0; i < 16 && charsOf(t.state, w).name === "Sol Ring" && !t.state.pending; i++) t.ok({ type: "advancePhase", player: t.state.turn.active } as never);
    expect(charsOf(t.state, w).name).toBe("Shifting Woodland");
  });
});

describe("stat predicates the drafts use", () => {
  const lands = (t: T) => { for (const n of ["Plains", "Island", "Swamp", "Mountain", "Forest", "Plains", "Island", "Swamp"]) t.give("p1", n, "battlefield"); };
  for (const cast of [true, false]) it(`Tiamat ${cast ? "cast" : "put onto the battlefield"}: the search for Dragons happens only when it was cast`, () => {
    const t = mini(["p1", "p2"]); lands(t); t.give("p1", "The Ur-Dragon", "library"); t.give("p1", "Island", "library"); t.give("p2", "Island", "library");
    if (cast) { t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Tiamat", "hand"), autoPay: true } as never); t.settle(); } else { t.give("p1", "Tiamat", "battlefield"); }
    const searched = !!t.state.pending || t.state.players[0].hand.some((id) => t.state.objects[id].cardName === "The Ur-Dragon");
    expect(searched).toBe(cast);
  });
  it("Zurgo and Ojutai: hexproof while it entered this turn, not on a later turn", () => {
    const t = mini(["p1", "p2"]); lands(t); t.give("p2", "Island", "library"); t.give("p1", "Island", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Zurgo and Ojutai", "hand"), autoPay: true } as never); t.settle();
    const z = t.state.battlefield.find((id) => t.state.objects[id].cardName.startsWith("Zurgo"))!;
    expect(charsOf(t.state, z).keywords).toContain("hexproof");
    const turn = t.state.turn.number;
    for (let i = 0; i < 40 && t.state.turn.number === turn && !t.state.pending; i++) t.ok({ type: "advancePhase", player: t.state.turn.active } as never);
    expect(t.state.turn.number).toBeGreaterThan(turn);
    expect(charsOf(t.state, z).keywords ?? []).not.toContain("hexproof");
  });
});
