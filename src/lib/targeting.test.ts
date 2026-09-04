import { describe, expect, it } from "vitest";
import { legalTargets, preferredTargets, targetsStillLegal, type TargetSpec } from "./targeting";
import type { GameSession, PlayerSeat, VisibleCard } from "./types";

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

const source = card({ id: "src-1", name: "Doom Blade", typeLine: "Instant", colors: ["B"] });

const baseSpec: TargetSpec = {
  id: "t1",
  zone: "battlefield",
  permanentType: "creature",
  controller: "any",
  min: 1,
  max: 1,
  prompt: "Destroy target creature."
};

describe("legalTargets — battlefield", () => {
  it("returns creatures from both seats when controller is any", () => {
    const mine = card({ id: "mine", name: "Bear", typeLine: "Creature" });
    const theirs = card({ id: "theirs", name: "Wolf", typeLine: "Creature" });
    const s = session([
      seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [mine] } }),
      seat({ id: "opp", name: "Opp", kind: "agent", board: { hand: [], battlefield: [theirs] } })
    ]);

    const result = legalTargets(s, "caster", baseSpec, source);
    expect(result.map((t) => (t.kind === "card" ? t.card.id : ""))).toEqual(["mine", "theirs"]);
  });

  it("excludes non-matching permanent types", () => {
    const land = card({ id: "land-1", name: "Forest", typeLine: "Basic Land — Forest" });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [land] } })]);
    expect(legalTargets(s, "caster", baseSpec, source)).toHaveLength(0);
  });

  it("respects controller: opponent", () => {
    const mine = card({ id: "mine", name: "Bear", typeLine: "Creature" });
    const theirs = card({ id: "theirs", name: "Wolf", typeLine: "Creature" });
    const s = session([
      seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [mine] } }),
      seat({ id: "opp", name: "Opp", kind: "agent", board: { hand: [], battlefield: [theirs] } })
    ]);
    const spec: TargetSpec = { ...baseSpec, controller: "opponent" };
    const result = legalTargets(s, "caster", spec, source);
    expect(result.map((t) => (t.kind === "card" ? t.card.id : ""))).toEqual(["theirs"]);
  });

  it("shroud blocks everyone, including the caster's own permanent", () => {
    const mine = card({ id: "mine", name: "Bear", typeLine: "Creature", oracleText: "Shroud" });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [mine] } })]);
    expect(legalTargets(s, "caster", baseSpec, source)).toHaveLength(0);
  });

  it("hexproof only blocks opponents, not the caster's own permanent", () => {
    const mine = card({ id: "mine", name: "Bear", typeLine: "Creature", oracleText: "Hexproof" });
    const theirs = card({ id: "theirs", name: "Wolf", typeLine: "Creature", oracleText: "Hexproof" });
    const s = session([
      seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [mine] } }),
      seat({ id: "opp", name: "Opp", kind: "agent", board: { hand: [], battlefield: [theirs] } })
    ]);
    const result = legalTargets(s, "caster", baseSpec, source);
    expect(result.map((t) => (t.kind === "card" ? t.card.id : ""))).toEqual(["mine"]);
  });

  it("blocks a target protected from the source's color", () => {
    const theirs = card({ id: "theirs", name: "Wolf", typeLine: "Creature", oracleText: "Protection from black" });
    const s = session([seat({ id: "opp", name: "Opp", kind: "agent", board: { hand: [], battlefield: [theirs] } })]);
    expect(legalTargets(s, "caster", baseSpec, source)).toHaveLength(0);
  });

  it("excludes a phased-out permanent", () => {
    const theirs = card({ id: "theirs", name: "Wolf", typeLine: "Creature", phasedOut: true });
    const s = session([seat({ id: "opp", name: "Opp", kind: "agent", board: { hand: [], battlefield: [theirs] } })]);
    expect(legalTargets(s, "caster", baseSpec, source)).toHaveLength(0);
  });

  it("excludes card ids listed for 'another target creature'", () => {
    const first = card({ id: "first", name: "Bear", typeLine: "Creature" });
    const second = card({ id: "second", name: "Wolf", typeLine: "Creature" });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [first, second] } })]);
    const spec: TargetSpec = { ...baseSpec, excludedCardIds: ["first"] };
    const result = legalTargets(s, "caster", spec, source);
    expect(result.map((t) => (t.kind === "card" ? t.card.id : ""))).toEqual(["second"]);
  });
});

describe("legalTargets — graveyard and library", () => {
  it("pulls creature cards from every seat's graveyard, ignoring battlefield-only checks", () => {
    const dead = card({ id: "dead-1", name: "Bear", typeLine: "Creature", oracleText: "Hexproof" });
    const s = session([seat({ id: "opp", name: "Opp", kind: "agent", board: { hand: [], battlefield: [], graveyard: [dead] } })]);
    const spec: TargetSpec = { ...baseSpec, zone: "graveyard" };
    const result = legalTargets(s, "caster", spec, source);
    expect(result.map((t) => (t.kind === "card" ? t.card.id : ""))).toEqual(["dead-1"]);
  });

  it("only searches the caster's own library when controller is 'you'", () => {
    const mine = card({ id: "mine-lib", name: "Bear", typeLine: "Creature" });
    const theirs = card({ id: "theirs-lib", name: "Wolf", typeLine: "Creature" });
    const s = session([
      seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [] }, library: [mine] }),
      seat({ id: "opp", name: "Opp", kind: "agent", board: { hand: [], battlefield: [] }, library: [theirs] })
    ]);
    const spec: TargetSpec = { ...baseSpec, zone: "library", controller: "you" };
    const result = legalTargets(s, "caster", spec, source);
    expect(result.map((t) => (t.kind === "card" ? t.card.id : ""))).toEqual(["mine-lib"]);
  });
});

describe("legalTargets — player", () => {
  it("targets opponents only when controller is opponent", () => {
    const s = session([
      seat({ id: "caster", name: "Me", kind: "human" }),
      seat({ id: "opp1", name: "Opp1", kind: "agent" }),
      seat({ id: "opp2", name: "Opp2", kind: "agent", hasLost: true })
    ]);
    const spec: TargetSpec = { id: "p1", zone: "player", controller: "opponent", min: 1, max: 1, prompt: "Target player draws a card." };
    const result = legalTargets(s, "caster", spec, source);
    expect(result).toEqual([{ kind: "player", seatId: "opp1" }]);
  });
});

describe("targetsStillLegal", () => {
  it("fizzles once the chosen opponent creature gains hexproof after being targeted", () => {
    const theirs = card({ id: "theirs", name: "Wolf", typeLine: "Creature" });
    const before = session([seat({ id: "opp", name: "Opp", kind: "agent", board: { hand: [], battlefield: [theirs] } })]);
    const chosen = [{ kind: "card" as const, seatId: "opp", cardId: "theirs" }];
    expect(targetsStillLegal(before, "caster", baseSpec, source, chosen)).toBe(true);

    const grantedHexproof = card({ ...theirs, oracleText: "Hexproof" });
    const after = session([seat({ id: "opp", name: "Opp", kind: "agent", board: { hand: [], battlefield: [grantedHexproof] } })]);
    expect(targetsStillLegal(after, "caster", baseSpec, source, chosen)).toBe(false);
  });

  it("fizzles once the chosen creature leaves the battlefield entirely", () => {
    const s = session([seat({ id: "opp", name: "Opp", kind: "agent", board: { hand: [], battlefield: [] } })]);
    const chosen = [{ kind: "card" as const, seatId: "opp", cardId: "theirs" }];
    expect(targetsStillLegal(s, "caster", baseSpec, source, chosen)).toBe(false);
  });
});

describe("preferredTargets", () => {
  it("biggest_opponent_threat picks the opponent's highest power+toughness creature", () => {
    const small = card({ id: "small", name: "Bear", typeLine: "Creature", power: "1", toughness: "1" });
    const big = card({ id: "big", name: "Dragon", typeLine: "Creature", power: "5", toughness: "5" });
    const mine = card({ id: "mine", name: "MyBear", typeLine: "Creature", power: "9", toughness: "9" });
    const s = session([
      seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [mine] } }),
      seat({ id: "opp", name: "Opp", kind: "agent", board: { hand: [], battlefield: [small, big] } })
    ]);
    const result = preferredTargets(s, "caster", baseSpec, source, "biggest_opponent_threat");
    expect(result).toEqual([{ kind: "card", seatId: "opp", cardId: "big" }]);
  });

  it("smallest_own_creature picks the caster's own weakest creature", () => {
    const weak = card({ id: "weak", name: "Bear", typeLine: "Creature", power: "1", toughness: "1" });
    const strong = card({ id: "strong", name: "Dragon", typeLine: "Creature", power: "5", toughness: "5" });
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [weak, strong] } })]);
    const spec: TargetSpec = { ...baseSpec, controller: "you" };
    const result = preferredTargets(s, "caster", spec, source, "smallest_own_creature");
    expect(result).toEqual([{ kind: "card", seatId: "caster", cardId: "weak" }]);
  });

  it("lowest_life_opponent targets the opponent closest to death", () => {
    const s = session([
      seat({ id: "caster", name: "Me", kind: "human", life: 40 }),
      seat({ id: "opp1", name: "Opp1", kind: "agent", life: 30 }),
      seat({ id: "opp2", name: "Opp2", kind: "agent", life: 5 })
    ]);
    const spec: TargetSpec = { id: "p1", zone: "player", controller: "opponent", min: 1, max: 1, prompt: "" };
    const result = preferredTargets(s, "caster", spec, source, "lowest_life_opponent");
    expect(result).toEqual([{ kind: "player", seatId: "opp2" }]);
  });

  it("returns an empty array when there is no legal target", () => {
    const s = session([seat({ id: "caster", name: "Me", kind: "human", board: { hand: [], battlefield: [] } })]);
    expect(preferredTargets(s, "caster", baseSpec, source, "biggest_opponent_threat")).toEqual([]);
  });
});
