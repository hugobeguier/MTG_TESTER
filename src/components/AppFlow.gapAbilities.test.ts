// Activated abilities that the strict ability audit used to list as gaps (decks/custom): scaling paid mana (Cabal Coffers), gated mana (Mox Opal,
// Mox Jasper), put-a-counter / pay-life costs (Mazemind Tome, Westvale Abbey), team counters (Steel Overseer), a typed board wipe (Nevinyrral's Disk),
// life from a sacrificed creature (Disciple of Griselbrand) and a five-Zombie tap cost (Gravespawn Sovereign). Real catalog text, engine entry points.
import { describe, expect, it } from "vitest";
import {
  applyGenericTapEffect,
  applySacrificeEffect,
  chooseManaSourcesForCost,
  isAvailableManaSource,
  legalMainPhaseActions,
  manaChoicesForCard,
  manaProducedBy,
  payGenericSacrificeCost,
  payGenericTapCost,
  spendManaSources
} from "./AppFlow";
import { parseGenericSacrificeAbilities, parseGenericTapAbilities } from "@/lib/activatedAbilities";
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
const swamps = (n: number) => Array.from({ length: n }, (_, i) => real("Swamp", `sw${i}`));
function seat(id: string, battlefield: VisibleCard[], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return {
    id, name: id, kind: "human", life: 40, commanderDamage: {},
    zones: { library: (extra.library ?? []).length, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield, graveyard: [] }, ...extra
  };
}
function session(seats: PlayerSeat[]): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 6, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] };
}
const mine = (s: GameSession, id = "a") => s.seats.find((x) => x.id === id)!;
const onBoard = (s: GameSession, id: string, seatId = "a") => mine(s, seatId).board.battlefield.find((c) => c.id === id);
const colors = (c: VisibleCard, s: PlayerSeat) => manaChoicesForCard(c, s, [s]).join("");
const untapAll = (s: GameSession): GameSession => ({ ...s, seats: s.seats.map((x) => ({ ...x, board: { ...x.board, battlefield: x.board.battlefield.map((c) => ({ ...c, tapped: false })) } })) });

describe("Cabal Coffers: {2}, {T}: Add {B} for each Swamp you control", () => {
  it("is a net-gain source: nothing with two Swamps, B with five, producing Swamps minus two", () => {
    const coffers = real("Cabal Coffers", "cc");
    const two = seat("a", [coffers, ...swamps(2)]);
    expect(isAvailableManaSource(coffers, two, [two])).toBe(false);
    const five = seat("a", [coffers, ...swamps(5)]);
    expect(colors(coffers, five)).toBe("B");
    expect(manaProducedBy(coffers, five)).toBe(3);
  });
  it("needs two OTHER untapped lands to pay its {2}", () => {
    const coffers = real("Cabal Coffers", "cc");
    const lands = swamps(5).map((land, i) => (i < 4 ? { ...land, tapped: true } : land));
    const s = seat("a", [coffers, ...lands]);
    expect(isAvailableManaSource(coffers, s, [s])).toBe(false);
  });
  it("lets Coffers plus Swamps pay a big black spell, tapping the lands that fund the {2}", () => {
    const coffers = real("Cabal Coffers", "cc");
    const s = seat("a", [coffers, ...swamps(5)]);
    const spell = real("Swamp", "spell", { manaValue: 7, manaCost: "{5}{B}{B}", typeLine: "Sorcery" });
    const paid = chooseManaSourcesForCost(s, spell, 7, undefined, [s]);
    expect(paid.ok).toBe(true);
    const spent = spendManaSources(s, paid.sourceIds);
    expect(spent.board.battlefield.every((c) => c.tapped)).toBe(true);
  });
  it("taps two extra Swamps when Coffers alone is chosen", () => {
    const coffers = real("Cabal Coffers", "cc");
    const s = seat("a", [coffers, ...swamps(5)]);
    const spent = spendManaSources(s, ["cc"]);
    expect(spent.board.battlefield.filter((c) => c.tapped).map((c) => c.id).sort()).toEqual(["cc", "sw0", "sw1"]);
  });
});

describe("Mox Opal / Mox Jasper: gated 'any color' mana", () => {
  it("Mox Opal needs three artifacts (itself included)", () => {
    const opal = real("Mox Opal", "mo");
    const art = (id: string) => ({ ...bear(id), typeLine: "Artifact" }) as VisibleCard;
    const two = seat("a", [opal, art("x")]);
    expect(isAvailableManaSource(opal, two, [two])).toBe(false);
    const three = seat("a", [opal, art("x"), art("y")]);
    expect(colors(opal, three).split("").sort().join("")).toBe("BGRUW");
  });
  it("Mox Jasper needs a Dragon", () => {
    const jasper = real("Mox Jasper", "mj");
    const without = seat("a", [jasper, bear("b")]);
    expect(isAvailableManaSource(jasper, without, [without])).toBe(false);
    const withDragon = seat("a", [jasper, bear("d", { typeLine: "Creature — Dragon" })]);
    expect(isAvailableManaSource(jasper, withDragon, [withDragon])).toBe(true);
  });
});

describe("Steel Overseer: {T}: Put a +1/+1 counter on each artifact creature you control", () => {
  const artifactCreature = (id: string) => bear(id, { typeLine: "Artifact Creature — Construct" });
  it("puts a counter on every artifact creature (itself included), not on other creatures", () => {
    const overseer = real("Steel Overseer", "so", { typeLine: "Artifact Creature — Construct" });
    const s = session([seat("a", [overseer, artifactCreature("c1"), bear("plain")])]);
    const ability = parseGenericTapAbilities(overseer.oracleText)[0];
    const paid = payGenericTapCost(s, "a", "so", 0)!;
    const after = applyGenericTapEffect(paid.session, "a", "so", "Steel Overseer", ability.effect, ability.clause);
    expect(onBoard(after, "so")!.tapped).toBe(true);
    expect(onBoard(after, "so")!.counters).toEqual([{ kind: "+1/+1", count: 1 }]);
    expect(onBoard(after, "c1")!.counters).toEqual([{ kind: "+1/+1", count: 1 }]);
    expect(onBoard(after, "plain")!.counters).toBeUndefined();
  });
});

describe("Nevinyrral's Disk: {1}, {T}: Destroy all artifacts, creatures, and enchantments", () => {
  const disk = () => real("Nevinyrral's Disk", "nd");
  it("destroys artifacts, creatures and enchantments of every player but not lands, and spares indestructible permanents", () => {
    const rock = bear("rock", { typeLine: "Artifact" });
    const aura = bear("ench", { typeLine: "Enchantment" });
    const god = bear("god", { oracleText: "Indestructible" });
    const s = session([seat("a", [disk(), real("Swamp", "land"), bear("mine"), rock]), seat("b", [bear("theirs"), aura, god])]);
    const ability = parseGenericTapAbilities(disk().oracleText)[0];
    expect(ability.effect).toEqual({ kind: "destroy_all_types", types: ["artifact", "creature", "enchantment"] });
    const paid = payGenericTapCost(s, "a", "nd", 0)!;
    const after = applyGenericTapEffect(paid.session, "a", "nd", "Nevinyrral's Disk", ability.effect, ability.clause);
    const left = (id: string, seatId: string) => Boolean(onBoard(after, id, seatId));
    expect([left("mine", "a"), left("rock", "a"), left("nd", "a"), left("land", "a")]).toEqual([false, false, false, true]);
    expect([left("theirs", "b"), left("ench", "b"), left("god", "b")]).toEqual([false, false, true]);
  });
  it("an agent only wipes when opponents lose clearly more than it does; a human is always offered it", () => {
    const wipeOffered = (kind: "human" | "agent", mineCount: number, theirsCount: number) => {
      const own = Array.from({ length: mineCount }, (_, i) => bear(`m${i}`));
      const theirs = Array.from({ length: theirsCount }, (_, i) => bear(`t${i}`));
      const me = seat("a", [disk(), real("Swamp", "land"), ...own], { kind });
      const s = session([me, seat("b", theirs, { kind: "agent" })]);
      return legalMainPhaseActions(me, true, "a", 6, new Set(), s).some((action) => action.cardId === "nd" && action.actionType === "activate_ability");
    };
    expect(wipeOffered("agent", 0, 5)).toBe(true);
    expect(wipeOffered("agent", 4, 5)).toBe(false);
    expect(wipeOffered("human", 4, 5)).toBe(true);
  });
});

describe("Disciple of Griselbrand: {1}, Sacrifice a creature: You gain life equal to the sacrificed creature's toughness", () => {
  it("gains the sacrificed creature's toughness", () => {
    const disciple = real("Disciple of Griselbrand", "dg");
    const wall = bear("wall", { toughness: "5", power: "0" });
    const s = session([seat("a", [disciple, wall, real("Swamp", "land")])]);
    const ability = parseGenericSacrificeAbilities(disciple.oracleText)[0];
    const paid = payGenericSacrificeCost(s, "a", "dg", 0, undefined, [wall])!;
    const after = applySacrificeEffect(paid.session, "a", disciple, ability.effect, ability.clause, paid.sacrificed);
    expect(mine(after).life).toBe(45);
    expect(onBoard(after, "wall")).toBeUndefined();
  });
});

describe("Mazemind Tome: put a page counter as a cost, gone after the fourth", () => {
  const tome = () => real("Mazemind Tome", "mt");
  it("parses both abilities with the counter cost", () => {
    const abilities = parseGenericTapAbilities(tome().oracleText);
    expect(abilities.map((a) => [a.costManaText, a.costPutCounter, a.effect.kind])).toEqual([["", "page", "scry"], ["{2}", "page", "draw_cards"]]);
  });
  it("adds a page counter per activation and exiles itself at four, gaining 4 life", () => {
    let s = session([seat("a", [tome()])]);
    for (let n = 1; n <= 3; n += 1) {
      s = payGenericTapCost(untapAll(s), "a", "mt", 0)!.session;
      expect(onBoard(s, "mt")!.counters).toEqual([{ kind: "page", count: n }]);
    }
    s = payGenericTapCost(untapAll(s), "a", "mt", 0)!.session;
    expect(onBoard(s, "mt")).toBeUndefined();
    expect(mine(s).board.exile?.some((c) => c.id === "mt")).toBe(true);
    expect(mine(s).life).toBe(44);
  });
});

describe("Westvale Abbey: {5}, {T}, Pay 1 life: Create a 1/1 Human Cleric token", () => {
  it("pays the life and the mana, taps itself, and makes the token", () => {
    const abbey = real("Westvale Abbey // Ormendahl, Profane Prince", "wa");
    const s = session([seat("a", [abbey, ...swamps(5)])]);
    const ability = parseGenericTapAbilities(abbey.oracleText)[0];
    expect(ability.costLife).toBe(1);
    const paid = payGenericTapCost(s, "a", "wa", 0)!;
    expect(mine(paid.session).life).toBe(39);
    expect(onBoard(paid.session, "wa")!.tapped).toBe(true);
    const after = applyGenericTapEffect(paid.session, "a", "wa", abbey.name, ability.effect, ability.clause);
    expect(mine(after).board.battlefield.filter((c) => c.token && c.typeLine.includes("Human"))).toHaveLength(1);
  });
  it("is refused without five other mana sources", () => {
    const abbey = real("Westvale Abbey // Ormendahl, Profane Prince", "wa");
    expect(payGenericTapCost(session([seat("a", [abbey, ...swamps(3)])]), "a", "wa", 0)).toBeUndefined();
  });
});

describe("Gravespawn Sovereign: tap five untapped Zombies", () => {
  it("is parsed with a five-Zombie tap cost and a reanimate effect", () => {
    const sovereign = real("Gravespawn Sovereign", "gs");
    const ability = parseGenericTapAbilities(sovereign.oracleText)[0];
    expect(ability.costTapCreatures).toEqual({ count: 5, subtype: "zombie" });
    expect(ability.effect.kind).toBe("zone_effect");
  });
});
