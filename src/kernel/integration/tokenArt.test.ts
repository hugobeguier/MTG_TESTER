import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ctx, mini } from "./testgame";
import { packKit } from "./cardPack";
import { buildPack } from "./nodePack";
import { attachTokenArt, loadTokenPrintingsCache } from "./nodeTokenArt";
import { PREDEFINED_TOKEN_NAMES, printingKey, resolveTokenArt, tokenArtResolver, tokenNamesOf, type TokenPrintings } from "./tokenArt";
import { toSession, type ToSessionEnv } from "./toSession";
import type { TokenDef } from "../engine/types";
import type { VisibleCard } from "../../lib/types";

const img = (n: string) => ({ small: `s/${n}`, normal: `n/${n}`, large: `l/${n}` });
const fixture: TokenPrintings = {
  pest: [
    { name: "Pest", type_line: "Token Creature — Pest", oracle_text: "Whenever this creature attacks, you gain 1 life.", colors: ["B", "G"], power: "1", toughness: "1", image_uris: img("pest-attack") },
    { name: "Pest", type_line: "Token Creature — Pest", oracle_text: "When this creature dies, you gain 1 life.", colors: ["B", "G"], power: "1", toughness: "1", image_uris: img("pest-dies") }
  ],
  treasure: [{ name: "Treasure", type_line: "Token Artifact — Treasure", oracle_text: "{T}, Sacrifice this artifact: Add one mana of any color.", colors: [], image_uris: img("treasure") }]
};

describe("resolveTokenArt", () => {
  it("picks the printing with the same rules text, falls back to the name, and is memoised", () => {
    expect(resolveTokenArt(fixture, { name: "Pest", power: "1", toughness: "1", colors: ["B", "G"], oracleText: "When this token dies, you gain 1 life." })?.normal).toBe("n/pest-dies");
    expect(resolveTokenArt(fixture, { name: "Pest Token", power: "1", toughness: "1", colors: ["B", "G"], oracleText: "Something else entirely" })?.normal).toBeTruthy();
    expect(resolveTokenArt(fixture, { name: "Nobody", colors: [] })).toBeUndefined();
    const r = tokenArtResolver(fixture);
    const spec = { name: "Treasure", colors: [], typeLine: "Artifact — Treasure", oracleText: "{T}, Sacrifice this artifact: Add one mana of any color." };
    expect(r(spec)?.normal).toBe("n/treasure");
    expect(r(spec)).toBe(r(spec));
  });
  it("tokenNamesOf finds create_tokens at any depth and investigate", () => {
    expect(tokenNamesOf({ a: [{ then: [{ kind: "create_tokens", tokenName: "Thopter" }] }, { kind: "investigate" }] })).toEqual(["Clue", "Thopter"]);
  });
});

describe("toSession: token art", () => {
  const baseEnv = (extra: Partial<ToSessionEnv>): ToSessionEnv => ({ ctx, ...extra } as ToSessionEnv);
  const tokenCard = (token: TokenDef, env: Partial<ToSessionEnv>, cardName = token.name): VisibleCard => {
    const t = mini();
    const id = t.give("p1", "Gravecrawler", "battlefield");
    t.state.objects[id].token = token; t.state.objects[id].cardName = cardName;
    return toSession(t.state, "p1", { ...baseEnv(env) } as ToSessionEnv).seats[0].board.battlefield.find((c) => c.name === token.name)!;
  };
  it("a token gets its Scryfall printing; without art it is a placeholder card with name, type line and P/T", () => {
    const withArt = tokenCard({ name: "Treasure", types: ["artifact"], subtypes: ["Treasure"], colors: [], keywords: [] }, { tokenArt: tokenArtResolver(fixture) });
    expect(withArt.imageUris?.normal).toBe("n/treasure");
    const none = tokenCard({ name: "Nobody", types: ["creature"], subtypes: ["Nobody"], colors: ["red"], power: 3, toughness: 3, keywords: [] }, { tokenArt: tokenArtResolver(fixture) });
    expect(none.imageUris).toBeUndefined();
    expect(none).toMatchObject({ token: true, typeLine: "Token Creature — Nobody", power: "3", toughness: "3" });
  });
  it("a token copy of a card uses the copied card's art", () => {
    const display = (n: string) => (n === "Gravecrawler" ? { name: n, typeLine: "Creature — Zombie", oracleText: "", manaValue: 1, colors: ["B"], imageUris: { normal: "n/gravecrawler" } as never } : undefined);
    const c = tokenCard({ name: "Gravecrawler", types: ["creature"], subtypes: ["Zombie"], colors: ["black"], power: 2, toughness: 1, keywords: [], manaCost: "{B}" }, { display, tokenArt: tokenArtResolver(fixture) });
    expect(c.imageUris?.normal).toBe("n/gravecrawler");
  });
});

// ---- the ready decks: every token their cards create resolves to real art or to the placeholder (never to nothing)
const DECKS = ["saheeli", "aminatou", "meren", "the-ur-dragon", "meren-built-on-my-own", "keen-engineering", "wretched-ranks", "tramplesaurus-rex"];
const cache = loadTokenPrintingsCache();
const cached = Object.keys(cache).length > 0;

function draftTokens(slug: string): Array<{ name: string; types: string; power?: number | string; toughness?: number | string; colors: string[] }> {
  const dir = path.resolve(process.cwd(), "data/kernel-drafts", slug);
  const out: Array<{ name: string; types: string; power?: number | string; toughness?: number | string; colors: string[] }> = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.tokenName === "string") out.push({ name: o.tokenName, types: String(o.tokenTypeLine ?? ""), power: o.tokenPower as never, toughness: o.tokenToughness as never, colors: ((o.tokenColors as string[]) ?? []).filter((c) => c !== "colorless") });
    Object.values(o).forEach(walk);
  };
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".json") && !f.startsWith("_")) { try { walk(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))); } catch { /* not a card */ } }
  return out;
}

describe("token art coverage over the ready decks", () => {
  const distinct = new Set<string>();
  let real = 0;
  const placeholders: string[] = [];
  for (const slug of DECKS) {
    it(`${slug}: every token resolves to art or the placeholder`, async () => {
      const pack = buildPack(slug, { catalog: false });
      const res = await attachTokenArt(pack, { cache, offline: true });
      expect(res.names).toEqual(expect.arrayContaining([...PREDEFINED_TOKEN_NAMES]));
      const kit = packKit([pack]);
      const specs = draftTokens(slug);
      for (const tk of specs) {
        const num = (x: unknown) => (typeof x === "number" ? x : undefined);
        const def: TokenDef = { name: tk.name, types: tk.types.split(" — ")[0].toLowerCase().split(" ").filter(Boolean), subtypes: (tk.types.split(" — ")[1] ?? "").split(" ").filter(Boolean), colors: tk.colors, power: num(tk.power), toughness: num(tk.toughness), keywords: [] };
        const t = mini();
        const id = t.give("p1", "Gravecrawler", "battlefield");
        t.state.objects[id].token = def; t.state.objects[id].cardName = def.name;
        const card = toSession(t.state, "p1", { ctx, tokenArt: kit.tokenArt } as ToSessionEnv).seats[0].board.battlefield.find((c) => c.name === def.name);
        expect(card, tk.name).toBeTruthy();
        expect(card!.typeLine.length, tk.name).toBeGreaterThan(0); // the placeholder is drawn from these
        const key = `${printingKey(tk.name)}|${tk.power ?? ""}/${tk.toughness ?? ""}|${tk.colors.join("")}`;
        if (!distinct.has(key)) { distinct.add(key); if (card!.imageUris?.normal) real += 1; else placeholders.push(tk.name); }
        if (cached) expect(card!.imageUris?.normal, `${tk.name} (${key}) has no art in the cache`).toBeTruthy();
      }
    }, 120000);
  }
  it("reports the coverage", () => {
    // eslint-disable-next-line no-console
    console.log(`token art: ${real} of ${distinct.size} distinct deck tokens resolve to Scryfall art, ${placeholders.length} to the placeholder${placeholders.length ? ` (${[...new Set(placeholders)].join(", ")})` : ""}`);
    expect(real + placeholders.length).toBe(distinct.size);
  });
});
