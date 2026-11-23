// The kernel AI understands what its spells do (lookahead on a cloned state). Every card below is a real drafted card; the oracle text each test relies on is
// quoted in the test (read from data/cards.db):
//   Toxic Deluge   {2}{B} Sorcery  "As an additional cost to cast this spell, pay X life. All creatures get -X/-X until end of turn."
//   Delete         {X}{R}{R} Sorcery  "Delete deals X damage to each nonartifact creature and each player."
//   Magmaquake     {X}{R}{R} Instant  "Magmaquake deals X damage to each creature without flying and each planeswalker."
//   Blasphemous Act {8}{R} Sorcery  "This spell costs {1} less to cast for each creature on the battlefield. Blasphemous Act deals 13 damage to each creature."
//   Day of Judgment {2}{W}{W} Sorcery  "Destroy all creatures."
//   Decree of Pain {6}{B}{B} Sorcery  "Destroy all creatures. They can't be regenerated. Draw a card for each creature destroyed this way. Cycling {3}{B}{B} ... When you cycle this card, all creatures get -2/-2 until end of turn."
//   Swords to Plowshares {W} Instant  "Exile target creature. Its controller gains life equal to its power."
//   Lightning Bolt {R} Instant  "Lightning Bolt deals 3 damage to any target."
//   Counterspell   {U}{U} Instant  "Counter target spell."
//   Fleshbag Marauder {2}{B} 3/1 Creature  "When this creature enters, each player sacrifices a creature of their choice."
// Creatures: Gigantosaurus 10/10 vanilla, Carnage Tyrant 7/6 trample hexproof, Palladium Myr 2/2 ({T}: Add {C}{C}), Silver Myr 1/1, Elvish Mystic 1/1, Llanowar Elves 1/1,
// Segovian Angel 1/1 flying vigilance, Birds of Paradise 0/1 flying.
import { describe, expect, it } from "vitest";
import { ctx } from "../integration/testgame";
import { legalActions } from "../engine/legal";
import { chooseAiAction } from "../../components/game/kernelAi";
import { board, choose, life, playOne, zoneOf } from "./kernelAiKit";

const swamps = (n: number) => ({ Swamp: n });
const dead = (t: ReturnType<typeof board>["t"], id: string) => zoneOf(t, id) !== "battlefield";

describe("Toxic Deluge (pay X life, all creatures get -X/-X)", () => {
  it("2 players: pays just enough life to wipe the opponent's small creatures and keeps its own 10/10", () => {
    const { t, ids } = board({
      p1: { lands: swamps(4), field: ["Gigantosaurus"], hand: ["Toxic Deluge"] },
      p2: { field: ["Elvish Mystic", "Silver Myr", "Palladium Myr", "Segovian Angel"] }
    });
    const r = playOne(t, "p1");
    expect(r.label).toBe("Cast Toxic Deluge");
    expect(zoneOf(t, ids["p1:Gigantosaurus"][0])).toBe("battlefield");
    for (const n of ["Elvish Mystic", "Silver Myr", "Palladium Myr", "Segovian Angel"]) expect(dead(t, ids[`p2:${n}`][0])).toBe(true);
    expect(life(t, "p1")).toBe(38); // X = 2, the smallest that kills the 2/2 Palladium Myr
  });
  it("sizes X to the biggest threat (never pays 0): a 10/10 across the table needs X = 10", () => {
    const { t, ids } = board({ p1: { lands: swamps(4), hand: ["Toxic Deluge"] }, p2: { field: ["Gigantosaurus"] } });
    expect(playOne(t, "p1").label).toBe("Cast Toxic Deluge");
    expect(dead(t, ids["p2:Gigantosaurus"][0])).toBe(true);
    expect(life(t, "p1")).toBe(30);
  });
  it("does not cast it into an empty board (paying 0 would do nothing, paying more only costs life)", () => {
    const { t } = board({ p1: { lands: swamps(4), hand: ["Toxic Deluge"] }, p2: {} });
    expect(playOne(t, "p1").label).toBeUndefined();
    expect(life(t, "p1")).toBe(40);
  });
  it("does not cast it when it would lose as much as it kills", () => {
    const { t } = board({ p1: { lands: swamps(4), field: ["Elvish Mystic", "Silver Myr"], hand: ["Toxic Deluge"] }, p2: { field: ["Elvish Mystic", "Silver Myr"] } });
    expect(playOne(t, "p1").label).toBeUndefined();
  });
  it("does not pay life into danger (life 6 against two 1/1s: X = 1 would be enough for them but the AI is too low)", () => {
    const { t } = board({ p1: { lands: swamps(4), hand: ["Toxic Deluge"], life: 4 }, p2: { field: ["Llanowar Elves", "Segovian Angel"] } });
    expect(playOne(t, "p1").label).toBeUndefined();
  });
  it("4 players: one wipe that kills three opponents' boards while sparing its own big creature", () => {
    const { t, ids } = board({
      p1: { lands: swamps(4), field: ["Carnage Tyrant"], hand: ["Toxic Deluge"] },
      p2: { field: ["Elvish Mystic", "Llanowar Elves"] }, p3: { field: ["Silver Myr", "Palladium Myr"] }, p4: { field: ["Segovian Angel", "Birds of Paradise"] }
    });
    expect(playOne(t, "p1").label).toBe("Cast Toxic Deluge");
    expect(zoneOf(t, ids["p1:Carnage Tyrant"][0])).toBe("battlefield");
    for (const k of Object.keys(ids).filter((k) => !k.startsWith("p1:"))) expect(dead(t, ids[k][0])).toBe(true);
    expect(life(t, "p1")).toBe(38);
  });
});

describe("Delete ({X}{R}{R}: X damage to each nonartifact creature and each player)", () => {
  it("chooses X = 1 to kill three 1/1s while its own artifact creature survives (never X = 0)", () => {
    const { t, ids } = board({
      p1: { lands: { Mountain: 5 }, field: ["Silver Myr"], hand: ["Delete"] },
      p2: { field: ["Elvish Mystic", "Llanowar Elves", "Segovian Angel"] }
    });
    expect(playOne(t, "p1").label).toBe("Cast Delete");
    expect(zoneOf(t, ids["p1:Silver Myr"][0])).toBe("battlefield");
    for (const n of ["Elvish Mystic", "Llanowar Elves", "Segovian Angel"]) expect(dead(t, ids[`p2:${n}`][0])).toBe(true);
    expect(life(t, "p1")).toBe(39); // each player is hit too: X = 1
    expect(life(t, "p2")).toBe(39);
  });
  it("is cast with X = the opponent's life when that is lethal", () => {
    const { t } = board({ p1: { lands: { Mountain: 6 }, hand: ["Delete"] }, p2: { life: 3 } });
    expect(playOne(t, "p1").label).toBe("Cast Delete");
    expect(t.state.gameOver?.winner).toBe("p1");
  });
  it("is not cast with nothing to hit (X = 0 changes nothing; X > 0 hurts both players equally)", () => {
    const { t } = board({ p1: { lands: { Mountain: 5 }, hand: ["Delete"] }, p2: {} });
    expect(playOne(t, "p1").label).toBeUndefined();
    expect(life(t, "p1")).toBe(40);
  });
  it("is not cast when its own creatures would die for the opponent's smaller ones", () => {
    const { t } = board({ p1: { lands: { Mountain: 5 }, field: ["Palladium Myr", "Carnage Tyrant", "Elvish Mystic"], hand: ["Delete"] }, p2: { field: ["Llanowar Elves"] } });
    expect(playOne(t, "p1").label).toBeUndefined();
  });
});

describe("other board wipes", () => {
  it("Magmaquake (X to each creature without flying): X = 1, its own flyer lives", () => {
    const { t, ids } = board({ p1: { lands: { Mountain: 4 }, field: ["Segovian Angel"], hand: ["Magmaquake"] }, p2: { field: ["Elvish Mystic", "Llanowar Elves"] } });
    expect(playOne(t, "p1").label).toBe("Cast Magmaquake");
    expect(zoneOf(t, ids["p1:Segovian Angel"][0])).toBe("battlefield");
    expect(dead(t, ids["p2:Elvish Mystic"][0])).toBe(true);
    expect(dead(t, ids["p2:Llanowar Elves"][0])).toBe(true);
  });
  it("Blasphemous Act (costs {1} less per creature): cast with an empty own board against a wide table, not into its own big board", () => {
    const wide = board({ p1: { lands: { Mountain: 6 }, hand: ["Blasphemous Act"] }, p2: { field: ["Elvish Mystic", "Llanowar Elves", "Silver Myr"] }, p3: { field: ["Palladium Myr", "Segovian Angel"] }, p4: { field: ["Birds of Paradise"] } });
    expect(playOne(wide.t, "p1").label).toBe("Cast Blasphemous Act");
    for (const k of Object.keys(wide.ids).filter((k) => !k.startsWith("p1:"))) expect(dead(wide.t, wide.ids[k][0])).toBe(true);
    const mine = board({ p1: { lands: { Mountain: 6 }, field: ["Gigantosaurus", "Carnage Tyrant"], hand: ["Blasphemous Act"] }, p2: { field: ["Elvish Mystic"] } });
    expect(playOne(mine.t, "p1").label).toBeUndefined();
  });
  it("Day of Judgment: cast when behind on board, not when ahead", () => {
    const behind = board({ p1: { lands: { Plains: 4 }, field: ["Elvish Mystic"], hand: ["Day of Judgment"] }, p2: { field: ["Gigantosaurus", "Palladium Myr"] } });
    expect(playOne(behind.t, "p1").label).toBe("Cast Day of Judgment");
    expect(dead(behind.t, behind.ids["p2:Gigantosaurus"][0])).toBe(true);
    const ahead = board({ p1: { lands: { Plains: 4 }, field: ["Gigantosaurus"], hand: ["Day of Judgment"] }, p2: { field: ["Elvish Mystic"] } });
    expect(playOne(ahead.t, "p1").label).toBeUndefined();
  });
  it("Decree of Pain: cast (8 mana) when it kills far more of the opponents' board", () => {
    const { t, ids } = board({ p1: { lands: swamps(8), hand: ["Decree of Pain"] }, p2: { field: ["Gigantosaurus", "Carnage Tyrant"] } });
    const r = playOne(t, "p1");
    expect(r.label).toBe("Cast Decree of Pain");
    expect(dead(t, ids["p2:Gigantosaurus"][0])).toBe(true);
  });
});

describe("spot removal and burn", () => {
  it("Swords to Plowshares is never cast when it could only target its own creatures", () => {
    const { t } = board({ p1: { lands: { Plains: 2 }, field: ["Gigantosaurus"], hand: ["Swords to Plowshares"] }, p2: {} });
    expect(playOne(t, "p1").label).toBeUndefined();
  });
  it("Swords to Plowshares exiles the opponent's best targetable creature (the hexproof one cannot be chosen)", () => {
    const { t, ids } = board({ p1: { lands: { Plains: 2 }, field: ["Elvish Mystic"], hand: ["Swords to Plowshares"] }, p2: { field: ["Carnage Tyrant", "Gigantosaurus", "Llanowar Elves"] } });
    expect(playOne(t, "p1").label).toBe("Cast Swords to Plowshares");
    expect(zoneOf(t, ids["p2:Gigantosaurus"][0])).toBe("exile");
    expect(zoneOf(t, ids["p1:Elvish Mystic"][0])).toBe("battlefield");
  });
  it("Lightning Bolt goes at the opponent's creature or face, never at its own creature", () => {
    const { t, ids } = board({ p1: { lands: { Mountain: 2 }, field: ["Palladium Myr"], hand: ["Lightning Bolt"] }, p2: { field: ["Segovian Angel"] } });
    expect(playOne(t, "p1").label).toBe("Cast Lightning Bolt");
    expect(zoneOf(t, ids["p1:Palladium Myr"][0])).toBe("battlefield");
  });
});

describe("responses and decisions", () => {
  it("still counters an opponent's spell with a counterspell", () => {
    const { t, ids } = board({ p1: { lands: { Forest: 5 }, hand: ["Gigantosaurus"] }, p2: { lands: { Island: 2 }, hand: ["Counterspell"] } });
    t.ok({ type: "castSpell", player: "p1", cardId: ids["p1:Gigantosaurus"][0], autoPay: true });
    t.ok({ type: "passPriority", player: "p1" });
    const c = choose(t, "p2");
    expect(c.label).toBe("Cast Counterspell");
  });
  it("sacrifice decisions give up the least valuable creature (Fleshbag Marauder: each player sacrifices a creature of their choice)", () => {
    const { t, ids } = board({ p1: { lands: swamps(3), field: ["Gigantosaurus", "Elvish Mystic"], hand: ["Fleshbag Marauder"] }, p2: { field: ["Palladium Myr"] } });
    const r = playOne(t, "p1");
    expect(r.label).toBe("Cast Fleshbag Marauder");
    expect(zoneOf(t, ids["p1:Gigantosaurus"][0])).toBe("battlefield");
    expect(dead(t, ids["p2:Palladium Myr"][0])).toBe(true);
  });
  it("is deterministic: the same position gives the same choice", () => {
    const mk = () => board({ p1: { lands: swamps(4), field: ["Gigantosaurus"], hand: ["Toxic Deluge"] }, p2: { field: ["Elvish Mystic", "Palladium Myr"] } }).t;
    const a = mk(), b = mk();
    const ca = choose(a, "p1"), cb = choose(b, "p1");
    expect(ca.action).toEqual(cb.action);
    expect(ca.memory.script).toEqual(cb.memory.script);
  });
  it("plays lands first and passes when nothing is worth doing", () => {
    const { t } = board({ p1: { lands: swamps(1), hand: ["Swamp"] }, p2: {} });
    expect(choose(t, "p1").label).toBe("Play Swamp");
    void ctx; void legalActions; void chooseAiAction;
  });
});
