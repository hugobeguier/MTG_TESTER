// Pure tests of the kernel decision view-model (no DOM): layout classification, selection min / max / "up to" / single-pick / repeatable, ordering, numbers, splits.
import { describe, expect, it } from "vitest";
import type { DecisionView } from "@/kernel/integration/tableState";
import type { VisibleCard } from "@/lib/types";
import {
  boardPickModel, canConfirm, castHint, classifyDecision, clampNumber, confirmLabel, defaultDamageSplit, moveItem, numberChoice, orderChoice, pickChoice, selectionHint,
  causeLine, entriesChoice, entryText, orderEntries, setSplit, splitChoice, splitModel, splitSum, splitValid, toggleSelection, undoLast
} from "./kernelDecisionView";

const card = (id: string, zone: VisibleCard["zone"]): VisibleCard => ({ id, name: id, typeLine: "Creature", oracleText: "", manaValue: 1, colors: [], role: "permanent", zone } as VisibleCard);
const base: DecisionView = { id: "d1", kind: "choose_targets", player: "p1", title: "t", instruction: "", options: [], min: 1, max: 1, cancellable: true };
const withOpts = (o: Partial<DecisionView>): DecisionView => ({ ...base, ...o });

describe("classifyDecision", () => {
  it("sends permanents, players and hand cards to the board and everything else to the dialog", () => {
    const bf = withOpts({ options: [{ id: "#1", label: "A", card: card("#1", "battlefield") }, { id: "p2", label: "Bob", seatId: "p2" }] });
    expect(classifyDecision(bf)).toMatchObject({ layout: "pick", board: true });
    expect(classifyDecision(withOpts({ kind: "choose_cards", options: [{ id: "#2", label: "H", card: card("#2", "hand") }] })).board).toBe(true);
    expect(classifyDecision(withOpts({ options: [{ id: "#3", label: "G", card: card("#3", "graveyard") }] })).board).toBe(false);
    expect(classifyDecision(withOpts({ options: [{ id: "#1", label: "A", card: card("#1", "battlefield") }, { id: "x", label: "stack item" }] })).board).toBe(false);
    expect(classifyDecision(withOpts({ kind: "choose_modes", options: [{ id: "m", label: "m", card: card("#1", "battlefield") }] })).board).toBe(false);
    expect(classifyDecision(withOpts({ repeatable: true, options: [{ id: "#1", label: "A", card: card("#1", "battlefield") }] })).board).toBe(false);
  });
  it("picks the layout per kind", () => {
    expect(classifyDecision(withOpts({ kind: "choose_yes_no" })).layout).toBe("yes_no");
    expect(classifyDecision(withOpts({ kind: "pay_unless" })).layout).toBe("yes_no");
    expect(classifyDecision(withOpts({ kind: "choose_x", numeric: true, min: 0, max: 4 })).layout).toBe("number");
    expect(classifyDecision(withOpts({ kind: "order_triggers" })).layout).toBe("order");
    expect(classifyDecision(withOpts({ kind: "order_replacements" })).layout).toBe("order");
    for (const k of ["assign_damage", "assign_mana", "assign_counters"] as const) expect(classifyDecision(withOpts({ kind: k })).layout).toBe("split");
    expect(classifyDecision(withOpts({ kind: "choose_color" })).layout).toBe("pick");
    expect(classifyDecision(withOpts({ kind: "choose_cast_option" })).layout).toBe("pick");
    expect(classifyDecision(withOpts({ min: 0, max: 2 })).upTo).toBe(true);
  });
});

describe("selection", () => {
  it("replaces the pick when max is 1, and toggles off", () => {
    const d = { min: 1, max: 1 };
    expect(toggleSelection(d, [], "a")).toEqual(["a"]);
    expect(toggleSelection(d, ["a"], "b")).toEqual(["b"]);
    expect(toggleSelection(d, ["a"], "a")).toEqual([]);
  });
  it("stops adding at max and allows removal", () => {
    const d = { min: 1, max: 2 };
    let p: string[] = [];
    p = toggleSelection(d, p, "a"); p = toggleSelection(d, p, "b"); p = toggleSelection(d, p, "c");
    expect(p).toEqual(["a", "b"]);
    expect(toggleSelection(d, p, "a")).toEqual(["b"]);
  });
  it("confirms only within min..max, and 'up to' accepts none", () => {
    const d = { min: 0, max: 3 };
    expect(canConfirm(d, [])).toBe(true);
    expect(confirmLabel(d, [])).toBe("None");
    expect(confirmLabel(d, ["a"])).toBe("Confirm");
    expect(canConfirm({ min: 2, max: 2 }, ["a"])).toBe(false);
    expect(canConfirm({ min: 2, max: 2 }, ["a", "b"])).toBe(true);
    expect(selectionHint({ min: 0, max: 3 }, ["a"])).toBe("Selected 1 (choose up to 3)");
    expect(selectionHint({ min: 2, max: 2 }, [])).toBe("Selected 0 (choose 2)");
    expect(selectionHint({ min: 1, max: 3 }, [])).toContain("1 to 3");
  });
  it("repeatable modes can be added again up to max and undone", () => {
    const d = { min: 2, max: 3, repeatable: true };
    let p: string[] = [];
    p = toggleSelection(d, p, "m1"); p = toggleSelection(d, p, "m1"); p = toggleSelection(d, p, "m2"); p = toggleSelection(d, p, "m2");
    expect(p).toEqual(["m1", "m1", "m2"]);
    expect(undoLast(p)).toEqual(["m1", "m1"]);
    expect(pickChoice(p)).toEqual({ ids: ["m1", "m1", "m2"] });
  });
});

describe("ordering", () => {
  it("moves items and answers with the first one or the whole order", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(orderChoice({ max: 1 }, ["b", "a"])).toEqual({ ids: ["b"] });
    expect(orderChoice({ max: 3 }, ["b", "a", "c"])).toEqual({ ids: ["b", "a", "c"] });
  });
});

describe("numbers", () => {
  it("clamps X to what the kernel allows", () => {
    const d = { min: 0, max: 4 };
    expect(clampNumber(d, 9)).toBe(4);
    expect(clampNumber(d, -3)).toBe(0);
    expect(clampNumber(d, NaN)).toBe(0);
    expect(numberChoice(d, 2.7)).toEqual({ number: 2 });
  });
});

describe("split amounts", () => {
  it("damage: exact total, lethal-first default, caps", () => {
    const d = withOpts({ kind: "assign_damage", amounts: { total: 5, lethal: { "#1": 2, "#2": 3 }, trample: false }, options: [{ id: "#1", label: "A" }, { id: "#2", label: "B" }] });
    const m = splitModel(d);
    expect(m.ids).toEqual(["#1", "#2"]);
    const def = defaultDamageSplit(m, d.amounts!.lethal);
    expect(def).toEqual({ "#1": 2, "#2": 3 });
    expect(splitValid(m, def)).toBe(true);
    expect(splitValid(m, { "#1": 1, "#2": 3 })).toBe(false);
    expect(splitChoice(m, { "#1": 5, "#2": 0 })).toEqual({ assign: { "#1": 5 } });
    expect(setSplit(m, {}, "#1", 99)).toEqual({ "#1": 5 });
    expect(splitSum(m, def)).toBe(5);
  });
  it("mana: split a total between colours; counters: min..max with per-kind availability", () => {
    const mana = splitModel(withOpts({ kind: "assign_mana", mana: { total: 2, colors: ["B", "G"] } }));
    expect(splitValid(mana, { B: 1, G: 1 })).toBe(true);
    expect(splitValid(mana, { B: 3 })).toBe(false);
    const c = splitModel(withOpts({ kind: "assign_counters", min: 1, max: 2, counters: { min: 1, max: 2, available: { "+1/+1": 2, flying: 1 } } }));
    expect(c.caps).toEqual({ "+1/+1": 2, flying: 1 });
    expect(splitValid(c, {})).toBe(false);
    expect(splitValid(c, { "+1/+1": 2 })).toBe(true);
    expect(splitValid(c, { flying: 2 })).toBe(false);
    expect(splitValid(c, { "+1/+1": 2, flying: 1 })).toBe(false);
  });
});

describe("board bridge and cast hints", () => {
  it("maps table ids to option ids", () => {
    const m = boardPickModel(withOpts({ options: [{ id: "#1", label: "A", card: card("legacy-1", "battlefield") }, { id: "p2", label: "Bob", seatId: "p2" }] }));
    expect(m.cardOptions).toEqual({ "legacy-1": "#1" });
    expect(m.seatOptions).toEqual({ p2: "p2" });
  });
  it("explains why a card does not glow", () => {
    const o = { playable: new Set(["a"]), holdsPriority: true, isLand: false, stackEmpty: true, mainPhase: true, activeTurn: true };
    expect(castHint("a", o)).toEqual({ castable: true });
    expect(castHint("b", o).reason).toMatch(/mana or wrong timing/);
    expect(castHint("l", { ...o, isLand: true }).reason).toMatch(/No land drop/);
    expect(castHint("b", { ...o, holdsPriority: false }).reason).toMatch(/priority/);
  });
});

describe("ordering entries (trigger order dialog)", () => {
  const opt = (id: string, group: string | undefined, extra: Record<string, unknown> = {}) => ({ id, label: "Src: short", ...(group ? { group } : {}), ...extra });
  const d = withOpts({ kind: "order_triggers", min: 4, max: 4, options: [opt("q1", "A"), opt("q2", "B"), opt("q3", "A"), opt("q4", undefined)] });
  it("merges only entries with the same group, keeps first-appearance order, and counts them", () => {
    const e = orderEntries(d);
    expect(e.map((x) => [x.key, x.count])).toEqual([["q1", 2], ["q2", 1], ["q4", 1]]);
    expect(e[0].ids).toEqual(["q1", "q3"]);
  });
  it("the answer lists every id, a merged row contributing its ids side by side", () => {
    expect(entriesChoice(d, ["q4", "q1", "q2"])).toEqual({ ids: ["q4", "q1", "q3", "q2"] });
    expect(entriesChoice({ ...d, max: 1 }, ["q2", "q1", "q4"])).toEqual({ ids: ["q2"] });
  });
  it("shows the full text (never the truncated label) and 'because <card> <verb>'", () => {
    expect(entryText({ label: "Src: trunc", text: "The whole ability text, long as it is." })).toBe("The whole ability text, long as it is.");
    expect(entryText({ label: "Src: only label" })).toBe("Src: only label");
    expect(causeLine({ causeCard: { name: "Fear of Sleep Paralysis" }, causeLabel: "entered the battlefield" })).toBe("because Fear of Sleep Paralysis entered the battlefield");
    expect(causeLine({})).toBeUndefined();
  });
});
