import { describe, expect, it } from "vitest";
import { displayFromDef, fetchPacks, isCardPack, packKit, typeLineOf, type CardPack } from "./cardPack";
import { dl } from "./testgame";

const mk = (deck: string, names: string[]): CardPack => ({ version: 1, deck, slug: deck.toLowerCase(), generatedAt: "", cards: Object.fromEntries(names.map((n) => [n, dl.lookup(n)!])), info: {}, creatureTypes: ["Zombie"], display: {}, decks: [{ name: deck, cards: names.map((n) => ({ name: n, count: 1 })) }], unsupported: [] });

describe("card packs", () => {
  it("packKit merges packs without overriding the first definition", () => {
    const a = mk("A", ["Swamp", "Sol Ring"]), b = mk("B", ["Swamp", "Gravecrawler"]);
    const kit = packKit([a, b]);
    expect(kit.names).toEqual(["Gravecrawler", "Sol Ring", "Swamp"]);
    expect(kit.lookup("Swamp")).toBe(a.cards.Swamp);
    expect(kit.lookup("Nope")).toBeUndefined();
    expect(kit.deck("B")?.cards).toHaveLength(2);
    expect(kit.db.cardNames()).toEqual(kit.names);
  });
  it("isCardPack rejects junk", () => {
    expect(isCardPack(mk("A", ["Swamp"]))).toBe(true);
    for (const bad of [null, {}, { version: 2 }, { version: 1, deck: "x" }, "pack"]) expect(isCardPack(bad)).toBe(false);
  });
  it("fetchPacks reads /kernel-packs/<slug>.json and explains a missing pack", async () => {
    const pack = mk("A", ["Swamp"]);
    const fetcher = (async (url: string) => (url.endsWith("/a.json") ? { ok: true, status: 200, json: async () => pack } : { ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await fetchPacks(["a"], "/kernel-packs", fetcher)).toEqual([pack]);
    await expect(fetchPacks(["missing"], "/kernel-packs", fetcher)).rejects.toThrow(/kernel:bundle-drafts/);
  });
  it("type lines and display fallbacks", () => {
    expect(typeLineOf(["creature"], ["Zombie", "Knight"], ["legendary"])).toBe("Legendary Creature — Zombie Knight");
    expect(typeLineOf(["land"])).toBe("Land");
    const d = displayFromDef(dl.lookup("Gravecrawler")!);
    expect(d).toMatchObject({ name: "Gravecrawler", typeLine: "Creature — Zombie", manaValue: 1, power: "2", toughness: "1" });
    expect(d.colors).toEqual(["B"]);
  });
});
