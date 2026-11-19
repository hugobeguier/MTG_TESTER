import { describe, expect, it } from "vitest";
import { canReceivePriorityForPendingAction, pendingActionRequiredPasses, yieldMomentFor } from "./priority";
import { toggleYield, withoutYields, yieldAutoPasses, yieldCancelReason, type YieldMoment } from "./yieldPolicy";
import { DEFAULT_STOP_SETTINGS } from "@/lib/priorityStops";
import { defaultSeatStopSettings } from "@/lib/multiplayer/seatStops";
import type { GameSession, ManaPool, PlayerSeat } from "@/lib/types";

const moment = (patch: Partial<YieldMoment> = {}): YieldMoment => ({ seatId: "host", turn: 3, phase: "precombat main phase", activeSeatId: "host", beingAttacked: false, fullControl: false, holdOnce: false, ...patch });
const started = { turn: 3, activeSeatId: "host" };

describe("yieldPolicy (pure)", () => {
  it("auto-passes own-turn and opponent-turn windows of the turn it was started in", () => {
    expect(yieldAutoPasses(started, moment())).toBe(true);
    expect(yieldAutoPasses({ turn: 3, activeSeatId: "bot" }, moment({ activeSeatId: "bot", phase: "declare blockers step" }))).toBe(true);
    expect(yieldAutoPasses(undefined, moment())).toBe(false);
  });
  it("ends at the end step / cleanup and when the turn changes", () => {
    expect(yieldCancelReason(started, moment({ phase: "end step" }))).toMatch(/end step/);
    expect(yieldCancelReason(started, moment({ phase: "cleanup step" }))).toBeDefined();
    expect(yieldCancelReason(started, moment({ turn: 4 }))).toMatch(/turn ended/);
    expect(yieldCancelReason(started, moment({ activeSeatId: "bot" }))).toMatch(/turn ended/);
  });
  it("cancels when attacked, on Full Control / Stop Next, and when a spell of ANOTHER seat targets the seat", () => {
    expect(yieldCancelReason(started, moment({ beingAttacked: true }))).toMatch(/attacked/);
    expect(yieldCancelReason(started, moment({ fullControl: true }))).toMatch(/Full Control/);
    expect(yieldCancelReason(started, moment({ holdOnce: true }))).toMatch(/Stop Next/);
    expect(yieldCancelReason(started, moment({ pending: { controllerSeatId: "bot", targetSeatIds: ["host"], sourceName: "Bot's Bolt" } }))).toBe("Bot's Bolt targets you");
  });
  it("does not cancel for a spell that does not target the seat, or for the seat's own spell", () => {
    expect(yieldCancelReason(started, moment({ pending: { controllerSeatId: "bot", targetSeatIds: ["friend"] } }))).toBeUndefined();
    expect(yieldCancelReason(started, moment({ pending: { controllerSeatId: "bot", targetSeatIds: [] } }))).toBeUndefined();
    expect(yieldCancelReason(started, moment({ pending: { controllerSeatId: "host", targetSeatIds: ["host"] } }))).toBeUndefined();
  });
  it("toggle starts then cancels, per seat", () => {
    const one = toggleYield({}, "host", 3, "host");
    expect(one).toEqual({ host: started });
    const both = toggleYield(one, "friend", 3, "host");
    expect(Object.keys(both).sort()).toEqual(["friend", "host"]);
    expect(Object.keys(toggleYield(both, "host", 3, "host"))).toEqual(["friend"]);
    expect(withoutYields(both, ["nobody"])).toBe(both);
    expect(withoutYields(both, ["friend"])).toEqual({ host: started });
  });
});

function seat(id: string, kind: "human" | "agent", extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return { id, name: id, kind, life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield: [] }, ...extra };
}
const seer = (id: string) => ({ id, name: "Viscera Seer", typeLine: "Creature - Vampire Wizard", oracleText: "Sacrifice a creature: Scry 1.", manaValue: 1, colors: [], role: "permanent", zone: "battlefield" }) as PlayerSeat["board"]["battlefield"][number];
const withSeer = (id: string): PlayerSeat["board"] => ({ hand: [], battlefield: [seer(id)] });
const host = seat("host", "human", { board: withSeer("s1") });
const friend = seat("friend", "human", { remoteSlot: "guest-1", board: withSeer("s2") });
const bot = seat("bot", "agent");
const seats = [host, friend, bot];
const session = { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 3, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] } as GameSession;
const pools: Record<string, ManaPool> = {};
const phaseAction = (actor: string) => ({ id: "a", type: "phase" as const, actorSeatId: actor, message: "" }) as never;
const spell = (actor: string, targets: Array<{ kind: "player"; seatId: string }> = []) => ({ id: "s", type: "spell" as const, actorSeatId: actor, cardId: "x", cardName: "Bolt", message: "", castChoices: { targets } }) as never;
const ask = (who: PlayerSeat, action: never, stops: object, sess = session, active = "host") => canReceivePriorityForPendingAction(who, action, active, sess, pools, { ...DEFAULT_STOP_SETTINGS, ...stops }, undefined);

describe("priority.ts consults the yield per seat", () => {
  const yields = { host: started };
  it("a yielding host is not asked on its own turn (default stop) nor on an opponent's stack response, while without yield it is", () => {
    expect(ask(host, phaseAction("host"), {})).toBe(true); // own precombat main: a default stop
    expect(ask(host, phaseAction("host"), { yields })).toBe(false);
    expect(ask(host, spell("bot"), {})).toBe(true);
    expect(ask(host, spell("bot"), {}, { ...session, phase: "combat damage step" }, "bot")).toBe(true);
    expect(ask(host, spell("bot"), { yields: { host: { turn: 3, activeSeatId: "bot" } } }, { ...session, phase: "combat damage step" }, "bot")).toBe(false);
  });
  it("a targeted spell is not skipped (the yield is cancelled for it); a spell aimed at someone else is skipped", () => {
    expect(ask(host, spell("bot", [{ kind: "player", seatId: "host" }]), { yields })).toBe(true);
    expect(ask(host, spell("bot", [{ kind: "player", seatId: "friend" }]), { yields })).toBe(false);
  });
  it("an attack against the seat cancels it", () => {
    const attacker = { id: "atk", name: "Wolf", typeLine: "Creature", oracleText: "", manaValue: 1, colors: [], role: "permanent", zone: "battlefield", attacking: true, attackTargetId: "host" } as never;
    const attacked = { ...session, phase: "declare blockers step", seats: [host, friend, { ...bot, board: { hand: [], battlefield: [attacker] } }] } as GameSession;
    expect(ask(host, spell("bot"), { yields }, attacked, "bot")).toBe(true);
  });
  it("is over at the end step and on the next turn, and Full Control cancels it", () => {
    expect(ask(host, spell("bot"), { yields }, { ...session, phase: "end step" }, "host")).toBe(true);
    expect(ask(host, spell("bot"), { yields }, { ...session, turn: 4 }, "bot")).toBe(true);
    expect(ask(host, spell("bot"), { yields, fullControl: true })).toBe(true);
  });
  it("is per seat: the host's yield does not silence the friend, and the friend's own yield (remote seat) works next to their seat settings", () => {
    const stops = { bySeat: { friend: defaultSeatStopSettings(1, 3) }, yields };
    expect(ask(friend, spell("bot"), stops, session, "bot")).toBe(true);
    const friendYields = { ...stops, yields: { friend: started } };
    expect(ask(friend, spell("bot"), friendYields)).toBe(false);
    expect(ask(host, spell("bot"), friendYields)).toBe(true);
    expect(pendingActionRequiredPasses(seats, spell("bot"), "host", session, pools, { ...DEFAULT_STOP_SETTINGS, ...friendYields }, undefined)).toEqual(["host"]);
  });
  it("yieldMomentFor describes the seat and the stack item (prompts are not priority windows and are never read here)", () => {
    const m = yieldMomentFor(host, spell("bot", [{ kind: "player", seatId: "host" }]), session, "host", DEFAULT_STOP_SETTINGS, undefined);
    expect(m.pending?.targetSeatIds).toEqual(["host"]);
    expect(m.pending?.controllerSeatId).toBe("bot");
    expect(yieldMomentFor(host, undefined, session, "host", DEFAULT_STOP_SETTINGS, undefined).pending).toBeUndefined();
  });
});
