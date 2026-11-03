// Lim-Dûl's Vault: "Look at the top five cards of your library. As many times as you choose, you may pay 1 life, put those
// cards on the bottom of your library in any order, then look at the top five cards of your library. Then shuffle and put
// the last cards you looked at this way on top in any order." Agents used to get NOTHING from it (the rules advisor declines
// the loop as manual_review and only the human had an interactive flow).
import { describe, expect, it } from "vitest";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { resolveAgentLimDulVault } from "./AppFlow";

function card(id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  return { id, name: id, manaValue: 3, colors: [], role: "permanent", zone: "library", typeLine: "Creature", oracleText: "", ...extra } as VisibleCard;
}
const land = (id: string) => card(id, { typeLine: "Basic Land", manaValue: 0 });

function game(library: VisibleCard[], extra: Partial<PlayerSeat> = {}, battlefield: VisibleCard[] = []): GameSession {
  const seat = { id: "a", name: "Veyra", kind: "agent", life: 40, commanderDamage: {}, zones: { library: library.length, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield, graveyard: [], exile: [] }, library, ...extra } as PlayerSeat;
  return { id: "t", createdAt: "", status: "playing", phase: "end step", turn: 4, xmage: { enabled: false, status: "not_configured", message: "" }, seats: [seat], events: [] };
}

describe("resolveAgentLimDulVault", () => {
  const filler = Array.from({ length: 30 }, (_, i) => card(`f${i}`, { manaValue: 2 }));

  it("keeps the library intact, never loses cards, and puts the five looked-at cards on top", () => {
    const lib = [land("l1"), land("l2"), card("c1"), card("c2"), card("c3"), ...filler];
    const after = resolveAgentLimDulVault(game(lib), "a", "Lim-Dûl's Vault");
    const out = after.seats[0].library!;
    expect(out).toHaveLength(lib.length);
    expect(new Set(out.map((c) => c.id))).toEqual(new Set(lib.map((c) => c.id)));
    // Good hand already (lands + spells): no life paid, same five on top.
    expect(new Set(out.slice(0, 5).map((c) => c.id))).toEqual(new Set(["l1", "l2", "c1", "c2", "c3"]));
    expect(after.seats[0].life).toBe(40);
  });

  it("pays life and looks again when the top five are all dead cards, then stops (bounded)", () => {
    const dead = Array.from({ length: 5 }, (_, i) => card(`big${i}`, { manaValue: 9 }));
    const lib = [...dead, ...Array.from({ length: 40 }, (_, i) => card(`x${i}`, { manaValue: 9 }))];
    const after = resolveAgentLimDulVault(game(lib), "a", "Lim-Dûl's Vault");
    const paid = 40 - after.seats[0].life;
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThanOrEqual(3);
    expect(after.seats[0].library).toHaveLength(lib.length);
  });

  it("never pays below the life floor", () => {
    const lib = [...Array.from({ length: 5 }, (_, i) => card(`big${i}`, { manaValue: 9 })), ...Array.from({ length: 40 }, (_, i) => card(`x${i}`, { manaValue: 9 }))];
    const after = resolveAgentLimDulVault(game(lib, { life: 5 }), "a", "Lim-Dûl's Vault");
    expect(after.seats[0].life).toBe(5);
  });

  it("puts the best card on top when lands are needed, and the log does not name any card", () => {
    const lib = [card("big", { manaValue: 8 }), card("c1"), land("land"), land("land2"), card("c3"), ...filler];
    const after = resolveAgentLimDulVault(game(lib), "a", "Lim-Dûl's Vault");
    expect(["land", "land2"]).toContain(after.seats[0].library![0].id);
    expect(after.seats[0].life).toBe(40);
    const logged = after.events.map((e) => e.message).join(" ");
    expect(logged).toMatch(/Lim-D/);
    for (const c of lib.slice(0, 5)) expect(logged).not.toContain(` ${c.id} `);
    expect(logged).not.toMatch(/\bland\b.*\btop\b/);
  });
});
