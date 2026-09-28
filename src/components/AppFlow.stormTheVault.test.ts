// Storm the Vault has no mana ability of its own — its real abilities are "create a Treasure token
// whenever your creatures deal combat damage" and an end-step transform condition. But its oracle
// text describes the TREASURE TOKEN's own ability in a parenthetical: "(It's an artifact with \"{T},
// Sacrifice this token: Add one mana of any color.\")". Every mana-ability regex used to read raw
// oracleText with no reminder-text stripping, so this card was misread as having that ability
// itself — including the "sacrifice this token" clause, which made spendManaSources treat CASTING
// Storm the Vault's OWN permanent as a sacrifice-to-use mana rock. Caught live by self-play's
// anomaly detector (silent_death_after_etb): Storm the Vault entered the battlefield, then vanished
// into the graveyard the very next time its controller cast something else, with no log entry
// naming it, because it had been spent as a mana source.
import { describe, expect, it } from "vitest";
import { chooseManaSourcesForCost, isAvailableManaSource, manaChoicesForCard } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const STORM_THE_VAULT_ORACLE_TEXT =
  "Whenever one or more creatures you control deal combat damage to a player, create a Treasure token. (It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")\nAt the beginning of your end step, if you control five or more artifacts, transform Storm the Vault.";

function stormTheVault(overrides: Partial<VisibleCard> = {}): VisibleCard {
  return {
    id: "storm-the-vault",
    name: "Storm the Vault",
    typeLine: "Legendary Enchantment",
    oracleText: STORM_THE_VAULT_ORACLE_TEXT,
    manaCost: "{2}{U}{R}",
    manaValue: 4,
    colors: ["U", "R"],
    role: "permanent",
    zone: "battlefield",
    ...overrides
  };
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

describe("Storm the Vault — reminder text describing a Treasure token isn't this card's own ability", () => {
  it("is not treated as an available mana source", () => {
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [stormTheVault()] } });
    expect(isAvailableManaSource(stormTheVault(), player)).toBe(false);
    expect(manaChoicesForCard(stormTheVault(), player)).toEqual([]);
  });

  it("is never chosen to pay a cost, even when it's the only untapped permanent", () => {
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [stormTheVault()] } });
    const genericCostShim: VisibleCard = { ...stormTheVault(), id: "cost-shim", oracleText: "", manaCost: "{1}" };
    const payment = chooseManaSourcesForCost(player, genericCostShim, 1, undefined, [player]);
    expect(payment.ok).toBe(false);
  });

  it("still lets a REAL Treasure token (not reminder text about one) act as a mana source", () => {
    const treasure: VisibleCard = {
      id: "treasure-1",
      name: "Treasure",
      typeLine: "Token Artifact",
      oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.',
      manaValue: 0,
      colors: [],
      role: "permanent",
      zone: "battlefield",
      token: true
    };
    const player = seat({ id: "p", name: "You", kind: "human", board: { hand: [], battlefield: [treasure] } });
    expect(isAvailableManaSource(treasure, player)).toBe(true);
    expect(manaChoicesForCard(treasure, player)).toEqual(expect.arrayContaining(["W", "U", "B", "R", "G"]));
  });
});
