import { describe, expect, it } from "vitest";
import { ctx, dl, mini, realGame } from "./testgame";
import { playRandom } from "./randomPlay";
import { SPECTATOR, legacyPhase, toSession, type ToSessionEnv } from "./toSession";
import { decisionView, stackViews, toTableState } from "./tableState";
import { formatEvent, namesFrom } from "./eventLog";
import { packKit } from "./cardPack";
import { buildPack } from "./nodePack";
import { toKernelState } from "../observer/adapter";
import { compareKernelStates } from "../observer/compare";
import { viewFor } from "../engine/view";
import { resolve } from "../engine/resolve";
import { effectivePower, effectiveToughness } from "../../lib/counters";
import { isSummoningSick } from "../../lib/summoningSickness";
import { hasKeyword } from "../../engine/shared";
import type { GameState } from "../engine/types";
import type { GameSession, VisibleCard } from "../../lib/types";

const kit = packKit([buildPack("wretched-ranks", { catalog: false })]);
const env: ToSessionEnv = { ctx, display: kit.display };
const allCards = (s: GameSession): VisibleCard[] => s.seats.flatMap((x) => [...x.board.hand, ...x.board.battlefield, ...(x.board.graveyard ?? []), ...(x.board.exile ?? []), ...(x.library ?? []), ...(x.board.commander ? [x.board.commander] : [])]);
const seatOf = (s: GameSession, id: string) => s.seats.find((x) => x.id === id)!;
const bfByName = (s: GameSession, name: string) => s.seats.flatMap((x) => x.board.battlefield).find((c) => c.name === name)!;

describe("toSession: header, seats and zones", () => {
  const s = realGame(undefined, { seed: 3 });
  const ses = toSession(s, "p1", env);
  it("turn, phase, active player and status", () => {
    expect(ses.turn).toBe(1);
    expect(ses.phase).toBe("precombat main phase");
    expect(ses.activePlayerId).toBe("p1");
    expect(ses.status).toBe("playing");
    expect(ses.xmage.enabled).toBe(false);
  });
  it("maps every kernel phase to a legacy phase name", () => {
    for (const ph of ["untap", "upkeep", "draw", "precombat_main", "beginning_of_combat", "declare_attackers", "declare_blockers", "combat_damage", "end_of_combat", "postcombat_main", "end_step", "cleanup"]) expect(legacyPhase(ph)).toMatch(/step|phase/);
    expect(legacyPhase("first_strike_damage")).toBe("combat damage step");
  });
  it("seats: ids, names, life, the viewer is the only human", () => {
    expect(ses.seats.map((x) => x.id)).toEqual(["p1", "p2"]);
    expect(ses.seats.map((x) => x.life)).toEqual([40, 40]);
    expect(ses.seats.map((x) => x.kind)).toEqual(["human", "agent"]);
    expect(toSession(s, "p2", env).seats.map((x) => x.kind)).toEqual(["agent", "human"]);
    expect(toSession(s, SPECTATOR, env).seats.map((x) => x.kind)).toEqual(["human", "agent"]);
  });
  it("explicit seat metadata wins", () => {
    const x = toSession(s, "p1", { ...env, seats: { p2: { kind: "agent", agentName: "Veyra" }, p1: { kind: "human" } } });
    expect(seatOf(x, "p2").agentName).toBe("Veyra");
  });
  it("zone counts", () => {
    const me = seatOf(ses, "p1");
    expect(me.zones).toMatchObject({ hand: 7, library: 99 - 7, battlefield: 0, command: 1 });
    expect(me.library).toHaveLength(92);
    expect(me.board.hand).toHaveLength(7);
    expect(me.board.commander?.name).toBe("Ghoulcaller Gisa");
    expect(me.board.commander?.commander).toBe(true);
  });
  it("the table cards carry art / oracle text from the pack", () => {
    const g = seatOf(ses, "p1").board.commander!;
    expect(g.typeLine).toContain("Legendary Creature");
    expect(g.oracleText.length).toBeGreaterThan(10);
    expect(g.manaValue).toBe(5);
    expect(g.role).toBeTruthy();
  });
  it("a game over becomes status complete with a winner", () => {
    const o = { ...s, gameOver: { winner: "p2", reason: "x" } } as GameState;
    expect(toSession(o, "p1", env)).toMatchObject({ status: "complete", winnerSeatId: "p2" });
  });
  it("the log is passed through", () => {
    const log = [{ id: "e1", at: "", message: "hello" }];
    expect(toSession(s, "p1", { ...env, log }).events).toBe(log);
  });
});

describe("toSession: redaction", () => {
  const s = realGame(undefined, { seed: 5 });
  it("the opponent's hand and every library are stubs of the right size", () => {
    const ses = toSession(s, "p1", env);
    const opp = seatOf(ses, "p2");
    expect(opp.board.hand).toHaveLength(7);
    expect(opp.board.hand.every((c) => c.id.startsWith("hidden:p2:hand:") && c.name === "Hidden card" && c.role === "hidden")).toBe(true);
    expect(opp.library).toHaveLength(92);
    expect(opp.library!.every((c) => c.name === "Hidden card")).toBe(true);
    expect(seatOf(ses, "p1").library!.every((c) => c.name === "Hidden card")).toBe(true);
    expect(opp.zones.hand).toBe(7);
  });
  it("no name of a hidden card appears anywhere in the JSON", () => {
    const ses = toSession(s, "p1", env);
    const json = JSON.stringify(ses);
    const hidden = [...s.players[1].hand, ...s.players[0].library, ...s.players[1].library].map((id) => s.objects[id].cardName).filter((n) => n !== "Swamp" && !s.players[0].hand.some((h) => s.objects[h].cardName === n) && n !== "Ghoulcaller Gisa");
    for (const n of new Set(hidden)) expect(json, n).not.toContain(n);
    for (const id of [...s.players[1].hand, ...s.players[1].library]) expect(json).not.toContain(`"${id}"`);
  });
  it("a spectator sees no hand at all", () => {
    const ses = toSession(s, SPECTATOR, env);
    for (const seat of ses.seats) expect(seat.board.hand.every((c) => c.name === "Hidden card")).toBe(true);
  });
  it("a face-down permanent of another player is anonymous", () => {
    const t = mini();
    const id = t.give("p2", "Gravecrawler", "battlefield");
    t.state.objects[id].faceDown = true;
    const mine = toSession(t.state, "p2", { ...env });
    const theirs = toSession(t.state, "p1", { ...env });
    expect(mine.seats[1].board.battlefield[0]).toMatchObject({ name: "Face-down creature", faceDownCardName: "Gravecrawler" });
    expect(theirs.seats[1].board.battlefield[0].name).toBe("Face-down card");
    expect(JSON.stringify(theirs)).not.toContain("Gravecrawler");
    expect(effectivePower(theirs.seats[1].board.battlefield[0])).toBe(2);
  });
  it("the top card of a library the owner may look at is visible to the owner only", () => {
    const t = mini();
    t.give("p1", "Gravecrawler", "library"); t.give("p1", "Swamp", "library");
    t.state = { ...t.state, topLookers: ["p1"] };
    expect(toSession(t.state, "p1", env).seats[0].library![0].name).toBe("Swamp");
    expect(toSession(t.state, "p2", env).seats[0].library![0].name).toBe("Hidden card");
  });
});

describe("toSession: battlefield cards", () => {
  it("effective power / toughness through effectivePower even with counters and a lord", () => {
    const t = mini();
    t.give("p1", "Bad Moon", "battlefield");
    t.give("p1", "Gravecrawler", "battlefield", { counters: { "+1/+1": 2 } });
    t.give("p1", "Undead Augur", "battlefield");
    const ses = toSession(t.state, "p1", env);
    const g = bfByName(ses, "Gravecrawler");
    expect([effectivePower(g), effectiveToughness(g)]).toEqual([5, 4]); // 2/1 + Bad Moon + two counters
    expect(g.counters).toEqual([{ kind: "+1/+1", count: 2 }]);
    const a = bfByName(ses, "Undead Augur");
    expect([effectivePower(a), effectiveToughness(a)]).toEqual([3, 3]); // 2/2 black Zombie Wizard + Bad Moon
  });
  it("the displayed numbers equal the kernel's chars for random positions", { timeout: 60000 }, () => {
    let checked = 0;
    for (const seed of [1, 2]) {
      const end = playRandom(realGame(undefined, { seed, upkeep: true }), ctx, seed, 200);
      const ses = toSession(end, "p1", env);
      for (const seat of ses.seats) for (const c of seat.board.battlefield) {
        if (c.power === undefined) continue;
        const v = (await_view(end, c.id));
        expect([effectivePower(c), effectiveToughness(c)], c.name).toEqual([v.power, v.toughness]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
  it("tapped, damage and summoning sickness (the legacy predicate agrees)", () => {
    const t = mini();
    t.give("p1", "Undead Augur", "battlefield", { fresh: true, tapped: true });
    t.give("p1", "Gravecrawler", "battlefield");
    t.state.objects[t.state.battlefield[1]].damage = 1;
    const ses = toSession(t.state, "p1", env);
    const sick = bfByName(ses, "Undead Augur"), ok = bfByName(ses, "Gravecrawler");
    expect(sick).toMatchObject({ tapped: true, summoningSick: true });
    expect(isSummoningSick(sick)).toBe(true);
    expect(isSummoningSick(ok)).toBe(false);
    expect(ok.damage).toBe(1);
  });
  it("granted keywords and keyword loss show up where hasKeyword reads them", () => {
    const t = mini();
    const id = t.give("p1", "Gravecrawler", "battlefield");
    const o = t.state.objects[id];
    t.state.effects.push({ id: "e1", timestamp: 99, objectId: id, objectTimestamp: o.timestamp, grant: "flying", until: "end_of_turn" });
    const ses = toSession(t.state, "p1", env);
    const c = bfByName(ses, "Gravecrawler");
    expect(c.grantedKeywords).toContain("flying");
    expect(hasKeyword(c, "flying")).toBe(true);
    expect(hasKeyword(c, "haste")).toBe(false);
  });
  it("loses all abilities", () => {
    const t = mini();
    const id = t.give("p1", "Undead Augur", "battlefield");
    t.state.effects.push({ id: "e1", timestamp: 99, objectId: id, objectTimestamp: t.state.objects[id].timestamp, lose: "all abilities", until: "end_of_turn" });
    const c = bfByName(toSession(t.state, "p1", env), "Undead Augur");
    expect(c.abilitiesStripped).toBe(true);
  });
  it("attachments point at their host", () => {
    const t = mini();
    const host = t.give("p1", "Gravecrawler", "battlefield");
    const lw = t.give("p1", "Lashwrithe", "battlefield");
    t.state.objects[lw].attachedTo = host; t.state.objects[lw].attachedToTs = t.state.objects[host].timestamp;
    const ses = toSession(t.state, "p1", env);
    expect(bfByName(ses, "Lashwrithe").attachedToId).toBe(host);
  });
  it("combat flags", () => {
    const t = mini();
    const atk = t.give("p1", "Gravecrawler", "battlefield");
    const blk = t.give("p2", "Undead Augur", "battlefield");
    t.state = { ...t.state, turn: { ...t.state.turn, phase: "beginning_of_combat" } };
    t.ok({ type: "passPriority", player: "p1" }); t.ok({ type: "passPriority", player: "p2" });
    t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: atk, defender: "p2" }] });
    t.ok({ type: "passPriority", player: "p1" }); t.ok({ type: "passPriority", player: "p2" });
    t.ok({ type: "declareBlockers", player: "p2", blocks: [{ blocker: blk, attacker: atk }] });
    const ses = toSession(t.state, "p1", env);
    expect(bfByName(ses, "Gravecrawler")).toMatchObject({ attacking: true, attackTargetId: "p2" });
    expect(bfByName(ses, "Undead Augur")).toMatchObject({ blocking: true, blockingTargetId: atk });
    expect(ses.phase).toBe("declare blockers step");
  });
  it("tokens: type line, stats, keywords in the text", () => {
    const t = mini();
    const id = t.give("p1", "Gravecrawler", "battlefield");
    const o = t.state.objects[id];
    o.token = { name: "Zombie", types: ["creature"], subtypes: ["Zombie"], colors: ["B"], power: 2, toughness: 2, keywords: ["menace"] };
    o.cardName = "Zombie";
    const c = bfByName(toSession(t.state, "p1", env), "Zombie");
    expect(c).toMatchObject({ token: true, typeLine: "Token Creature — Zombie", power: "2", toughness: "2" });
    expect(c.colors).toEqual(["B"]);
    expect(hasKeyword(c, "menace")).toBe(true);
  });
  it("a commander cast once costs 2 more (commanderTax) and moves out of the command zone", () => {
    const s = realGame(undefined, { seed: 3 });
    const cmd = s.players[0].command[0];
    const t = mini();
    t.state = s;
    t.state.players[0].commanderCasts[cmd] = 1;
    expect(toSession(t.state, "p1", env).seats[0].board.commander?.commanderTax).toBe(2);
  });
  it("monarch and poison / experience counters", () => {
    const t = mini();
    t.state = { ...t.state, monarch: "p2" };
    t.state.players[0].counters = { poison: 3, experience: 2 };
    const ses = toSession(t.state, "p1", env);
    expect(ses.monarchSeatId).toBe("p2");
    expect(seatOf(ses, "p1")).toMatchObject({ poison: 3, experienceCounters: 2 });
  });
  it("floating mana is published per seat", () => {
    const t = mini();
    t.state.players[0].manaPool.B = 2;
    expect(seatOf(toSession(t.state, "p1", env), "p1").floatingMana).toMatchObject({ B: 2 });
    expect(toTableState(t.state, "p1", env).manaPools.p1.B).toBe(2);
  });
});

// helper: effective view lookup without importing the engine in every test
import { effectiveView, legalActions } from "../engine/legal";
function await_view(state: GameState, id: string) { return effectiveView(state, id, ctx); }

describe("toSession: stable object identity", () => {
  it("the same state returns the very same session", () => {
    const s = realGame(undefined, { seed: 3 });
    const a = toSession(s, "p1", env);
    expect(toSession(s, "p1", env, a)).toBe(a);
  });
  it("after one action only what changed is a new object", () => {
    const t = mini();
    const land = t.give("p1", "Swamp", "hand"); t.give("p1", "Gravecrawler", "hand"); t.give("p2", "Swamp", "battlefield");
    const a = toSession(t.state, "p1", env);
    t.ok({ type: "playLand", player: "p1", cardId: land });
    const b = toSession(t.state, "p1", env, a);
    expect(b).not.toBe(a);
    expect(b.seats[1]).toBe(a.seats[1]); // the opponent did not change
    expect(b.seats[0].board.hand[0]).toBe(a.seats[0].board.hand[1]); // the other hand card is the same object
    expect(b.seats[1].board.battlefield[0]).toBe(a.seats[1].board.battlefield[0]);
    expect(b.seats[0].board.battlefield[0].id).toBe(land);
  });
  it("a card that changes (tapped) is a new object, its neighbours are not", () => {
    const t = mini();
    const a1 = t.give("p1", "Swamp", "battlefield"), a2 = t.give("p1", "Swamp", "battlefield");
    const a = toSession(t.state, "p1", env);
    const tap = legalActions(t.state, "p1", ctx).find((x) => x.objectId === a1 && x.isMana)!;
    t.ok(tap.action!);
    const b = toSession(t.state, "p1", env, a);
    expect(b.seats[0].board.battlefield.find((c) => c.id === a1)).not.toBe(a.seats[0].board.battlefield.find((c) => c.id === a1));
    expect(b.seats[0].board.battlefield.find((c) => c.id === a1)?.tapped).toBe(true);
    expect(b.seats[0].board.battlefield.find((c) => c.id === a2)).toBe(a.seats[0].board.battlefield.find((c) => c.id === a2));
  });
  it("card ids are the kernel ids, and legacyIds renames them", () => {
    const t = mini();
    const id = t.give("p1", "Swamp", "battlefield");
    expect(toSession(t.state, "p1", env).seats[0].board.battlefield[0].id).toBe(id);
    expect(toSession(t.state, "p1", { ...env, legacyIds: new Map([[id, "legacy-swamp-1"]]) }).seats[0].board.battlefield[0].id).toBe("legacy-swamp-1");
  });
  it("every card id in a session is unique", () => {
    const end = playRandom(realGame(undefined, { seed: 2, upkeep: true }), ctx, 2, 150);
    const ids = allCards(toSession(end, "p1", env)).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("toSession is a pure read", () => {
  it("does not mutate the state", () => {
    const end = playRandom(realGame(undefined, { seed: 4, upkeep: true }), ctx, 4, 120);
    const before = JSON.stringify(end);
    toSession(end, "p1", env); toSession(end, "p2", env); toSession(end, SPECTATOR, env);
    expect(JSON.stringify(end)).toBe(before);
  });
  it("is deterministic", () => {
    const end = playRandom(realGame(undefined, { seed: 4, upkeep: true }), ctx, 4, 120);
    expect(toSession(end, "p1", env)).toEqual(toSession(end, "p1", env));
  });
});

describe("round trip with the forward adapter (toKernelState(toSession(k)) ~ k)", () => {
  const positions: Array<[number, number]> = [[1, 40], [1, 120], [2, 80], [2, 200], [3, 60], [3, 160], [4, 100]];
  for (const [seed, steps] of positions) {
    it(`Wretched Ranks seed ${seed} after ${steps} actions`, () => {
      const k = playRandom(realGame(undefined, { seed, upkeep: true }), ctx, seed * 7, steps);
      for (const viewer of ["p1", "p2"]) {
        const ses = toSession(k, viewer, env);
        const back = toKernelState(ses, { lookup: dl, onUnsupported: "continue" }).state;
        const diffs = compareKernelStates(k, back, dl).filter((d) => !(d.field === "zone:hand" && d.seat !== viewer) && d.field !== "zone:library" && d.field !== "gameOver");
        expect(diffs, `viewer ${viewer}`).toEqual([]);
      }
    });
  }
  it("a position with attackers and a stack-free table", () => {
    const t = mini();
    t.give("p1", "Bad Moon", "battlefield");
    const a = t.give("p1", "Gravecrawler", "battlefield", { counters: { "+1/+1": 1 } });
    t.give("p2", "Undead Augur", "battlefield", { tapped: true });
    t.state = { ...t.state, turn: { ...t.state.turn, phase: "beginning_of_combat" } };
    t.ok({ type: "passPriority", player: "p1" }); t.ok({ type: "passPriority", player: "p2" });
    t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: a, defender: "p2" }] });
    const back = toKernelState(toSession(t.state, "p1", env), { lookup: dl }).state;
    expect(compareKernelStates(t.state, back, dl).filter((d) => d.field !== "gameOver")).toEqual([]);
  });
});

describe("stack, decisions and the log", () => {
  const setup = () => {
    const t = mini();
    t.give("p1", "Swamp", "battlefield"); t.give("p1", "Swamp", "battlefield");
    const victim = t.give("p2", "Gravecrawler", "battlefield");
    t.give("p2", "Undead Augur", "battlefield");
    const spell = t.give("p1", "Go for the Throat", "hand");
    return { t, victim, spell };
  };
  it("a pending targeting decision: options with cards for the owner, 'waiting for' for the others", () => {
    const { t } = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: t.state.players[0].hand[0] });
    const mine = toTableState(t.state, "p1", env);
    expect(mine.decision?.kind).toBe("choose_targets");
    expect(mine.decision?.options.map((o) => o.card?.name).sort()).toEqual(["Gravecrawler", "Undead Augur"]);
    expect(mine.decision?.cancellable).toBe(true);
    expect(mine.waitingFor).toBeUndefined();
    const theirs = toTableState(t.state, "p2", env);
    expect(theirs.decision).toBeUndefined();
    expect(theirs.waitingFor).toMatchObject({ player: "p1", kind: "choose_targets" });
    expect(JSON.stringify(theirs)).not.toContain("optionCount");
    expect(theirs.waitingFor).not.toHaveProperty("options");
  });
  it("a spell on the stack: panel entry with its target, required passes, mana pools", () => {
    const { t, victim } = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: t.state.players[0].hand[0] });
    t.answer({ ids: [victim] });
    const ts = toTableState(t.state, "p2", env);
    expect(ts.pendingAction).toMatchObject({ type: "spell", cardName: "Go for the Throat", actorSeatId: "p1" });
    expect(ts.pendingAction && ts.pendingAction.type === "spell" ? ts.pendingAction.description?.targets[0].label : "").toBe("Gravecrawler");
    expect(ts.stackActions).toEqual([]);
    expect(ts.session.stackSpellCardIds).toHaveLength(1);
    expect(ts.requiredPasses.sort()).toEqual(["p1", "p2"]);
    expect(ts.prioritySeatId).toBe("p1");
    t.ok({ type: "passPriority", player: "p1" });
    expect(toTableState(t.state, "p1", env).priorityPasses).toEqual(["p1"]);
    expect(stackViews(t.state, "p1", env)).toHaveLength(1);
  });
  it("declaring state is exposed", () => {
    const t = mini();
    t.give("p1", "Gravecrawler", "battlefield");
    t.state = { ...t.state, turn: { ...t.state.turn, phase: "beginning_of_combat" } };
    t.ok({ type: "passPriority", player: "p1" }); t.ok({ type: "passPriority", player: "p2" });
    const ts = toTableState(t.state, "p1", env);
    expect(ts.declaring).toEqual({ kind: "attackers", players: ["p1"] });
    expect(ts.prioritySeatId).toBeUndefined();
  });
  it("decisionView is empty without a pending decision", () => { expect(decisionView(mini().state, "p1", env)).toEqual({}); });
  it("event lines: viewer-safe text, bookkeeping events are skipped", () => {
    const { t } = setup();
    const view = viewFor(t.state, "p1");
    const n = namesFrom(view);
    expect(formatEvent({ type: "draw", seq: 0, player: "p2", hidden: true }, n)?.message).toBe("p2 draws a card.");
    expect(formatEvent({ type: "cast", seq: 0, player: "p1", id: "#1", name: "Go for the Throat" }, n)?.message).toBe("p1 casts Go for the Throat.");
    expect(formatEvent({ type: "phase_changed", seq: 0 }, n)).toBeUndefined();
    expect(formatEvent({ type: "tap", seq: 0, id: "#1" }, n)).toBeUndefined();
    expect(formatEvent({ type: "unresolved", seq: 0, message: "Swan Song: step copy not supported; that part was skipped", player: "p1" }, n)).toMatchObject({ detail: "Unresolved" });
    expect(formatEvent({ type: "life_loss", seq: 0, player: "p2", amount: 3 }, n)?.message).toBe("p2 loses 3 life.");
  });
  it("a hidden card in an event is 'a card'", () => {
    const { t } = setup();
    const n = namesFrom(viewFor(t.state, "p1"));
    const secret = t.give("p2", "Grave Titan", "hand");
    const n2 = namesFrom(viewFor(t.state, "p1"));
    expect(formatEvent({ type: "discard", seq: 0, player: "p2", id: secret }, n2)?.message).toBe("p2 discards a card.");
    void n;
  });
  it("resolve keeps working on the same state the session was built from", () => {
    const { t } = setup();
    expect(resolve(t.state, { type: "passPriority", player: "p1" }, ctx).error).toBeUndefined();
  });
});
