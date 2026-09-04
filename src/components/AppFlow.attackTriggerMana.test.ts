import { describe, expect, it } from "vitest";
import { attackTriggerManaHeuristicSplit } from "./AppFlow";
import type { PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...overrides };
}

function seat(overrides: Partial<PlayerSeat> & Pick<PlayerSeat, "id" | "name" | "kind">): PlayerSeat {
  return {
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield: [] },
    ...overrides
  };
}

describe("attackTriggerManaHeuristicSplit — agent's Klauth-style mana distribution", () => {
  it("splits evenly (round-robin) across the commander's color identity", () => {
    const veyra = seat({
      id: "veyra",
      name: "Veyra",
      kind: "agent",
      board: {
        hand: [],
        battlefield: [],
        commander: card({ id: "klauth", name: "Klauth, Unrivaled Ancient", typeLine: "Legendary Creature — Dragon", colorIdentity: ["R", "G"] })
      }
    });
    const pool = attackTriggerManaHeuristicSplit(veyra, 5);
    expect(pool.R + pool.G).toBe(5);
    expect(pool.W + pool.U + pool.B + pool.C).toBe(0);
    // Round-robin over ["R","G"] for 5 total: R,G,R,G,R -> R=3, G=2
    expect(pool.R).toBe(3);
    expect(pool.G).toBe(2);
  });

  it("falls back to colorless when the commander has no color identity", () => {
    const seatState = seat({
      id: "agent",
      name: "Malik",
      kind: "agent",
      board: { hand: [], battlefield: [], commander: card({ id: "c", name: "Colorless Commander", typeLine: "Legendary Creature", colorIdentity: [] }) }
    });
    const pool = attackTriggerManaHeuristicSplit(seatState, 3);
    expect(pool.C).toBe(3);
    expect(pool.W + pool.U + pool.B + pool.R + pool.G).toBe(0);
  });

  it("returns a pool totaling exactly the requested amount for a mono-colored identity", () => {
    const seatState = seat({
      id: "agent",
      name: "Sable",
      kind: "agent",
      board: { hand: [], battlefield: [], commander: card({ id: "c", name: "Mono Green Commander", typeLine: "Legendary Creature", colorIdentity: ["G"] }) }
    });
    const pool = attackTriggerManaHeuristicSplit(seatState, 7);
    expect(pool.G).toBe(7);
  });
});
