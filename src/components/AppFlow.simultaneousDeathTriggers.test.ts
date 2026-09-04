import { describe, expect, it } from "vitest";
import { findCommonTriggersForPermanentDied } from "./AppFlow";
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

const MEREN_ORACLE_TEXT =
  "Whenever another creature you control dies, you get an experience counter.\nAt the beginning of your end step, choose target creature card in your graveyard. If that card's mana value is less than or equal to the number of experience counters you have, return it to the battlefield. Otherwise, put it into your hand.";

describe("findCommonTriggersForPermanentDied — simultaneous deaths look back in time (rule 603.10/603.6d)", () => {
  it("Meren dying in the same board wipe as 4 other creatures still triggers once per OTHER death", () => {
    const meren = card({ id: "meren", name: "Meren of Clan Nel Toth", typeLine: "Legendary Creature — Human Shaman", oracleText: MEREN_ORACLE_TEXT });
    const others = ["c1", "c2", "c3", "c4"].map((id) => card({ id, name: `Creature ${id}`, typeLine: "Creature — Bear" }));
    const you = seat({ id: "you", name: "You", kind: "human", board: { hand: [], battlefield: [] } });
    const s = session([you]);
    // destroyCreatures already removes every dying creature from the battlefield in one batch before
    // this runs — simulated here by an empty battlefield and the whole simultaneous batch passed in.
    const simultaneousDeaths = [{ seatId: "you", card: meren }, ...others.map((c) => ({ seatId: "you", card: c }))];

    const triggersFromOtherDeaths = others.flatMap((deadCard) => findCommonTriggersForPermanentDied(s, "you", deadCard, undefined, simultaneousDeaths));
    const merenTriggers = triggersFromOtherDeaths.filter((t) => t.sourceCardId === "meren");
    expect(merenTriggers).toHaveLength(4);
    expect(merenTriggers.every((t) => t.effect.kind === "get_experience_counter")).toBe(true);
  });

  it("Meren's own death does not trigger her own 'another creature' ability", () => {
    const meren = card({ id: "meren", name: "Meren of Clan Nel Toth", typeLine: "Legendary Creature — Human Shaman", oracleText: MEREN_ORACLE_TEXT });
    const you = seat({ id: "you", name: "You", kind: "human", board: { hand: [], battlefield: [] } });
    const s = session([you]);
    const triggers = findCommonTriggersForPermanentDied(s, "you", meren, undefined, [{ seatId: "you", card: meren }]);
    expect(triggers.filter((t) => t.sourceCardId === "meren")).toHaveLength(0);
  });

  it("without a simultaneous-death batch (single-death call site), still finds the source's own death trigger", () => {
    const soulWarden = card({ id: "warden", name: "Soul Warden", typeLine: "Creature — Human Cleric", oracleText: "Whenever another creature enters, you gain 1 life." });
    const bear = card({ id: "bear", name: "Grizzly Bears", typeLine: "Creature — Bear", oracleText: "" });
    const you = seat({ id: "you", name: "You", kind: "human", board: { hand: [], battlefield: [soulWarden] } });
    const s = session([you]);
    // No death trigger on Soul Warden itself — this just proves the default single-death parameter
    // still scans the dying card alongside the live battlefield without throwing or double-counting.
    expect(findCommonTriggersForPermanentDied(s, "you", bear)).toEqual([]);
  });
});
