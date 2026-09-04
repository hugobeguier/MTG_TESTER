import { describe, expect, it } from "vitest";
import { resolveEquip } from "./AppFlow";
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

// Equip {0} so these targeting-focused tests aren't tangled up with mana payment (already covered
// by src/lib/attachments.test.ts's equipCost tests and AppFlow.manaAbilityCost.test.ts's payment tests).
const BOOTS = card({ id: "boots", name: "Swiftfoot Boots", typeLine: "Artifact — Equipment", oracleText: "Equipped creature has haste and hexproof.\nEquip {0}" });

describe("resolveEquip — a human's explicitly chosen target (choose_equip_target)", () => {
  it("attaches to the chosen creature, not the auto-pick heuristic's biggest creature", () => {
    const small = card({ id: "small", name: "Small Creature", typeLine: "Creature — Bear", power: "1", toughness: "1" });
    const big = card({ id: "big", name: "Big Creature", typeLine: "Creature — Giant", power: "9", toughness: "9" });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [BOOTS, small, big] } })]);
    const result = resolveEquip(s, "caster", "boots", undefined, "small");
    expect(result).toBeDefined();
    const boots = result!.session.seats[0].board.battlefield.find((c) => c.id === "boots");
    expect(boots?.attachedToId).toBe("small");
  });

  it("allows re-equipping to the SAME creature it's already attached to (a real, if pointless, choice)", () => {
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear" });
    const bootsAttached = { ...BOOTS, attachedToId: "bear", attachTimestamp: 1 };
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [bootsAttached, bear] } })]);
    const result = resolveEquip(s, "caster", "boots", undefined, "bear");
    expect(result).toBeDefined();
    const boots = result!.session.seats[0].board.battlefield.find((c) => c.id === "boots");
    expect(boots?.attachedToId).toBe("bear");
  });

  it("refuses a pre-chosen target that isn't actually a creature", () => {
    const land = card({ id: "land", name: "Forest", typeLine: "Basic Land — Forest" });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [BOOTS, land] } })]);
    expect(resolveEquip(s, "caster", "boots", undefined, "land")).toBeUndefined();
  });

  it("agent path (no preChosenTargetId) is unaffected — still auto-picks the biggest creature", () => {
    const small = card({ id: "small", name: "Small Creature", typeLine: "Creature — Bear", power: "1", toughness: "1" });
    const big = card({ id: "big", name: "Big Creature", typeLine: "Creature — Giant", power: "9", toughness: "9" });
    const s = session([seat({ id: "agent", name: "Veyra", kind: "agent", board: { hand: [], battlefield: [BOOTS, small, big] } })]);
    const result = resolveEquip(s, "agent", "boots", undefined);
    expect(result).toBeDefined();
    const boots = result!.session.seats[0].board.battlefield.find((c) => c.id === "boots");
    expect(boots?.attachedToId).toBe("big");
  });
});
