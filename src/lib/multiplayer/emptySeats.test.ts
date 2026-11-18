import { describe, expect, it } from "vitest";
import { createInitialConfigs, playingConfigs, seatRolePatch, validateConfigsForPlay, applyDefaultDecks, type SeatConfig } from "@/components/DeckSetup";
import { runStateBasedActionsPass } from "@/components/AppFlow";
import { nextSeatId, rollForStartingSeat } from "@/engine/turnFlow";
import { buildGuestSession } from "./view";
import { SPECTATOR_VIEWER } from "./view";
import { activeSeats, assignSlots, missingGuests, REMOTE_UNASSIGNED } from "./seatMap";
import { buildLobbyMessage, lobbyBlockers, type LobbyConfig } from "./lobby";
import type { GuestInfo } from "./protocol";
import type { GameSession, PlayerSeat } from "@/lib/types";

const seat = (id: string, kind: PlayerSeat["kind"], extra: Partial<PlayerSeat> = {}): PlayerSeat =>
  ({ id, name: id, kind, life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield: [] }, ...extra }) as PlayerSeat;
const four = () => [seat("a", "human"), seat("b", "agent"), seat("c", "agent"), seat("d", "agent")];
const session = (seats: PlayerSeat[]): GameSession => ({ id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] }) as GameSession;
const g = (seatId: string, connected = true): GuestInfo => ({ seatId, displayName: seatId, connected });
const legalDeck = { validation: { legal: true, errors: [], warnings: [] } } as unknown as SeatConfig["deck"];

function settle(input: GameSession): GameSession {
  let cur = input;
  for (let i = 0; i < 10; i += 1) {
    const r = runStateBasedActionsPass(cur);
    cur = r.session;
    if (!r.changed) break;
  }
  return cur;
}

describe("host setup: seats 1-3 default to Empty", () => {
  it("multiplayer host: only the host seat plays; the normal app keeps all four", () => {
    const mp = createInitialConfigs(four(), { emptyNonHostSeats: true });
    expect(mp.map((c) => c.empty ?? false)).toEqual([false, true, true, true]);
    expect(playingConfigs(mp).map((c) => c.seatId)).toEqual(["a"]);
    expect(playingConfigs(createInitialConfigs(four())).length).toBe(4);
  });
  it("the selector switches a seat between empty / agent / open and back", () => {
    const base = createInitialConfigs(four(), { emptyNonHostSeats: true })[1];
    expect(seatRolePatch("agent")).toMatchObject({ empty: false, kind: "agent", remoteSlot: undefined });
    expect(seatRolePatch("remote")).toMatchObject({ empty: false, kind: "human", remoteSlot: REMOTE_UNASSIGNED });
    expect(seatRolePatch("empty")).toMatchObject({ empty: true, kind: "agent", remoteSlot: undefined });
    expect({ ...base, ...seatRolePatch("remote"), ...seatRolePatch("empty") }.remoteSlot).toBeUndefined();
  });
  it("empty seats are ignored by validation and by default-deck filling", () => {
    const configs = createInitialConfigs(four(), { emptyNonHostSeats: true });
    configs[0] = { ...configs[0], deck: legalDeck, status: "ready" };
    const v = validateConfigsForPlay(configs);
    expect(v.ready).toBe(true);
    expect(v.configs[1].empty).toBe(true);
    const lib = [{ id: "decks/foundations/x", label: "Wretched Ranks", commander: "X", deckList: "1 A" }];
    expect(applyDefaultDecks(configs, lib)[1].deckList).toBe("");
  });
  it("host seat with no valid deck still blocks play", () => {
    const configs = createInitialConfigs(four(), { emptyNonHostSeats: true });
    expect(validateConfigsForPlay(configs).ready).toBe(false);
  });
});

describe("lobby readiness with empty seats", () => {
  const base = (id: string, over: Partial<LobbyConfig> = {}): LobbyConfig => ({ seatId: id, name: id, kind: "agent", mode: "commander", commander: "", deckList: "", status: "empty", message: "", activity: [], ...over });
  it("empty seats never block PLAY or need guests", () => {
    const configs = [base("a", { kind: "human" }), base("b", { empty: true }), base("c", { empty: true }), base("d", { empty: true })];
    expect(lobbyBlockers(configs, [])).toEqual([]);
    expect(missingGuests(configs, [])).toEqual([]);
    expect(assignSlots(configs, [g("guest-1")])).toEqual({});
  });
  it("an open friend seat still blocks, an empty one beside it does not", () => {
    const configs = [base("a", { kind: "human" }), base("b", { kind: "human", remoteSlot: REMOTE_UNASSIGNED }), base("c", { empty: true })];
    expect(lobbyBlockers(configs, []).map((b) => b.seatId)).toEqual(["b"]);
    expect(missingGuests(configs, [])).toEqual(["b"]);
  });
  it("guests only see seats that exist", () => {
    const configs = [base("a", { kind: "human" }), base("b", { kind: "human", remoteSlot: REMOTE_UNASSIGNED }), base("c", { empty: true }), base("d", { kind: "agent" })];
    const msg = buildLobbyMessage({ configs, guests: [g("guest-1")], slot: "guest-1", hostName: "H", hostDecks: [], rev: 1 });
    expect(msg.seats.map((s) => s.seatId)).toEqual(["a", "b", "d"]);
    expect(activeSeats(configs).length).toBe(3);
  });
});

describe("game with 1, 2, 3 seats", () => {
  it("turn rotation wraps over the seats that exist (1 seat: back to the same player)", () => {
    expect(nextSeatId(four().slice(0, 1), "a")).toBe("a");
    expect(nextSeatId(four().slice(0, 2), "b")).toBe("a");
    expect(nextSeatId(four().slice(0, 3), "c")).toBe("a");
    expect(rollForStartingSeat(four().slice(0, 1)).winnerId).toBe("a");
    expect(["a", "b"]).toContain(rollForStartingSeat(four().slice(0, 2)).winnerId);
  });
  it("a solo game does not end the moment it starts, but ends when the lone player loses", () => {
    const solo = settle(session([seat("a", "human")]));
    expect(solo.status).toBe("playing");
    expect(solo.winnerSeatId).toBeUndefined();
    const dead = settle(session([seat("a", "human", { life: 0 })]));
    expect(dead.status).toBe("complete");
    expect(dead.winnerSeatId).toBeUndefined();
  });
  it("2+ seat games still end with a winner when one player remains", () => {
    for (const n of [2, 3, 4]) {
      const seats = four().slice(0, n).map((s, i) => (i === 0 ? s : { ...s, life: 0 }));
      const done = settle(session(seats));
      expect(done.status).toBe("complete");
      expect(done.winnerSeatId).toBe("a");
    }
  });
  it("spectator/guest relabel works for any seat count", () => {
    for (const n of [1, 2, 3, 4]) {
      const view = buildGuestSession(session(four().slice(0, n)), SPECTATOR_VIEWER);
      expect(view.seats.length).toBe(n);
      expect(view.seats.filter((s) => s.kind === "human").length).toBe(1);
    }
  });
});
