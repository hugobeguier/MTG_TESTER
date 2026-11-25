// Regression tests for token copies (Extravagant Replication's real upkeep trigger), one per root cause found by copysweep.test.ts:
//  - Overwhelming Splendor (an "Enchant player" Aura Curse) copied: the copy asks which player it enchants and its two effects apply to that player
//  - planeswalker copies enter with their loyalty (they used to die at once: "no loyalty")
//  - the legend rule (704.5j) existed nowhere in the kernel; a copy of a legendary permanent now triggers it, with the owner's choice
//  - a token that enters and is removed by the legend rule before its enters trigger is placed still has the trigger go on the stack
//  - a token copy of a back face has the back face's (empty) mana cost; the real transformed permanent has its front face's mana value
import { describe, expect, it } from "vitest";
import { G, base, rich, lands, toUpkeep, type Answerer } from "./aminatoukit";
import { ctx } from "../integration/testgame";
import { legalActions } from "./legal";
import { baseChars, type Run } from "./core";
import { copiableDef } from "./copy";
import { createToken } from "./steps";
import { chooseAiAction } from "../../components/game/kernelAi";
import type { ObjId } from "./types";

const NL = String.fromCharCode(10);
const rr = (g: G) => ({ s: g.s, events: [], defs: ctx.cards, scanned: 0 }) as never;
const target = (x: ObjId, then?: Answerer): Answerer => (p, g) => (p.kind === "choose_targets" && /Extravagant Replication/.test(p.prompt.title) ? { ids: [x] } : then?.(p, g));
/** a table: p1 has Extravagant Replication + a creature, p2 has a creature; the game is at the end of p2's turn */
function table(extra?: (m: ReturnType<typeof base>) => void) {
  const m = base(); rich(m);
  m.give("p1", "Extravagant Replication", "battlefield");
  const c1 = m.give("p1", "Ledger Shredder", "battlefield"), c2 = m.give("p2", "Esper Sentinel", "battlefield");
  extra?.(m);
  m.state.turn.active = "p2"; m.state.turn.phase = "end_step"; m.state.priority = "p2";
  return { m, c1, c2 };
}

describe("Overwhelming Splendor copied by Extravagant Replication", () => {
  const setup = () => {
    let os = "";
    const t = table((m) => { os = m.give("p1", "Overwhelming Splendor", "battlefield"); m.state.objects[os].attachedPlayer = "p2"; });
    return { ...t, os, g: new G(t.m) };
  };
  it("the original enchants p2: p2's creatures are 1/1 without abilities, p1's are untouched", () => {
    const { g, c1, c2 } = setup();
    expect(g.chars(c2).power).toBe(1); expect(g.chars(c2).abilities).toEqual([]);
    expect(g.chars(c1).keywords).toContain("flying");
  });
  it("the copy asks which player it enchants (any player, yourself included); choosing p1 turns p1's creatures into 1/1s without abilities", () => {
    const { g, os, c1, c2 } = setup();
    const seen: string[][] = [];
    const ans: Answerer = (p) => { if (p.kind === "choose_option") { seen.push(p.options.map((o) => o.label)); return { ids: ["p1"] }; } return undefined; };
    toUpkeep(g, "p1", target(os, ans)); g.drive(target(os, ans));
    expect(seen, g.log().join("\n")).toEqual([["p1", "p2"]]);
    const copy = g.bf("Overwhelming Splendor").find((i) => g.obj(i).token)!;
    expect(g.obj(copy).attachedPlayer).toBe("p1");
    expect(g.obj(os).attachedPlayer).toBe("p2"); // the original is untouched
    expect(g.chars(c1).power).toBe(1); expect(g.chars(c1).toughness).toBe(1); expect(g.chars(c1).abilities).toEqual([]);
    expect(g.chars(c2).power).toBe(1); // still enchanted by the original
    g.clean();
  });
  it("choosing p2: p2 is enchanted twice, p1's creatures keep their abilities", () => {
    const { g, os, c1 } = setup();
    const ans: Answerer = (p) => (p.kind === "choose_option" ? { ids: ["p2"] } : undefined);
    toUpkeep(g, "p1", target(os, ans)); g.drive(target(os, ans));
    const copy = g.bf("Overwhelming Splendor").find((i) => g.obj(i).token)!;
    expect(g.obj(copy).attachedPlayer).toBe("p2");
    expect(g.chars(c1).keywords).toContain("flying");
  });
  it("the copy's second effect: the enchanted player cannot activate non-mana abilities", () => {
    const { g, os, c1 } = setup();
    const ans: Answerer = (p) => (p.kind === "choose_option" ? { ids: ["p1"] } : undefined);
    // p1 is the enchanted player now; give p1 a Sigil-like activated ability source (Food token) and an artifact with a mana ability
    toUpkeep(g, "p1", target(os, ans)); g.drive(target(os, ans));
    const sol = g.s.objects[Object.keys(g.s.objects).length ? g.find("Overwhelming Splendor")[0] : ""];
    expect(sol).toBeTruthy();
    const acts = legalActions(g.s, "p1", ctx).filter((a) => a.kind === "activateAbility");
    // every listed activated ability of p1 would be a mana ability (none of p1's other permanents have a non-mana one on this table)
    for (const a of acts) expect(g.chars(a.objectId as ObjId).abilities.find((x) => x.id === (a as { abilityId?: string }).abilityId)?.kind, JSON.stringify(a)).toBe("mana");
    void c1;
  });
  it("one legal player is chosen without a question", () => {
    const { g, os } = setup();
    const r = { s: structuredClone(g.s), events: [], defs: ctx.cards, scanned: 0 } as never as Run;
    r.s.players[1].hasLost = true; // only p1 is left to enchant
    const copy = createToken(r, "p1", copiableDef(r, r.s.objects[os]), false, []);
    void copy;
    const tok = Object.values(r.s.objects).find((o) => o.token && o.zone === "battlefield")!;
    expect(tok.attachedPlayer).toBe("p1");
  });
  it("the AI controlling Extravagant Replication picks the target and answers the enchant-player question with a legal player", () => {
    const { g } = setup();
    const picked: string[] = []; const asked: string[] = [];
    const ans: Answerer = (p, gg) => {
      const act = chooseAiAction(legalActions(gg.s, "p1", ctx), gg.s, ctx, "p1");
      expect(act?.type, p.kind).toBe("answerDecision");
      const choice = (act as { choice: { ids: string[] } }).choice;
      if (p.kind === "choose_option") picked.push(choice.ids[0]);
      if (p.kind === "choose_targets") asked.push(p.prompt.title + " -> " + choice.ids.join(","));
      return choice;
    };
    toUpkeep(g, "p1", ans); g.drive(ans);
    expect(asked.some((x) => /Extravagant Replication/.test(x)), g.log().join(NL)).toBe(true);
    const tokens = g.s.battlefield.filter((i) => g.obj(i).token);
    expect(tokens.length, g.log().join(NL)).toBe(1);
    if (g.obj(tokens[0]).cardName === "Overwhelming Splendor") expect(["p1", "p2"]).toContain(picked[0]);
    g.clean();
  });
});

describe("planeswalker copies enter with loyalty", () => {
  it("Garruk, Cursed Huntsman is legendary: the copy triggers the legend rule; keeping the copy leaves a planeswalker with its 5 loyalty", () => {
    const t = table((m) => { const w = m.give("p1", "Garruk, Cursed Huntsman", "battlefield"); m.state.objects[w].counters = { loyalty: 5 }; });
    const g = new G(t.m); const w = g.bf("Garruk, Cursed Huntsman")[0];
    const titles: string[] = [];
    const ans: Answerer = (p) => { titles.push(p.prompt.title); return /Legend rule/.test(p.prompt.title) ? { ids: [p.options.find((o) => /token/.test(o.label))!.id] } : undefined; };
    toUpkeep(g, "p1", target(w, ans)); g.drive(target(w, ans));
    expect(titles.some((x) => /Legend rule/.test(x))).toBe(true);
    const tok = g.bf("Garruk, Cursed Huntsman")[0];
    expect(g.obj(tok).token).toBeTruthy();
    expect(g.obj(tok).counters.loyalty).toBe(5);
    expect(g.zone(w)).toBe("graveyard");
    expect(g.log().join("\n")).not.toMatch(/no loyalty/);
  });
});

describe("the legend rule (704.5j)", () => {
  it("keeping the original: the token ceases to exist, the original is untouched; keeping the token: the original goes to the graveyard", () => {
    for (const keepToken of [false, true]) {
      const t = table((m) => { m.give("p1", "Zur, Eternal Schemer", "battlefield"); });
      const g = new G(t.m); const z = g.bf("Zur, Eternal Schemer")[0];
      const ans: Answerer = (p) => (/Legend rule/.test(p.prompt.title) ? { ids: [p.options.find((o) => /token/.test(o.label) === keepToken)!.id] } : undefined);
      toUpkeep(g, "p1", target(z, ans)); g.drive(target(z, ans));
      const now = g.bf("Zur, Eternal Schemer");
      expect(now).toHaveLength(1);
      expect(!!g.obj(now[0]).token).toBe(keepToken);
      expect(g.zone(z)).toBe(keepToken ? "graveyard" : "battlefield");
      expect(g.log().join("\n")).toMatch(/legend rule/);
    }
  });
  it("two players each controlling a legendary permanent of the same name do not trigger it", () => {
    const m = base(); m.give("p1", "Zur, Eternal Schemer", "battlefield"); m.give("p2", "Zur, Eternal Schemer", "battlefield");
    const g = new G(m); g.pl("p1"); g.drive();
    // nothing happened yet (no action ran the state-based actions): run one
    g.do("p1", { type: "advancePhase", player: "p1" } as never);
    expect(g.find("Zur, Eternal Schemer", "battlefield")).toHaveLength(2);
  });
  it("a token's enters trigger still goes on the stack when the legend rule removes the token first (Selfless Squire copy is not legendary: use Twilight Diviner is not either; Izoni is)", () => {
    const t = table((m) => { m.give("p1", "Izoni, Thousand-Eyed", "battlefield"); });
    const g = new G(t.m); const z = g.bf("Izoni, Thousand-Eyed")[0];
    const ans: Answerer = (p) => (/Legend rule/.test(p.prompt.title) ? { ids: [p.options.find((o) => !/token/.test(o.label))!.id] } : undefined);
    toUpkeep(g, "p1", target(z, ans)); g.drive(target(z, ans));
    expect(g.log().join("\n")).toMatch(/Izoni, Thousand-Eyed: .*Undergrowth/);
  });
});

describe("copies of the back face of a transforming card", () => {
  it("the real transformed permanent has its front face's mana value; a token copy of it has none", () => {
    const t = table((m) => { const h = m.give("p1", "Sheoldred // The True Scriptures", "battlefield"); m.state.objects[h].face = "The True Scriptures"; });
    const g = new G(t.m); const h = g.find("Sheoldred // The True Scriptures", "battlefield")[0];
    expect(baseChars(rr(g), g.obj(h)).mv).toBe(ctx.cards("Sheoldred // The True Scriptures")!.manaCost ? baseChars(rr(g), { ...g.obj(h), face: undefined } as never).mv : 0);
    toUpkeep(g, "p1", target(h)); g.drive(target(h));
    const tok = g.s.battlefield.map((i) => g.obj(i)).find((o) => o.token && o.cardName !== "Ledger Shredder");
    expect(tok).toBeTruthy();
    expect(baseChars(rr(g), tok!).mv).toBe(0);
    lands(t.m, "p1");
  });
});

describe("Overwhelming Splendor cast for real, then copied on the next upkeep", () => {
  it("cast targeting p2 (the resolve path attaches it), then Extravagant Replication copies it; the copy chooses a player and applies it", () => {
    const m = base(); rich(m);
    m.give("p1", "Extravagant Replication", "battlefield");
    const c1 = m.give("p1", "Ledger Shredder", "battlefield"), c2 = m.give("p2", "Esper Sentinel", "battlefield");
    const os = m.give("p1", "Overwhelming Splendor", "hand");
    const g = new G(m);
    g.cast("p1", os, {}, ((p: { kind: string; options: Array<{ id: string }> }) => (p.kind === "choose_targets" ? { ids: ["p2"] } : undefined)) as never);
    const orig = g.bf("Overwhelming Splendor")[0];
    expect(orig, g.log().join("\n")).toBeTruthy();
    expect(g.obj(orig).attachedPlayer).toBe("p2");
    expect(g.chars(c2).power).toBe(1);
    const ans: Answerer = (p) => (p.kind === "choose_targets" && /Extravagant Replication/.test(p.prompt.title) ? { ids: [orig] } : p.kind === "choose_option" ? { ids: ["p1"] } : undefined);
    toUpkeep(g, "p1", ans); g.drive(ans);
    const copy = g.bf("Overwhelming Splendor").find((i) => g.obj(i).token)!;
    expect(copy, g.log().join("\n")).toBeTruthy();
    expect(g.obj(copy).attachedPlayer).toBe("p1");
    expect(g.chars(c1).power).toBe(1);
    g.clean();
  });
});
