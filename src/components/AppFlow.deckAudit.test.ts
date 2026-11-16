// Cross-deck audit regressions (every deck list): conditional enters-tapped lands, plain-{T} mana colors vs. costly/conditional/filter abilities,
// and dynamic token counts. Each case drives the REAL catalog text through the same entry points the live game uses.
import { describe, expect, it } from "vitest";
import { applyDeterministicPhaseTrigger, destroyCreatures, entersBattlefieldTapped, findCommonTriggersForPermanentDied, isAvailableManaSource, manaChoicesForCard, parseCreateTokenSpecs, resolveTriggerEffect } from "./AppFlow";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const bear = (id: string, extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;
function seat(id: string, battlefield: VisibleCard[], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return {
    id, name: id, kind: "agent", life: 40, commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield, graveyard: [] }, deck: { colors: ["W", "U", "B", "R", "G"] }, ...extra
  } as PlayerSeat;
}
function session(seats: PlayerSeat[], extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "end step", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra };
}
const colors = (card: VisibleCard, s: PlayerSeat) => manaChoicesForCard(card, s, [s]).slice().sort().join("");
const tokenNames = (s: GameSession) => s.seats[0].board.battlefield.filter((c) => c.token && c.name === "Treasure").map((c) => c.name);

describe("Vault of Champions: enters tapped unless you have two or more opponents", () => {
  it("is tapped in a 1v1 and untapped in a pod with two opponents", () => {
    const vault = real("Vault of Champions", "v");
    const me = seat("a", []);
    expect(entersBattlefieldTapped(vault, me, [me, seat("o1", [])])).toBe(true);
    expect(entersBattlefieldTapped(vault, me, [me, seat("o1", []), seat("o2", [])])).toBe(false);
  });
});

describe("free-tap colors ignore costly, conditional and filter abilities", () => {
  const me = seat("a", []);
  it("Fetid Heath's {W/B} filter ability leaves only {C} free", () => {
    expect(colors(real("Fetid Heath", "f"), me)).toBe("C");
  });
  it("Prismatic Lens and Cascading Cataracts: their {1}/{5} 'any color' ability is not a free tap", () => {
    expect(colors(real("Prismatic Lens", "p"), me)).toBe("C");
    expect(colors(real("Cascading Cataracts", "c"), me)).toBe("C");
  });
  it("Tainted Field: the {W} or {B} ability needs a Swamp, and BOTH colors are blocked without one", () => {
    const field = real("Tainted Field", "tf");
    expect(colors(field, me)).toBe("C");
    const swamp = { ...bear("sw"), name: "Swamp", typeLine: "Basic Land — Swamp" } as VisibleCard;
    expect(colors(field, seat("a", [swamp]))).toBe("BCW");
  });
  it("Orzhov Signet makes only W and B (not the commander's colors), and Ramos' counter-removal ability is no free mana", () => {
    expect(colors(real("Orzhov Signet", "s"), me)).toBe("BW");
    expect(isAvailableManaSource(real("Ramos, Dragon Engine", "r"), me, [me])).toBe(false);
  });
});

describe("dynamic token counts", () => {
  it("Felisa makes X tapped Inklings, X = every counter on the creature that died", () => {
    const felisa = real("Felisa, Fang of Silverquill", "f");
    const dead = bear("d", { counters: [{ kind: "+1/+1", count: 2 }, { kind: "shield", count: 1 }] } as Partial<VisibleCard>);
    const dying = destroyCreatures(session([seat("a", [felisa, dead])]), [{ seatId: "a", cardId: "d", message: "d dies." }], "test");
    const triggers = (dying.pendingDeaths ?? []).flatMap((d) => findCommonTriggersForPermanentDied(dying, d.seatId, d.card));
    expect(triggers).toHaveLength(1);
    const after = resolveTriggerEffect(dying, triggers[0]);
    const inklings = after.seats[0].board.battlefield.filter((c) => c.token);
    expect(inklings).toHaveLength(3);
    expect(inklings.every((c) => c.tapped && c.oracleText === "Flying")).toBe(true);
  });
  it("Gadrak makes a Treasure per nontoken creature that died this turn, and none when nothing died", () => {
    const gadrak = real("Gadrak, the Crown-Scourge", "g");
    const base = session([seat("a", [gadrak, bear("b1"), bear("tok", { token: true })]), seat("o", [bear("o1")])]);
    expect(tokenNames(applyDeterministicPhaseTrigger(base, "a", gadrak, "end step" as never)!)).toEqual([]);
    const died = destroyCreatures(base, [{ seatId: "a", cardId: "b1", message: "x" }, { seatId: "a", cardId: "tok", message: "x" }, { seatId: "o", cardId: "o1", message: "x" }], "test");
    expect(tokenNames(applyDeterministicPhaseTrigger(died, "a", gadrak, "end step" as never)!)).toEqual(["Treasure", "Treasure"]);
  });
  it("a Treasure 'for each ...' count this parser can't see is declined, not silently made 1 (Smuggler's Share)", () => {
    expect(parseCreateTokenSpecs("then create a Treasure token for each opponent who had two or more lands enter the battlefield under their control this turn.")).toEqual([]);
    expect(parseCreateTokenSpecs("create a Treasure token.")).toHaveLength(1);
  });
});
