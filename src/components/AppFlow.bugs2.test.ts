// Bugs2.txt regressions, built on REAL Oracle text from the catalog: reveal-lands (Snarls), commander exile -> command zone,
// and Sarkhan's Triumph's visible reveal.
import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import {
  moveCardAcrossSeats,
  moveCommanderToCommandZone,
  moveLibraryCardToDestination,
  playCardFromZone,
  resolveTriggerEffect,
  returnLinkedExiles,
  revealLandTypes,
  resolveBasicLandFetchSearch,
  basicLandFetchBeholdType
} from "./AppFlow";

const catalog = loadCardCatalog();

function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "hand", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}

function seat(id: string, extra: Partial<PlayerSeat["board"]> = {}, seatExtra: Partial<PlayerSeat> = {}): PlayerSeat {
  const board = { hand: [], battlefield: [], graveyard: [], exile: [], ...extra };
  return {
    id,
    name: id,
    kind: "agent",
    life: 40,
    commanderDamage: {},
    zones: { library: 0, hand: board.hand.length, battlefield: board.battlefield.length, graveyard: board.graveyard.length, exile: board.exile.length, command: 0 },
    board,
    ...seatExtra
  } as PlayerSeat;
}

function session(seats: PlayerSeat[]): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] };
}

describe("reveal-lands (Snarls and friends)", () => {
  it("parses the revealable types from every template", () => {
    expect(revealLandTypes(real("Frostboil Snarl", "f").oracleText)).toEqual(["Island", "Mountain"]);
    expect(revealLandTypes(real("Furycalm Snarl", "f").oracleText)).toEqual(["Mountain", "Plains"]);
    expect(revealLandTypes(real("Shineshadow Snarl", "f").oracleText)).toEqual(["Plains", "Swamp"]);
    expect(revealLandTypes(real("Vineglimmer Snarl", "f").oracleText)).toEqual(["Forest", "Island"]);
    expect(revealLandTypes(real("Necroblossom Snarl", "f").oracleText)).toEqual(["Swamp", "Forest"]);
    expect(revealLandTypes(real("Murmuring Bosk", "f").oracleText)).toEqual(["Treefolk"]);
    expect(revealLandTypes(real("Temple of the Dragon Queen", "f").oracleText)).toEqual(["Dragon"]);
    expect(revealLandTypes("{T}: Add {G}.")).toBeUndefined();
  });

  it("an agent holding a Mountain in hand reveals it: the Snarl enters untapped and the log says so", () => {
    const snarl = real("Frostboil Snarl", "snarl");
    const mountain = real("Mountain", "mtn", { typeLine: "Basic Land — Mountain", oracleText: "({T}: Add {R}.)" });
    const after = playCardFromZone(session([seat("a", { hand: [snarl, mountain] })]), "a", "snarl");
    expect(after.seats[0].board.battlefield[0].tapped).toBeFalsy();
    expect(after.events[0].message).toMatch(/Reveals Mountain/);
  });

  it("no revealable card: enters tapped, no prompt", () => {
    const snarl = real("Frostboil Snarl", "snarl");
    const forest = real("Forest", "for", { typeLine: "Basic Land — Forest", oracleText: "({T}: Add {G}.)" });
    const after = playCardFromZone(session([seat("a", { hand: [snarl, forest] })]), "a", "snarl");
    expect(after.seats[0].board.battlefield[0].tapped).toBe(true);
    expect(after.pendingShockChoices).toBeUndefined();
  });

  it("a human is ASKED: the land enters tapped with a queued reveal choice, and revealing it untaps the land", () => {
    const snarl = real("Frostboil Snarl", "snarl");
    const island = real("Island", "isl", { typeLine: "Basic Land — Island", oracleText: "({T}: Add {U}.)" });
    const played = playCardFromZone(session([seat("h", { hand: [snarl, island] }, { kind: "human" })]), "h", "snarl");
    expect(played.seats[0].board.battlefield[0].tapped).toBe(true);
    expect(played.pendingShockChoices).toEqual([expect.objectContaining({ seatId: "h", cardId: "snarl", revealTypes: ["Island", "Mountain"] })]);
    const land = played.seats[0].board.battlefield[0];
    const resolved = resolveTriggerEffect(played, {
      id: "t",
      type: "trigger",
      actorSeatId: "h",
      controllerSeatId: "h",
      sourceCardId: "snarl",
      sourceCardName: "Frostboil Snarl",
      triggerKind: "common",
      effect: { kind: "reveal_land_untap", cardIds: ["isl"], chosenOption: "0" },
      message: ""
    } as never);
    expect(resolved.seats[0].board.battlefield.find((c) => c.id === land.id)!.tapped).toBe(false);
    expect(resolved.events[0].message).toMatch(/reveals Island/);
    const declined = resolveTriggerEffect(played, {
      id: "t",
      type: "trigger",
      actorSeatId: "h",
      controllerSeatId: "h",
      sourceCardId: "snarl",
      sourceCardName: "Frostboil Snarl",
      triggerKind: "common",
      effect: { kind: "reveal_land_untap", cardIds: ["isl"], chosenOption: "1" },
      message: ""
    } as never);
    expect(declined.seats[0].board.battlefield.find((c) => c.id === land.id)!.tapped).toBe(true);
  });

  it("behold land (Theorist's Sanctum): a Jace in hand is revealable, a Jace you control exempts it", () => {
    const sanctum = real("Theorist's Sanctum", "sanc");
    expect(revealLandTypes(sanctum.oracleText)).toEqual(["Jace"]);
    const jace = real("Jace, the Mind Sculptor", "jace");
    const handCase = playCardFromZone(session([seat("a", { hand: [sanctum, jace] })]), "a", "sanc");
    expect(handCase.seats[0].board.battlefield.find((c) => c.id === "sanc")!.tapped).toBeFalsy();
    const boardCase = playCardFromZone(session([seat("a", { hand: [sanctum], battlefield: [{ ...jace, zone: "battlefield" } as VisibleCard] })]), "a", "sanc");
    expect(boardCase.seats[0].board.battlefield.find((c) => c.id === "sanc")!.tapped).toBeFalsy();
    const none = playCardFromZone(session([seat("a", { hand: [sanctum] })]), "a", "sanc");
    expect(none.seats[0].board.battlefield[0].tapped).toBe(true);
  });

  it("Temple of the Dragon Queen: controlling a Dragon is enough (no card to reveal)", () => {
    const temple = real("Temple of the Dragon Queen", "temple");
    const dragon = real("Shivan Dragon", "drg", { zone: "battlefield" });
    const after = playCardFromZone(session([seat("a", { hand: [temple], battlefield: [dragon] })]), "a", "temple");
    expect(after.seats[0].board.battlefield.find((c) => c.id === "temple")!.tapped).toBeFalsy();
  });
});

describe("commander exiled -> command zone (rule 903.9a)", () => {
  const commanderCard = () => real("Grizzly Bears", "cmdr", { zone: "battlefield", commander: true, ownerSeatId: "h", commanderTax: 0 });

  it("moveCommanderToCommandZone works from exile (Swords, Path, Oblivion Ring...)", () => {
    const cmdr = commanderCard();
    const exiled = moveCardAcrossSeats(session([seat("h", { battlefield: [cmdr] }, { kind: "human" })]), "h", "cmdr", "h", "exile").session;
    expect(exiled.seats[0].board.exile!.map((c) => c.id)).toEqual(["cmdr"]);
    const moved = moveCommanderToCommandZone(exiled, "h", "cmdr");
    expect(moved.seats[0].board.exile).toHaveLength(0);
    expect(moved.seats[0].board.commander?.id).toBe("cmdr");
    // Tax rises on CAST (903.8), never on the move itself — and exactly once per cast, even after a round trip.
    expect(moved.seats[0].board.commander?.commanderTax).toBe(0);
  });

  it("commander tax +2 only when cast from the command zone, no double counting through exile -> command zone -> cast", () => {
    const cmdr = commanderCard();
    const exiled = moveCardAcrossSeats(session([seat("h", { battlefield: [cmdr] }, { kind: "human" })]), "h", "cmdr", "h", "exile").session;
    const inCommand = moveCommanderToCommandZone(exiled, "h", "cmdr");
    expect(inCommand.seats[0].board.commander?.commanderTax).toBe(0);
    const cast1 = playCardFromZone(inCommand, "h", "cmdr", undefined, undefined, "battlefield", [], "command");
    const onBoard = cast1.seats[0].board.battlefield.find((c) => c.id === "cmdr")!;
    expect(onBoard.commanderTax).toBe(2);
    const bounced = moveCardAcrossSeats(cast1, "h", "cmdr", "h", "hand").session;
    expect(bounced.seats[0].board.commander?.commanderTax).toBe(2);
    const cast2 = playCardFromZone(bounced, "h", "cmdr", undefined, undefined, "battlefield", [], "command");
    expect(cast2.seats[0].board.battlefield.find((c) => c.id === "cmdr")!.commanderTax).toBe(4);
  });

  it("Grasp of Fate: moving the exiled commander breaks the 'until it leaves' link, so it does NOT return when Grasp leaves", () => {
    const cmdr = commanderCard();
    const grasp = real("Grasp of Fate", "grasp", { zone: "battlefield" });
    const caster = seat("a", { battlefield: [grasp] });
    const owner = seat("h", { battlefield: [cmdr] }, { kind: "human" });
    let s = moveCardAcrossSeats(session([caster, owner]), "h", "cmdr", "h", "exile").session;
    s = { ...s, seats: s.seats.map((x) => (x.id === "h" ? { ...x, board: { ...x.board, exile: (x.board.exile ?? []).map((c) => ({ ...c, exiledUntilSourceLeaves: "grasp" })) } } : x)) };
    const moved = moveCommanderToCommandZone(s, "h", "cmdr");
    // Grasp of Fate leaves the battlefield
    const gone = { ...moved, seats: moved.seats.map((x) => (x.id === "a" ? { ...x, board: { ...x.board, battlefield: [] } } : x)) };
    const after = returnLinkedExiles(gone);
    expect(after.seats.find((x) => x.id === "h")!.board.battlefield).toHaveLength(0);
    expect(after.seats.find((x) => x.id === "h")!.board.commander?.id).toBe("cmdr");
    expect(after.seats.find((x) => x.id === "h")!.board.commander?.exiledUntilSourceLeaves).toBeUndefined();
  });

  it("declining leaves the link intact: Grasp leaving still returns the commander to the battlefield", () => {
    const cmdr = commanderCard();
    let s = moveCardAcrossSeats(session([seat("a"), seat("h", { battlefield: [cmdr] }, { kind: "human" })]), "h", "cmdr", "h", "exile").session;
    s = { ...s, seats: s.seats.map((x) => (x.id === "h" ? { ...x, board: { ...x.board, exile: (x.board.exile ?? []).map((c) => ({ ...c, exiledUntilSourceLeaves: "grasp" })) } } : x)) };
    const after = returnLinkedExiles(s);
    expect(after.seats.find((x) => x.id === "h")!.board.battlefield.map((c) => c.id)).toEqual(["cmdr"]);
  });
});

describe("Sarkhan's Triumph: the found Dragon is revealed in the log and lands in hand", () => {
  it("logs the reveal and puts the card into hand", () => {
    const dragon = real("Shivan Dragon", "drg", { zone: "library" });
    const s = session([seat("m", {}, { library: [dragon, real("Grizzly Bears", "b", { zone: "library" })], zones: { library: 2, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 } })]);
    const after = moveLibraryCardToDestination(s, "m", "drg", "hand", false, true);
    expect(after.seats[0].board.hand.map((c) => c.name)).toEqual(["Shivan Dragon"]);
    expect(after.events[0].message).toMatch(/reveals Shivan Dragon/);
    expect(after.events[0].message).toMatch(/into their hand/);
  });
});

describe("Elven Passage: pay 1 life, sacrifice, fetch a tapped basic, optionally behold an Elf to untap it", () => {
  const forest = () => real("Forest", "for", { zone: "library", typeLine: "Basic Land — Forest", oracleText: "({T}: Add {G}.)" });
  const elf = (zone: "hand" | "battlefield") => real("Llanowar Elves", "elf", { zone });
  const run = (extra: { hand?: VisibleCard[]; battlefield?: VisibleCard[]; kind?: "human" | "agent" }) => {
    const passage = real("Elven Passage", "ep", { zone: "battlefield" });
    const s = session([seat("a", { hand: extra.hand ?? [], battlefield: [passage, ...(extra.battlefield ?? [])] }, { kind: extra.kind ?? "agent", library: [forest()] })]);
    return resolveBasicLandFetchSearch(s, "a", "ep");
  };
  const fetched = (s: GameSession) => s.seats[0].board.battlefield.find((c) => c.id === "for")!;

  it("parses the behold type and charges the 1 life", () => {
    expect(basicLandFetchBeholdType(real("Elven Passage", "x").oracleText)).toBe("Elf");
    expect(run({}).seats[0].life).toBe(39);
  });
  it("no Elf anywhere: the land stays tapped", () => {
    expect(fetched(run({})).tapped).toBe(true);
  });
  it("controlling an Elf beholds it for free: untapped, no prompt", () => {
    const after = run({ battlefield: [elf("battlefield")], kind: "human" });
    expect(fetched(after).tapped).toBe(false);
    expect(after.pendingShockChoices).toBeUndefined();
  });
  it("agent with an Elf only in hand reveals it automatically and logs it", () => {
    const after = run({ hand: [elf("hand")] });
    expect(fetched(after).tapped).toBe(false);
    expect(after.events[0].message).toMatch(/Reveals Llanowar Elves/);
  });
  it("human with an Elf only in hand is asked (land stays tapped until they reveal)", () => {
    const after = run({ hand: [elf("hand")], kind: "human" });
    expect(fetched(after).tapped).toBe(true);
    expect(after.pendingShockChoices).toEqual([expect.objectContaining({ cardId: "for", revealTypes: ["Elf"] })]);
  });
});
