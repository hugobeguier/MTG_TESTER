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
