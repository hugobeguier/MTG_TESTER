// A counterspell may target ANY spell on the stack, so a priority window must open when the seat's counter can hit a DEEPER spell even though
// it cannot hit the top item. Real catalog Oracle text. Covers the host seat, a remote friend seat, and the pass-order helpers.
import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { canReceivePriorityForPendingAction, nextPrioritySeatId, pendingActionRequiredPasses } from "./priority";
import type { PendingAction } from "@/engine/types";
import { DEFAULT_STOP_SETTINGS } from "@/lib/priorityStops";
import type { GameSession, ManaPool, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "spell", zone: "hand", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
function seat(id: string, kind: "human" | "agent", hand: VisibleCard[] = [], battlefield: VisibleCard[] = [], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  const board = { hand, battlefield, graveyard: [], exile: [] };
  return { id, name: id, kind, life: 40, commanderDamage: {}, zones: { library: 0, hand: hand.length, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 }, board, ...extra } as unknown as PlayerSeat;
}
const islands = (prefix: string) => [real("Island", `${prefix}1`, { zone: "battlefield" }), real("Island", `${prefix}2`, { zone: "battlefield" })];
const session = (seats: PlayerSeat[]): GameSession => ({ id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] }) as GameSession;
function spell(id: string, seatId: string, card: VisibleCard): Extract<PendingAction, { type: "spell" }> {
  return { id, type: "spell", actorSeatId: seatId, cardId: card.id, cardName: card.name, cardTypeLine: card.typeLine, manaSourceIds: [], message: "" };
}
const pools: Record<string, ManaPool> = {};

const bolt = real("Lightning Bolt", "bolt");
const bears = real("Grizzly Bears", "bears");
// Stack, bottom to top: Grizzly Bears (creature), then Lightning Bolt (noncreature) on top.
const stack = [spell("sBears", "opp", bears), spell("sBolt", "opp", bolt)];
const top = stack[1];
const bottomOnly = [stack[0]];

function world(counter: VisibleCard, remote = false) {
  const me = seat("me", "human", [counter], islands("i"), remote ? { remoteSlot: "guest-1" } : {});
  const opp = seat("opp", "agent", [bolt, bears]);
  return { me, opp, s: session([me, opp]) };
}
const ask = (w: ReturnType<typeof world>, action: PendingAction, st: PendingAction[] | undefined) =>
  canReceivePriorityForPendingAction(w.me, action, "opp", w.s, pools, DEFAULT_STOP_SETTINGS, undefined, undefined, st);

describe("priority for a counterspell that can only hit a deeper spell", () => {
  it("Essence Scatter (creature spells only): top is a noncreature Bolt, deeper is a creature -> window opens only when the stack is passed", () => {
    const w = world(real("Essence Scatter", "es"));
    expect(ask(w, top, undefined)).toBe(false); // the old top-only view
    expect(ask(w, top, stack)).toBe(true);
  });

  it("Negate (noncreature only): top is a creature, deeper is Bolt -> window opens with the stack", () => {
    const w = world(real("Negate", "ng"));
    const creatureOnTop = [spell("sBolt", "opp", bolt), spell("sBears", "opp", bears)];
    expect(ask(w, creatureOnTop[1], undefined)).toBe(false);
    expect(ask(w, creatureOnTop[1], creatureOnTop)).toBe(true);
  });

  it("no window when no spell anywhere on the stack is a legal target", () => {
    const w = world(real("Essence Scatter", "es"));
    expect(ask(w, top, [top])).toBe(false);
    expect(ask(w, bottomOnly[0], bottomOnly)).toBe(true); // sanity: a creature alone is a legal target
  });

  it("a deeper uncounterable spell is not a legal target (Void Rend)", () => {
    const rend = real("Void Rend", "VR");
    const me = seat("me", "human", [real("Negate", "ng")], islands("i"));
    const opp = seat("opp", "agent", [rend, bears]);
    const s = session([me, opp]);
    const st = [spell("sR", "opp", rend), spell("sB", "opp", bears)];
    expect(canReceivePriorityForPendingAction(me, st[1], "opp", s, pools, DEFAULT_STOP_SETTINGS, undefined, undefined, st)).toBe(false);
  });

  it("a remote friend seat gets the same window", () => {
    const w = world(real("Essence Scatter", "es"), true);
    expect(ask(w, top, undefined)).toBe(false);
    expect(ask(w, top, stack)).toBe(true);
  });

  it("pendingActionRequiredPasses / nextPrioritySeatId carry the stack through", () => {
    const w = world(real("Essence Scatter", "es"));
    expect(pendingActionRequiredPasses(w.s.seats, top, "opp", w.s, pools, DEFAULT_STOP_SETTINGS, undefined)).toEqual([]);
    expect(pendingActionRequiredPasses(w.s.seats, top, "opp", w.s, pools, DEFAULT_STOP_SETTINGS, undefined, undefined, stack)).toEqual(["me"]);
    expect(nextPrioritySeatId(w.s.seats, "opp", [], top, "opp", w.s, pools, DEFAULT_STOP_SETTINGS, undefined, undefined, stack)).toBe("me");
  });
});
