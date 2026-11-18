import { describe, expect, it } from "vitest";
import { REMOTE_UNASSIGNED } from "./seatMap";
import type { GuestInfo } from "./protocol";
import { buildLobbyMessage, claimSeat, commanderFromList, isLobbyMessage, lobbyBlockers, lobbyFingerprint, parseLobbyIntent, parseMyDecks, reconcileClaims, releaseSlot, rememberDeck, resolveDeckChoice, type LobbyConfig } from "./lobby";

const g = (seatId: string, connected = true): GuestInfo => ({ seatId, displayName: `Name ${seatId}`, connected });
const legalDeck = { validation: { legal: true, errors: [], warnings: ["w"] } };
const cfg = (seatId: string, over: Partial<LobbyConfig> = {}): LobbyConfig => ({ seatId, name: seatId.toUpperCase(), kind: "agent", mode: "commander", commander: "", deckList: "", status: "empty", message: "", activity: [], ...over });
const open = (seatId: string, over: Partial<LobbyConfig> = {}) => cfg(seatId, { kind: "human", remoteSlot: REMOTE_UNASSIGNED, mode: "decklist", ...over });

describe("parseLobbyIntent", () => {
  it("accepts the three intents", () => {
    expect(parseLobbyIntent("lobby_take_seat", ["b"])).toEqual({ ok: true, intent: { type: "take_seat", seatId: "b" } });
    expect(parseLobbyIntent("lobby_leave_seat", [])).toEqual({ ok: true, intent: { type: "leave_seat" } });
    const r = parseLobbyIntent("lobby_set_deck", [{ source: "new", name: " My deck ", deckList: "1 Sol Ring" }]);
    expect(r).toEqual({ ok: true, intent: { type: "set_deck", deck: { source: "new", name: "My deck", commander: "", deckList: "1 Sol Ring" } } });
  });
  it("rejects junk and oversized payloads", () => {
    expect(parseLobbyIntent("lobby_take_seat", [])).toMatchObject({ ok: false });
    expect(parseLobbyIntent("lobby_take_seat", [42])).toMatchObject({ ok: false });
    expect(parseLobbyIntent("lobby_nope", [])).toMatchObject({ ok: false });
    expect(parseLobbyIntent("lobby_set_deck", [{ source: "new", name: "x", deckList: "a".repeat(20_001) }])).toMatchObject({ ok: false });
    expect(parseLobbyIntent("lobby_set_deck", [{ source: "new", name: "", deckList: "1 a" }])).toMatchObject({ ok: false });
    expect(parseLobbyIntent("lobby_set_deck", ["x"])).toMatchObject({ ok: false });
  });
});

describe("resolveDeckChoice", () => {
  const lib = [{ id: "decks/a.txt", label: "A", commander: "Atraxa", deckList: "Commander: Atraxa\n1 Sol Ring" }];
  it("looks saved decks up and reads the Commander line", () => {
    expect(resolveDeckChoice({ source: "saved", id: "decks/a.txt" }, lib)).toMatchObject({ ok: true, commander: "Atraxa" });
    expect(resolveDeckChoice({ source: "saved", id: "decks/zzz.txt" }, lib)).toMatchObject({ ok: false });
    expect(resolveDeckChoice({ source: "new", name: "n", commander: "", deckList: "Commander: Meren\n1 X" }, lib)).toMatchObject({ commander: "Meren" });
    expect(commanderFromList("1 Sol Ring")).toBe("");
  });
});

describe("seat claims", () => {
  const guests = [g("guest-1"), g("guest-2")];
  it("claims an open seat, refuses taken / non-friend seats and unknown guests", () => {
    const configs = [cfg("a"), open("b"), open("c")];
    const r = claimSeat(configs, guests, "guest-1", "b");
    expect(r.configs[1].remoteSlot).toBe("guest-1");
    expect(claimSeat(r.configs, guests, "guest-2", "b").error).toMatch(/already/);
    expect(claimSeat(configs, guests, "guest-1", "a").error).toBeDefined();
    expect(claimSeat(configs, [g("guest-1", false)], "guest-1", "b").error).toBeDefined();
    expect(claimSeat(r.configs, guests, "guest-1", "b").configs).toBe(r.configs);
  });
  it("moving seats carries the deck over and reopens the old seat", () => {
    const configs = [open("b", { remoteSlot: "guest-1", deck: legalDeck, status: "ready", commander: "X", deckList: "L" }), open("c")];
    const r = claimSeat(configs, guests, "guest-1", "c").configs;
    expect(r[1]).toMatchObject({ remoteSlot: "guest-1", commander: "X", status: "ready" });
    expect(r[0]).toMatchObject({ remoteSlot: REMOTE_UNASSIGNED, status: "empty", deck: undefined });
  });
  it("release and reconcile", () => {
    const configs = [open("b", { remoteSlot: "guest-1", status: "ready", deck: legalDeck }), open("c", { remoteSlot: "guest-9" })];
    expect(releaseSlot(configs, "guest-1")[0].remoteSlot).toBe(REMOTE_UNASSIGNED);
    expect(releaseSlot(configs, "guest-5")).toBe(configs);
    const r = reconcileClaims(configs, [g("guest-1", false)]);
    expect(r[0].remoteSlot).toBe("guest-1"); // disconnected but still in the room: seat held
    expect(r[1].remoteSlot).toBe(REMOTE_UNASSIGNED); // gone from the room: freed
    expect(reconcileClaims(r, [g("guest-1")])).toBe(r);
  });
});

describe("lobbyBlockers", () => {
  it("only passes when every friend seat is taken, connected and has a legal deck", () => {
    const ok = open("b", { remoteSlot: "guest-1", status: "ready", deck: legalDeck });
    expect(lobbyBlockers([cfg("a"), ok], [g("guest-1")])).toEqual([]);
    expect(lobbyBlockers([cfg("a")], [])).toEqual([]);
    expect(lobbyBlockers([ok, open("c")], [g("guest-1")])).toHaveLength(1);
    expect(lobbyBlockers([ok], [g("guest-1", false)])[0].reason).toMatch(/disconnected/);
    expect(lobbyBlockers([{ ...ok, status: "building" }], [g("guest-1")])[0].reason).toMatch(/validating/);
    expect(lobbyBlockers([{ ...ok, deck: undefined, status: "empty" }], [g("guest-1")])[0].reason).toMatch(/no valid deck/);
    expect(lobbyBlockers([{ ...ok, deck: { validation: { legal: false, errors: ["bad"], warnings: [] } } }], [g("guest-1")])).toHaveLength(1);
  });
});

describe("buildLobbyMessage", () => {
  const configs = [cfg("a", { kind: "human" }), open("b", { remoteSlot: "guest-1", status: "error", deck: { validation: { legal: false, errors: ["Unknown card: X."], warnings: [] } }, commander: "Atraxa" }), open("c"), cfg("d")];
  const build = (slot: string) => buildLobbyMessage({ configs, guests: [g("guest-1"), g("guest-2")], slot, hostName: "H", hostDecks: [{ id: "i", label: "L", commander: "C" }], rev: 3 });
  it("shows kinds, and deck errors only to the owner", () => {
    const mine = build("guest-1");
    expect(mine.seats.map((s) => s.kind)).toEqual(["host", "friend", "open", "agent"]);
    expect(mine.yourSeatId).toBe("b");
    expect(mine.seats[1]).toMatchObject({ you: true, takenBy: "Name guest-1", deck: { status: "error", errors: ["Unknown card: X."] } });
    const other = build("guest-2");
    expect(other.yourSeatId).toBeUndefined();
    expect(other.seats[1].deck).toMatchObject({ status: "error", errors: [], commander: "Atraxa" });
    expect(isLobbyMessage(JSON.parse(JSON.stringify(mine)))).toBe(true);
    expect(lobbyFingerprint(mine)).toBe(lobbyFingerprint({ ...mine, rev: 99 }));
  });
});

describe("my decks", () => {
  it("parses defensively and replaces by name", () => {
    expect(parseMyDecks("not json")).toEqual([]);
    expect(parseMyDecks('[{"name":1}]')).toEqual([]);
    const a = { name: "A", commander: "c", deckList: "l" };
    expect(rememberDeck(rememberDeck([], a), { ...a, name: "a", deckList: "l2" })).toEqual([{ name: "a", commander: "c", deckList: "l2" }]);
  });
});
