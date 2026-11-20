// Layer 6 timestamp order for "loses all abilities" (Utter Insignificance): abilities from effects with an EARLIER timestamp are lost,
// abilities from LATER effects are kept. Printed abilities are always lost.
import { describe, expect, it } from "vitest";
import { runStateBasedActionsPass } from "@/engine/stateBased";
import { changeControlWithinBattlefield } from "@/engine/zones";
import { clearTemporaryBuffs } from "@/engine/turnFlow";
import { nextTimestamp } from "@/engine/etb";
import { buildAgentDecisionContext } from "@/engine/priority";
import { hasKeyword } from "@/engine/shared";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

function perm(id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  return { id, name: id, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: [], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra } as VisibleCard;
}
const AURA_TEXT = "Enchant creature\nEnchanted creature loses all abilities and has base power and toughness 1/1.";
const aura = (id: string, at: number, ts: number) => perm(id, { typeLine: "Enchantment — Aura", oracleText: AURA_TEXT, attachedToId: "bear", attachedToSeatId: "a", attachTimestamp: at, permanentTimestamp: ts, power: undefined, toughness: undefined });
const anthem = (id: string, keyword: string, ts: number) => perm(id, { typeLine: "Enchantment", oracleText: `Creatures have ${keyword}.`, power: undefined, toughness: undefined, permanentTimestamp: ts });
const bear = (extra: Partial<VisibleCard> = {}) => perm("bear", { oracleText: "Flying", permanentTimestamp: 1, ...extra });
function seat(id: string, battlefield: VisibleCard[]): PlayerSeat {
  return { id, name: id, kind: "agent", life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield, graveyard: [] }, library: [] } as unknown as PlayerSeat;
}
function session(a: VisibleCard[], b: VisibleCard[] = []): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "main", turn: 5, activePlayerId: "a", effectTimestampCounter: 100, xmage: { enabled: false, status: "not_configured", message: "" }, seats: [seat("a", a), seat("b", b)], events: [] } as unknown as GameSession;
}
const settle = (s: GameSession) => {
  let cur = s;
  for (let i = 0; i < 4; i++) cur = runStateBasedActionsPass(cur).session;
  return cur;
};
const get = (s: GameSession, id: string) => s.seats.flatMap((x) => x.board.battlefield).find((c) => c.id === id)!;

describe("loses all abilities respects timestamp order", () => {
  it("a grant from a LATER effect (opponent's anthem entered after the aura) is kept; printed flying is lost", () => {
    const s = settle(session([bear(), aura("ui", 50, 40)], [anthem("late", "trample", 60)]));
    const b = get(s, "bear");
    expect(b.abilitiesStripped).toBe(true);
    expect(hasKeyword(b, "trample")).toBe(true);
    expect(hasKeyword(b, "flying")).toBe(false);
  });

  it("a grant from an EARLIER effect (anthem entered before the aura) is lost", () => {
    const s = settle(session([bear(), aura("ui", 50, 40)], [anthem("early", "trample", 30)]));
    expect(hasKeyword(get(s, "bear"), "trample")).toBe(false);
    expect(get(s, "bear").grantedKeywords).toBeUndefined();
  });

  it("when the strip aura leaves, everything comes back", () => {
    const s = settle(session([bear(), aura("ui", 50, 40)], [anthem("early", "trample", 30)]));
    const gone = settle({ ...s, seats: s.seats.map((x) => ({ ...x, board: { ...x.board, battlefield: x.board.battlefield.filter((c) => c.id !== "ui") } })) });
    const b = get(gone, "bear");
    expect(b.abilitiesStripped).toBeFalsy();
    expect(b.abilitiesStrippedAt).toBeUndefined();
    expect(hasKeyword(b, "trample")).toBe(true);
    expect(hasKeyword(b, "flying")).toBe(true);
  });

  it("with two strip effects, only grants newer than the latest one survive", () => {
    const board = [bear(), aura("ui1", 50, 40), aura("ui2", 80, 70)];
    const a = settle(session(board, [anthem("mid", "trample", 60), anthem("new", "haste", 90)]));
    const b = get(a, "bear");
    expect(hasKeyword(b, "trample")).toBe(false);
    expect(hasKeyword(b, "haste")).toBe(true);
    expect(b.abilitiesStrippedAt).toBe(80);
  });

  it("an until-end-of-turn grant resolved AFTER the strip is kept, then ends with the turn", () => {
    const s = settle(session([bear({ temporaryGrantedKeywords: ["trample"] }), aura("ui", 50, 40)]));
    expect(hasKeyword(get(s, "bear"), "trample")).toBe(true);
    const after = settle(clearTemporaryBuffs(s));
    expect(hasKeyword(get(after, "bear"), "trample")).toBe(false);
    expect(get(after, "bear").abilitiesStripped).toBe(true);
  });

  it("an until-end-of-turn grant resolved BEFORE the strip is lost", () => {
    const granted = settle(session([bear({ temporaryGrantedKeywords: ["trample"] })]));
    expect(hasKeyword(get(granted, "bear"), "trample")).toBe(true);
    const { timestamp, session: stamped } = nextTimestamp(granted);
    const enchanted = settle({ ...stamped, seats: stamped.seats.map((x) => (x.id === "a" ? { ...x, board: { ...x.board, battlefield: [...x.board.battlefield, aura("ui", timestamp, timestamp)] } } : x)) });
    expect(hasKeyword(get(enchanted, "bear"), "trample")).toBe(false);
    // a second, later grant of the same keyword counts again
    const regranted = settle({ ...enchanted, seats: enchanted.seats.map((x) => (x.id === "a" ? { ...x, board: { ...x.board, battlefield: x.board.battlefield.map((c) => (c.id === "bear" ? { ...c, temporaryGrantedKeywords: [...(c.temporaryGrantedKeywords ?? []), "trample"] } : c)) } } : x)) });
    expect(hasKeyword(get(regranted, "bear"), "trample")).toBe(true);
  });

  it("a control change re-stamps the source, so its static grants become later than an existing strip", () => {
    const s = settle(session([bear(), aura("ui", 50, 40)], [anthem("early", "trample", 30)]));
    expect(hasKeyword(get(s, "bear"), "trample")).toBe(false);
    const stolen = settle(changeControlWithinBattlefield(s, "early", "b", "a"));
    expect(get(stolen, "early").permanentTimestamp).toBeGreaterThan(50);
    expect(hasKeyword(get(stolen, "bear"), "trample")).toBe(true);
  });

  it("the AI snapshot agrees with the engine: stripped flag and only the surviving keywords", () => {
    const s = settle(session([bear(), aura("ui", 50, 40)], [anthem("late", "trample", 60)]));
    const ctx = buildAgentDecisionContext(s, s.seats[0], {}) as { you: { battlefield: Array<{ id: string; keywords: string[]; abilitiesStripped?: boolean }> } };
    const snap = ctx.you.battlefield.find((c) => c.id === "bear")!;
    expect(snap.abilitiesStripped).toBe(true);
    expect(snap.keywords).toContain("trample");
    expect(snap.keywords).not.toContain("flying");
  });

  it("stamps entry timestamps monotonically and never reuses one", () => {
    const s = settle(session([perm("x"), perm("y")]));
    const stamps = [get(s, "x").permanentTimestamp!, get(s, "y").permanentTimestamp!];
    expect(stamps[1]).toBeGreaterThan(stamps[0]);
    expect(s.effectTimestampCounter).toBeGreaterThan(stamps[1]);
  });
});
