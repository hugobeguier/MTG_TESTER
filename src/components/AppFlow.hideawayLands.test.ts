// Hideaway lands (Mosswort Bridge, Spinerock Knoll, Windbrisk Heights, Shelldock Isle, Howltooth Hollow), driven end to end
// for an AGENT seat with the REAL Oracle text from the catalog: land play -> enters trigger -> card hidden face down -> the
// activated ability's condition -> the free play being offered / performed.
import { describe, expect, it } from "vitest";
import { applyGenericTapEffect, hideawayDamageConditionMet, findCommonTriggersForPermanentEntered, legalMainPhaseActions, playCardFromZone, resolveTriggerEffect } from "./AppFlow";
import { parseGenericTapAbilities } from "@/lib/activatedAbilities";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
function seat(id: string, battlefield: VisibleCard[], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return { id, name: id, kind: "agent", life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield, graveyard: [] }, ...extra };
}
function session(seats: PlayerSeat[]): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] };
}
const bear = (id: string, extra: Partial<VisibleCard> = {}) => ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;

describe("Mosswort Bridge for an agent, end to end", () => {
  it("plays from hand, hides a card, then offers the activation and the free cast once power is 10+", () => {
    const bridge = real("Mosswort Bridge", "mb", { zone: "hand" });
    const forest = (id: string) => real("Forest", id, { typeLine: "Basic Land — Forest", oracleText: "{T}: Add {G}.", producedMana: ["G"] } as Partial<VisibleCard>);
    const mine = seat("m", [forest("f1"), forest("f2")], { name: "Malik" });
    mine.board.hand = [bridge];
    mine.library = [
      bear("l1", { zone: "library" as const, manaValue: 1 }),
      bear("big", { zone: "library" as const, manaValue: 7 }),
      bear("l2", { zone: "library" as const, manaValue: 2 }),
      bear("l3", { zone: "library" as const, manaValue: 3 }),
      bear("deep", { zone: "library" as const })
    ];
    const s0 = session([mine, seat("o", [])]);
    const played = playCardFromZone(s0, "m", "mb", "Malik plays Mosswort Bridge.", undefined, "battlefield", [], "hand");
    const onField = played.seats[0].board.battlefield.find((c) => c.id === "mb")!;
    expect(onField).toBeDefined();
    const triggers = findCommonTriggersForPermanentEntered(played, "m", bridge);
    expect(triggers.map((t) => t.effect.kind)).toEqual(["hideaway"]);
    const hidden = resolveTriggerEffect(played, triggers[0]);
    expect(hidden.seats[0].board.exile?.map((c) => c.id)).toEqual(["big"]);
    expect(hidden.events[0].message).toMatch(/hideaway/);

    // Untapped bridge, 10 power on board: the agent is offered the activation.
    const ready = { ...hidden, seats: hidden.seats.map((x) => x.id !== "m" ? x : { ...x, board: { ...x.board, battlefield: [...x.board.battlefield.map((c) => c.id === "mb" ? { ...c, tapped: false } : c), bear("fat", { power: "6" }), bear("fat2", { power: "4" })] } }) };
    const actions = legalMainPhaseActions(ready.seats[0], true, "m", 1, new Set(), ready);
    expect(actions.some((a) => a.abilityKind === "generic_tap" && a.cardId === "mb" && /play the exiled card/.test(a.detail ?? ""))).toBe(true);

    const ability = parseGenericTapAbilities(bridge.oracleText).find((a) => a.effect.kind === "hideaway_play")!;
    const granted = applyGenericTapEffect(ready, "m", "mb", "Mosswort Bridge", ability.effect, ability.clause);
    const after = legalMainPhaseActions(granted.seats[0], true, "m", 1, new Set(), granted);
    expect(after.some((a) => a.id === "cast-exile:big")).toBe(true);
  });
});

describe("hideaway activation conditions", () => {
  it("Shelldock Isle and Howltooth Hollow have real evaluators; unknown text stays undefined", () => {
    const a = seat("a", [], { library: Array.from({ length: 21 }, (_, i) => bear(`c${i}`)) });
    const b = seat("b", [], { library: Array.from({ length: 30 }, (_, i) => bear(`d${i}`)) });
    const s = session([a, b]);
    expect(hideawayDamageConditionMet(s, "a", "a library has twenty or fewer cards in it")).toBe(false);
    b.library = b.library!.slice(0, 20);
    expect(hideawayDamageConditionMet(s, "a", "a library has twenty or fewer cards in it")).toBe(true);
    expect(hideawayDamageConditionMet(s, "a", "each player has no cards in hand")).toBe(true);
    a.board.hand = [bear("h")];
    expect(hideawayDamageConditionMet(s, "a", "each player has no cards in hand")).toBe(false);
    expect(hideawayDamageConditionMet(s, "a", "you attacked with three or more creatures this turn")).toBeUndefined();
  });

  it("a hidden LAND: the ability is only worth paying with a land drop left, and the land is then offered as a play from exile", () => {
    const bridge = real("Mosswort Bridge", "mb");
    const forest = real("Forest", "f1", { typeLine: "Basic Land — Forest", oracleText: "{T}: Add {G}.", producedMana: ["G"] } as Partial<VisibleCard>);
    const mine = seat("m", [bridge, forest, bear("fat", { power: "12" })]);
    mine.board.exile = [{ ...forest, id: "hid", zone: "exile" as const, hideawaySourceId: "mb" }];
    const s = session([mine, seat("o", [])]);
    const withDrop = legalMainPhaseActions(s.seats[0], false, "m", 1, new Set(), s);
    const noDrop = legalMainPhaseActions(s.seats[0], true, "m", 1, new Set(), s);
    expect(noDrop.some((a) => a.cardId === "mb" && a.abilityKind === "generic_tap")).toBe(false);
    expect(withDrop.some((a) => a.cardId === "mb" && a.abilityKind === "generic_tap")).toBe(true);
    const ability = parseGenericTapAbilities(bridge.oracleText).find((a) => a.effect.kind === "hideaway_play")!;
    const granted = applyGenericTapEffect(s, "m", "mb", "Mosswort Bridge", ability.effect, ability.clause);
    const afterGrant = legalMainPhaseActions(granted.seats[0], false, "m", 1, new Set(), granted);
    const landPlay = afterGrant.find((a) => a.id === "play-land-exile:hid");
    expect(landPlay).toMatchObject({ actionType: "play_land", sourceZone: "exile" });
    const played = playCardFromZone(granted, "m", "hid", "Malik plays a land.", undefined, "battlefield", [], "exile");
    expect(played.seats[0].board.battlefield.some((c) => c.id === "hid")).toBe(true);
    expect(played.seats[0].board.exile!.some((c) => c.id === "hid")).toBe(false);
    // and with the land drop already used it is not offered
    expect(legalMainPhaseActions(granted.seats[0], true, "m", 1, new Set(), granted).some((a) => a.id === "play-land-exile:hid")).toBe(false);
  });
});
