import { describe, expect, it } from "vitest";
import { runStateBasedActionsPass } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

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

function session(seats: PlayerSeat[]): GameSession {
  return {
    id: "test",
    createdAt: "",
    status: "playing",
    phase: "precombat main phase",
    turn: 1,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

// Runs runStateBasedActionsPass to a fixed point, same as AppFlow.doomwakeGiant.test.ts's own
// helper (mirroring how checkStateBasedActions drives this in the real app).
function settle(input: GameSession): GameSession {
  let current = input;
  for (let guard = 0; guard < 10; guard += 1) {
    const result = runStateBasedActionsPass(current);
    current = result.session;
    if (!result.changed) break;
  }
  return current;
}

// Real oracle text, verified via this codebase's local card database.
const DARKSTEEL_JUGGERNAUT_ORACLE_TEXT =
  "Indestructible\nDarksteel Juggernaut's power and toughness are each equal to the number of artifacts you control.\nThis creature attacks each combat if able.";

function darksteelJuggernaut(): VisibleCard {
  return card({
    id: "juggernaut",
    name: "Darksteel Juggernaut",
    typeLine: "Artifact Creature — Juggernaut",
    oracleText: DARKSTEEL_JUGGERNAUT_ORACLE_TEXT,
    power: "*",
    toughness: "*"
  });
}

describe("Darksteel Juggernaut's power/toughness CDA", () => {
  it("does not die the instant it enters when it and another artifact give it toughness > 0 (reported live)", () => {
    const otherArtifact = card({ id: "sol-ring", name: "Sol Ring", typeLine: "Artifact" });
    const player = seat({ id: "p", name: "Player", kind: "agent", board: { hand: [], battlefield: [darksteelJuggernaut(), otherArtifact] } });
    const settled = settle(session([player]));
    const after = settled.seats.find((s) => s.id === "p")!;
    expect(after.board.battlefield.some((c) => c.id === "juggernaut")).toBe(true);
    expect(after.board.graveyard ?? []).toHaveLength(0);
  });

  it("still counts itself as one of the artifacts, surviving alone with no other artifacts on the battlefield", () => {
    const player = seat({ id: "p", name: "Player", kind: "agent", board: { hand: [], battlefield: [darksteelJuggernaut()] } });
    const settled = settle(session([player]));
    const after = settled.seats.find((s) => s.id === "p")!;
    expect(after.board.battlefield.some((c) => c.id === "juggernaut")).toBe(true);
    expect(after.board.graveyard ?? []).toHaveLength(0);
  });

  it("still correctly dies to the toughness-0 rule when it genuinely has zero toughness (regression guard)", () => {
    // A hypothetical CDA creature with no such exception carved out — the fix must not make every
    // 0-toughness creature immortal, only stop a CDA creature from being judged before its own CDA
    // has ever been computed.
    const zeroToughnessCreature = card({ id: "zero", name: "Truly Zero", typeLine: "Creature — Test", power: "0", toughness: "0" });
    const player = seat({ id: "p", name: "Player", kind: "agent", board: { hand: [], battlefield: [zeroToughnessCreature] } });
    const settled = settle(session([player]));
    const after = settled.seats.find((s) => s.id === "p")!;
    expect(after.board.battlefield.some((c) => c.id === "zero")).toBe(false);
    expect(after.board.graveyard?.some((c) => c.id === "zero")).toBe(true);
  });
});
