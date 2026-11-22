import { describe, expect, it } from "vitest";
import { heuristicBrain } from "../../lib/selfplay/brains";
import { createSelfPlayGame, playGame, seedRuntime } from "../../lib/selfplay/orchestrator";
import { INTENT_SPECS, GUEST_INTENT_NAMES } from "../../lib/multiplayer/intentSpecs";
import type { GameSession, PlayerSeat, VisibleCard } from "../../lib/types";
import { loadDraftLookup } from "./draftLookup";
import { toKernelState, ADAPTER_COVERAGE } from "./adapter";
import { INTENT_COVERAGE, mapIntent, mapObserverAction, runMapped } from "./actions";
import { compareKernelStates, compareIntent, diffSnapshots, snapshotKernel } from "./compare";
import { KernelObserver } from "./observer";
import { createEngine } from "../engine";
import type { Diff } from "./types";

const lookup = loadDraftLookup();

const card = (id: string, name: string, typeLine: string, extra: Partial<VisibleCard> = {}): VisibleCard =>
  ({ id, name, typeLine, oracleText: "", manaValue: 0, colors: [], role: "spell", zone: "hand", ...extra }) as VisibleCard;
type SeatOpts = Partial<PlayerSeat> & { hand?: VisibleCard[]; battlefield?: VisibleCard[]; library?: VisibleCard[]; graveyard?: VisibleCard[]; commander?: VisibleCard };
const seat = (id: string, p: SeatOpts = {}): PlayerSeat =>
  ({ id, name: id, kind: "agent", life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }, library: p.library ?? [], board: { hand: p.hand ?? [], battlefield: p.battlefield ?? [], graveyard: p.graveyard ?? [], ...(p.commander ? { commander: p.commander } : {}) }, ...(p.poison ? { poison: p.poison } : {}) }) as PlayerSeat;
const session = (seats: PlayerSeat[], extra: Partial<GameSession> = {}): GameSession =>
  ({ id: "t", createdAt: "", status: "playing", activePlayerId: seats[0].id, phase: "precombat main phase", turn: 3, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra }) as GameSession;

describe("adapter round trip", () => {
  const s = session([
    seat("a", {
      library: [card("a-l1", "Forest", "Basic Land - Forest"), card("a-l2", "Island", "Basic Land - Island")],
      hand: [card("a-h1", "Lightning Bolt", "Instant", { manaCost: "{R}", manaValue: 1 })],
      battlefield: [
        card("a-b1", "Llanowar Elves", "Creature - Elf Druid", { power: "1", toughness: "1", tapped: true, counters: [{ kind: "+1/+1", count: 2 }], zone: "battlefield" }),
        card("a-b2", "Sol Ring", "Artifact", { zone: "battlefield", summoningSick: false }),
        card("a-b3", "Treasure", "Token Artifact - Treasure", { token: true, zone: "battlefield" })
      ],
      graveyard: [card("a-g1", "Counterspell", "Instant", { zone: "graveyard" })],
      commander: card("a-c1", "Meren of Clan Nel Toth", "Legendary Creature - Human Shaman", { power: "3", toughness: "4", commanderTax: 2, zone: "command" })
    }),
    seat("b", { battlefield: [card("b-b1", "Plains", "Basic Land - Plains", { zone: "battlefield" })], library: [card("b-l1", "Swamp", "Basic Land - Swamp")] })
  ]);

  it("keeps zones, ids, tapped, counters, commander", () => {
    const r = toKernelState(s, { lookup });
    const st = r.state;
    expect(st.players.map((p) => p.id)).toEqual(["a", "b"]);
    expect(st.players[0].library).toHaveLength(2);
    expect(st.players[0].hand).toHaveLength(1);
    expect(st.players[0].graveyard).toHaveLength(1);
    expect(st.players[0].command).toHaveLength(1);
    expect(st.battlefield).toHaveLength(4);
    const elves = st.objects[r.toKernel.get("a-b1")!];
    expect(elves.tapped).toBe(true);
    expect(elves.counters).toEqual({ "+1/+1": 2 });
    expect(st.objects[r.toKernel.get("a-b3")!].token?.name).toBe("Treasure");
    expect(st.objects[r.toKernel.get("a-c1")!].isCommander).toBe(true);
    expect(st.players[0].commanderCasts[r.toKernel.get("a-c1")!]).toBe(1);
    for (const [legacy, kid] of r.toKernel) expect(r.toLegacy.get(kid)).toBe(legacy);
    expect(st.turn).toEqual({ number: 3, active: "a", phase: "precombat_main" });
    expect(st.stack).toEqual([]);
  });

  it("reports gaps instead of silently dropping data", () => {
    const s2 = session([seat("a", { poison: 3 }), seat("b")]);
    const r = toKernelState(s2, { lookup });
    expect(r.gaps.map((g) => g.field)).toContain("seat.poison");
  });

  it("is a pure read of the session", () => {
    const before = JSON.stringify(s);
    toKernelState(s, { lookup });
    expect(JSON.stringify(s)).toBe(before);
  });

  it("documents every guest intent", () => {
    expect(Object.keys(INTENT_COVERAGE).sort()).toEqual([...GUEST_INTENT_NAMES].sort());
    expect(Object.keys(INTENT_SPECS).length).toBe(GUEST_INTENT_NAMES.length);
    expect(ADAPTER_COVERAGE.some((c) => c.status === "unmapped")).toBe(true);
  });
});

describe("compare normalisation", () => {
  const base = session([seat("a", { hand: [card("h1", "Lightning Bolt", "Instant"), card("h2", "Counterspell", "Instant")] }), seat("b")]);
  const reordered = session([seat("a", { hand: [card("x9", "Counterspell", "Instant"), card("x8", "Lightning Bolt", "Instant")] }), seat("b")]);

  it("ignores ids and order of unordered zones", () => {
    const a = toKernelState(base, { lookup }).state, b = toKernelState(reordered, { lookup }).state;
    expect(compareKernelStates(a, b, lookup)).toEqual([]);
  });

  it("flags life and zone contents by field", () => {
    const a = toKernelState(base, { lookup });
    const b = structuredClone(a.state);
    b.players[0].life = 37;
    b.players[0].hand.pop();
    const fields = diffSnapshots(snapshotKernel(a.state, lookup), snapshotKernel(b, lookup)).map((d) => d.field);
    expect(fields).toContain("life");
    expect(fields).toContain("zone:hand");
  });

  it("a legacy-accepted action the kernel refuses is kernel_rejected_legal_action; an unknown action is unmapped_action", () => {
    const ctx = createEngine(lookup.lookup, lookup.db).ctx;
    const bolt = card("h1", "Lightning Bolt", "Instant", { manaCost: "{R}", manaValue: 1 });
    const s0 = session([seat("a", { hand: [bolt] }), seat("b")]);
    const s1 = session([seat("a", { graveyard: [bolt] }), seat("b", {})]);
    const r = compareIntent(s0, s1, { seatId: "a", turn: 3, phase: "precombat main phase", actionType: "cast_spell", cardId: "h1", manaPayment: { seatId: "a", sourceIds: [], totalCost: 1 } }, { lookup, ctx });
    expect(r.outcome.diffs.map((d) => d.category)).toContain("kernel_rejected_legal_action");
    const u = compareIntent(s0, s1, { seatId: "a", turn: 3, phase: "precombat main phase", actionType: "activate_ability" }, { lookup, ctx });
    expect(u.outcome.diffs.map((d) => d.category)).toContain("unmapped_action");
  });

  it("kernel_accepted_illegal_action when the legacy engine refused a land the kernel allows", () => {
    const ctx = createEngine(lookup.lookup, lookup.db).ctx;
    const land = card("h1", "Forest", "Basic Land - Forest");
    const s0 = session([seat("a", { hand: [land] }), seat("b")]);
    const mapped = mapIntent("onPlayCard", ["a", "h1"], "a", s0);
    const r = compareIntent(s0, s0, { seatId: "a", turn: 3, phase: "precombat main phase", actionType: "onPlayCard", cardId: "h1" }, { lookup, ctx, mapped, legacyAccepted: false });
    expect(r.outcome.diffs.map((d) => d.category)).toEqual(["kernel_accepted_illegal_action"]);
  });

  it("a land play that legacy and kernel agree on has no diff", () => {
    const ctx = createEngine(lookup.lookup, lookup.db).ctx;
    const land = card("h1", "Forest", "Basic Land - Forest");
    const s0 = session([seat("a", { hand: [land] }), seat("b")]);
    const s1 = session([seat("a", { battlefield: [{ ...land, zone: "battlefield", enteredTurn: 3, enteredFrom: "hand" } as VisibleCard] }), seat("b")]);
    const r = compareIntent(s0, s1, { seatId: "a", turn: 3, phase: "precombat main phase", actionType: "play_land", cardId: "h1" }, { lookup, ctx });
    expect(r.outcome.diffs.filter((d) => d.category !== "adapter_gap")).toEqual([]);
    expect(r.outcome.kind).toBe("agree");
    const run = runMapped(toKernelState(s0, { lookup }), r.mapped, ctx);
    expect(run.error).toBeUndefined();
  });
});

describe("scripted two-deck game through the observer", () => {
  const play = async (withObserver: boolean) => {
    const restore = seedRuntime(11);
    try {
      const s = createSelfPlayGame({ deckListPaths: ["Meren.txt", "Saheeli.txt"], seatNames: ["Meren", "Saheeli"], forceFirstSeatIndex: 0, seed: 11 });
      const diffs: Diff[] = [];
      const obs = withObserver ? new KernelObserver({ lookup, game: 0, seed: 11, decks: ["Meren", "Saheeli"], sink: (d) => diffs.push(d) }) : undefined;
      if (obs) obs.keepOutcomes = true;
      const brains = { [s.seats[0].id]: heuristicBrain, [s.seats[1].id]: heuristicBrain };
      const res = await playGame(s, brains, { turnCap: 4, onAction: obs ? (p, n, m) => obs.onAction(p, n, { ...m, seatId: m.seatId ?? "" }) : undefined });
      obs?.finish();
      return { res, obs, diffs };
    } finally { restore(); }
  };
  const board = (r: { res: { session: GameSession } }) => JSON.stringify(r.res.session.seats.map((x) => [x.life, x.board.battlefield.map((c) => c.name), x.board.hand.map((c) => c.name)]));

  it("observes without changing the game, never throws, and logs typed diffs", async () => {
    const a = await play(false);
    const b = await play(true);
    expect(board(b)).toBe(board(a));
    expect(b.obs!.aggregate.actions).toBeGreaterThan(10);
    expect(b.diffs.some((d) => d.category === "observer_error")).toBe(false);
    for (const d of b.diffs) expect(typeof d.category).toBe("string");
    const compared = b.obs!.outcomes.filter((o) => o.kind !== "skipped");
    expect(compared.length).toBeGreaterThan(5);
    expect(compared.filter((o) => o.kind === "agree").length / compared.length).toBeGreaterThan(0.4);
  }, 120000);
});

describe("round 1 fixes", () => {
  it("tokens written with an ASCII hyphen keep their subtypes (a Treasure token has its mana ability, an Insect is an Insect)", () => {
    const s = session([seat("a", { battlefield: [card("a-t", "Treasure", "Token Artifact - Treasure", { token: true, zone: "battlefield" }), card("a-i", "Insect Token", "Token Creature - Insect", { token: true, zone: "battlefield", power: "1", toughness: "1" })] }), seat("b")]);
    const r = toKernelState(s, { lookup });
    expect(r.state.objects[r.toKernel.get("a-t")!].token?.subtypes).toEqual(["Treasure"]);
    expect(r.state.objects[r.toKernel.get("a-t")!].token?.abilities?.some((a) => a.kind === "mana")).toBe(true);
    expect(r.state.objects[r.toKernel.get("a-i")!].token?.subtypes).toEqual(["Insect"]);
  });

  it("a card whose data has a toughness but a non-numeric power keeps the toughness (Callaphe)", () => {
    const dl = loadDraftLookup();
    dl.register({ name: "Callaphe, Beloved of the Sea", typeLine: "Legendary Enchantment Creature — Demigod", power: "*", toughness: "3" });
    expect(dl.lookup("Callaphe, Beloved of the Sea")?.toughness).toBe(3);
  });

  it("experience counters are mapped onto the player", () => {
    const a = seat("a"); (a as PlayerSeat).experienceCounters = 3;
    const r = toKernelState(session([a, seat("b")]), { lookup });
    expect(r.state.players[0].counters).toEqual({ experience: 3 });
    expect(r.gaps.some((g) => g.field === "seat.experienceCounters")).toBe(false);
  });

  it("X is split over every {X} symbol of the cost ({X}{X}{X}{R}{R}: 17 mana paid = X 5)", () => {
    const crackle = card("a-c", "Crackle with Power", "Sorcery", { manaCost: "{X}{X}{X}{R}{R}", manaValue: 2 });
    const s0 = session([seat("a", { hand: [crackle] }), seat("b")]);
    const m = mapIntentFromMeta(s0, { seatId: "a", turn: 3, phase: "precombat main phase", actionType: "cast_spell", cardId: "a-c", manaPayment: { seatId: "a", sourceIds: [], totalCost: 17 } });
    expect(m.kind === "cast" && m.x).toBe(5);
  });

  it("a refused payment carries a board dump (sources, pool, X, cost) so it can be judged from the log", () => {
    const bf = [card("a-m", "Mountain", "Basic Land - Mountain", { zone: "battlefield", tapped: true }), card("a-i", "Island", "Basic Land - Island", { zone: "battlefield" })];
    const spell = card("a-s", "Counterspell", "Instant", { manaCost: "{U}{U}", manaValue: 2 });
    const s0 = session([seat("a", { hand: [spell], battlefield: bf }), seat("b")]);
    const meta = { seatId: "a", turn: 3, phase: "precombat main phase", actionType: "cast_spell", cardId: "a-s", manaPayment: { seatId: "a", sourceIds: ["a-m", "a-i"], totalCost: 2 } };
    const obs = new KernelObserver({ lookup, keepOutcomes: undefined } as never);
    const res = compareIntent(s0, s0, meta, { lookup, ctx: obs.ctx });
    const d = res.outcome.diffs.find((x) => x.category === "kernel_rejected_legal_action");
    expect(d).toBeDefined();
    const board = (d!.context as { board: Record<string, unknown> }).board;
    expect(board).toMatchObject({ cast: "Counterspell", manaCost: "{U}{U}", totalPaidByLegacy: 2 });
    expect(board.tappedSources).toEqual(expect.arrayContaining([expect.stringContaining("Mountain")]));
    expect(board.untappedSources).toEqual(expect.arrayContaining([expect.stringContaining("Island")]));
  });
});

const mapIntentFromMeta = (s0: GameSession, meta: Parameters<typeof mapObserverAction>[0]) => mapObserverAction(meta, s0, s0);

describe("decision hints read the legacy choice off the legacy result", () => {
  it("the permanent that left the battlefield is the chosen target; an untouched one is not", async () => {
    const { cardChanged, playerChanged } = await import("./hints");
    const a = card("a-1", "Bear", "Creature - Bear", { zone: "battlefield", power: "2", toughness: "2" });
    const b = card("a-2", "Wolf", "Creature - Wolf", { zone: "battlefield", power: "2", toughness: "2" });
    const s0 = session([seat("a", { battlefield: [a, b] }), seat("b")]);
    const s1 = session([seat("a", { battlefield: [b], graveyard: [a] }), seat("b")]);
    expect(cardChanged(s0, s1, "a-1")).toBe(true);
    expect(cardChanged(s0, s1, "a-2")).toBe(false);
    const s2 = session([seat("a", { battlefield: [a, b] }), { ...seat("b"), life: 37 }]);
    expect(playerChanged(s0, s2, "b")).toBe(true);
    expect(playerChanged(s0, s2, "a")).toBe(false);
  });
});
