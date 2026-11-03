// Twilight Diviner (real catalog text): "When this creature enters, surveil 2." and "Whenever one or more other creatures you control enter, if they
// entered or were cast from a graveyard, create a token that's a copy of one of them. This ability triggers only once each turn."
// Reported live: the human was never offered the surveil (a silent land-only auto-surveil claimed it as a "zone effect"), and the second ability never fired.
import { describe, expect, it } from "vitest";
import {
  agentBestCopyCandidate,
  agentSurveilDecision,
  findEntersBatchWatcherTriggers,
  moveCardAcrossSeats,
  parseEtbZoneEffect,
  resolveDeferredChoice,
  resolveTriggerEffect,
  resolveAgentLibraryLookWorkflow,
  playCardFromZone,
  applyMerenEndStepEffect
} from "./AppFlow";
import { deterministicRuleWorkflow } from "@/lib/rulesAdvisor";
import { etbEffectText } from "@/lib/oracleClauses";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const bear = (id: string, extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;
const land = (id: string, zone: VisibleCard["zone"] = "battlefield") => bear(id, { name: `Forest ${id}`, typeLine: "Basic Land — Forest", role: "land", manaValue: 0, zone });
function seat(id: string, battlefield: VisibleCard[], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return {
    id, name: id, kind: "agent", life: 40, commanderDamage: {},
    zones: { library: (extra.library ?? []).length, hand: 0, battlefield: battlefield.length, graveyard: (extra.board?.graveyard ?? []).length, exile: 0, command: 0 },
    board: { hand: [], battlefield, graveyard: [] }, ...extra
  };
}
function session(seats: PlayerSeat[], extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 3, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra };
}
const mine = (s: GameSession) => s.seats.find((x) => x.id === "a")!;
const grave = (...cards: VisibleCard[]) => ({ hand: [], battlefield: [] as VisibleCard[], graveyard: cards });
const diviner = () => real("Twilight Diviner", "div");

describe("Twilight Diviner: the ETB surveil", () => {
  it("is not claimed as a silent zone effect; it is the rules advisor's surveil workflow (the human gets the look-at-top prompt)", () => {
    expect(parseEtbZoneEffect(etbEffectText(diviner().oracleText))).toBeUndefined();
    const workflow = deterministicRuleWorkflow({ event: "spell_resolved_to_battlefield", actorName: "a", sourceCard: diviner(), battlefield: [], hand: [], graveyard: [], exile: [], libraryPreview: [] } as never);
    expect(workflow).toMatchObject({ workflow: "surveil_cards", maxChoices: 2, requiresHumanChoice: true });
  });
  it("an agent surveils with a deterministic ruling: flooded lands and reanimation targets (with a recursion engine) go to the graveyard", () => {
    const meren = real("Meren of Clan Nel Toth", "meren");
    const lands = Array.from({ length: 6 }, (_, i) => land(`bl${i}`));
    const looked = [land("topLand", "library"), bear("cheap", { zone: "library", manaValue: 2 }), bear("fatty", { zone: "library", manaValue: 6 })];
    const deep = Array.from({ length: 40 }, (_, i) => bear(`deep${i}`, { zone: "library" }));
    const flooded = seat("a", lands, { library: [...looked, ...deep] });
    expect(agentSurveilDecision(flooded, looked).binned.map((c) => c.id)).toEqual(["topLand"]);
    const reanimator = seat("a", [...lands, meren], { library: [...looked, ...deep] });
    expect(agentSurveilDecision(reanimator, looked).binned.map((c) => c.id).sort()).toEqual(["fatty", "topLand"]);
    // short on lands: the land stays and goes on top first (the land-light agent needs it most)
    const short = seat("a", [land("one")], { library: [...looked, ...deep] });
    const keep = agentSurveilDecision(short, looked);
    // (the six-drop is far out of reach with one land, so it is binned even without a recursion engine)
    expect(keep.binned.map((c) => c.id)).toEqual(["fatty"]);
    expect(keep.kept.map((c) => c.id)).toEqual(["topLand", "cheap"]);
    // and the agent workflow actually moves the cards
    const library = [land("topLand", "library"), bear("cheap", { zone: "library" }), ...Array.from({ length: 30 }, (_, i) => bear(`rest${i}`, { zone: "library" }))];
    const s = session([seat("a", lands, { library }), seat("o", [])]);
    const after = resolveAgentLibraryLookWorkflow(s, "a", "Twilight Diviner", "surveil_cards", 2);
    expect(mine(after).board.graveyard?.map((c) => c.id)).toEqual(["topLand"]);
    expect(mine(after).library?.[0].id).toBe("cheap");
  });
});

describe("Twilight Diviner: entered-from-graveyard origin is stamped on every entry path", () => {
  it("moveCardAcrossSeats (reanimation, Meren, Dina-style returns) records the graveyard as the origin; a hand/exile source records its own", () => {
    const dead = bear("dead", { zone: "graveyard" });
    const inHand = bear("handy", { zone: "hand" });
    const s = session([seat("a", [], { board: { hand: [inHand], battlefield: [], graveyard: [dead] } }), seat("o", [])]);
    const fromGrave = moveCardAcrossSeats(s, "a", "dead", "a", "battlefield");
    expect(mine(fromGrave.session).board.battlefield[0].enteredFrom).toBe("graveyard");
    expect(fromGrave.session.pendingEntries?.[0].card.enteredFrom).toBe("graveyard");
    expect(mine(moveCardAcrossSeats(s, "a", "handy", "a", "battlefield").session).board.battlefield[0].enteredFrom).toBe("hand");
  });
  it("Meren's end-step return puts the creature on the battlefield flagged as coming from the graveyard", () => {
    const meren = real("Meren of Clan Nel Toth", "meren");
    const dead = bear("dead", { zone: "graveyard", manaValue: 3 });
    const s = session([seat("a", [meren], { experienceCounters: 5, board: { hand: [], battlefield: [meren], graveyard: [dead] } }), seat("o", [])]);
    const after = applyMerenEndStepEffect(s, "a", "Meren of Clan Nel Toth");
    expect(mine(after).board.battlefield.find((c) => c.id === "dead")?.enteredFrom).toBe("graveyard");
  });
  it("a creature cast from the graveyard (a graveyard cast grant) enters 'from a graveyard'; a plain hand cast does not", () => {
    const fromGrave = bear("fg", { zone: "graveyard", graveyardCastGrant: { seatId: "a", turn: 3 } });
    const s = session([seat("a", [], { board: { hand: [bear("hc", { zone: "hand" })], battlefield: [], graveyard: [fromGrave] } }), seat("o", [])]);
    const a = playCardFromZone(s, "a", "fg", undefined, undefined, "battlefield", [], "graveyard");
    expect(mine(a).board.battlefield.find((c) => c.id === "fg")?.enteredFrom).toBe("graveyard");
    const b = playCardFromZone(s, "a", "hc", undefined, undefined, "battlefield", [], "hand");
    expect(mine(b).board.battlefield.find((c) => c.id === "hc")?.enteredFrom).toBe("hand");
  });
});

describe("Twilight Diviner: whenever one or more other creatures you control enter from a graveyard", () => {
  const entries = (s: GameSession, ids: string[]) => ids.map((id) => ({ seatId: "a", card: mine(s).board.battlefield.find((c) => c.id === id)! }));
  it("one trigger for a batch of simultaneous reanimations, listing each candidate; not for hand entries, tokens, or itself", () => {
    const a1 = bear("a1", { enteredFrom: "graveyard" });
    const a2 = bear("a2", { enteredFrom: "graveyard" });
    const h = bear("h1", { enteredFrom: "hand" });
    const tok = bear("tok", { token: true });
    const s = session([seat("a", [diviner(), a1, a2, h, tok]), seat("o", [])]);
    const triggers = findEntersBatchWatcherTriggers(s, entries(s, ["a1", "a2", "h1", "tok"]));
    expect(triggers).toHaveLength(1);
    expect(triggers[0].effect).toMatchObject({ kind: "copy_token", scope: "one_of_candidates", candidateIds: ["a1", "a2"], oncePerTurn: true });
    expect(findEntersBatchWatcherTriggers(s, entries(s, ["h1", "tok"]))).toEqual([]);
    const self = session([seat("a", [{ ...diviner(), enteredFrom: "graveyard" }]), seat("o", [])]);
    expect(findEntersBatchWatcherTriggers(self, [{ seatId: "a", card: self.seats[0].board.battlefield[0] }])).toEqual([]);
  });
  it("an opponent's creature entering from a graveyard does not trigger it (creatures YOU control)", () => {
    const theirs = bear("t1", { enteredFrom: "graveyard" });
    const s = session([seat("a", [diviner()]), seat("o", [theirs])]);
    expect(findEntersBatchWatcherTriggers(s, [{ seatId: "o", card: theirs }])).toEqual([]);
  });
  it("resolving makes a token copy (summoning sick, not a graveyard entry itself); a second batch the same turn does nothing", () => {
    const a1 = bear("a1", { enteredFrom: "graveyard", oracleText: "When this creature enters, draw a card." });
    const s = session([seat("a", [diviner(), a1]), seat("o", [])]);
    const [trigger] = findEntersBatchWatcherTriggers(s, entries(s, ["a1"]));
    const after = resolveTriggerEffect(s, trigger);
    const token = mine(after).board.battlefield.find((c) => c.token);
    expect(token?.name).toBe("Bear a1");
    expect(token?.summoningSick).toBe(true);
    expect(token?.enteredFrom).toBeUndefined();
    expect(after.pendingEntries?.some((e) => e.card.id === token?.id)).toBe(true);
    // the token copy itself is not a graveyard entry, and the once-each-turn limit now blocks any further trigger
    expect(findEntersBatchWatcherTriggers(after, [{ seatId: "a", card: token! }])).toEqual([]);
    expect(findEntersBatchWatcherTriggers(after, entries(after, ["a1"]))).toEqual([]);
    const again = resolveTriggerEffect(after, trigger);
    expect(mine(again).board.battlefield.filter((c) => c.token)).toHaveLength(1);
    // the next turn it works again
    expect(findEntersBatchWatcherTriggers({ ...after, turn: 4 }, entries(after, ["a1"]))).toHaveLength(1);
  });
  it("with several candidates an agent copies the best (an enters-effect creature over a bigger vanilla; non-legendary first); a human is asked", () => {
    const vanilla = bear("big", { enteredFrom: "graveyard", manaValue: 6, power: "6", toughness: "6" });
    const etb = bear("etb", { enteredFrom: "graveyard", manaValue: 3, oracleText: "When this creature enters, draw a card." });
    const legend = bear("leg", { enteredFrom: "graveyard", manaValue: 7, typeLine: "Legendary Creature — Bear" });
    expect(agentBestCopyCandidate([vanilla, legend, etb]).id).toBe("etb");
    const agentSession = session([seat("a", [diviner(), vanilla, etb]), seat("o", [])]);
    const [t] = findEntersBatchWatcherTriggers(agentSession, entries(agentSession, ["big", "etb"]));
    expect(mine(resolveTriggerEffect(agentSession, t)).board.battlefield.find((c) => c.token)?.name).toBe("Bear etb");

    const humanSession = session([seat("a", [diviner(), vanilla, etb], { kind: "human" }), seat("o", [])]);
    const [ht] = findEntersBatchWatcherTriggers(humanSession, entries(humanSession, ["big", "etb"]));
    const asked = resolveTriggerEffect(humanSession, ht);
    const prompt = asked.pendingPlayerChoices![0];
    expect(prompt.options.map((o) => o.value).sort()).toEqual(["big", "etb"]);
    expect(mine(asked).board.battlefield.some((c) => c.token)).toBe(false);
    const picked = resolveDeferredChoice(asked, "a", "div", "Twilight Diviner", prompt.resolver, prompt.data, "big");
    expect(mine(picked).board.battlefield.find((c) => c.token)?.name).toBe("Bear big");
  });
  it("a single candidate is copied without asking even a human", () => {
    const only = bear("only", { enteredFrom: "graveyard" });
    const s = session([seat("a", [diviner(), only], { kind: "human" }), seat("o", [])]);
    const [t] = findEntersBatchWatcherTriggers(s, entries(s, ["only"]));
    const after = resolveTriggerEffect(s, t);
    expect(after.pendingPlayerChoices).toBeUndefined();
    expect(mine(after).board.battlefield.some((c) => c.token)).toBe(true);
  });
});
