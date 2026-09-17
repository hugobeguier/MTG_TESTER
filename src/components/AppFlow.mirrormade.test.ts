import { describe, expect, it } from "vitest";
import { playCardFromZone } from "./AppFlow";
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
    turn: 3,
    xmage: { enabled: false, status: "not_configured", message: "" },
    seats,
    events: []
  };
}

const MIRRORMADE_TEXT = "You may have this enchantment enter as a copy of any artifact or enchantment on the battlefield.";

function mirrormade(): VisibleCard {
  return card({
    id: "mirrormade",
    name: "Mirrormade",
    typeLine: "Enchantment",
    oracleText: MIRRORMADE_TEXT,
    manaCost: "{2}{U}",
    manaValue: 3,
    colors: ["U"],
    imageUris: { normal: "mirrormade.jpg" }
  });
}

// Reported live: "Mirrormade must be cast as a copy of another enchantment or artifact that is out
// on the battlefield" not working — the engine only ever recognized Estrid's Invocation's narrower
// "an enchantment you control" wording, so Mirrormade's real "any artifact or enchantment on the
// battlefield" text matched nothing and it entered as a blank, uncopied enchantment.
describe("playCardFromZone — Mirrormade's 'enter as a copy of any artifact or enchantment on the battlefield'", () => {
  it("copies an OPPONENT's artifact (not just the caster's own enchantments)", () => {
    const solRing = card({
      id: "sol-ring",
      name: "Sol Ring",
      typeLine: "Artifact",
      oracleText: "{T}: Add {C}{C}.",
      manaCost: "{1}",
      manaValue: 1,
      colors: [],
      imageUris: { normal: "sol-ring.jpg" }
    });
    const opponent = seat({ id: "opponent", name: "Opponent", kind: "human", board: { hand: [], battlefield: [solRing] } });
    const caster = seat({ id: "caster", name: "Caster", kind: "human", board: { hand: [mirrormade()], battlefield: [] } });

    const result = playCardFromZone(session([opponent, caster]), "caster", "mirrormade", undefined, undefined, "battlefield");
    const after = result.seats.find((s) => s.id === "caster")!;
    const permanent = after.board.battlefield.find((c) => c.id === "mirrormade");

    expect(permanent?.name).toBe("Sol Ring");
    expect(permanent?.typeLine).toBe("Artifact");
    expect(permanent?.oracleText).toBe("{T}: Add {C}{C}.");
    expect(permanent?.manaCost).toBe("{1}");
    expect(permanent?.imageUris?.normal).toBe("sol-ring.jpg");
    // The permanent it copied it from must be untouched.
    const opponentAfter = result.seats.find((s) => s.id === "opponent")!;
    expect(opponentAfter.board.battlefield.map((c) => c.id)).toEqual(["sol-ring"]);
    expect(result.events[0].message).toContain("It enters as a copy of Sol Ring.");
  });

  it("prefers the caster's own permanent over an opponent's when both are eligible", () => {
    const ownEnchantment = card({ id: "own-ench", name: "Rhystic Study", typeLine: "Enchantment", oracleText: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}." });
    const opponentArtifact = card({ id: "opp-art", name: "Sol Ring", typeLine: "Artifact", oracleText: "{T}: Add {C}{C}." });
    const opponent = seat({ id: "opponent", name: "Opponent", kind: "human", board: { hand: [], battlefield: [opponentArtifact] } });
    const caster = seat({ id: "caster", name: "Caster", kind: "human", board: { hand: [mirrormade()], battlefield: [ownEnchantment] } });

    const result = playCardFromZone(session([opponent, caster]), "caster", "mirrormade", undefined, undefined, "battlefield");
    const after = result.seats.find((s) => s.id === "caster")!;
    const permanent = after.board.battlefield.find((c) => c.id === "mirrormade");
    expect(permanent?.name).toBe("Rhystic Study");
  });

  it("enters as a blank enchantment when nothing eligible is on the battlefield", () => {
    const caster = seat({ id: "caster", name: "Caster", kind: "human", board: { hand: [mirrormade()], battlefield: [] } });
    const result = playCardFromZone(session([caster]), "caster", "mirrormade", undefined, undefined, "battlefield");
    const after = result.seats.find((s) => s.id === "caster")!;
    const permanent = after.board.battlefield.find((c) => c.id === "mirrormade");
    expect(permanent?.name).toBe("Mirrormade");
  });

  // Regression guard: Estrid's Invocation's narrower "an enchantment you control" wording must keep
  // ignoring both artifacts and opponents' permanents, unchanged by Mirrormade's broader support.
  it("still restricts Estrid's Invocation to the caster's own enchantments (not artifacts, not opponents')", () => {
    const estrid = card({
      id: "estrid",
      name: "Estrid's Invocation",
      typeLine: "Enchantment",
      oracleText: 'You may have this enchantment enter as a copy of an enchantment you control, except it has "{4}: Draw a card."'
    });
    const ownArtifact = card({ id: "own-art", name: "Sol Ring", typeLine: "Artifact", oracleText: "{T}: Add {C}{C}." });
    const opponentEnchantment = card({ id: "opp-ench", name: "Rhystic Study", typeLine: "Enchantment", oracleText: "Whenever an opponent casts a spell, draw a card." });
    const opponent = seat({ id: "opponent", name: "Opponent", kind: "human", board: { hand: [], battlefield: [opponentEnchantment] } });
    const caster = seat({ id: "caster", name: "Caster", kind: "human", board: { hand: [estrid], battlefield: [ownArtifact] } });

    const result = playCardFromZone(session([opponent, caster]), "caster", "estrid", undefined, undefined, "battlefield");
    const after = result.seats.find((s) => s.id === "caster")!;
    const permanent = after.board.battlefield.find((c) => c.id === "estrid");
    // Neither the caster's own artifact nor the opponent's enchantment is a legal target, so it
    // enters blank, same as before Mirrormade's broader shape was recognized.
    expect(permanent?.name).toBe("Estrid's Invocation");
  });
});
