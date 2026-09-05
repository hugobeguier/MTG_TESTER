import { describe, expect, it } from "vitest";
import { applyRemovalEffect, parseCreateTokenSpecs } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const PEST_INFESTATION_ORACLE_TEXT =
  'Destroy up to X target artifacts and/or enchantments. Create twice X 1/1 black and green Pest creature tokens with "When this token dies, you gain 1 life."';

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

describe("parseCreateTokenSpecs — Pest Infestation's \"twice X\" token count", () => {
  it("yields twice chosenX tokens when chosenX is available", () => {
    const specs = parseCreateTokenSpecs(PEST_INFESTATION_ORACLE_TEXT, undefined, undefined, 3);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ count: 6, name: expect.stringContaining("Pest") });
  });

  it("declines the token creation (rather than guessing) with no chosenX available", () => {
    expect(parseCreateTokenSpecs(PEST_INFESTATION_ORACLE_TEXT)).toEqual([]);
  });
});

describe("applyRemovalEffect — destroy_up_to_x (Pest Infestation)", () => {
  const pestInfestation = card({ id: "pest-infestation", name: "Pest Infestation", typeLine: "Sorcery", oracleText: PEST_INFESTATION_ORACLE_TEXT });

  it("destroys exactly chosenX legal targets, not more, not fewer when enough exist", () => {
    const artifacts = Array.from({ length: 3 }, (_, i) => card({ id: `art-${i}`, name: `Artifact ${i}`, typeLine: "Artifact" }));
    const caster = seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: artifacts } });
    const s = session([caster]);
    const effect = { kind: "destroy_up_to_x" as const, targetType: "artifact_or_enchantment" as const };
    const result = applyRemovalEffect(s, "caster", "Pest Infestation", pestInfestation, effect, 2);
    const after = result.seats.find((item) => item.id === "caster")!;
    expect(after.board.battlefield).toHaveLength(1);
    expect(after.board.graveyard).toHaveLength(2);
  });

  it("destroys nothing (no error) when chosenX is 0", () => {
    const artifacts = [card({ id: "art-0", name: "Artifact 0", typeLine: "Artifact" })];
    const caster = seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: artifacts } });
    const s = session([caster]);
    const effect = { kind: "destroy_up_to_x" as const, targetType: "artifact_or_enchantment" as const };
    const result = applyRemovalEffect(s, "caster", "Pest Infestation", pestInfestation, effect, 0);
    const after = result.seats.find((item) => item.id === "caster")!;
    expect(after.board.battlefield).toHaveLength(1);
    expect(after.board.graveyard ?? []).toHaveLength(0);
  });

  it("destroys whatever legal targets exist even when fewer than chosenX", () => {
    const artifacts = [card({ id: "art-0", name: "Artifact 0", typeLine: "Artifact" })];
    const caster = seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: artifacts } });
    const s = session([caster]);
    const effect = { kind: "destroy_up_to_x" as const, targetType: "artifact_or_enchantment" as const };
    const result = applyRemovalEffect(s, "caster", "Pest Infestation", pestInfestation, effect, 5);
    const after = result.seats.find((item) => item.id === "caster")!;
    expect(after.board.battlefield).toHaveLength(0);
    expect(after.board.graveyard).toHaveLength(1);
  });
});
