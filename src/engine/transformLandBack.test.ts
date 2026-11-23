// A transforming DFC whose back face is a land (Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun; Storm the Vault // Vault of Catlacan) is a
// NONLAND card in hand: its back face is never played as a land and never cast. Only a true modal DFC (Bala Ged Recovery // Bala Ged Sanctuary)
// offers "play the land face" from hand, and then it is a play_land special action, never a cast_spell.
import { describe, expect, it } from "vitest";
import { legalMainPhaseActions } from "@/engine/legalActions";
import { isLandCard } from "@/engine/shared";
import type { CardFaceRecord, GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const face = (o: Partial<CardFaceRecord> & Pick<CardFaceRecord, "name" | "typeLine" | "oracleText">): CardFaceRecord => ({ colors: [], ...o });
const growingRites: VisibleCard = {
  id: "gr", name: "Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun", typeLine: "Legendary Enchantment // Legendary Land", manaCost: "{2}{G}", manaValue: 3, colors: ["G"], role: "land", zone: "hand",
  oracleText: "When Growing Rites of Itlimoc enters, look at the top four cards of your library.",
  faces: [
    face({ name: "Growing Rites of Itlimoc", typeLine: "Legendary Enchantment", manaCost: "{2}{G}", oracleText: "When Growing Rites of Itlimoc enters, look at the top four cards of your library." }),
    face({ name: "Itlimoc, Cradle of the Sun", typeLine: "Legendary Land", manaCost: "", oracleText: "(Transforms from Growing Rites of Itlimoc.)\n{T}: Add {G}." })
  ]
};
const bala: VisibleCard = {
  id: "bala", name: "Bala Ged Recovery // Bala Ged Sanctuary", typeLine: "Sorcery // Land", manaCost: "{2}{G}", manaValue: 3, colors: ["G"], role: "spell", zone: "hand",
  oracleText: "Return target card from your graveyard to your hand.",
  faces: [
    face({ name: "Bala Ged Recovery", typeLine: "Sorcery", manaCost: "{2}{G}", oracleText: "Return target card from your graveyard to your hand." }),
    face({ name: "Bala Ged Sanctuary", typeLine: "Land", manaCost: "", oracleText: "This land enters tapped.\n{T}: Add {G}." })
  ]
};
const forest = (i: number): VisibleCard => ({ id: `f${i}`, name: "Forest", typeLine: "Basic Land - Forest", oracleText: "{T}: Add {G}.", manaValue: 0, colors: [], role: "land", zone: "battlefield" });
const seat = (hand: VisibleCard[]): PlayerSeat => ({ id: "p", name: "P", kind: "agent", life: 40, commanderDamage: {}, zones: { library: 0, hand: 1, battlefield: 3, graveyard: 0, exile: 0, command: 0 }, board: { hand, battlefield: [forest(1), forest(2), forest(3)] } } as PlayerSeat);
const session = (s: PlayerSeat): GameSession => ({ id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats: [s], events: [] });

describe("transform DFC with a land back face (not a modal DFC)", () => {
  it("is not a land card while it is the enchantment front", () => { expect(isLandCard(growingRites)).toBe(false); });
  it("is cast as the enchantment only: never offered as a land play, never as a cast of the land face", () => {
    const s = seat([growingRites]);
    const acts = legalMainPhaseActions(s, false, "p", 1, new Set(), session(s));
    expect(acts.filter((a) => a.actionType === "play_land")).toEqual([]);
    const casts = acts.filter((a) => a.actionType === "cast_spell" && a.cardId === "gr");
    expect(casts).toHaveLength(1);
    expect(casts[0].faceIndex).toBeUndefined();
  });
  it("a real modal DFC still offers the land face as play_land and the spell face as cast_spell (never the land face as a cast)", () => {
    const s = seat([bala]);
    const acts = legalMainPhaseActions(s, false, "p", 1, new Set(), session(s));
    expect(acts.filter((a) => a.actionType === "play_land").map((a) => a.faceIndex)).toEqual([1]);
    expect(acts.filter((a) => a.actionType === "cast_spell" && a.faceIndex === 1)).toEqual([]);
  });
});
