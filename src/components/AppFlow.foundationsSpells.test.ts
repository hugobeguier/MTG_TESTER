// Cards from the Foundations Commander precons that 4-player self-play found resolving as "mana
// spent, nothing happens" (or finding "no legal target" because their X is a board count). Real
// oracle text throughout, so a wording change in the parsers shows up here.
import { describe, expect, it } from "vitest";
import { applyRemovalEffect, applySpellExtraEffect, createTokensForSeat, parseCreateTokenSpecs } from "./AppFlow";
import { etbEffectText } from "@/lib/oracleClauses";
import { parseRemovalEffect } from "@/lib/removalSpells";
import { parseSpellExtraEffects } from "@/lib/spellExtras";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...overrides };
}

function creature(id: string, power: string, toughness: string, overrides: Partial<VisibleCard> = {}): VisibleCard {
  return card({ id, name: `Creature ${id}`, typeLine: "Creature — Bear", power, toughness, role: "creature", ...overrides });
}

function seat(overrides: Partial<PlayerSeat> & Pick<PlayerSeat, "id" | "name" | "kind">): PlayerSeat {
  return {
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield: [], graveyard: [] },
    ...overrides
  };
}

// A seat whose zone counts match its library, as the real game keeps them (drawForSeat reads zones.library).
function withLibrary(library: VisibleCard[]): Pick<PlayerSeat, "library" | "zones"> {
  return { library, zones: { library: library.length, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 } };
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

const swamp = (id: string) => card({ id, name: "Swamp", typeLine: "Basic Land — Swamp" });
const spell = (name: string, oracleText: string) => card({ id: `spell-${name}`, name, typeLine: "Sorcery", oracleText, zone: "stack" as VisibleCard["zone"] });

function battlefield(s: GameSession, seatId: string) {
  return s.seats.find((item) => item.id === seatId)!.board.battlefield;
}

describe("dynamic X (number of Swamps / creatures on the battlefield)", () => {
  const consuming = "Consuming Corruption deals X damage to target creature or planeswalker and you gain X life, where X is the number of Swamps you control.";

  it("parses X as a board count and the life gain", () => {
    expect(parseRemovalEffect(consuming)).toMatchObject({
      kind: "damage",
      amount: "X",
      xDefinition: { kind: "lands_you_control", subtype: "swamp" },
      alsoGainLife: true
    });
  });

  it("deals damage equal to the Swamps you control and gains that much life (Consuming Corruption)", () => {
    const you = seat({ id: "a", name: "You", kind: "human", board: { hand: [], battlefield: [swamp("s1"), swamp("s2"), swamp("s3")], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [creature("c1", "2", "3")], graveyard: [] } });
    const effect = parseRemovalEffect(consuming)!;
    const result = applyRemovalEffect(session([you, them]), "a", "Consuming Corruption", spell("Consuming Corruption", consuming), effect);
    expect(result.seats.find((s) => s.id === "a")!.life).toBe(43);
    expect(battlefield(result, "b").find((c) => c.id === "c1")).toBeUndefined();
  });

  it("Chain Reaction deals damage equal to the creatures on the battlefield to each creature", () => {
    const text = "Chain Reaction deals X damage to each creature, where X is the number of creatures on the battlefield.";
    const effect = parseRemovalEffect(text)!;
    expect(effect).toMatchObject({ kind: "mass_damage", xDefinition: { kind: "creatures_on_battlefield" } });
    const you = seat({ id: "a", name: "You", kind: "human", board: { hand: [], battlefield: [creature("y1", "1", "3")], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [creature("o1", "1", "2"), creature("o2", "1", "5")], graveyard: [] } });
    const result = applyRemovalEffect(session([you, them]), "a", "Chain Reaction", spell("Chain Reaction", text), effect);
    // 3 creatures => 3 damage each: the 3-toughness and 2-toughness die, the 5-toughness survives.
    expect(battlefield(result, "a").some((c) => c.id === "y1")).toBe(false);
    expect(battlefield(result, "b").map((c) => c.id)).toEqual(["o2"]);
  });

  it("Magmaquake spares fliers and hits planeswalkers", () => {
    const text = "Magmaquake deals X damage to each creature without flying and each planeswalker.";
    const effect = parseRemovalEffect(text)!;
    expect(effect).toMatchObject({ kind: "mass_damage", excludeFlying: true, includePlaneswalkers: true });
    const flier = creature("f", "2", "2", { oracleText: "Flying" });
    const walker = card({ id: "pw", name: "Walker", typeLine: "Legendary Planeswalker — Test", counters: [{ kind: "loyalty", count: 4 }] });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [flier, creature("g", "2", "2"), walker], graveyard: [] } });
    const you = seat({ id: "a", name: "You", kind: "human" });
    const result = applyRemovalEffect(session([you, them]), "a", "Magmaquake", spell("Magmaquake", text), effect, 3);
    expect(battlefield(result, "b").map((c) => c.id)).not.toContain("g");
    expect(battlefield(result, "b").map((c) => c.id)).toContain("f");
    // 3 damage to a 4-loyalty planeswalker leaves 1 loyalty.
    expect(battlefield(result, "b").find((c) => c.id === "pw")!.counters?.find((counter) => counter.kind === "loyalty")?.count).toBe(1);
  });
});

describe("Fateful Absence — Clue for the destroyed permanent's controller", () => {
  const text = `Destroy target creature or planeswalker. Its controller investigates. (They create a Clue token. It's an artifact with "{2}, Sacrifice this token: Draw a card.")`;

  it("reads past the reminder text and flags the investigate", () => {
    expect(parseRemovalEffect(etbEffectText(text))).toMatchObject({ kind: "destroy", controllerInvestigates: true });
  });

  it("gives the opponent a Clue, not the caster", () => {
    const you = seat({ id: "a", name: "You", kind: "human" });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [creature("o1", "3", "3")], graveyard: [] } });
    const effect = parseRemovalEffect(etbEffectText(text))!;
    const result = applyRemovalEffect(session([you, them]), "a", "Fateful Absence", spell("Fateful Absence", text), effect);
    expect(battlefield(result, "b").some((c) => c.name === "Clue")).toBe(true);
    expect(battlefield(result, "a").some((c) => c.name === "Clue")).toBe(false);
  });
});

describe("tapped tokens and large counts", () => {
  it("Army of the Damned makes thirteen tapped 2/2 Zombies", () => {
    const specs = parseCreateTokenSpecs("Create thirteen tapped 2/2 black Zombie creature tokens.");
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ count: 13, power: "2", toughness: "2", tapped: true });
    const you = seat({ id: "a", name: "You", kind: "human" });
    const created = createTokensForSeat(session([you]), "a", "army", specs);
    expect(created.createdTokens).toHaveLength(13);
    expect(created.createdTokens.every((token) => token.tapped)).toBe(true);
  });

  it("an untapped token spec stays untapped", () => {
    const [spec] = parseCreateTokenSpecs("Create a 1/1 white Soldier creature token.");
    expect(spec.tapped).toBeUndefined();
  });
});

describe("spellExtras parsing", () => {
  it.each([
    ["Target player draws two cards and loses 2 life.", "draw_and_lose_life"],
    ["Each player sacrifices six creatures of their choice. You create six tapped 2/2 black Zombie creature tokens.", "each_player_sacrifices"],
    ["Monstrous Onslaught deals X damage divided as you choose among any number of target creatures, where X is the greatest power among creatures you control as you cast this spell.", "divided_damage_greatest_power"],
    ["All creatures get -1/-1 until end of turn for each Swamp you control.", "pump_dynamic"],
    ["Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest power among creatures you control.", "pump_dynamic"],
    ["Target creature you control deals damage equal to its power to each other creature and each opponent.", "creature_damages_everything_else"],
    ["Target creature you control deals damage equal to its power to target creature or planeswalker you don't control.", "creature_bites"],
    ["Add {R} for each tapped land your opponents control.", "add_mana_per_tapped_opponent_land"]
  ])("%s", (text, kind) => {
    expect(parseSpellExtraEffects(text).map((effect) => effect.kind)).toContain(kind);
  });

  it("does not touch ordinary spells", () => {
    expect(parseSpellExtraEffects("Destroy target creature.")).toEqual([]);
  });
});

describe("applySpellExtraEffect", () => {
  function run(text: string, you: PlayerSeat, others: PlayerSeat[], chosenX?: number) {
    const effect = parseSpellExtraEffects(text)[0];
    const source = spell("Test Spell", text);
    return applySpellExtraEffect(session([you, ...others]), you.id, source, effect, chosenX);
  }

  it("Sign in Blood: draws two and loses 2 life", () => {
    const library = [card({ id: "l1", name: "A", typeLine: "Creature", zone: "library" }), card({ id: "l2", name: "B", typeLine: "Creature", zone: "library" }), card({ id: "l3", name: "C", typeLine: "Creature", zone: "library" })];
    const you = seat({ id: "a", name: "You", kind: "human", ...withLibrary(library) });
    const result = run("Target player draws two cards and loses 2 life.", you, []);
    const after = result.seats.find((s) => s.id === "a")!;
    expect(after.board.hand).toHaveLength(2);
    expect(after.life).toBe(38);
  });

  it("Hit the Mother Lode: puts the discovered card in hand and makes tapped Treasures for the difference", () => {
    const text = "Discover 10. If the discovered card's mana value is less than 10, create a number of tapped Treasure tokens equal to the difference.";
    const library = [
      card({ id: "land", name: "Forest", typeLine: "Basic Land — Forest", zone: "library" }),
      card({ id: "big", name: "Huge", typeLine: "Creature", manaValue: 12, zone: "library" }),
      card({ id: "hit", name: "Hit", typeLine: "Creature", manaValue: 6, zone: "library" }),
      card({ id: "rest", name: "Rest", typeLine: "Creature", manaValue: 1, zone: "library" })
    ];
    const you = seat({ id: "a", name: "You", kind: "human", library });
    const after = run(text, you, []).seats.find((s) => s.id === "a")!;
    expect(after.board.hand.map((c) => c.id)).toEqual(["hit"]);
    const treasures = after.board.battlefield.filter((c) => c.name === "Treasure");
    expect(treasures).toHaveLength(4);
    expect(treasures.every((t) => t.tapped)).toBe(true);
    // Revealed cards go to the bottom: only the untouched "rest" card stays above them.
    expect(after.library![0].id).toBe("rest");
    expect(after.library).toHaveLength(3);
  });

  it("Necrotic Hex: each player sacrifices up to six creatures, but not the Zombies this spell makes", () => {
    const text = "Each player sacrifices six creatures of their choice. You create six tapped 2/2 black Zombie creature tokens.";
    const zombies = Array.from({ length: 2 }, (_, i) => creature(`z${i}`, "2", "2", { token: true, tokenSourceCardId: "spell-Test Spell" }));
    const you = seat({ id: "a", name: "You", kind: "human", board: { hand: [], battlefield: [creature("y1", "1", "1"), ...zombies], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [creature("o1", "4", "4"), creature("o2", "1", "1")], graveyard: [] } });
    const result = run(text, you, [them]);
    expect(battlefield(result, "a").map((c) => c.id)).toEqual(["z0", "z1"]);
    expect(battlefield(result, "b")).toHaveLength(0);
  });

  it("Mutilate: each creature gets -1/-1 per Swamp you control", () => {
    const text = "All creatures get -1/-1 until end of turn for each Swamp you control.";
    const you = seat({ id: "a", name: "You", kind: "human", board: { hand: [], battlefield: [swamp("s1"), swamp("s2"), creature("y1", "4", "4")], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [creature("o1", "3", "3")], graveyard: [] } });
    const result = run(text, you, [them]);
    expect(battlefield(result, "a").find((c) => c.id === "y1")!.temporaryToughnessBonus).toBe(-2);
    expect(battlefield(result, "b").find((c) => c.id === "o1")!.temporaryPowerBonus).toBe(-2);
  });

  it("Overwhelming Stampede: +X/+X and trample for your creatures only, X = greatest power", () => {
    const text = "Until end of turn, creatures you control gain trample and get +X/+X, where X is the greatest power among creatures you control.";
    const you = seat({ id: "a", name: "You", kind: "human", board: { hand: [], battlefield: [creature("y1", "6", "6"), creature("y2", "2", "2")], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [creature("o1", "3", "3")], graveyard: [] } });
    const result = run(text, you, [them]);
    const y2 = battlefield(result, "a").find((c) => c.id === "y2")!;
    expect(y2.temporaryPowerBonus).toBe(6);
    expect(y2.temporaryGrantedKeywords).toContain("trample");
    expect(battlefield(result, "b")[0].temporaryPowerBonus).toBeUndefined();
  });

  it("Ezuri's Predation: a 4/4 Beast per opposing creature, each fighting a different one", () => {
    const text = "For each creature your opponents control, create a 4/4 green Phyrexian Beast creature token. Each of those tokens fights a different one of those creatures.";
    const you = seat({ id: "a", name: "You", kind: "human" });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [creature("o1", "2", "2"), creature("o2", "3", "3"), creature("o3", "6", "6")], graveyard: [] } });
    const result = run(text, you, [them]);
    const beasts = battlefield(result, "a").filter((c) => c.name === "Phyrexian Beast Token");
    // Three Beasts were made; the 6/6 fought one and killed it, the other two Beasts survive.
    expect(battlefield(result, "b").map((c) => c.id)).toEqual(expect.not.arrayContaining(["o1", "o2"]));
    expect(beasts.length).toBeGreaterThanOrEqual(2);
  });

  it("Chandra's Ignition: your biggest creature hits every other creature and each opponent", () => {
    const text = "Target creature you control deals damage equal to its power to each other creature and each opponent.";
    const you = seat({ id: "a", name: "You", kind: "human", board: { hand: [], battlefield: [creature("big", "4", "9"), creature("y2", "1", "1")], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [creature("o1", "2", "2")], graveyard: [] } });
    const result = run(text, you, [them]);
    expect(battlefield(result, "a").map((c) => c.id)).toEqual(["big"]);
    expect(battlefield(result, "b")).toHaveLength(0);
    expect(result.seats.find((s) => s.id === "b")!.life).toBe(36);
  });

  it("Bite Down: your biggest creature deals damage to an opposing creature (one-sided)", () => {
    const text = "Target creature you control deals damage equal to its power to target creature or planeswalker you don't control.";
    const you = seat({ id: "a", name: "You", kind: "human", board: { hand: [], battlefield: [creature("big", "5", "5")], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [creature("o1", "3", "3")], graveyard: [] } });
    const result = run(text, you, [them]);
    expect(battlefield(result, "b")).toHaveLength(0);
    expect(battlefield(result, "a").map((c) => c.id)).toEqual(["big"]);
  });

  it("Monstrous Onslaught: divides the damage to kill as many creatures as it can", () => {
    const text = "Monstrous Onslaught deals X damage divided as you choose among any number of target creatures, where X is the greatest power among creatures you control as you cast this spell.";
    const you = seat({ id: "a", name: "You", kind: "human", board: { hand: [], battlefield: [creature("big", "5", "5")], graveyard: [] } });
    const them = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [creature("o1", "2", "2"), creature("o2", "3", "3"), creature("o3", "9", "9")], graveyard: [] } });
    const result = run(text, you, [them]);
    // 5 damage = 2 + 3: both small creatures die, the 9/9 is untouched.
    expect(battlefield(result, "b").map((c) => c.id)).toEqual(["o3"]);
  });

  it("Rishkar's Expertise: draws cards equal to the greatest power, then puts a cheap permanent into play", () => {
    const text = "Draw cards equal to the greatest power among creatures you control.\nYou may cast a spell with mana value 5 or less from your hand without paying its mana cost.";
    const library = Array.from({ length: 5 }, (_, i) => card({ id: `l${i}`, name: `Card ${i}`, typeLine: i === 0 ? "Creature" : "Sorcery", manaValue: i === 0 ? 4 : 3, zone: "library" }));
    const you = seat({ id: "a", name: "You", kind: "human", ...withLibrary(library), board: { hand: [], battlefield: [creature("y1", "3", "3")], graveyard: [] } });
    const after = run(text, you, []).seats.find((s) => s.id === "a")!;
    expect(after.board.hand).toHaveLength(2);
    expect(after.board.battlefield.map((c) => c.id)).toContain("l0");
  });

  it("Chaos Warp: shuffles the opposing permanent into its owner's library and reveals the top", () => {
    const text = "The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield.";
    const library = [card({ id: "t1", name: "Top Land", typeLine: "Basic Land — Forest", zone: "library" })];
    const you = seat({ id: "a", name: "You", kind: "human" });
    const them = seat({ id: "b", name: "Opp", kind: "agent", ...withLibrary(library), board: { hand: [], battlefield: [creature("o1", "5", "5")], graveyard: [] } });
    const result = run(text, you, [them]);
    const after = result.seats.find((s) => s.id === "b")!;
    const libraryIds = (after.library ?? []).map((c) => c.id);
    const bfIds = after.board.battlefield.map((c) => c.id);
    // Either the creature or the land is back on the battlefield; the other is in the library.
    expect([...libraryIds, ...bfIds].sort()).toEqual(["o1", "t1"]);
  });
});

describe("rule 800.4a — an eliminated player's permanents leave the game", () => {
  it("clears the battlefield of a player who reaches 0 life (cards to exile, tokens vanish) and leaves others alone", async () => {
    const { runStateBasedActionsPass } = await import("./AppFlow");
    const doomed = seat({
      id: "a",
      name: "Doomed",
      kind: "agent",
      life: 0,
      board: { hand: [], battlefield: [creature("c1", "3", "3"), creature("t1", "1", "1", { token: true })], graveyard: [] }
    });
    const alive = seat({ id: "b", name: "Alive", kind: "agent", board: { hand: [], battlefield: [creature("c2", "2", "2")], graveyard: [] } });
    const other = seat({ id: "c", name: "Other", kind: "agent" });
    const { session: after } = runStateBasedActionsPass(session([doomed, alive, other]));
    const doomedAfter = after.seats.find((s) => s.id === "a")!;
    expect(doomedAfter.hasLost).toBe(true);
    expect(doomedAfter.board.battlefield).toHaveLength(0);
    expect(doomedAfter.board.exile?.map((c) => c.id)).toEqual(["c1"]);
    expect(after.seats.find((s) => s.id === "b")!.board.battlefield.map((c) => c.id)).toEqual(["c2"]);
    // Three players, one eliminated: the game is still on.
    expect(after.status).toBe("playing");
  });
});

describe("lords on the board", () => {
  const zombie = (id: string) => creature(id, "2", "2", { typeLine: "Creature — Zombie" });
  const lordOfTheUndead = card({
    id: "lord",
    name: "Lord of the Undead",
    typeLine: "Creature — Zombie",
    power: "2",
    toughness: "2",
    oracleText: "Other Zombie creatures get +1/+1.\n{1}{B}, {T}: Return target Zombie card from your graveyard to your hand."
  });
  const deathBaron = card({
    id: "baron",
    name: "Death Baron",
    typeLine: "Creature — Zombie Wizard",
    power: "2",
    toughness: "2",
    oracleText: "Skeletons you control and other Zombies you control get +1/+1 and have deathtouch. (Any amount of damage they deal to a creature is enough to destroy it.)"
  });

  it("Lord of the Undead boosts every other Zombie — including an opponent's — but not itself", async () => {
    const { runStateBasedActionsPass } = await import("./AppFlow");
    const mine = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [lordOfTheUndead, zombie("z1")], graveyard: [] } });
    const theirs = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [zombie("z2"), creature("bear", "2", "2")], graveyard: [] } });
    const { session: after } = runStateBasedActionsPass(session([mine, theirs]));
    const find = (seatId: string, id: string) => after.seats.find((s) => s.id === seatId)!.board.battlefield.find((c) => c.id === id)!;
    expect(find("a", "z1").attachmentPowerBonus).toBe(1);
    expect(find("b", "z2").attachmentPowerBonus).toBe(1);
    expect(find("a", "lord").attachmentPowerBonus).toBeUndefined();
    expect(find("b", "bear").attachmentPowerBonus).toBeUndefined();
    // A permanent anthem — nothing temporary about it.
    expect(find("a", "z1").temporaryPowerBonus).toBeUndefined();
  });

  it("Death Baron boosts and gives deathtouch to its controller's other Zombies only", async () => {
    const { runStateBasedActionsPass } = await import("./AppFlow");
    const mine = seat({ id: "a", name: "Me", kind: "human", board: { hand: [], battlefield: [deathBaron, zombie("z1")], graveyard: [] } });
    const theirs = seat({ id: "b", name: "Opp", kind: "agent", board: { hand: [], battlefield: [zombie("z2")], graveyard: [] } });
    const { session: after } = runStateBasedActionsPass(session([mine, theirs]));
    const find = (seatId: string, id: string) => after.seats.find((s) => s.id === seatId)!.board.battlefield.find((c) => c.id === id)!;
    expect(find("a", "z1").attachmentPowerBonus).toBe(1);
    expect(find("a", "z1").grantedKeywords).toContain("deathtouch");
    expect(find("b", "z2").attachmentPowerBonus).toBeUndefined();
    expect(find("a", "baron").attachmentPowerBonus).toBeUndefined();
  });
});
