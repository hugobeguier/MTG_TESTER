// Hidden information: viewFor / eventsFor / pendingFor / viewResult. The server keeps the full state; each player only gets their own view.

import { describe, expect, it } from "vitest";
import type { Step } from "../schema";
import { eventsFor, pendingFor, viewFor, viewResult } from "./view";
import { fam, filler, sorcery } from "./famkit";
import type { Table } from "./testkit";

const S = (s: Record<string, unknown>) => s as unknown as Step;
const secret = (n: string) => filler(n);

function setup() {
  const t = fam({
    "Secret Hand Card": secret("Secret Hand Card"), "Secret Library Card": secret("Secret Library Card"), "Their Hand Card": secret("Their Hand Card"), "Their Library Card": secret("Their Library Card"),
    Tutor: sorcery("Tutor", "{U}", [S({ kind: "search_library", who: "you", filter: { types: ["creature"] }, count: 1, to: "hand" })]),
    RevealTutor: sorcery("RevealTutor", "{U}", [S({ kind: "search_library", who: "you", filter: { types: ["creature"] }, count: 1, to: "hand", reveal: true })]),
    Peek: sorcery("Peek", "{U}", [S({ kind: "look_top", amount: 2 })])
  });
  t.give("p1", "Island", "battlefield"); t.give("p1", "Island", "battlefield");
  t.give("p1", "Secret Hand Card", "hand");
  t.give("p1", "Secret Library Card", "library"); t.give("p1", "Fill A", "library");
  t.give("p2", "Their Hand Card", "hand"); t.give("p2", "Their Library Card", "library");
  t.give("p1", "Fill B", "graveyard"); t.give("p2", "Fill C", "exile"); t.give("p2", "Fill D", "battlefield");
  return t;
}
const names = (x: unknown) => JSON.stringify(x);

describe("viewFor", () => {
  it("own hand is visible, the opponent's hand and every library are counts only", () => {
    const t = setup();
    const v1 = viewFor(t.state, "p1");
    expect(v1.players[0].hand).toHaveLength(1);
    expect(v1.players[1].hand).toEqual([]);
    expect(v1.players[1].handCount).toBe(1);
    expect(v1.players[0].libraryCount).toBe(2);
    expect(v1.players[0].library).toEqual([]);
    expect(names(v1)).toContain("Secret Hand Card");
    expect(names(v1)).not.toContain("Secret Library Card");
    expect(names(v1)).not.toContain("Their Hand Card");
    expect(names(v1)).not.toContain("Their Library Card");
  });

  it("battlefield, graveyard and exile are public", () => {
    const t = setup();
    const v2 = viewFor(t.state, "p2");
    expect(names(v2)).toContain("Fill B"); // p1's graveyard
    expect(names(v2)).toContain("Fill C"); // exile
    expect(names(v2)).toContain("Fill D"); // battlefield
    expect(names(v2)).toContain("Island");
    expect(names(v2)).not.toContain("Secret Hand Card");
    expect(names(v2)).toContain("Their Hand Card");
  });

  it("the RNG seed, the RNG state and the replay data of pending decisions never leave the server", () => {
    const t = setup();
    const v = viewFor(t.state, "p1") as unknown as Record<string, unknown>;
    expect(v.seed).toBeUndefined();
    expect(v.rngState).toBeUndefined();
  });

  it("does not mutate the state and is deterministic and JSON-safe", () => {
    const t = setup();
    const before = JSON.stringify(t.state);
    const a = JSON.stringify(viewFor(t.state, "p2"));
    expect(JSON.stringify(t.state)).toBe(before);
    expect(JSON.stringify(viewFor(t.state, "p2"))).toBe(a);
    expect(JSON.parse(a).viewer).toBe("p2");
  });

  it("a third player sees neither of the others' hands", () => {
    const t = fam();
    const s = t.state; s.players.push({ ...structuredClone(s.players[1]), id: "p3", name: "p3", hand: [], library: [], graveyard: [], exile: [], command: [] });
    t.give("p1", "Secret Hand Card", "hand");
    const v3 = viewFor(t.state, "p3");
    expect(names(v3)).not.toContain("Secret Hand Card");
    expect(v3.players.find((p) => p.id === "p1")!.handCount).toBe(1);
  });

  it("face-down cards of others are anonymous, their owner still sees them", () => {
    const t = setup();
    const id = t.give("p1", "Secret Library Card", "exile");
    t.state.objects[id].faceDown = true;
    expect(names(viewFor(t.state, "p2"))).not.toMatch(/Secret Library Card/);
    expect(viewFor(t.state, "p2").objects[id].zone).toBe("exile");
    expect(names(viewFor(t.state, "p1"))).toContain("Secret Library Card");
  });

  it("the stack is public (a spell on the stack is a known card)", () => {
    const t = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Tutor", "hand") });
    const v2 = viewFor(t.state, "p2");
    expect(Object.values(v2.objects).some((o) => o.cardName === "Tutor" && o.zone === "stack")).toBe(true);
  });
});

describe("a search by player A", () => {
  const search = (card: "Tutor" | "RevealTutor") => {
    const t = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", card, "hand") });
    const res = t.resolveTop();
    const pick = res.pending!.options.find((o) => o.label === "Secret Library Card")!.id;
    const done = t.answer(res, { ids: [pick] });
    return { t, res, done, pick };
  };

  it("reveals nothing to B unless the card says reveal: B's events carry no name and the zone change is hidden", () => {
    const { t, res, done, pick } = search("Tutor");
    const all = [...res.events, ...done.events];
    const bEvents = eventsFor(t.state, "p2", all);
    expect(names(bEvents)).not.toContain("Secret Library Card");
    const zc = bEvents.filter((e) => e.type === "zone_change" && e.hidden);
    expect(zc.length).toBeGreaterThan(0);
    expect(zc.every((e) => e.id === undefined && e.name === undefined)).toBe(true);
    expect(bEvents.some((e) => e.type === "library_searched")).toBe(true); // that a search happened is public
    expect(names(bEvents)).not.toContain(pick);
    // A sees everything
    expect(names(eventsFor(t.state, "p1", all))).toContain("Secret Library Card");
  });

  it("B's state view after the search still hides the card (it is in A's hand now)", () => {
    const { t } = search("Tutor");
    expect(names(viewFor(t.state, "p2"))).not.toContain("Secret Library Card");
    expect(names(viewFor(t.state, "p1"))).toContain("Secret Library Card");
  });

  it("with `reveal: true` the reveal event names the card to everybody", () => {
    const { t, res, done } = search("RevealTutor");
    const bEvents = eventsFor(t.state, "p2", [...res.events, ...done.events]);
    const rev = bEvents.find((e) => e.type === "reveal");
    expect(rev).toMatchObject({ player: "p1", names: ["Secret Library Card"] });
  });

  it("B's view of A's decision has no options; A's own view does", () => {
    const t = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Tutor", "hand") });
    const res = t.resolveTop();
    expect(res.pending!.options.length).toBeGreaterThan(0);
    const b = viewResult(res, "p2");
    expect(b.pending).toMatchObject({ hidden: true, options: [], kind: "choose_cards", player: "p1" });
    expect((b.pending as { optionCount: number }).optionCount).toBe(res.pending!.options.length);
    expect(names(b)).not.toContain("Secret Library Card");
    expect(names(viewFor(t.state, "p2").pending)).not.toContain("Secret Library Card");
    const a = viewResult(res, "p1");
    expect(a.pending!.options.length).toBe(res.pending!.options.length);
    expect(names(a.pending)).toContain("Secret Library Card");
  });

  it("the replay / exec continuation inside state.pending never appears in a view", () => {
    const t = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Tutor", "hand") });
    t.resolveTop();
    const json = names(viewFor(t.state, "p1"));
    expect(json).not.toContain('"ctx"');
    expect(json).not.toContain("exec");
  });
});

describe("draws, looks and the log", () => {
  it("another player's draw event carries no card; the drawer's does", () => {
    const t2 = fam({ Draw: sorcery("Draw", "{U}", [S({ kind: "draw_cards", amount: 1, who: "you" })]) });
    t2.give("p1", "Island", "battlefield"); t2.give("p1", "Fill A", "library");
    t2.ok({ type: "castSpell", player: "p1", cardId: t2.give("p1", "Draw", "hand") });
    const res = t2.resolveTop();
    const own = eventsFor(t2.state, "p1", res.events).find((e) => e.type === "draw")!;
    const other = eventsFor(t2.state, "p2", res.events).find((e) => e.type === "draw")!;
    expect(own.id).toBeDefined();
    expect(other.id).toBeUndefined();
    expect(other).toMatchObject({ player: "p1", hidden: true });
    expect(names(viewFor(t2.state, "p2").turnLog.filter((e) => e.type === "draw"))).not.toContain('"id"');
  });

  it("looking at the top cards is private to the looker", () => {
    const t = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Peek", "hand") });
    const res = t.resolveTop();
    expect(eventsFor(t.state, "p1", res.events).some((e) => e.type === "looked_at")).toBe(true);
    expect(eventsFor(t.state, "p2", res.events).some((e) => e.type === "looked_at")).toBe(false);
    expect(names(eventsFor(t.state, "p2", res.events))).not.toContain("Secret Library Card");
  });

  it("discards, mills and exiles are public (the card goes to a public zone)", () => {
    const t = fam({ Mill: sorcery("Mill", "{U}", [S({ kind: "mill", amount: 1, who: "you" }), S({ kind: "discard", amount: 1, who: "you" })]) });
    t.give("p1", "Island", "battlefield"); t.give("p1", "Fill A", "library"); t.give("p1", "Fill B", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Mill", "hand") });
    const res = t.resolveTop();
    const ev = eventsFor(t.state, "p2", res.events);
    expect(names(ev)).toContain("Fill A");
    expect(ev.filter((e) => e.type === "zone_change" && e.hidden)).toHaveLength(0);
  });

  it("a hidden-to-hidden move of another player's card keeps the zones but not the identity (hand -> library)", () => {
    const t = fam({ Put: sorcery("Put", "{U}", [S({ kind: "move_card_zone", what: "all", who: "you", from: "hand", moveTo: "library" })]) });
    t.give("p1", "Island", "battlefield"); t.give("p1", "Fill B", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Put", "hand") });
    const res = t.resolveTop();
    const ev = eventsFor(t.state, "p2", res.events).filter((e) => e.type === "zone_change" && e.from === "hand" && e.to === "library");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ hidden: true, owner: "p1" });
    expect(names(ev)).not.toContain("Fill B");
  });
});

describe("pendingFor", () => {
  it("null stays null; the deciding player keeps options; the others lose them", () => {
    expect(pendingFor(null, "p1")).toBeNull();
    const t = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Tutor", "hand") });
    t.resolveTop();
    const p = t.state.pending!;
    expect(pendingFor(p, "p1")!.options.length).toBe(p.options.length);
    const other = pendingFor(p, "p2") as { options: unknown[]; hidden?: boolean; prompt: unknown };
    expect(other.options).toEqual([]);
    expect(other.hidden).toBe(true);
    expect(other.prompt).toEqual(p.prompt);
  });
});

void (null as unknown as Table);
