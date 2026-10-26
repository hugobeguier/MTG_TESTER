import { describe, expect, it } from "vitest";
import { findCommonTriggersForPermanentEntered } from "./AppFlow";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
const real = (name: string, id: string, extra: Partial<VisibleCard> = {}) =>
  ({ manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...(lookupCard(catalog, name) as object), id, summoningSick: false, ...extra }) as VisibleCard;
const seat = (id: string, battlefield: VisibleCard[]) => ({ id, name: id, kind: "agent", life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield, graveyard: [] } }) as never;

describe("Dragon's Hoard", () => {
  it("gets a gold counter when a Dragon enters under its controller", () => {
    const hoard = real("Dragon's Hoard", "hoard");
    console.log(hoard.oracleText);
    const dragon = real("Shivan Dragon", "d");
    const s = { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats: [seat("a", [hoard, dragon])], events: [] } as unknown as GameSession;
    const t = findCommonTriggersForPermanentEntered(s, "a", dragon).filter((x) => x.sourceCardId === "hoard");
    console.log(JSON.stringify(t.map((x) => x.effect)));
    expect(t).toHaveLength(1);
  });
});
