import { describe, expect, it } from "vitest";
import { applyMassPumpEffect, runStateBasedActionsPass } from "./AppFlow";
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

// Runs runStateBasedActionsPass to a fixed point, the same way checkStateBasedActions does.
function settle(input: GameSession): GameSession {
  let current = input;
  for (let guard = 0; guard < 10; guard += 1) {
    const result = runStateBasedActionsPass(current);
    current = result.session;
    if (!result.changed) break;
  }
  return current;
}

describe("Chief of the Foundry's anthem surviving a Doomwake-Giant-style opponents' -1/-1", () => {
  it("keeps a 1/1 artifact creature alive at 1 toughness after +1/+1 anthem then -1/-1 until end of turn", () => {
    const chief = card({
      id: "chief",
      name: "Chief of the Foundry",
      typeLine: "Artifact Creature — Construct",
      oracleText: "Other artifact creatures you control get +1/+1.",
      power: "2",
      toughness: "2"
    });
    const servo = card({ id: "servo", name: "Servo", typeLine: "Artifact Creature — Servo", power: "1", toughness: "1", token: true });
    const malik = seat({ id: "malik", name: "Malik", kind: "agent", board: { hand: [], battlefield: [chief, servo] } });
    const human = seat({ id: "human", name: "Human", kind: "human" });

    // Let the anthem settle first, the same way a real game would have it already settled by the
    // time a later trigger applies a separate temporary debuff — not the very same state-based-action
    // pass that introduces the anthem.
    const settled = settle(session([malik, human]));
    const settledServo = settled.seats.find((s) => s.id === "malik")!.board.battlefield.find((c) => c.id === "servo")!;
    expect(settledServo.attachmentPowerBonus ?? 0).toBe(1);
    expect(settledServo.attachmentToughnessBonus ?? 0).toBe(1);

    // Doomwake Giant's real oracle text: "creatures your opponents control get -1/-1 until end of
    // turn" — scope "opponents" relative to whoever controls Doomwake Giant (here, the human).
    const debuffed = applyMassPumpEffect(settled, "human", "Doomwake Giant", { power: -1, toughness: -1, scope: "opponents" });
    const finalState = settle(debuffed);

    const finalMalik = finalState.seats.find((s) => s.id === "malik")!;
    const finalServo = finalMalik.board.battlefield.find((c) => c.id === "servo");
    expect(finalServo).toBeDefined();
    expect(finalMalik.board.graveyard ?? []).toHaveLength(0);
  });
});
