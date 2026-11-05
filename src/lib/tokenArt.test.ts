import { describe, expect, it } from "vitest";
import { needsTokenArt, tokenArtKey, tokenBaseName, tokenSearchQuery } from "./tokenArt";
import type { VisibleCard } from "./types";

const servo = { id: "s", name: "Servo Token", typeLine: "Token Artifact Creature - Servo", power: "1", toughness: "1", colors: [], token: true, manaValue: 0, oracleText: "", role: "token", zone: "battlefield" } as VisibleCard;

describe("token art (Scryfall token objects)", () => {
  it("builds a token-only Scryfall query from the token's name and stats", () => {
    expect(tokenBaseName("Servo Token")).toBe("Servo");
    expect(tokenSearchQuery(servo, true)).toBe('t:token name:"Servo" pow=1 tou=1');
    expect(tokenSearchQuery(servo, false)).toBe('t:token name:"Servo"');
    expect(tokenArtKey(servo)).toBe("servo|1/1|");
  });
  it("only tokens without art ask for it", () => {
    expect(needsTokenArt(servo)).toBe(true);
    expect(needsTokenArt({ ...servo, imageUris: { normal: "https://example/x.jpg" } })).toBe(false);
    expect(needsTokenArt({ ...servo, token: false })).toBe(false);
  });
});

import { normalizeTokenText, pickTokenPrinting, tokenArtLookupKey, type TokenCandidate } from "./tokenArt";

const img = (id: string) => ({ small: `s${id}`, normal: `n${id}`, large: `l${id}`, png: `p${id}`, art_crop: `a${id}`, border_crop: `b${id}` });
const cand = (id: string, name: string, type_line: string, oracle_text: string, colors: string[], power?: string, toughness?: string): TokenCandidate => ({ name, type_line, oracle_text, colors, power, toughness, image_uris: img(id) });
const tok = (name: string, typeLine: string, power: string | undefined, toughness: string | undefined, colors: string[], oracleText: string) => ({ name, typeLine, power, toughness, colors, oracleText });

describe("pickTokenPrinting (same-name tokens with different rules text)", () => {
  // newest first, as Scryfall returns it: the attack-trigger SOS Pest comes before the die-trigger one
  const pests = [
    cand("sos", "Pest", "Token Creature — Pest", "Whenever this token attacks, you gain 1 life.", ["B", "G"], "1", "1"),
    cand("sth", "Pest", "Token Creature — Pest", "When this token dies, you gain 1 life.", ["B", "G"], "1", "1")
  ];
  it("Beledros's Pest (die trigger) gets the die-trigger printing, not the newest one", () => {
    const beledros = tok("Pest Token", "Token Creature - Pest", "1", "1", ["B", "G"], '"When this token dies, you gain 1 life');
    expect(pickTokenPrinting(beledros, pests)?.normal).toBe("nsth");
  });
  it("an attack-trigger Pest gets the attack printing", () => {
    expect(pickTokenPrinting(tok("Pest Token", "Token Creature - Pest", "1", "1", ["B", "G"], "Whenever this token attacks, you gain 1 life."), pests)?.normal).toBe("nsos");
  });
  it("shows no face (engine text) when every printing has different rules text", () => {
    expect(pickTokenPrinting(tok("Pest Token", "Token Creature - Pest", "1", "1", ["B", "G"], "Whenever this token blocks, draw a card."), pests)).toBeUndefined();
  });
  it("a vanilla token falls back to name+colors+P/T, ignoring wrong stats", () => {
    const wurms = [
      cand("w33", "Wurm", "Token Creature — Wurm", "Deathtouch", ["B"], "3", "3"),
      cand("w66", "Wurm", "Token Creature — Wurm", "Trample", ["G"], "6", "6"),
      cand("w33l", "Wurm", "Token Creature — Wurm", "Lifelink", ["G"], "3", "3")
    ];
    expect(pickTokenPrinting(tok("Wurm Token", "Token Creature - Wurm", "3", "3", ["G"], "Lifelink"), wurms)?.normal).toBe("nw33l");
    expect(pickTokenPrinting(tok("Wurm Token", "Token Creature - Wurm", "6", "6", ["G"], "Trample"), wurms)?.normal).toBe("nw66");
    expect(pickTokenPrinting(tok("Wurm Token", "Token Creature - Wurm", "3", "3", ["B"], "Deathtouch"), wurms)?.normal).toBe("nw33");
  });
  it("Treasure / Clue / Food pick the printing whose text matches, ignoring reminder text and sacrifice wording", () => {
    const treasures = [cand("t1", "Treasure", "Token Artifact — Treasure", "{T}, Sacrifice this token: Add one mana of any color.", []), cand("t2", "Treasure", "Token Artifact — Treasure", "{T}, Sacrifice this artifact: Add one mana of any color. Different.", [])];
    expect(pickTokenPrinting(tok("Treasure Token", "Token Artifact - Treasure", undefined, undefined, [], "{T}, Sacrifice this artifact: Add one mana of any color. Different."), treasures)?.normal).toBe("nt2");
    const clues = [cand("c1", "Clue", "Token Artifact — Clue", "{2}, Sacrifice this token: Draw a card.", [])];
    expect(pickTokenPrinting(tok("Clue Token", "Token Artifact - Clue", undefined, undefined, [], "{2}, Sacrifice this token: Draw a card."), clues)?.normal).toBe("nc1");
  });
  it("vanilla tokens (Servo, Thopter, Soldier, Zombie, Insect, Goblin, Spirit, Elf Warrior, Dragon) match by colors/stats/type", () => {
    const spirits = [cand("sp1", "Spirit", "Token Creature — Spirit", "Flying", ["W"], "1", "1"), cand("sp2", "Spirit", "Token Creature — Spirit", "", ["C"], "1", "1"), cand("sp3", "Spirit", "Token Creature — Spirit", "", ["W"], "1", "1")];
    expect(pickTokenPrinting(tok("Spirit Token", "Token Creature - Spirit", "1", "1", ["W"], "Flying"), spirits)?.normal).toBe("nsp1");
    expect(pickTokenPrinting(tok("Spirit Token", "Token Creature - Spirit", "1", "1", ["W"], ""), spirits)?.normal).toBe("nsp3");
    const dragons = [cand("d4", "Dragon", "Token Creature — Dragon", "Flying", ["R"], "4", "4"), cand("d5", "Dragon", "Token Creature — Dragon", "Flying", ["R"], "5", "5")];
    expect(pickTokenPrinting(tok("Dragon Token", "Token Creature - Dragon", "5", "5", ["R"], "Flying"), dragons)?.normal).toBe("nd5");
    const elf = [cand("e1", "Elf Warrior", "Token Creature — Elf Warrior", "", ["G", "W"], "1", "1"), cand("e2", "Elf Warrior", "Token Creature — Elf Warrior", "", ["G"], "1", "1")];
    expect(pickTokenPrinting(tok("Elf Warrior Token", "Token Creature - Elf Warrior", "1", "1", ["G"], ""), elf)?.normal).toBe("ne2");
    const zombies = [cand("z1", "Zombie", "Token Creature — Zombie", "", ["B"], "2", "2")];
    expect(pickTokenPrinting(tok("Zombie Token", "Token Creature - Zombie", "2", "2", ["B"], ""), zombies)?.normal).toBe("nz1");
  });
  it("ignores candidates with other names and returns undefined when nothing has art", () => {
    expect(pickTokenPrinting(tok("Servo Token", "Token Artifact Creature - Servo", "1", "1", [], ""), [cand("x", "Thopter", "Token", "", [], "1", "1")])).toBeUndefined();
    expect(pickTokenPrinting(tok("Servo Token", "", "1", "1", [], ""), [{ name: "Servo", oracle_text: "", colors: [], power: "1", toughness: "1" }])).toBeUndefined();
  });
  it("lookup keys differ by oracle text", () => {
    const a = tok("Pest Token", "", "1", "1", ["B", "G"], "When this token dies, you gain 1 life.");
    const b = tok("Pest Token", "", "1", "1", ["B", "G"], "Whenever this token attacks, you gain 1 life.");
    expect(tokenArtLookupKey(a)).not.toBe(tokenArtLookupKey(b));
    expect(normalizeTokenText('"When this token dies, you gain 1 life.')).toBe("when this dies, you gain 1 life");
  });
});
