// Batch 3: scripted card abilities (engine/cardAbilities.ts): cost, choices (slots), effect, with REAL Oracle text from the card catalog.
// Engine/unit tests only: the hook/prompt plumbing (useAbilities.activateScriptedAbility) is covered by the human target guard + type checks, not by a browser run.
import { describe, expect, it } from "vitest";
import { manaProducedBy } from "./AppFlow";
import { applyScriptedAbility, payScriptedCost, scriptedAbilitiesFor, scriptedCostPayable, scriptedNextSlot } from "@/engine/cardAbilities";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { counterCount } from "@/lib/counters";
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
  return { id, name: id, kind: "human", life: 40, commanderDamage: {}, zones: { library: (extra.library ?? []).length, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield, graveyard: [] }, ...extra };
}
function session(seats: PlayerSeat[], extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 6, activePlayerId: seats[0].id, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra } as GameSession;
}
const by = (s: GameSession, id: string) => s.seats.find((x) => x.id === id)!;
const onBoard = (s: GameSession, id: string, seatId = "a") => by(s, seatId).board.battlefield.find((c) => c.id === id);
const board = (cards: VisibleCard[], hand: VisibleCard[] = [], graveyard: VisibleCard[] = []) => ({ board: { hand, battlefield: cards, graveyard } });

type Zone = "battlefield" | "hand" | "graveyard";
const find = (s: GameSession, seatId: string, cardId: string, zone: Zone) => {
  const me = by(s, seatId);
  return (zone === "hand" ? me.board.hand : zone === "graveyard" ? (me.board.graveyard ?? []) : me.board.battlefield).find((c) => c.id === cardId)!;
};
function activate(s: GameSession, seatId: string, cardId: string, zone: Zone, abilityId: string, picks: string[]) {
  const card = find(s, seatId, cardId, zone);
  const ability = scriptedAbilitiesFor(card, zone).find((a) => a.id === abilityId)!;
  expect(ability, `${card.name} has ${abilityId}`).toBeTruthy();
  const paid = payScriptedCost(s, seatId, card, ability, picks);
  return paid ? applyScriptedAbility(paid.session, seatId, card, ability, picks) : undefined;
}
const slot = (s: GameSession, seatId: string, cardId: string, zone: Zone, abilityId: string, picks: string[]) => {
  const card = find(s, seatId, cardId, zone);
  return scriptedNextSlot(s, seatId, card, scriptedAbilitiesFor(card, zone).find((a) => a.id === abilityId)!, picks);
};
const values = (r: ReturnType<typeof slot>) => (r && r !== "done" ? r.options.map((o) => o.value) : []);
const swamps = (n: number) => Array.from({ length: n }, (_, i) => real("Swamp", `sw${i}`));
const lib = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `lib${i}`, name: `Lib ${i}`, typeLine: "Creature — Bear", oracleText: "", power: "2", toughness: "2", colors: [], manaValue: 2, role: "creature", zone: "library" }) as VisibleCard);

describe("Priest of Forgotten Gods (real Oracle text)", () => {
  it("asks two other creatures to sacrifice, then target players; targets lose 2 and sacrifice; you draw and add BB", () => {
    const priest = real("Priest of Forgotten Gods", "pr");
    const a = seat("a", [priest, bear("b1"), bear("b2"), bear("b3")], { library: lib(3) });
    const b = seat("b", [bear("o1"), bear("o2", { power: "5", toughness: "5" })], { kind: "agent" });
    const s = session([a, b]);
    expect(scriptedCostPayable(s, "a", priest, scriptedAbilitiesFor(priest, "battlefield")[0])).toBe(true);
    expect(values(slot(s, "a", "pr", "battlefield", "priest_sacrifice_two", [])).length).toBe(3);
    expect(values(slot(s, "a", "pr", "battlefield", "priest_sacrifice_two", ["b1"]))).toEqual(["b2", "b3"]);
    expect(values(slot(s, "a", "pr", "battlefield", "priest_sacrifice_two", ["b1", "b2"]))).toContain("done");
    const result = activate(s, "a", "pr", "battlefield", "priest_sacrifice_two", ["b1", "b2", "b"])!;
    expect(result.mana).toBe("BB");
    expect(by(result.session, "b").life).toBe(38);
    expect(onBoard(result.session, "o1", "b")).toBeUndefined();
    expect(onBoard(result.session, "o2", "b")).toBeDefined();
    expect(onBoard(result.session, "b1")).toBeUndefined();
    expect(onBoard(result.session, "pr")!.tapped).toBe(true);
    expect(by(result.session, "a").board.hand.length).toBe(1);
  });
  it("is not activatable with fewer than two other creatures", () => {
    const s = session([seat("a", [real("Priest of Forgotten Gods", "pr"), bear("b1")]), seat("b", [])]);
    expect(slot(s, "a", "pr", "battlefield", "priest_sacrifice_two", [])).toBeUndefined();
  });
});

describe("Jarad, Golgari Lich Lord: graveyard recursion", () => {
  it("is offered from the graveyard, needs a Swamp and a Forest, and returns Jarad to hand", () => {
    const jarad = real("Jarad, Golgari Lich Lord", "ja", { zone: "graveyard" });
    const lands = [real("Swamp", "s1"), real("Forest", "f1"), real("Forest", "f2")];
    const s = session([seat("a", lands, board(lands, [], [jarad]))]);
    expect(scriptedAbilitiesFor(jarad, "graveyard").length).toBe(1);
    expect(scriptedAbilitiesFor(jarad, "battlefield").length).toBe(0);
    const result = activate(s, "a", "ja", "graveyard", "jarad_return", ["s1", "f2"])!;
    expect(by(result.session, "a").board.hand.map((c) => c.id)).toEqual(["ja"]);
    expect(by(result.session, "a").board.battlefield.map((c) => c.id)).toEqual(["f1"]);
  });
  it("cannot be activated without a Forest", () => {
    const jarad = real("Jarad, Golgari Lich Lord", "ja", { zone: "graveyard" });
    const lands = [real("Swamp", "s1"), real("Swamp", "s2")];
    expect(slot(session([seat("a", lands, board(lands, [], [jarad]))]), "a", "ja", "graveyard", "jarad_return", [])).toBeUndefined();
  });
});

describe("Channel lands: cost from hand, reduced per legendary creature", () => {
  it("Takenuma: {3}{B} minus one per legendary creature; discards itself, mills three, returns a creature", () => {
    const tak = real("Takenuma, Abandoned Mire", "tk", { zone: "hand" });
    const legend = bear("lg", { typeLine: "Legendary Creature — Bear" });
    const gy = [bear("big", { zone: "graveyard", manaValue: 6 }), bear("small", { zone: "graveyard" })];
    const two = [...swamps(2), legend];
    const poor = session([seat("a", two, { kind: "agent", library: lib(5), ...board(two, [tak], gy) })]);
    expect(scriptedCostPayable(poor, "a", tak, scriptedAbilitiesFor(tak, "hand")[0])).toBe(false);
    const three = [...swamps(3), legend];
    const rich = session([seat("a", three, { kind: "agent", library: lib(5), ...board(three, [tak], gy) })]);
    const result = activate(rich, "a", "tk", "hand", "channel_takenuma", [])!;
    const me = by(result.session, "a");
    expect(me.board.hand.map((c) => c.id)).toEqual(["big"]);
    expect((me.board.graveyard ?? []).some((c) => c.id === "tk")).toBe(true);
    expect(me.library!.length).toBe(2);
  });
  it("Boseiju: asks which artifact/enchantment/nonbasic land to destroy (never a basic land); the victim fetches a land", () => {
    const bo = real("Boseiju, Who Endures", "bo", { zone: "hand" });
    const lands = [real("Forest", "f1"), real("Forest", "f2")];
    const a = seat("a", lands, board(lands, [bo]));
    const b = seat("b", [real("Sol Ring", "sr"), real("Command Tower", "ct"), real("Forest", "bf"), bear("o1")], { kind: "agent", library: [real("Island", "li", { zone: "library" })] });
    const s = session([a, b]);
    expect(values(slot(s, "a", "bo", "hand", "channel_boseiju", [])).sort()).toEqual(["b:ct", "b:sr"]);
    const result = activate(s, "a", "bo", "hand", "channel_boseiju", ["b:sr"])!;
    expect(onBoard(result.session, "sr", "b")).toBeUndefined();
    expect(onBoard(result.session, "li", "b")).toBeDefined();
  });
  it("Eiganjo: only attacking or blocking creatures are targets and take 4 damage", () => {
    const ei = real("Eiganjo, Seat of the Empire", "ei", { zone: "hand" });
    const lands = [real("Plains", "p1"), real("Plains", "p2"), real("Plains", "p3")];
    const s = session([seat("a", lands, board(lands, [ei])), seat("b", [bear("calm"), bear("att", { attacking: true, toughness: "5" })], { kind: "agent" })]);
    expect(values(slot(s, "a", "ei", "hand", "channel_eiganjo", []))).toEqual(["b:att"]);
    expect(onBoard(activate(s, "a", "ei", "hand", "channel_eiganjo", ["b:att"])!.session, "att", "b")!.damage).toBe(4);
  });
});

describe("Spymaster's Vault: connive X, X = creatures that died this turn", () => {
  it("targets a creature you control, draws X and discards X (a counter per nonland)", () => {
    const vault = real("Spymaster's Vault", "sv");
    const cards = [vault, real("Swamp", "s1"), bear("b1")];
    const s = session([seat("a", cards, { kind: "agent", library: lib(4), ...board(cards) })], { creaturesDiedThisTurn: { turn: 6, bySeat: { a: 1, b: 1 } } });
    expect(values(slot(s, "a", "sv", "battlefield", "vault_connive", []))).toEqual(["b1"]);
    const result = activate(s, "a", "sv", "battlefield", "vault_connive", ["b1"])!;
    expect(by(result.session, "a").board.graveyard!.length).toBe(2);
    expect(counterCount(onBoard(result.session, "b1")!, "+1/+1")).toBe(2);
  });
});

describe("Chatterfang: {B}, Sacrifice X Squirrels: Target creature gets +X/-X", () => {
  it("asks X, then the Squirrels, then the target; sacrifices and pumps", () => {
    const sq = (id: string) => bear(id, { typeLine: "Token Creature — Squirrel", token: true, power: "1", toughness: "1" });
    const s = session([seat("a", [real("Chatterfang, Squirrel General", "cf"), real("Swamp", "s1"), sq("q1"), sq("q2")]), seat("b", [bear("o1", { power: "3", toughness: "3" })], { kind: "agent" })]);
    expect(values(slot(s, "a", "cf", "battlefield", "chatterfang_pump", [])).length).toBe(3);
    expect(values(slot(s, "a", "cf", "battlefield", "chatterfang_pump", ["2"])).length).toBe(3);
    expect(values(slot(s, "a", "cf", "battlefield", "chatterfang_pump", ["2", "q1", "q2"]))).toContain("b:o1");
    const result = activate(s, "a", "cf", "battlefield", "chatterfang_pump", ["2", "q1", "q2", "b:o1"])!;
    const hit = onBoard(result.session, "o1", "b")!;
    expect([hit.temporaryPowerBonus, hit.temporaryToughnessBonus]).toEqual([2, -2]);
    expect(onBoard(result.session, "q1")).toBeUndefined();
  });
});

describe("Insatiable Frugivore, Ravenous Squirrel, Oran-Rief", () => {
  it("Frugivore: sacrifice X Foods for +X/+0 and menace to your creatures", () => {
    const food = (id: string) => ({ ...bear(id), typeLine: "Artifact — Food", token: true }) as VisibleCard;
    const s = session([seat("a", [real("Insatiable Frugivore", "fr"), ...swamps(4), food("fd1"), food("fd2"), bear("b1")])]);
    const result = activate(s, "a", "fr", "battlefield", "frugivore_pump", ["2", "fd1", "fd2"])!;
    expect(onBoard(result.session, "b1")!.temporaryPowerBonus).toBe(2);
    expect(onBoard(result.session, "b1")!.temporaryGrantedKeywords).toContain("menace");
    expect(onBoard(result.session, "fd1")).toBeUndefined();
  });
  it("Ravenous Squirrel: sacrifice an artifact or creature to gain 1 life and draw", () => {
    const s = session([seat("a", [real("Ravenous Squirrel", "rs"), real("Swamp", "s1"), real("Forest", "f1"), real("Forest", "f2"), bear("b1")], { library: lib(2) })]);
    const result = activate(s, "a", "rs", "battlefield", "ravenous_squirrel_sacrifice", ["b1"])!;
    expect(by(result.session, "a").life).toBe(41);
    expect(by(result.session, "a").board.hand.length).toBe(1);
    expect(onBoard(result.session, "b1")).toBeUndefined();
  });
  it("Oran-Rief: counters only on green creatures that entered this turn", () => {
    const s = session([seat("a", [real("Oran-Rief, the Vastwood", "or"), bear("new", { enteredTurn: 6 }), bear("old", { enteredTurn: 3 }), bear("blue", { enteredTurn: 6, colors: ["U"] })])]);
    const result = activate(s, "a", "or", "battlefield", "oran_rief_counters", [])!;
    expect(["new", "old", "blue"].map((id) => counterCount(onBoard(result.session, id)!, "+1/+1"))).toEqual([1, 0, 0]);
  });
});

describe("Ramos, Dragon Engine: remove five counters for WWUUBBRRGG, once each turn", () => {
  it("is a mana ability with a counter cost, usable once per turn and only with five counters", () => {
    const ramos = real("Ramos, Dragon Engine", "rm", { counters: [{ kind: "+1/+1", count: 6 }] });
    const s = session([seat("a", [ramos])]);
    const first = activate(s, "a", "rm", "battlefield", "ramos_burst", [])!;
    expect(first.mana).toBe("WWUUBBRRGG");
    const left = onBoard(first.session, "rm")!;
    expect(counterCount(left, "+1/+1")).toBe(1);
    expect(scriptedCostPayable(first.session, "a", left, scriptedAbilitiesFor(left, "battlefield")[0])).toBe(false);
    const few = session([seat("a", [{ ...ramos, counters: [{ kind: "+1/+1", count: 4 }] }])]);
    expect(scriptedCostPayable(few, "a", by(few, "a").board.battlefield[0], scriptedAbilitiesFor(ramos, "battlefield")[0])).toBe(false);
  });
});

describe("Wolfwillow Haven: enchanted land adds an additional {G}", () => {
  it("an enchanted Forest produces two mana, another Forest one", () => {
    const s = seat("a", [real("Forest", "f1"), real("Wolfwillow Haven", "wh", { attachedToId: "f1" }), real("Forest", "f2")]);
    expect(manaProducedBy(s.board.battlefield[0], s)).toBe(2);
    expect(manaProducedBy(s.board.battlefield[2], s)).toBe(1);
  });
});
