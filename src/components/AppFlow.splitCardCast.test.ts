// Split / Adventure cards (Find // Finality, Fire // Ice, Bonecrusher Giant // Stomp, Appeal // Authority) with their REAL catalog text.
// Rule 708 / 715: the caster picks ONE half and pays only that half's cost; its type, text and timing are that half's.
// Reported live: a human could not cast Find // Finality without 8 mana (the two halves' costs added) and was never asked which half.
import { describe, expect, it } from "vitest";
import { castFaceDecision, checkMoveLegal, handCardFaceOptions, isSplitSpellCard, legalMainPhaseActions, playCardFromZone } from "./AppFlow";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "hand", typeLine: "", oracleText: "", ...found, id, ...extra } as VisibleCard;
}
const land = (name: "Swamp" | "Forest" | "Plains" | "Island" | "Mountain", id: string) => real(name, id, { zone: "battlefield" });
const bear = (id: string, extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;
function seat(id: string, kind: "human" | "agent", hand: VisibleCard[], battlefield: VisibleCard[], graveyard: VisibleCard[] = []): PlayerSeat {
  return {
    id, name: id, kind, life: 40, commanderDamage: {},
    zones: { library: 0, hand: hand.length, battlefield: battlefield.length, graveyard: graveyard.length, exile: 0, command: 0 },
    board: { hand, battlefield, graveyard }
  };
}
function session(seats: PlayerSeat[], phase = "precombat main phase"): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase, turn: 3, activePlayerId: seats[0].id, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] } as GameSession;
}
const pool = (p: Partial<Record<"W" | "U" | "B" | "R" | "G" | "C", number>>) => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...p });
const deadGuys = () => [bear("g1", { zone: "graveyard" as const }), bear("g2", { zone: "graveyard" as const })];

describe("catalog shape of the split / adventure cards", () => {
  it("Find // Finality: two faces, each with its OWN cost; the card-level cost is the sum", () => {
    const ff = real("Find // Finality", "ff");
    expect(ff.faces?.map((f) => f.manaCost)).toEqual(["{B/G}{B/G}", "{4}{B}{G}"]);
    expect(ff.manaValue).toBe(8);
    expect(isSplitSpellCard(ff)).toBe(true);
    expect(isSplitSpellCard(real("Bonecrusher Giant // Stomp", "bg"))).toBe(false); // an Adventure is not a split card
  });
});

describe("castFaceDecision: which halves a HUMAN can cast now, priced per half", () => {
  const ff = () => real("Find // Finality", "ff");
  const human = (p: ReturnType<typeof pool>, graveyard = deadGuys()) => {
    const s = session([seat("h", "human", [ff()], [], graveyard), seat("o", "agent", [], [bear("o1")])]);
    return { s, decision: castFaceDecision(s, s.seats[0], s.seats[0].board.hand[0], "h", p) };
  };

  it("two mana floating (B + G): Find is castable, Finality is not, and it is NOT an 8-mana wall", () => {
    const { decision } = human(pool({ B: 1, G: 1 }));
    expect(decision.kind).toBe("single");
    if (decision.kind !== "single") return;
    expect(decision.faceIndex).toBe(0);
    expect(decision.options.map((o) => [o.faceIndex, o.payable])).toEqual([[0, true], [1, false]]);
  });

  it("six mana floating: BOTH halves are castable, so the human is asked which one", () => {
    const { decision } = human(pool({ B: 3, G: 3 }));
    expect(decision.kind).toBe("choose");
    expect(decision.kind === "choose" && decision.options.filter((o) => o.payable).map((o) => o.faceIndex)).toEqual([0, 1]);
  });

  it("each option shows its own cost and name", () => {
    const { decision } = human(pool({ B: 3, G: 3 }));
    expect(decision.kind === "choose" && decision.options.map((o) => o.label)).toEqual(["Cast Find ({B/G}{B/G})", "Cast Finality ({4}{B}{G})"]);
  });

  it("hybrid {B/G} needs black or green: white mana cannot pay Find", () => {
    const { decision } = human(pool({ W: 6 }));
    expect(decision.kind).toBe("unpayable");
  });

  it("Find is not castable (and not offered) when no creature card is in the graveyard? -- 'up to two' still allows zero targets, so it stays castable", () => {
    const { decision } = human(pool({ B: 1, G: 1 }), []);
    expect(decision.kind).toBe("single");
  });

  it("the hand menu (what the Play buttons show) agrees: per-half cost, greyed when unaffordable", () => {
    const s = session([seat("h", "human", [ff()], [], deadGuys()), seat("o", "agent", [], [])]);
    const options = handCardFaceOptions(s.seats[0], s.seats[0].board.hand[0], false, "h", pool({ B: 1, G: 1 }), s.seats);
    expect(options?.map((o) => [o.label, o.payable])).toEqual([["Cast Find ({B/G}{B/G})", true], ["Cast Finality ({4}{B}{G})", false]]);
  });

  it("a card with a single face is not a face choice at all", () => {
    const s = session([seat("h", "human", [real("Sol Ring", "sr")], [], []), seat("o", "agent", [], [])]);
    expect(castFaceDecision(s, s.seats[0], s.seats[0].board.hand[0], "h", pool({ C: 9 })).kind).toBe("none");
  });
});

describe("castFaceDecision: timing is judged per half", () => {
  it("Fire // Ice (two instants) can be chosen on the opponent's turn; Find // Finality (sorceries) cannot", () => {
    const fi = real("Fire // Ice", "fi");
    const ff = real("Find // Finality", "ff");
    const s = session([seat("h", "human", [fi, ff], [], deadGuys()), seat("o", "agent", [], [bear("o1")])]);
    s.activePlayerId = "o";
    const p = pool({ B: 3, G: 3, R: 1, U: 1, W: 1 });
    expect(castFaceDecision(s, s.seats[0], fi, "o", p).kind).toBe("choose");
    expect(castFaceDecision(s, s.seats[0], ff, "o", p).kind).toBe("unpayable"); // nothing castable now
  });

  it("Bonecrusher Giant // Stomp: on the opponent's turn only the instant half (Stomp) is castable", () => {
    const bg = real("Bonecrusher Giant // Stomp", "bg");
    const s = session([seat("h", "human", [bg], [], []), seat("o", "agent", [], [bear("o1")])]);
    const d = castFaceDecision(s, s.seats[0], bg, "o", pool({ R: 3 }));
    expect(d.kind).toBe("single");
    expect(d.kind === "single" && d.faceIndex).toBe(1);
  });

  it("Appeal // Authority: Authority is aftermath (graveyard only), so from hand only Appeal is offered", () => {
    const aa = real("Appeal // Authority", "aa");
    const s = session([seat("h", "human", [aa], [bear("mine")], []), seat("o", "agent", [], [bear("o1")])]);
    const d = castFaceDecision(s, s.seats[0], aa, "h", pool({ G: 3, W: 3 }));
    expect(d.kind).toBe("single");
    expect(d.kind === "single" && d.faceIndex).toBe(0);
  });
});

describe("agents: one action per castable half, priced and judged per half", () => {
  const actionsFor = (landNames: Array<"Swamp" | "Forest">, graveyard = deadGuys(), battlefield: VisibleCard[] = []) => {
    const lands = landNames.map((n, i) => land(n, `l${i}`));
    const s = session([seat("a", "agent", [real("Find // Finality", "ff")], [...lands, ...battlefield], graveyard), seat("o", "agent", [], [bear("o1")])]);
    return legalMainPhaseActions(s.seats[0], true, "a", s.turn, new Set(), s).filter((x) => x.cardId === "ff");
  };
  it("two lands: only Find; eight lands: both halves", () => {
    expect(actionsFor(["Swamp", "Forest"]).map((x) => x.faceIndex)).toEqual([0]);
    expect(actionsFor(["Swamp", "Swamp", "Swamp", "Swamp", "Forest", "Forest", "Forest", "Forest"]).map((x) => x.faceIndex)).toEqual([0, 1]);
  });
  it("labels name the half, never the combined card", () => {
    const labels = actionsFor(["Swamp", "Swamp", "Swamp", "Swamp", "Forest", "Forest"]).map((x) => x.label);
    expect(labels).toEqual(["cast Find", "cast Finality"]);
  });
  it("Appeal // Authority: the aftermath half is never offered from hand", () => {
    const lands = [land("Forest", "l0"), land("Plains", "l1"), land("Plains", "l2"), land("Forest", "l3")];
    const s = session([seat("a", "agent", [real("Appeal // Authority", "aa")], lands, []), seat("o", "agent", [], [bear("o1")])]);
    s.seats[0].board.battlefield.push(bear("mine"));
    const faces = legalMainPhaseActions(s.seats[0], true, "a", s.turn, new Set(), s).filter((x) => x.cardId === "aa").map((x) => x.faceIndex);
    expect(faces).toEqual([0]);
  });
});

describe("checkMoveLegal judges the chosen half", () => {
  it("Bonecrusher Giant: the creature half cannot be cast in the opponent's turn, Stomp can", () => {
    const bg = real("Bonecrusher Giant // Stomp", "bg");
    const s = session([seat("o", "agent", [], [bear("o1")]), seat("h", "human", [bg], [land("Mountain", "m1"), land("Mountain", "m2")], [])], "end step");
    s.activePlayerId = "o";
    const ctx = { mode: "human" as const, hasPlayedLand: true, activeSeatId: "o", stackEmpty: true };
    const base = { actionType: "cast_spell" as const, cardId: "bg", targetIds: [], label: "cast" };
    expect(checkMoveLegal(s, "h", { ...base, id: "cast:bg:face0", faceIndex: 0 }, ctx).legal).toBe(false);
    expect(checkMoveLegal(s, "h", { ...base, id: "cast:bg:face1", faceIndex: 1 }, ctx).legal).toBe(true);
  });
  it("an aftermath half cannot be cast from hand", () => {
    const aa = real("Appeal // Authority", "aa");
    const s = session([seat("h", "human", [aa], [bear("mine")], []), seat("o", "agent", [], [bear("o1")])]);
    const r = checkMoveLegal(s, "h", { id: "cast:aa:face1", actionType: "cast_spell", cardId: "aa", faceIndex: 1, targetIds: [], label: "cast" }, { mode: "human", hasPlayedLand: true, activeSeatId: "h", stackEmpty: true });
    expect(r.legal).toBe(false);
  });
});

describe("after resolution a split card goes to the graveyard as the FULL card", () => {
  it("Find // Finality keeps its combined name and cost in the graveyard (not 'Find')", () => {
    const ff = real("Find // Finality", "ff");
    const s = session([seat("h", "human", [ff], [], []), seat("o", "agent", [], [])]);
    const next = playCardFromZone(s, "h", "ff", "h casts Find.", undefined, "graveyard", [], "hand", 0);
    const inYard = next.seats[0].board.graveyard!.find((c) => c.id === "ff")!;
    expect(inYard.name).toBe("Find // Finality");
    expect(inYard.manaCost).toBe("{B/G}{B/G} // {4}{B}{G}");
    expect(inYard.manaValue).toBe(8);
  });
});

describe("agents: each half is judged on its own text", () => {
  it("Find (return creature cards from the graveyard) is not offered when the graveyard has no creature card", () => {
    const lands = [land("Swamp", "l0"), land("Forest", "l1")];
    const s = session([seat("a", "agent", [real("Find // Finality", "ff")], lands, []), seat("o", "agent", [], [bear("o1")])]);
    const faces = legalMainPhaseActions(s.seats[0], true, "a", s.turn, new Set(), s).filter((x) => x.cardId === "ff");
    expect(faces).toEqual([]);
  });
});
