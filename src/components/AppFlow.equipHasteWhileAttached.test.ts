import { describe, expect, it } from "vitest";
import { runStateBasedActionsPass } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", power: "2", toughness: "2", ...overrides };
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

const BOOTS_ORACLE_TEXT = "Equipped creature has haste and hexproof.\nEquip {1}";

describe("runStateBasedActionsPass — equipment-granted keywords only apply while actually attached", () => {
  it("grants haste/hexproof to a creature the equipment is attached to", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const boots = card({ id: "boots", name: "Swiftfoot Boots", typeLine: "Artifact — Equipment", oracleText: BOOTS_ORACLE_TEXT, attachedToId: "bear", attachTimestamp: 1 });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [bear, boots] } })]);
    const result = runStateBasedActionsPass(s).session;
    const bearAfter = result.seats[0].board.battlefield.find((c) => c.id === "bear");
    expect(bearAfter?.grantedKeywords).toEqual(expect.arrayContaining(["haste", "hexproof"]));
  });

  it("does NOT grant haste/hexproof once the equipment is unattached", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const boots = card({ id: "boots", name: "Swiftfoot Boots", typeLine: "Artifact — Equipment", oracleText: BOOTS_ORACLE_TEXT, attachedToId: undefined });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [bear, boots] } })]);
    const result = runStateBasedActionsPass(s).session;
    const bearAfter = result.seats[0].board.battlefield.find((c) => c.id === "bear");
    expect(bearAfter?.grantedKeywords ?? []).not.toContain("haste");
    expect(bearAfter?.grantedKeywords ?? []).not.toContain("hexproof");
  });

  it("does not grant haste/hexproof to a DIFFERENT creature the equipment isn't attached to", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const otherBear = card({ id: "other-bear", name: "Other Bear", typeLine: "Creature — Bear" });
    const boots = card({ id: "boots", name: "Swiftfoot Boots", typeLine: "Artifact — Equipment", oracleText: BOOTS_ORACLE_TEXT, attachedToId: "bear", attachTimestamp: 1 });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [bear, otherBear, boots] } })]);
    const result = runStateBasedActionsPass(s).session;
    const otherBearAfter = result.seats[0].board.battlefield.find((c) => c.id === "other-bear");
    expect(otherBearAfter?.grantedKeywords ?? []).not.toContain("haste");
  });
});
