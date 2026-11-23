import { describe, expect, it } from "vitest";
import type { GameSession, VisibleCard } from "@/lib/types";
import { stackSession } from "./tokenStacks";

const tok = (id: string, over: Partial<VisibleCard> = {}): VisibleCard => ({ id, name: "Squirrel", typeLine: "Token Creature — Squirrel", oracleText: "", manaValue: 0, colors: ["G"], power: "1", toughness: "1", token: true, role: "creature", zone: "battlefield", ...over } as VisibleCard);
const sessionOf = (...bf: VisibleCard[][]): GameSession => ({ turn: 1, seats: bf.map((b, i) => ({ id: `p${i + 1}`, board: { hand: [], battlefield: b } })) } as unknown as GameSession);
const ids = (s: GameSession, seat = 0) => s.seats[seat].board.battlefield.map((c) => `${c.id}x${c.stackCount ?? 1}`);

describe("stackSession", () => {
  it("merges identical tokens into one representative with the lowest id", () => {
    const { session, index } = stackSession(sessionOf([tok("t3"), tok("t1"), tok("t2")]));
    expect(ids(session)).toEqual(["t1x3"]);
    expect(session.seats[0].board.battlefield[0].stackIds).toEqual(["t1", "t2", "t3"]);
    expect(index.repOf.get("t3")).toBe("t1");
  });
  it("leaves a lone token and non-tokens untouched (same object)", () => {
    const lone = tok("t1"); const land = { ...tok("l1"), token: false, name: "Forest" } as VisibleCard; const land2 = { ...land, id: "l2" };
    const s = sessionOf([lone, land, land2]);
    const r = stackSession(s);
    expect(r.session).toBe(s);
  });
  it("splits summoning-sick from ready tokens, and re-merges when the state matches", () => {
    expect(ids(stackSession(sessionOf([tok("t1", { summoningSick: true }), tok("t2", { summoningSick: true }), tok("t3"), tok("t4")])).session)).toEqual(["t1x2", "t3x2"]);
    expect(ids(stackSession(sessionOf([tok("t1"), tok("t2"), tok("t3"), tok("t4")])).session)).toEqual(["t1x4"]);
  });
  it("splits attackers from the rest (3 of 5) and tapped from untapped", () => {
    const five = [1, 2, 3, 4, 5].map((n) => tok(`t${n}`, n <= 3 ? { attacking: true, tapped: true, attackTargetId: "p2" } : {}));
    expect(ids(stackSession(sessionOf(five)).session)).toEqual(["t1x3", "t4x2"]);
    expect(ids(stackSession(sessionOf([tok("t1", { tapped: true }), tok("t2")])).session)).toEqual(["t1x1", "t2x1"]);
  });
  it("keeps tokens with different counters, damage, attack target, power, or phase state apart", () => {
    const a = tok("t1");
    for (const o of [{ counters: [{ kind: "+1/+1", count: 1 }] }, { damage: 1 }, { attacking: true, attackTargetId: "x" }, { setPowerOverride: 3 }, { phasedOut: true }, { ownerSeatId: "p2" }, { grantedKeywords: ["flying"] }, { colors: ["R"] }]) {
      expect(ids(stackSession(sessionOf([a, tok("t2", o as Partial<VisibleCard>)])).session)).toEqual(["t1x1", "t2x1"]);
    }
  });
  it("never merges a token with an attachment or an attached token; different controllers are different seats", () => {
    const aura = { ...tok("a1"), token: false, name: "Pacifism", typeLine: "Enchantment — Aura", attachedToId: "t1" } as VisibleCard;
    expect(ids(stackSession(sessionOf([tok("t1"), tok("t2"), tok("t3"), aura])).session)).toEqual(["t1x1", "t2x2", "a1x1"]);
    expect(ids(stackSession(sessionOf([tok("t1"), tok("t2")], [tok("t3")])).session, 1)).toEqual(["t3x1"]);
  });
  it("counts drop when a member dies and the representative stays stable", () => {
    const three = stackSession(sessionOf([tok("t1"), tok("t2"), tok("t3")])).session;
    const two = stackSession(sessionOf([tok("t1"), tok("t3")])).session;
    expect(three.seats[0].board.battlefield[0].id).toBe(two.seats[0].board.battlefield[0].id);
    expect(two.seats[0].board.battlefield[0].stackCount).toBe(2);
  });
  it("keeps the order of first appearance, and fans out split groups that share a dragged position", () => {
    const pos = { x: 1, z: 1 };
    const { session } = stackSession(sessionOf([tok("t1", { attacking: true, battlefieldPosition: pos }), tok("t2", { attacking: true, battlefieldPosition: pos }), tok("t3", { battlefieldPosition: pos }), tok("t4", { battlefieldPosition: pos })]));
    const bf = session.seats[0].board.battlefield;
    expect(bf.map((c) => c.id)).toEqual(["t1", "t3"]);
    expect(bf[0].battlefieldPosition).toEqual(pos);
    expect(bf[1].battlefieldPosition!.x).toBeGreaterThan(pos.x + 0.7);
  });
  it("is pluggable: a groupable rule can include non-tokens", () => {
    const f = (id: string) => ({ ...tok(id), token: false, name: "Forest", typeLine: "Basic Land — Forest" }) as VisibleCard;
    expect(ids(stackSession(sessionOf([f("l1"), f("l2")]), { groupable: (c) => c.typeLine.startsWith("Basic Land") }).session)).toEqual(["l1x2"]);
  });
});
