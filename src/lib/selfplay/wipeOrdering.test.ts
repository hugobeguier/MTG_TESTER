// End-to-end ordering through the self-play orchestrator (not just single-action scoring): with a castable, net-positive Wrath of God in
// hand, the agent casts the wipe BEFORE deploying, and with limited mana it wipes and deploys what is left instead of deploying first.
import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { runStateBasedActionsPass } from "@/components/AppFlow";
import { heuristicBrain } from "./brains";
import { createSelfPlayGame, playGame } from "./orchestrator";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
let counter = 0;
function real(name: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  counter += 1;
  const isLand = (found.typeLine ?? "").includes("Land");
  return { manaValue: 0, colors: [], role: isLand ? "land" : "permanent", zone: "hand", typeLine: "", oracleText: "", ...found, id: `t-${name}-${counter}`, ...extra } as VisibleCard;
}

function setup(handNames: string[], lands: number): GameSession {
  const base = createSelfPlayGame({ deckListPaths: ["decks/foundations/WretchedRanks.txt", "decks/foundations/CallingAllAngels.txt"], seatNames: ["A", "B"], forceFirstSeatIndex: 0, seed: 11 });
  const seats = base.seats.map((seat, index): PlayerSeat => {
    if (index === 0) {
      const plains = Array.from({ length: lands }, () => real("Plains", { zone: "battlefield" }));
      return { ...seat, board: { ...seat.board, hand: handNames.map((name) => real(name)), battlefield: plains } };
    }
    const giants = [real("Hill Giant", { zone: "battlefield", summoningSick: false }), real("Hill Giant", { zone: "battlefield", summoningSick: false })];
    return { ...seat, board: { ...seat.board, hand: [], battlefield: giants } };
  });
  return runStateBasedActionsPass({ ...base, seats }).session;
}

async function firstTurnCasts(session: GameSession): Promise<{ casts: string[]; final: GameSession }> {
  const brains = Object.fromEntries(session.seats.map((seat) => [seat.id, heuristicBrain]));
  const result = await playGame(session, brains, { turnCap: 1 });
  const casts = [...result.session.events].reverse().map((event) => event.message).filter((message) => /^A casts /.test(message)).map((message) => message.replace(/^A casts /, "").replace(/\.$/, ""));
  return { casts, final: result.session };
}

describe("wipe first, then deploy (whole turn)", () => {
  it("with mana for both, casts Wrath of God before the creature", async () => {
    const { casts, final } = await firstTurnCasts(setup(["Serra Angel", "Wrath of God"], 9));
    expect(casts.indexOf("Wrath of God")).toBeGreaterThanOrEqual(0);
    expect(casts.indexOf("Serra Angel")).toBeGreaterThan(casts.indexOf("Wrath of God"));
    const mine = final.seats[0].board.battlefield.map((card) => card.name);
    expect(mine).toContain("Serra Angel");
    expect(final.seats[1].board.battlefield.some((card) => card.name === "Hill Giant")).toBe(false);
  });

  it("with limited mana, wipes first and deploys the cheap creature with what is left", async () => {
    const { casts, final } = await firstTurnCasts(setup(["Savannah Lions", "Serra Angel", "Wrath of God"], 6));
    expect(casts[0]).toBe("Wrath of God");
    expect(casts).toContain("Savannah Lions");
    expect(casts).not.toContain("Serra Angel"); // 6 mana: Wrath (4) leaves only 2
    expect(final.seats[0].board.battlefield.map((card) => card.name)).toContain("Savannah Lions");
    expect(final.seats[1].board.battlefield.some((card) => card.name === "Hill Giant")).toBe(false);
  });

  it("never casts the wipe over a creature it just cast when the wipe is marginal", async () => {
    // One Hill Giant against the agent: wiping would cost it the fresh Serra Angel for little.
    const session = setup(["Serra Angel", "Wrath of God"], 9);
    const trimmed = { ...session, seats: session.seats.map((seat, i) => (i === 1 ? { ...seat, board: { ...seat.board, battlefield: seat.board.battlefield.slice(0, 1) } } : seat)) };
    const { casts } = await firstTurnCasts(trimmed);
    const wrathAfterAngel = casts.indexOf("Wrath of God") > casts.indexOf("Serra Angel") && casts.indexOf("Serra Angel") >= 0;
    expect(wrathAfterAngel).toBe(false);
  });
});

describe("every battlefield entry path is stamped with its entry turn", () => {
  it("a token that never went through playCardFromZone gets enteredTurn, so Blasphemous Act/Wrath see it as fresh", () => {
    const base = setup(["Wrath of God"], 4);
    const token = { ...real("Hill Giant", { zone: "battlefield" }), name: "Dragon Token", token: true, enteredTurn: undefined } as VisibleCard;
    const withToken: GameSession = { ...base, turn: 9, seats: base.seats.map((seat, i) => (i === 0 ? { ...seat, board: { ...seat.board, battlefield: [...seat.board.battlefield, token] } } : seat)) };
    const stamped = runStateBasedActionsPass(withToken).session;
    expect(stamped.seats[0].board.battlefield.find((card) => card.name === "Dragon Token")?.enteredTurn).toBe(9);
    // Older permanents keep their own turn.
    expect(stamped.seats[0].board.battlefield.find((card) => card.name === "Plains")?.enteredTurn).toBeDefined();
  });
});
