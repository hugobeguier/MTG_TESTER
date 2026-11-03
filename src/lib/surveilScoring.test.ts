import { describe, expect, it } from "vitest";
import { scoreSurveil, hasCreatureRecursion, type SurveilSeatState } from "./surveilScoring";
import type { VisibleCard } from "./types";

const base = { colors: [] as string[], role: "permanent", zone: "library", oracleText: "", manaValue: 0 };
const forest = (id: string, zone: VisibleCard["zone"] = "battlefield") =>
  ({ ...base, id, name: "Forest", typeLine: "Basic Land — Forest", role: "land", oracleText: "({T}: Add {G}.)\n{T}: Add {G}.", producedMana: ["G"], zone }) as VisibleCard;
const island = (id: string, zone: VisibleCard["zone"] = "battlefield") =>
  ({ ...base, id, name: "Island", typeLine: "Basic Land — Island", role: "land", oracleText: "{T}: Add {U}.", producedMana: ["U"], zone }) as VisibleCard;
const creature = (id: string, mv: number, extra: Partial<VisibleCard> = {}) =>
  ({ ...base, id, name: `Creature ${id}`, typeLine: "Creature — Beast", manaValue: mv, manaCost: `{${Math.max(0, mv - 1)}}{G}`, colors: ["G"], power: String(mv), toughness: String(mv), role: "creature", ...extra }) as VisibleCard;
const doomBlade = (id = "dead") =>
  ({ ...base, id, name: "Doom Blade", typeLine: "Instant", manaValue: 2, manaCost: "{1}{B}", colors: ["B"], role: "removal", oracleText: "Destroy target nonblack creature." }) as VisibleCard;
const commanderG = { ...base, id: "cmd", name: "Green Boss", typeLine: "Legendary Creature — Elf", manaValue: 4, manaCost: "{2}{G}{G}", colors: ["G"], colorIdentity: ["G"], power: "4", toughness: "4", commanderTax: 0 } as VisibleCard;

function state(over: Partial<SurveilSeatState> = {}): SurveilSeatState {
  return { turn: 5, life: 40, librarySize: 60, battlefield: [], hand: [], graveyard: [], commander: commanderG, opponents: [], ...over };
}
const lands = (n: number, make = forest) => Array.from({ length: n }, (_, i) => make(`bf${i}`));
const swamp = (id: string) => ({ ...forest(id), name: "Swamp", typeLine: "Basic Land — Swamp", oracleText: "{T}: Add {B}.", producedMana: ["B"] }) as VisibleCard;
const blackState = (over: Partial<SurveilSeatState> = {}) => state({ commander: { ...commanderG, colors: ["B"], colorIdentity: ["B"], manaCost: "{2}{B}{B}" }, battlefield: lands(5, swamp), ...over });
const bin = (s: SurveilSeatState, looked: VisibleCard[]) => scoreSurveil(s, looked).toGraveyard.sort();

describe("scoreSurveil: lands", () => {
  it("bins a land when flooded, keeps the spell", () => {
    const d = scoreSurveil(state({ battlefield: lands(7) }), [forest("top", "library"), creature("c", 3)]);
    expect(d.toGraveyard).toEqual(["top"]);
    expect(d.topOrder).toEqual(["c"]);
  });
  it("keeps a land when land-light and puts it first", () => {
    const d = scoreSurveil(state({ battlefield: lands(2) }), [creature("c", 2), forest("top", "library")]);
    expect(d.toGraveyard).toEqual([]);
    expect(d.topOrder[0]).toBe("top");
  });
  it("never bins the land the commander still needs", () => {
    expect(bin(state({ battlefield: lands(3) }), [forest("top", "library")])).toEqual([]);
  });
  it("keeps a flooded-agent land that fixes a missing commander colour", () => {
    const cmd = { ...commanderG, colorIdentity: ["G", "U"] };
    const d = scoreSurveil(state({ commander: cmd, battlefield: lands(7) }), [island("i", "library"), forest("f", "library")]);
    expect(d.toGraveyard).toEqual(["f"]);
    expect(d.topOrder).toEqual(["i"]);
  });
  it("only keeps as many lands from one look as needed (the second plain land is redundant)", () => {
    const d = scoreSurveil(state({ battlefield: lands(4) }), [forest("a", "library"), forest("b", "library"), forest("c", "library")]);
    expect(d.toGraveyard.length).toBeGreaterThanOrEqual(1);
    expect(d.topOrder.length).toBeGreaterThanOrEqual(1);
  });
  it("counts lands in hand toward the total", () => {
    const hand = [forest("h1", "hand"), forest("h2", "hand"), forest("h3", "hand")];
    expect(bin(state({ battlefield: lands(5), hand }), [forest("top", "library")])).toEqual(["top"]);
  });
});

describe("scoreSurveil: castability and colours", () => {
  it("bins a card whose colour the agent cannot produce (and cannot fix)", () => {
    const red = creature("red", 3, { colors: ["R"], manaCost: "{2}{R}" });
    expect(bin(state({ battlefield: lands(4) }), [red, creature("ok", 3)])).toEqual(["red"]);
  });
  it("is gentler when a land in hand can fix the colour", () => {
    const blue = creature("blue", 3, { colors: ["U"], manaCost: "{2}{U}" });
    expect(bin(state({ battlefield: lands(4), hand: [island("h", "hand")], commander: { ...commanderG, colorIdentity: ["G", "U"] } }), [blue])).toEqual([]);
  });
  it("a bomb far above current mana is lower value early but not binned, and valued late", () => {
    const bomb = creature("bomb", 8, { power: "8", toughness: "8" });
    expect(bin(state({ battlefield: lands(5) }), [bomb])).toEqual([]);
    const early = scoreSurveil(state({ battlefield: lands(5), turn: 4 }), [bomb]).scores[0].keepValue;
    const late = scoreSurveil(state({ battlefield: lands(5), turn: 10 }), [bomb]).scores[0].keepValue;
    expect(late).toBeGreaterThan(early);
  });
});

describe("scoreSurveil: graveyard plan", () => {
  const merenLike = { ...creature("meren", 4), name: "Meren-like", typeLine: "Legendary Creature — Elf", oracleText: "At the beginning of your end step, return target creature card from your graveyard to your hand." } as VisibleCard;
  it("detects creature recursion text", () => {
    expect(hasCreatureRecursion(merenLike)).toBe(true);
    expect(hasCreatureRecursion(creature("x", 2))).toBe(false);
  });
  it("with a reanimation engine, bins a big creature and keeps a cheap one and the recursion piece", () => {
    const witness = creature("wit", 3, { name: "Witness", oracleText: "When this creature enters, return target card from your graveyard to your hand." });
    const s = state({ battlefield: [...lands(6), merenLike] });
    const d = scoreSurveil(s, [creature("fatty", 6), creature("cheap", 2), witness]);
    expect(d.toGraveyard).toEqual(["fatty"]);
    const noEngine = scoreSurveil(state({ battlefield: lands(6) }), [creature("fatty", 6)]);
    expect(noEngine.toGraveyard).toEqual([]);
    // a recursion spell in the agent's hand counts too
    const inHand = scoreSurveil(state({ battlefield: lands(6), hand: [{ ...merenLike, id: "mh", zone: "hand" }] }), [creature("fatty", 6)]);
    expect(inHand.toGraveyard).toEqual(["fatty"]);
    // the recursion piece itself is never binned
    expect(scoreSurveil(s, [{ ...merenLike, id: "m2", name: "Other Reanimator" }]).toGraveyard).toEqual([]);
  });
  it("an enters-effect creature is a reanimation target too", () => {
    const etb = creature("etb", 3, { oracleText: "When this creature enters, draw a card." });
    expect(bin(state({ battlefield: [...lands(5), merenLike] }), [etb])).toEqual(["etb"]);
  });
});

describe("scoreSurveil: dead cards", () => {
  it("bins removal when there is nothing worth targeting", () => {
    expect(bin(blackState(), [doomBlade()])).toEqual(["dead"]);
  });
  it("bins removal when the only opposing creature is a worthless token", () => {
    const servo = { ...creature("servo", 1), name: "Servo", token: true, power: "1", toughness: "1" } as VisibleCard;
    expect(bin(blackState({ opponents: [{ battlefield: [servo] }] }), [doomBlade()])).toEqual(["dead"]);
  });
  it("keeps removal when a real threat is on the table", () => {
    const dragon = { ...creature("dragon", 6), name: "Dragon", power: "6", toughness: "6", oracleText: "Flying" } as VisibleCard;
    expect(bin(blackState({ opponents: [{ battlefield: [dragon] }] }), [doomBlade()])).toEqual([]);
  });
  it("bins a legendary permanent already controlled, and a redundant copy of a spell in hand", () => {
    const legend = creature("l2", 3, { name: "Sage", typeLine: "Legendary Creature — Human" });
    const owned = { ...legend, id: "l1", zone: "battlefield" } as VisibleCard;
    expect(bin(state({ battlefield: [...lands(5), owned] }), [legend])).toEqual(["l2"]);
    const dup = creature("d2", 3, { name: "Twin" });
    const inHand = { ...dup, id: "d1", zone: "hand" } as VisibleCard;
    const mono = scoreSurveil(state({ battlefield: lands(5), hand: [inHand] }), [dup]).scores[0];
    expect(mono.reasons.join(" ")).toContain("redundant extra copy");
  });
  it("a wipe is dead weight when the agent is ahead on creatures", () => {
    const wrath = { ...base, id: "w", name: "Wrath", typeLine: "Sorcery", manaValue: 4, manaCost: "{2}{W}{W}", colors: ["W"], oracleText: "Destroy all creatures." } as VisibleCard;
    const w = (id: string) => ({ ...forest(id), name: "Plains", oracleText: "{T}: Add {W}." });
    const s = state({ commander: { ...commanderG, colors: ["W"], colorIdentity: ["W"] }, battlefield: [...lands(5, w), creature("a", 3, { zone: "battlefield" }), creature("b", 3, { zone: "battlefield" })], opponents: [{ battlefield: [] }] });
    expect(bin(s, [wrath])).toEqual(["w"]);
  });
});

describe("scoreSurveil: ordering, ties, library safety", () => {
  it("orders by need: a land when land-light, then cheap castable plays, then expensive", () => {
    const d = scoreSurveil(state({ battlefield: lands(2) }), [creature("big", 7), creature("cheap", 2), forest("land", "library")]);
    expect(d.topOrder).toEqual(["land", "cheap", "big"]);
  });
  it("is deterministic: the same cards in any input order give the same result, ties broken by name then id", () => {
    const a = creature("a", 3, { name: "Same" });
    const b = creature("b", 3, { name: "Same" });
    const c = creature("c", 3, { name: "Same" });
    const s = state({ battlefield: lands(5) });
    expect(scoreSurveil(s, [a, b, c]).topOrder).toEqual(scoreSurveil(s, [c, a, b]).topOrder);
    expect(scoreSurveil(s, [c, b, a]).topOrder[0]).toBe(scoreSurveil(s, [a, b, c]).topOrder[0]);
  });
  it("never mills a nearly empty library", () => {
    const s = state({ battlefield: lands(7), librarySize: 5 });
    expect(scoreSurveil(s, [forest("top", "library")]).toGraveyard).toEqual([]);
    expect(bin(state({ battlefield: lands(7), librarySize: 7 }), [forest("a", "library"), forest("b", "library"), forest("c", "library")]).length).toBeLessThanOrEqual(2);
  });
  it("a small library only bins truly dead cards (a mediocre one stays)", () => {
    const meh = doomBlade(); // dead removal: about -0.5, under the normal bar but not "truly dead"
    expect(bin(blackState({ librarySize: 40 }), [meh])).toEqual(["dead"]);
    expect(bin(blackState({ librarySize: 10 }), [meh])).toEqual([]);
    const dupLegend = creature("l2", 3, { name: "Sage", typeLine: "Legendary Creature — Human" });
    const owned = { ...dupLegend, id: "l1" } as VisibleCard;
    expect(bin(state({ battlefield: [...lands(5), owned], librarySize: 10 }), [dupLegend])).toEqual(["l2"]);
  });
  it("keeps a good card next to a dead one", () => {
    const d = scoreSurveil(blackState(), [doomBlade("r"), { ...creature("good", 3), colors: ["B"], manaCost: "{2}{B}" }]);
    expect(d.topOrder).toEqual(["good"]);
    expect(d.toGraveyard).toEqual(["r"]);
  });
  it("returns every revealed card exactly once", () => {
    const looked = [forest("l", "library"), creature("c", 3), doomBlade("r")];
    const d = scoreSurveil(state({ battlefield: lands(7) }), looked);
    expect([...d.toGraveyard, ...d.topOrder].sort()).toEqual(looked.map((c) => c.id).sort());
  });
});
