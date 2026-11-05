import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "./cardCatalog";
import {
  anyPhaseTrigger,
  buildPhaseWatchers,
  collectPhaseTriggers,
  delayedTriggerDue,
  emblemDisplayName,
  parsePhaseTriggers,
  parsePhaseTriggersDetailed,
  stackResolutionOrder,
  type DelayedPhaseTrigger,
  type PhaseSeatView
} from "./phaseTriggers";

const catalog = loadCardCatalog();
const text = (name: string) => {
  const found = lookupCard(catalog, name) as { oracleText?: string } | undefined;
  if (!found?.oracleText) throw new Error(`catalog is missing ${name}`);
  return found.oracleText;
};
const card = (id: string, name: string, oracleText = text(name), extra: object = {}) => ({ id, name, oracleText, ...extra });
const seat = (id: string, cards: ReturnType<typeof card>[] = [], extra: Partial<PhaseSeatView> = {}): PhaseSeatView => ({ id, board: { battlefield: cards }, ...extra });

describe("parsePhaseTriggers: every wording class, on real card text", () => {
  it("your upkeep (controller only)", () => {
    expect(parsePhaseTriggers(text("Phyrexian Arena"))).toMatchObject([{ phase: "upkeep step", scope: "controller" }]);
  });
  it("each upkeep (every turn)", () => {
    expect(parsePhaseTriggers(text("Beledros Witherbloom"))).toMatchObject([{ phase: "upkeep step", scope: "each" }]);
  });
  it("each opponent's upkeep (Sheoldred also has a your-upkeep clause)", () => {
    expect(parsePhaseTriggers(text("Sheoldred, Whispering One")).map((s) => `${s.phase}/${s.scope}`)).toEqual(["upkeep step/controller", "upkeep step/opponents"]);
  });
  it("each end step, with its effect text", () => {
    const [spec] = parsePhaseTriggers(text("Smuggler's Share"));
    expect(spec).toMatchObject({ phase: "end step", scope: "each" });
    expect(spec.effectText).toMatch(/^draw a card for each opponent/i);
  });
  it("your end step and the 'beginning of combat on your turn' wording", () => {
    expect(parsePhaseTriggers(text("Meren of Clan Nel Toth"))).toMatchObject([{ phase: "end step", scope: "controller" }]);
    expect(parsePhaseTriggers(text("Brudiclad, Telchor Engineer"))).toMatchObject([{ phase: "beginning of combat step", scope: "controller" }]);
  });
  it("each combat", () => {
    expect(parsePhaseTriggers(text("Unnatural Growth"))).toMatchObject([{ phase: "beginning of combat step", scope: "each" }]);
  });
  it("precombat main phase", () => {
    expect(parsePhaseTriggers(text("Hulking Raptor"))).toMatchObject([{ phase: "precombat main phase", scope: "controller" }]);
  });
  it("postcombat main phase, with an intervening if", () => {
    const [spec] = parsePhaseTriggers(text("Reluctant Role Model"));
    expect(spec).toMatchObject({ phase: "postcombat main phase", scope: "controller" });
    expect(spec.condition).toBeTruthy();
  });
  it("draw step and each player's variants", () => {
    expect(parsePhaseTriggers("At the beginning of your draw step, draw a card.")).toMatchObject([{ phase: "draw step", scope: "controller" }]);
    expect(parsePhaseTriggers("At the beginning of each player's draw step, that player draws an additional card.")).toMatchObject([{ phase: "draw step", scope: "each_player" }]);
    expect(parsePhaseTriggers("At the beginning of each player's upkeep, that player gains 1 life.")).toMatchObject([{ phase: "upkeep step", scope: "each_player" }]);
  });
  it("end of combat (both wordings) and 'the end step' for a sacrifice-at-end permanent", () => {
    expect(parsePhaseTriggers("At end of combat, sacrifice this creature.")).toMatchObject([{ phase: "end of combat step", scope: "each" }]);
    expect(parsePhaseTriggers("At the end of combat on your turn, draw a card.")).toMatchObject([{ phase: "end of combat step", scope: "controller" }]);
    expect(parsePhaseTriggers("At the beginning of the end step, sacrifice Ball Lightning.")).toMatchObject([{ phase: "end step", scope: "each" }]);
  });
  it("an intervening if is split from the effect (Dragonmaster Outcast)", () => {
    const [spec] = parsePhaseTriggers(text("Dragonmaster Outcast"));
    expect(spec.condition).toBe("you control six or more lands");
    expect(spec.effectText).toMatch(/^create a 5\/5/i);
  });
  it("'you may' is flagged optional", () => {
    expect(parsePhaseTriggers(text("Land Tax"))[0].optional).toBe(true);
  });
  it("upkeep keywords: cumulative upkeep, echo, vanishing, fading", () => {
    expect(parsePhaseTriggers(text("Mystic Remora"))[0]).toMatchObject({ phase: "upkeep step", keyword: "cumulative upkeep" });
    expect(parsePhaseTriggers("Echo {2}{R}")[0]).toMatchObject({ keyword: "echo" });
    expect(parsePhaseTriggers("Vanishing 3")[0]).toMatchObject({ keyword: "vanishing" });
    expect(parsePhaseTriggers("Fading 4")[0]).toMatchObject({ keyword: "fading" });
  });
  it("an ability-word prefix, a mode label, a face label and 'When ~ enters and at the beginning of ...' still parse", () => {
    expect(parsePhaseTriggers("Lieutenant — At the beginning of combat on your turn, if you control your commander, create a 1/1 Thopter.")[0]).toMatchObject({ phase: "beginning of combat step", scope: "controller" });
    const siege = parsePhaseTriggers(text("Citadel Siege"));
    expect(siege.map((s) => `${s.modeLabel}:${s.phase}/${s.scope}`)).toEqual(["Khans:beginning of combat step/controller", "Dragons:beginning of combat step/opponents"]);
    expect(parsePhaseTriggers(text("Old Rutstein"))[0]).toMatchObject({ phase: "upkeep step", scope: "controller" });
  });
  it("one-shot wordings buried in an effect are NOT standing watchers (Hellkite Courser, Mimic Vat, Dragonhawk, Grave Betrayal)", () => {
    for (const name of ["Hellkite Courser", "Mimic Vat", "Dragonhawk, Fate's Tempest", "Grave Betrayal", "Goldlust Triad"]) expect(parsePhaseTriggers(text(name))).toEqual([]);
  });
  it("a loyalty ability's emblem text is not the planeswalker's own trigger (Tezzeret)", () => {
    expect(parsePhaseTriggers(text("Tezzeret, Artifice Master"))).toEqual([]);
  });
  it("'your next upkeep' / 'the next end step' written as a standing clause are reported as delayed, not as watchers", () => {
    const parsed = parsePhaseTriggersDetailed("At the beginning of your next upkeep, draw a card.");
    expect(parsed.specs).toEqual([]);
    expect(parsed.delayed).toHaveLength(1);
  });
  it("an unknown wording is reported, never silently dropped", () => {
    expect(parsePhaseTriggersDetailed("At the beginning of each of your first two combats, scry 1.").unrecognized).toHaveLength(1);
  });
});

describe("buildPhaseWatchers", () => {
  it("lists watchers of every seat, skipping stripped, phased-out and eliminated ones", () => {
    const seats = [
      seat("a", [card("c1", "Phyrexian Arena"), card("c2", "Phyrexian Arena", undefined, { abilitiesStripped: true }), card("c3", "Phyrexian Arena", undefined, { phasedOut: true })]),
      seat("b", [card("c4", "Beledros Witherbloom")]),
      seat("c", [card("c5", "Phyrexian Arena")], { hasLost: true })
    ];
    expect(buildPhaseWatchers(seats).map((w) => w.sourceCardId)).toEqual(["c1", "c4"]);
  });
  it("a chosen mode label gates its watcher (Citadel Siege: Dragons only)", () => {
    const watchers = buildPhaseWatchers([seat("a", [card("s", "Citadel Siege", undefined, { chosenMode: "Dragons" })])]);
    expect(watchers.map((w) => w.spec.modeLabel)).toEqual(["Dragons"]);
  });
  it("an emblem contributes its text", () => {
    const watchers = buildPhaseWatchers([seat("a", [], { emblems: [{ id: "e1", sourceName: "Tezzeret", oracleText: "At the beginning of your end step, draw a card." }] })]);
    expect(watchers).toMatchObject([{ emblem: true, sourceCardName: "Tezzeret's emblem", spec: { phase: "end step" } }]);
  });
  it("names an emblem's abilities after the short name of its source ('Tezzeret's emblem')", () => {
    expect(emblemDisplayName("Tezzeret, Artifice Master")).toBe("Tezzeret's emblem");
    expect(emblemDisplayName("Saheeli, Filigree Master")).toBe("Saheeli's emblem");
    expect(emblemDisplayName("Arlinn Kord // Arlinn, Embraced by the Moon")).toBe("Arlinn Kord's emblem");
  });
});

describe("collectPhaseTriggers: the right turns only, APNAP order", () => {
  const board = () => [
    seat("a", [card("a-arena", "Phyrexian Arena"), card("a-bel", "Beledros Witherbloom")]),
    seat("b", [card("b-arena", "Phyrexian Arena"), card("b-sheo", "Sheoldred, Whispering One")]),
    seat("c", [card("c-bel", "Beledros Witherbloom")])
  ];
  const ids = (groups: ReturnType<typeof collectPhaseTriggers>) => groups.map((g) => `${g.seatId}:${g.entries.map((e) => e.watcher.sourceCardId).join("+")}`);

  it("'your upkeep' fires only on its controller's turn; 'each upkeep' every turn; 'each opponent's upkeep' only on opponents' turns", () => {
    expect(ids(collectPhaseTriggers(board(), "upkeep step", "a"))).toEqual(["a:a-arena+a-bel", "b:b-sheo", "c:c-bel"]);
    // on b's turn: b's own Arena and Sheoldred's your-upkeep clause; a's and c's each-upkeep Beledros; NOT a's Arena
    expect(ids(collectPhaseTriggers(board(), "upkeep step", "b"))).toEqual(["b:b-arena+b-sheo", "c:c-bel", "a:a-bel"]);
  });
  it("Sheoldred's opponents clause does not fire on its own controller's turn", () => {
    const own = collectPhaseTriggers(board(), "upkeep step", "b").find((g) => g.seatId === "b")!;
    expect(own.entries.map((e) => e.watcher.spec.scope)).toEqual(["controller", "controller"]);
  });
  it("APNAP groups put the active player first; resolution order is the reverse (the last player's triggers resolve first)", () => {
    const groups = collectPhaseTriggers(board(), "upkeep step", "b");
    expect(groups.map((g) => g.seatId)).toEqual(["b", "c", "a"]);
    expect(stackResolutionOrder(groups).map((e) => e.watcher.sourceCardId)).toEqual(["a-bel", "c-bel", "b-arena", "b-sheo"]);
  });
  it("a step nothing watches yields nothing, and anyPhaseTrigger agrees", () => {
    expect(collectPhaseTriggers(board(), "draw step", "a")).toEqual([]);
    expect(anyPhaseTrigger(board(), "draw step", "a")).toBe(false);
    expect(anyPhaseTrigger(board(), "upkeep step", "a")).toBe(true);
  });
  it("an eliminated seat's permanents do not trigger", () => {
    const seats = board();
    seats[2] = { ...seats[2], hasLost: true };
    expect(ids(collectPhaseTriggers(seats, "upkeep step", "a"))).toEqual(["a:a-arena+a-bel", "b:b-sheo"]);
  });
});

describe("delayed one-shot triggers (rule 603.7)", () => {
  const delayed = (extra: Partial<DelayedPhaseTrigger> = {}): DelayedPhaseTrigger => ({
    id: "d1", controllerSeatId: "a", sourceCardId: "src", sourceCardName: "Saheeli", phase: "end step", scope: "any", effectText: "exile those tokens.", createdTurn: 5, createdPhase: "precombat main phase", ...extra
  });
  it("fires at the next matching step on anyone's turn, but not before it begins", () => {
    expect(delayedTriggerDue(delayed(), "end step", "b", 5)).toBe(true);
    expect(delayedTriggerDue(delayed(), "upkeep step", "a", 6)).toBe(false);
  });
  it("a step already under way when it was created does not count: it waits for the next one", () => {
    const duringEnd = delayed({ createdPhase: "end step" });
    expect(delayedTriggerDue(duringEnd, "end step", "a", 5)).toBe(false);
    expect(delayedTriggerDue(duringEnd, "end step", "b", 6)).toBe(true);
  });
  it("'your next upkeep' waits for its controller's turn", () => {
    const mine = delayed({ phase: "upkeep step", scope: "controller", createdTurn: 5 });
    expect(delayedTriggerDue(mine, "upkeep step", "b", 6)).toBe(false);
    expect(delayedTriggerDue(mine, "upkeep step", "a", 7)).toBe(true);
  });
  it("is collected with the standing watchers, on its controller's group", () => {
    const groups = collectPhaseTriggers([seat("a", [card("p", "Phyrexian Arena")]), seat("b")], "end step", "b", { delayed: [delayed()], turn: 6 });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ seatId: "a" });
    expect(groups[0].entries[0].delayed?.id).toBe("d1");
  });
});
