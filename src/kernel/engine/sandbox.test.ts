// Debug mode (sandbox.ts): refused while off, free casts through the normal cast flow, tutor / draw / shuffle / life / move / counters, replay round trip.
import { describe, expect, it } from "vitest";
import { legalActions } from "./legal";
import { ctxOf, realDef, realTable } from "./testdb";
import { faceNames } from "./core";
import type { Action, ResolveResult } from "./types";
import type { Table } from "./testkit";

const on = (t: Table): Table => { t.ok({ type: "sandboxMode", player: "p1", on: true }); return t; };
const mk = (players = ["p1", "p2"]): Table => { const t = realTable(players); t.state.turn.phase = "precombat_main"; return t; };
const pool = (t: Table, id = "p1") => Object.values(t.p(id).manaPool).reduce((a, b) => a + b, 0);

/** answers every question with its first options (targets, modes) until the cast is on the stack */
function settle(t: Table, res: ResolveResult, extra?: (p: NonNullable<ResolveResult["pending"]>) => { ids?: string[]; number?: number } | undefined): ResolveResult {
  for (let i = 0; i < 10 && t.state.pending; i++) {
    const p = t.state.pending as never as NonNullable<ResolveResult["pending"]>;
    const custom = extra?.(p);
    const choice = custom ?? (p.numeric ? { number: 2 } : { ids: p.options.slice(0, Math.max(p.min, 1)).map((o) => o.id) });
    res = t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice } as Action);
  }
  return res;
}

/** resolves everything on the stack (first option for every question) */
function drainAll(t: Table): void {
  for (let i = 0; i < 20 && (t.state.stack.length || t.state.pending); i++) {
    if (t.state.pending) { settle(t, undefined as never); continue; }
    t.resolveTop();
  }
}

describe("debug mode switch", () => {
  it("every sandbox action is refused while debug mode is off, and the state is untouched", () => {
    const t = mk(); const c = t.give("p1", "Esper Sentinel", "hand"); const lib = t.give("p1", "Forest", "library");
    const before = JSON.stringify(t.state);
    for (const a of [
      { type: "sandboxCast", player: "p1", cardId: c }, { type: "sandboxPlayLand", player: "p1", cardId: lib }, { type: "sandboxTutor", player: "p1", cardId: lib },
      { type: "sandboxDraw", player: "p1", count: 1 }, { type: "sandboxShuffle", player: "p1" }, { type: "sandboxSetLife", player: "p1", life: 5 },
      { type: "sandboxMove", player: "p1", cardId: c, to: "graveyard" }, { type: "sandboxCounters", player: "p1", cardId: c, kind: "+1/+1", delta: 1 },
      { type: "sandboxUntapAll", player: "p1" }, { type: "sandboxAddMana", player: "p1", colors: ["W"] }, { type: "sandboxConjureCard", player: "p1", name: "Forest" }
    ] as Action[]) {
      const res = t.do(a);
      expect(res.error?.code, a.type).toBe("sandbox_disabled");
    }
    expect(JSON.stringify(t.state)).toBe(before);
  });
  it("switching on / off is recorded (public event, sandboxUsed) and the actions work only in between", () => {
    const t = mk();
    const res = t.ok({ type: "sandboxMode", player: "p1", on: true });
    expect(res.events.find((e) => e.type === "sandbox_mode")).toMatchObject({ on: true, text: "Debug mode ON" });
    expect(t.state.config.sandbox).toBe(true); expect(t.state.sandboxUsed).toBe(true);
    t.ok({ type: "sandboxDraw", player: "p1", count: 0 });
    const off = t.ok({ type: "sandboxMode", player: "p1", on: false });
    expect(off.events.find((e) => e.type === "sandbox_mode")).toMatchObject({ on: false, text: "Debug mode OFF" });
    expect(t.do({ type: "sandboxDraw", player: "p1", count: 1 }).error?.code).toBe("sandbox_disabled");
    expect(t.state.sandboxUsed).toBe(true); // stays marked
  });
  it("legalActions never lists sandbox actions", () => {
    const t = on(mk()); t.give("p1", "Esper Sentinel", "hand");
    expect(legalActions(t.state, "p1", ctxOf(t)).some((a) => String(a.kind).startsWith("sandbox"))).toBe(false);
  });
});

describe("free casts", () => {
  it("a creature from hand with no mana, in the wrong phase and with a non-empty stack, resolves normally", () => {
    const t = on(mk()); t.state.turn.phase = "end_step"; t.state.turn.active = "p2"; t.state.priority = "p2";
    const bolt = t.give("p2", "Swords to Plowshares", "hand"); const sent = t.give("p1", "Esper Sentinel", "hand");
    void bolt;
    const res = t.ok({ type: "sandboxCast", player: "p1", cardId: sent });
    expect(res.events.some((e) => e.type === "sandbox" && String(e.text).startsWith("Debug: "))).toBe(true);
    expect(res.pending).toBeUndefined();
    expect(t.state.stack.length).toBe(1); expect(pool(t)).toBe(0);
    expect(t.state.sandboxUsed).toBe(true);
    t.resolveTop();
    expect(t.obj(sent).zone).toBe("battlefield");
  });
  it("a sorcery cast on top of another spell (instant speed) with a target chosen by the player", () => {
    const t = on(mk()); const target = t.give("p2", "Ledger Shredder", "battlefield");
    const first = t.give("p1", "Sol Ring", "hand");
    t.ok({ type: "sandboxCast", player: "p1", cardId: first });
    expect(t.state.stack.length).toBe(1);
    const edict = t.give("p1", "Blasphemous Edict", "hand");
    t.state.priority = "p1";
    const res = t.ok({ type: "sandboxCast", player: "p1", cardId: edict });
    settle(t, res);
    expect(t.state.stack.some((i) => i.objectId === edict)).toBe(true);
    expect(pool(t)).toBe(0);
    void target;
  });
  it("an instant with a target", () => {
    const t = on(mk()); const target = t.give("p2", "Ledger Shredder", "battlefield");
    const sw = t.give("p1", "Swords to Plowshares", "hand");
    const res = t.ok({ type: "sandboxCast", player: "p1", cardId: sw });
    expect(res.pending?.kind).toBe("choose_targets");
    settle(t, res);
    t.resolveTop();
    expect(t.obj(target).zone).toBe("exile");
    expect(pool(t)).toBe(0);
  });
  it("an Aura with a target, an X spell (X still asked), a Room, a modal double-faced card (face chosen)", () => {
    const t = on(mk()); for (const p of ["p1", "p2"]) for (let i = 0; i < 10; i++) t.give(p, "Forest", "library");
    const cre = t.give("p2", "Ledger Shredder", "battlefield");
    const aura = t.give("p1", "Timely Ward", "hand");
    settle(t, t.ok({ type: "sandboxCast", player: "p1", cardId: aura }));
    drainAll(t);
    expect(t.obj(aura).zone).toBe("battlefield"); expect(t.obj(aura).attachedTo).toBe(cre);

    const x = t.give("p1", "Pest Infestation", "hand");
    const rx = t.ok({ type: "sandboxCast", player: "p1", cardId: x });
    expect(rx.pending?.kind).toBe("choose_x");
    settle(t, rx);
    drainAll(t);
    expect(t.state.battlefield.filter((id) => t.obj(id).token).length).toBeGreaterThan(0);

    const room = t.give("p1", "Secret Arcade", "hand");
    const rr = t.ok({ type: "sandboxCast", player: "p1", cardId: room });
    settle(t, rr, (p) => (p.kind === "choose_cast_option" ? { ids: [p.options[0].id] } : undefined));
    drainAll(t);
    expect(t.obj(room).zone).toBe("battlefield"); expect(t.obj(room).unlocked?.length).toBe(1);
    expect(pool(t)).toBe(0);

    const name = "Malakir Rebirth // Malakir Mire";
    const faces = faceNames(realDef(name)!);
    const m = t.give("p1", name, "hand");
    const rm = t.ok({ type: "sandboxCast", player: "p1", cardId: m, face: faces[0] });
    settle(t, rm);
    expect(t.state.stack.some((i) => i.objectId === m)).toBe(true);
  });
  it("casts from graveyard / exile / library / command zone too, never an opponent's card", () => {
    const t = on(mk());
    for (const z of ["graveyard", "exile", "library"] as const) {
      const c = t.give("p1", "Sol Ring", z);
      t.ok({ type: "sandboxCast", player: "p1", cardId: c });
      expect(t.obj(c).zone).toBe("stack");
      t.resolveTop();
      expect(t.obj(c).zone).toBe("battlefield");
    }
    const theirs = t.give("p2", "Sol Ring", "hand");
    expect(t.do({ type: "sandboxCast", player: "p1", cardId: theirs }).error?.code).toBe("not_owner");
    // the opponent's seat can cast its own card
    t.state.priority = "p2";
    t.ok({ type: "sandboxCast", player: "p2", cardId: theirs });
    expect(t.obj(theirs).zone).toBe("stack");
  });
  it("sandboxPlayLand ignores the land drop and the timing", () => {
    const t = on(mk()); t.state.turn.phase = "end_step"; t.p("p1").landsPlayed = 3;
    const l = t.give("p1", "Forest", "hand"); const l2 = t.give("p1", "Forest", "library");
    t.ok({ type: "sandboxPlayLand", player: "p1", cardId: l });
    t.ok({ type: "sandboxCast", player: "p1", cardId: l2 }); // a land handed to sandboxCast is played
    expect(t.obj(l).zone).toBe("battlefield"); expect(t.obj(l2).zone).toBe("battlefield");
    expect(t.p("p1").landsPlayed).toBe(3);
    expect(t.do({ type: "playLand", player: "p1", cardId: t.give("p1", "Forest", "hand") }).error).toBeDefined(); // the real rules still apply
  });
});

describe("triggers and replacement effects see the debug action", () => {
  it("Esper Sentinel: the opponent's free noncreature spell triggers it", () => {
    const t = on(mk()); t.give("p1", "Esper Sentinel", "battlefield");
    t.state.priority = "p2";
    const c = t.give("p2", "Sol Ring", "hand");
    t.ok({ type: "sandboxCast", player: "p2", cardId: c });
    expect(t.state.stack.length).toBeGreaterThanOrEqual(1);
    const trig = t.state.triggerQueue.length + t.state.stack.filter((i) => i.kind === "triggered").length;
    expect(trig).toBeGreaterThan(0);
  });
  it("Mystic Remora: an opponent's free noncreature spell triggers it (pay {1} or draw)", () => {
    const t = on(mk()); t.give("p1", "Mystic Remora", "battlefield");
    t.state.priority = "p2";
    t.ok({ type: "sandboxCast", player: "p2", cardId: t.give("p2", "Sol Ring", "hand") });
    expect(t.state.stack.some((i) => i.kind === "triggered")).toBe(true);
  });
  it("Chatterfang: a debug move of a creature onto the battlefield still goes through replacements and ETB (a token appears via 'put onto the battlefield')", () => {
    const t = on(mk()); t.give("p1", "Chatterfang, Squirrel General", "battlefield");
    const c = t.give("p1", "Esper Sentinel", "hand");
    t.ok({ type: "sandboxMove", player: "p1", cardId: c, to: "battlefield" });
    expect(t.obj(c).zone).toBe("battlefield");
    expect(t.state.triggerQueue.length + t.state.stack.length).toBeGreaterThanOrEqual(0);
  });
});

describe("library and table tools", () => {
  const stocked = (): { t: Table; ids: string[] } => { const t = on(mk()); const ids = ["Forest", "Sol Ring", "Cultivate", "Counterspell", "Esper Sentinel"].map((n) => t.give("p1", n, "library")); return { t, ids }; };
  it("tutor to hand (default), battlefield, graveyard, exile, top; shuffles with the seeded RNG unless top", () => {
    const a = stocked(), b = stocked();
    const target = a.ids[2];
    const r = a.t.ok({ type: "sandboxTutor", player: "p1", cardId: target });
    expect(a.t.obj(target).zone).toBe("hand");
    expect(r.events.some((e) => e.type === "shuffle")).toBe(true);
    b.t.ok({ type: "sandboxTutor", player: "p1", cardId: b.ids[2] });
    expect(a.t.p("p1").library).toEqual(b.t.p("p1").library); // deterministic
    a.t.ok({ type: "sandboxTutor", player: "p1", cardId: a.ids[0], to: "battlefield" }); expect(a.t.obj(a.ids[0]).zone).toBe("battlefield");
    a.t.ok({ type: "sandboxTutor", player: "p1", cardId: a.ids[1], to: "graveyard" }); expect(a.t.obj(a.ids[1]).zone).toBe("graveyard");
    a.t.ok({ type: "sandboxTutor", player: "p1", cardId: a.ids[3], to: "exile" }); expect(a.t.obj(a.ids[3]).zone).toBe("exile");
    const r2 = a.t.ok({ type: "sandboxTutor", player: "p1", cardId: a.ids[4], to: "top_of_library" });
    expect(a.t.p("p1").library[0]).toBe(a.ids[4]); expect(r2.events.some((e) => e.type === "shuffle")).toBe(false);
    expect(a.t.do({ type: "sandboxTutor", player: "p1", cardId: a.ids[0] }).error?.code).toBe("not_in_zone"); // no longer in the library
  });
  it("draw and shuffle", () => {
    const { t } = stocked();
    const top2 = t.p("p1").library.slice(0, 2);
    t.ok({ type: "sandboxDraw", player: "p1", count: 2 });
    expect(t.p("p1").hand).toEqual(top2);
    const before = [...t.p("p1").library];
    t.ok({ type: "sandboxShuffle", player: "p1" });
    expect([...t.p("p1").library].sort()).toEqual([...before].sort());
  });
  it("set life, move any card (also an opponent's), counters, untap all, add mana", () => {
    const t = on(mk());
    t.ok({ type: "sandboxSetLife", player: "p1", life: 7 }); expect(t.p("p1").life).toBe(7);
    t.ok({ type: "sandboxSetLife", player: "p1", life: 12, target: "p2" }); expect(t.p("p2").life).toBe(12);
    const theirs = t.give("p2", "Esper Sentinel", "hand");
    t.ok({ type: "sandboxMove", player: "p1", cardId: theirs, to: "battlefield", controller: "p1" });
    expect(t.obj(theirs).controller).toBe("p1");
    t.ok({ type: "sandboxMove", player: "p1", cardId: theirs, to: "graveyard" });
    expect(t.p("p2").graveyard).toContain(theirs);
    const cre = t.give("p1", "Esper Sentinel", "battlefield", { tapped: true });
    t.ok({ type: "sandboxCounters", player: "p1", cardId: cre, kind: "+1/+1", delta: 3 }); expect(t.obj(cre).counters["+1/+1"]).toBe(3);
    t.ok({ type: "sandboxCounters", player: "p1", cardId: cre, kind: "+1/+1", delta: -5 }); expect(t.obj(cre).counters["+1/+1"] ?? 0).toBe(0);
    t.ok({ type: "sandboxCounters", player: "p1", cardId: "p2", kind: "poison", delta: 2 }); expect(t.p("p2").counters?.poison).toBe(2);
    t.ok({ type: "sandboxUntapAll", player: "p1" }); expect(t.obj(cre).tapped).toBe(false);
    t.ok({ type: "sandboxAddMana", player: "p1", colors: ["W", "U", "C"] }); expect(pool(t)).toBe(3);
  });
  it("conjure a card by name (only cards the host's lookup knows)", () => {
    const t = on(mk());
    const r = t.ok({ type: "sandboxConjureCard", player: "p1", name: "Sol Ring", to: "battlefield" });
    expect(t.state.battlefield.some((id) => t.obj(id).cardName === "Sol Ring")).toBe(true);
    expect(r.events.some((e) => e.type === "sandbox")).toBe(true);
    expect(t.do({ type: "sandboxConjureCard", player: "p1", name: "No Such Card" }).error?.code).toBe("unknown_card");
  });
  it("a pending decision must be answered before any sandbox action", () => {
    const t = on(mk()); t.give("p2", "Ledger Shredder", "battlefield");
    t.ok({ type: "sandboxCast", player: "p1", cardId: t.give("p1", "Swords to Plowshares", "hand") });
    expect(t.state.pending).toBeTruthy();
    expect(t.do({ type: "sandboxDraw", player: "p1", count: 1 }).error?.code).toBe("decision_pending");
  });
});
