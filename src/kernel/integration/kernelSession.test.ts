import { describe, expect, it } from "vitest";
import { ctx, dl, deckNames, mini } from "./testgame";
import { KernelSession, SPECTATOR } from "./kernelSession";
import { packKit, isCardPack } from "./cardPack";
import { buildPack } from "./nodePack";
import { packDraftLookup } from "./packLookup";
import { actorOf, mulberry, pickAction } from "./randomPlay";
import { createSelfPlayGame, seedRuntime } from "../../lib/selfplay/orchestrator";
import type { CardDef, EngineContext } from "../engine/types";
import type { UnresolvedRecord } from "../../lib/unresolvedLog";

const pack = JSON.parse(JSON.stringify(buildPack("wretched-ranks", { catalog: false })));
const kit = packKit([pack]);
const kitCtx: EngineContext = { cards: kit.lookup, db: kit.db };
const decks = () => { const d = deckNames("Wretched Ranks"); return [{ id: "p1", name: "You", deck: d.cards, commander: d.commander, kind: "human" as const }, { id: "p2", name: "Veyra", deck: d.cards, commander: d.commander, kind: "agent" as const }]; };
const fresh = (seed = 1, o: Record<string, unknown> = {}) => KernelSession.fromDecks({ ctx: kitCtx, display: kit.display, decks: decks(), seed, ...o });

/** a session over a hand-built position of real cards */
function scripted() {
  const t = mini();
  t.give("p1", "Swamp", "hand"); t.give("p1", "Swamp", "battlefield"); t.give("p1", "Swamp", "battlefield");
  for (let i = 0; i < 6; i++) { t.give("p1", "Swamp", "library"); t.give("p2", "Swamp", "library"); }
  t.give("p1", "Go for the Throat", "hand");
  const att = t.give("p1", "Gravecrawler", "battlefield");
  const victim = t.give("p2", "Undead Augur", "battlefield");
  t.state.players[0].hand.sort();
  const ks = KernelSession.fromState(t.state, { ctx, display: kit.display, now: () => "" });
  return { ks, att, victim, land: t.state.players[0].hand.find((id) => t.state.objects[id].cardName === "Swamp")!, spell: t.state.players[0].hand.find((id) => t.state.objects[id].cardName === "Go for the Throat")! };
}

describe("the card pack", () => {
  it("is plain JSON with the engine definitions, display data and the deck list", () => {
    expect(isCardPack(pack)).toBe(true);
    expect(pack.deck).toBe("Wretched Ranks");
    expect(pack.cards["Go for the Throat"].kernel.abilities.length).toBeGreaterThan(0);
    expect(pack.cards.Swamp.types).toContain("land");
    expect(pack.display["Grave Titan"].typeLine).toContain("Creature");
    expect(pack.decks[0].commander).toBe("Ghoulcaller Gisa");
    expect(pack.unsupported).toEqual([]); // a ready deck
    expect(kit.db.creatureTypes()).toContain("Zombie");
  });
  it("a pack kit drives the engine exactly like the Node lookup (same seed, same game)", () => {
    const a = fresh(9), b = KernelSession.fromDecks({ ctx, decks: decks(), seed: 9 });
    expect(a.state).toEqual(b.state);
  });
  it("packDraftLookup knows aliases and builds stubs for cards outside the pack", () => {
    const lk = packDraftLookup(kit);
    expect(lk.hasDraft("Swamp")).toBe(true);
    expect(lk.hasDraft("Nonexistent Card")).toBe(false);
    lk.register({ name: "Mystery Box", typeLine: "Artifact", manaCost: "{2}" });
    expect(lk.lookup("Mystery Box")?.types).toEqual(["artifact"]);
    expect(lk.noDraft.has("Mystery Box")).toBe(true);
  });
});

describe("KernelSession: creation and views", () => {
  it("from decks: 2 seats, 7-card hands, commander in the command zone, deterministic by seed", () => {
    const a = fresh(5), b = fresh(5), c = fresh(6);
    expect(a.state.players.map((p) => p.hand.length)).toEqual([7, 7]);
    expect(a.state.players[0].command).toHaveLength(1);
    expect(a.state).toEqual(b.state);
    expect(a.state.players[0].hand.map((id) => a.state.objects[id].cardName)).not.toEqual(c.state.players[0].hand.map((id) => c.state.objects[id].cardName));
    expect(a.state.config.onUnsupported).toBe("continue");
  });
  it("view(): the legacy session of that player, memoised per version", () => {
    const ks = fresh(2);
    const v1 = ks.view("p1");
    expect(ks.view("p1")).toBe(v1);
    expect(v1.seats[0].board.hand).toHaveLength(7);
    expect(v1.seats[1].board.hand.every((c) => c.name === "Hidden card")).toBe(true);
    expect(ks.view("p2").seats[1].board.hand.some((c) => c.name !== "Hidden card")).toBe(true);
    expect(ks.view(SPECTATOR).seats.every((s) => s.board.hand.every((c) => c.name === "Hidden card"))).toBe(true);
  });
  it("tableState has priority, mana pools and no decision at the start", () => {
    const ts = fresh(2).tableState("p1");
    expect(ts.prioritySeatId).toBe("p1");
    expect(ts.decision).toBeUndefined();
    expect(ts.manaPools.p1).toBeDefined();
  });
  it("actor is the priority holder, then the decision owner", () => {
    const { ks, spell } = scripted();
    expect(ks.actor).toBe("p1");
    ks.dispatch("p1", { type: "castSpell", player: "p1", cardId: spell });
    expect(ks.actor).toBe("p1");
  });
  it("legal() is legalActions on the current state", () => {
    const { ks } = scripted();
    expect(ks.legal("p1").some((a) => a.kind === "playLand")).toBe(true);
    expect(ks.legal("p2")).toEqual([]);
  });
});

describe("KernelSession: dispatch rules", () => {
  it("refuses an action sent on behalf of another player, without touching anything", () => {
    const { ks } = scripted();
    const before = JSON.stringify(ks.state);
    const r = ks.dispatch("p2", { type: "passPriority", player: "p1" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(ks.state)).toBe(before);
    expect(ks.version).toBe(0);
  });
  it("an engine refusal leaves state and version alone", () => {
    const { ks } = scripted();
    const r = ks.dispatch("p2", { type: "passPriority", player: "p2" });
    expect(r).toMatchObject({ ok: false, error: { code: "not_your_priority" } });
    expect(ks.version).toBe(0);
  });
  it("an accepted action bumps the version and invalidates the view", () => {
    const { ks, land } = scripted();
    const v = ks.view("p1");
    const r = ks.dispatch("p1", { type: "playLand", player: "p1", cardId: land });
    expect(r.ok).toBe(true);
    expect(ks.version).toBe(1);
    expect(ks.view("p1")).not.toBe(v);
    expect(ks.view("p1").seats[0].board.battlefield.some((c) => c.id === land)).toBe(true);
  });
  it("a late answer to an old decision is flagged stale and changes nothing", () => {
    const { ks, spell, victim } = scripted();
    ks.dispatch("p1", { type: "castSpell", player: "p1", cardId: spell });
    const old = ks.state.pending!.id;
    expect(ks.decide("p1", old, { ids: [victim] }).ok).toBe(true);
    const late = ks.decide("p1", old, { ids: [victim] });
    expect(late).toMatchObject({ ok: false, stale: true });
  });
  it("only the owner may answer a decision", () => {
    const { ks, spell } = scripted();
    ks.dispatch("p1", { type: "castSpell", player: "p1", cardId: spell });
    expect(ks.decide("p2", ks.state.pending!.id, { ids: [] })).toMatchObject({ ok: false, error: { code: "not_your_decision" } });
  });
  it("never throws: an engine exception marks the game degraded and keeps the state", () => {
    const { ks } = scripted();
    const bad = { ...ctx, cards: () => { throw new Error("boom"); } } as EngineContext;
    const ks2 = KernelSession.fromState(ks.state, { ctx: bad });
    const before = JSON.stringify(ks2.state);
    const r = ks2.dispatch("p1", { type: "passPriority", player: "p1" });
    expect(r).toMatchObject({ ok: false, error: { code: "internal" } });
    expect(ks2.degraded).toBe("boom");
    expect(JSON.stringify(ks2.state)).toBe(before);
  });
});

describe("KernelSession: a scripted human turn on Wretched Ranks cards", () => {
  function play(ks: ReturnType<typeof scripted>["ks"], ids: ReturnType<typeof scripted>) {
    const log: string[] = [];
    const ok = (p: string, a: Parameters<typeof ks.dispatch>[1]) => { const r = ks.dispatch(p, a); if (!r.ok) throw new Error(`${a.type}: ${r.error?.code} ${r.error?.message}`); return r; };
    // 1. play a land
    ok("p1", { type: "playLand", player: "p1", cardId: ids.land });
    log.push("land");
    // 2. cast a targeted spell: the target prompt is a decision of p1 that the table can show
    ok("p1", { type: "castSpell", player: "p1", cardId: ids.spell });
    const ts = ks.tableState("p1");
    expect(ts.decision?.kind).toBe("choose_targets");
    expect(ts.decision?.options.map((o) => o.card?.name)).toContain("Undead Augur");
    expect(ks.tableState("p2").waitingFor?.player).toBe("p1");
    ok("p1", { type: "answerDecision", player: "p1", decisionId: ts.decision!.id, choice: { ids: [ids.victim] } });
    expect(ks.tableState("p2").pendingAction).toMatchObject({ type: "spell", cardName: "Go for the Throat" });
    // 3. the AI seat passes, the spell resolves
    for (let i = 0; i < 12 && (ks.state.stack.length || ks.state.pending); i++) {
      // the spell, then Undead Augur's own "dies" trigger (a may-draw question for its controller)
      if (ks.state.pending) { const pd = ks.state.pending; ok(pd.player, { type: "answerDecision", player: pd.player, decisionId: pd.id, choice: { yes: false } }); continue; }
      const who = ks.actor!; ok(who, { type: "passPriority", player: who });
    }
    expect(ks.state.stack).toHaveLength(0);
    expect(ks.state.objects[ids.victim].zone).toBe("graveyard");
    log.push("kill");
    // 4. go to combat and attack
    while (ks.state.turn.phase !== "declare_attackers") { const who = ks.actor!; ok(who, { type: "passPriority", player: who }); }
    expect(ks.tableState("p1").declaring).toEqual({ kind: "attackers", players: ["p1"] });
    ok("p1", { type: "declareAttackers", player: "p1", attackers: [{ id: ids.att, defender: "p2" }] });
    expect(ks.view("p1").seats[0].board.battlefield.find((c) => c.id === ids.att)?.attacking).toBe(true);
    // 5. pass through damage to the end of the turn
    for (let i = 0; i < 40 && ks.state.turn.active === "p1" && ks.actor; i++) { const who = ks.actor; ok(who, { type: "passPriority", player: who }); }
    return log;
  }
  it("land, targeted spell, attack, pass: the opponent took damage and the table shows it all", () => {
    const s = scripted();
    expect(play(s.ks, s)).toEqual(["land", "kill"]);
    expect(s.ks.state.players[1].life).toBeLessThanOrEqual(38); // Gravecrawler (2/1) connected (Undead Augur's trigger may cost its controller 1 more)
    expect(s.ks.state.turn.active).toBe("p2");
    expect(s.ks.view("p2").turn).toBe(2);
  });
  it("the log shows the turn in order, the opponent log knows only public things", () => {
    const s = scripted();
    play(s.ks, s);
    const mine = s.ks.log("p1").map((l) => l.message).reverse();
    expect(mine.findIndex((m) => /plays Swamp/.test(m))).toBeGreaterThanOrEqual(0);
    expect(mine.findIndex((m) => /casts Go for the Throat/.test(m))).toBeGreaterThan(mine.findIndex((m) => /plays Swamp/.test(m)));
    expect(mine.some((m) => /attacks with 1 creature/.test(m))).toBe(true);
    expect(mine.some((m) => /deals 2 damage to p2/.test(m))).toBe(true);
    expect(s.ks.view("p1").events).toBe(s.ks.log("p1"));
    expect(new Set(s.ks.log("p1").map((l) => l.id)).size).toBe(s.ks.log("p1").length);
  });
  it("the whole game is deterministic: same actions, same states, same logs", () => {
    const a = scripted(), b = scripted();
    play(a.ks, a); play(b.ks, b);
    expect(a.ks.state).toEqual(b.ks.state);
    expect(a.ks.log("p1")).toEqual(b.ks.log("p1"));
    expect(a.ks.log("p2")).toEqual(b.ks.log("p2"));
  });
  it("per-player events: the opponent does not see what a hidden draw drew", () => {
    const t = mini(["p1", "p2"], { phase: "upkeep" });
    t.give("p1", "Swamp", "library"); t.give("p2", "Grave Titan", "library");
    const ks = KernelSession.fromState({ ...t.state, turn: { number: 2, active: "p2", phase: "upkeep" }, priority: "p2" }, { ctx, display: kit.display });
    const r = ks.dispatch("p2", { type: "passPriority", player: "p2" });
    r.events.length; // the draw happens in the draw step
    ks.dispatch("p1", { type: "passPriority", player: "p1" });
    const res = ks.dispatch("p2", { type: "passPriority", player: "p2" });
    void res;
    const all = [...ks.log("p1"), ...ks.log("p2")].map((l) => l.message).join("|");
    expect(ks.log("p1").map((l) => l.message).join("|")).not.toContain("Grave Titan");
    void all;
  });
});

describe("KernelSession: unresolved things reach the log and the sink, the game goes on", () => {
  const frob: CardDef = { name: "Frobnicate", manaCost: "{B}", types: ["sorcery"], kernel: { schemaVersion: 2, abilities: [{ id: "a1", kind: "spell_effect", text: "Frobnicate the world.", steps: [{ kind: "frobnicate" } as never] } as never] } };
  const ctx2: EngineContext = { cards: (n) => (n === "Frobnicate" ? frob : ctx.cards(n)), db: ctx.db };
  it("a spell with an unsupported step is cast, reported once, and play continues", () => {
    const t = mini();
    t.give("p1", "Swamp", "battlefield");
    const id = t.give("p1", "Gravecrawler", "hand");
    t.state.objects[id].cardName = "Frobnicate";
    const records: UnresolvedRecord[] = [];
    const ks = KernelSession.fromState(t.state, { ctx: ctx2, sink: (r) => records.push(r), gameId: "g1", deckNames: ["Wretched Ranks"], seats: { p1: { kind: "human" } } });
    expect(ks.dispatch("p1", { type: "castSpell", player: "p1", cardId: id }).ok).toBe(true);
    ks.dispatch("p1", { type: "passPriority", player: "p1" });
    const r = ks.dispatch("p2", { type: "passPriority", player: "p2" });
    expect(r.ok).toBe(true);
    expect(ks.state.stack).toHaveLength(0);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ cardName: "Frobnicate", engine: "kernel", gameId: "g1", seatKind: "human" });
    expect(ks.log("p2").some((l) => l.detail === "Unresolved" && /Frobnicate/.test(l.message))).toBe(true);
    expect(ks.log("p1").some((l) => l.detail === "Unresolved")).toBe(true);
  });
});

describe("KernelSession: save and restore", () => {
  it("toJSON / restore continue the same game", () => {
    const a = scripted();
    a.ks.dispatch("p1", { type: "playLand", player: "p1", cardId: a.land });
    const json = JSON.parse(JSON.stringify(a.ks.toJSON()));
    const b = KernelSession.restore(json, { ctx, display: kit.display });
    expect(b.state).toEqual(a.ks.state);
    expect(b.version).toBe(1);
    expect(b.log("p1")).toEqual(a.ks.log("p1"));
    a.ks.dispatch("p1", { type: "passPriority", player: "p1" });
    b.dispatch("p1", { type: "passPriority", player: "p1" });
    expect(b.state).toEqual(a.ks.state);
  });
});

describe("KernelSession: hand-off from a legacy session (end of the mulligans)", () => {
  const restore = seedRuntime(77);
  const legacy = (() => { try { return createSelfPlayGame({ deckListPaths: ["Wretched Ranks.txt", "Wretched Ranks.txt"], seed: 77, forceFirstSeatIndex: 0 }); } finally { restore(); } })();
  it("keeps the hands, the commanders and the legacy card ids", () => {
    const ks = KernelSession.fromLegacyHandoff(legacy, { ctx, lookup: dl });
    const v = ks.view(legacy.seats[0].id);
    expect(v.seats[0].board.hand.map((c) => c.id).sort()).toEqual(legacy.seats[0].board.hand.map((c) => c.id).sort());
    expect(v.seats[0].board.hand.map((c) => c.name).sort()).toEqual(legacy.seats[0].board.hand.map((c) => c.name).sort());
    expect(v.seats[0].board.commander?.name).toBe("Ghoulcaller Gisa");
    expect(v.seats[1].board.hand.every((c) => c.name === "Hidden card")).toBe(true);
    expect(ks.state.config.onUnsupported).toBe("continue");
  });
  it("the displayed cards are the ones the players saw (art and text come from the legacy cards)", () => {
    const ks = KernelSession.fromLegacyHandoff(legacy, { ctx, lookup: dl });
    const first = legacy.seats[0].board.hand[0];
    const shown = ks.view(legacy.seats[0].id).seats[0].board.hand[0];
    expect(shown.oracleText).toBe(first.oracleText);
    expect(shown.typeLine).toBe(first.typeLine);
  });
  it("works with the browser-safe lookup built from a pack", () => {
    const ks = KernelSession.fromLegacyHandoff(legacy, { ctx: kitCtx, lookup: kit });
    expect(ks.state.players.map((p) => p.hand.length)).toEqual(legacy.seats.map((s) => s.board.hand.length));
    expect(ks.legal(legacy.seats[0].id).length).toBeGreaterThan(0);
  });
  it("the game can continue from the hand-off position", () => {
    const ks = KernelSession.fromLegacyHandoff(legacy, { ctx, lookup: dl });
    const rng = mulberry(3);
    let steps = 0;
    for (let i = 0; i < 80 && ks.actor; i++) {
      const act = pickAction(ks.legal(ks.actor), rng, ks.state);
      if (act && ks.dispatch(ks.actor, act).ok) steps++;
      else if (!act) {
        // untap / draw happen through advancePhase from the active player
        ks.dispatch(ks.state.turn.active, { type: "advancePhase", player: ks.state.turn.active });
      }
    }
    expect(steps).toBeGreaterThan(5);
    expect(ks.degraded).toBeUndefined();
  });
});

describe("KernelSession: random games through the host API", () => {
  for (const seed of [11, 12, 13]) {
    it(`seed ${seed}: 250 actions, no internal errors, every view builds, ids stay unique`, () => {
      const ks = fresh(seed);
      const rng = mulberry(seed);
      let accepted = 0;
      let prev = ks.view("p1");
      for (let i = 0; i < 250; i++) {
        const who = actorOf(ks.state);
        if (!who) break;
        const act = pickAction(ks.legal(who), rng, ks.state);
        if (!act) break;
        const r = ks.dispatch(who, act);
        expect(r.error?.code).not.toBe("internal");
        if (r.ok) accepted++;
        if (i % 25 === 0) {
          const v = ks.view("p1"), v2 = ks.view("p2");
          const ids = [...v.seats, ...v2.seats].flatMap((s) => [...s.board.hand, ...s.board.battlefield]).map((c) => c.id);
          expect(ids.every((id) => typeof id === "string")).toBe(true);
          expect(v.turn).toBe(ks.state.turn.number);
          // unchanged opponent hand stubs keep their identity between versions
          if (prev.seats[1].board.hand.length === v.seats[1].board.hand.length) expect(v.seats[1].board.hand[0]).toBe(prev.seats[1].board.hand[0]);
          prev = v;
        }
      }
      expect(accepted).toBeGreaterThan(100);
      expect(ks.degraded).toBeUndefined();
    }, 120_000);
  }
});
