// Kernel debug mode, view-model level: the remembered checkbox, when the panel shows, the picker's filter / sort / pick actions, the conjure search, and the controller
// paths the buttons take (free-cast mode, the card inspector's "Cast for free (debug)", the switch recorded in the game). Plus: a guest can never reach a sandbox action.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { INTENT_SPECS } from "@/lib/multiplayer/intentSpecs";
import { SANDBOX_ACTION_TYPES } from "@/kernel/engine/types";
import { KernelGameController } from "./kernelController";
import {
  DEBUG_STORAGE_KEY, conjureMatches, debugCardAction, debugOptionAction, debugPanelVisible, destinationsFor, filterPickerCards, lifeAction, loadDebugFlag, pickAction, pickerCards, pickerCount,
  saveDebugFlag, sortPickerCards, PICKER_DESTINATIONS
} from "./kernelDebug";

const card = (name: string, typeLine: string, manaValue: number, oracleText = "") => ({ id: name, name, typeLine, oracleText, manaValue, colors: [], role: "spell" as const, zone: "library" as const });
const LIB = [
  card("Sol Ring", "Artifact", 1, "{T}: Add {C}{C}."), card("Forest", "Basic Land — Forest", 0, "({T}: Add {G}.)"), card("Cultivate", "Sorcery", 3, "Search your library for up to two basic land cards."),
  card("Esper Sentinel", "Artifact Creature — Human Soldier", 1, "Whenever an opponent casts their first noncreature spell each turn"), card("Counterspell", "Instant", 2, "Counter target spell."), card("Ünicorn", "Creature — Unicorn", 2)
];

describe("the remembered checkbox", () => {
  const store = (): { m: Map<string, string>; api: Pick<Storage, "getItem" | "setItem"> } => { const m = new Map<string, string>(); return { m, api: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) } }; };
  it("is off by default, remembers on and off", () => {
    const s = store();
    expect(loadDebugFlag(s.api)).toBe(false);
    saveDebugFlag(true, s.api); expect(s.m.get(DEBUG_STORAGE_KEY)).toBe("1"); expect(loadDebugFlag(s.api)).toBe(true);
    saveDebugFlag(false, s.api); expect(loadDebugFlag(s.api)).toBe(false);
  });
  it("survives storage that throws or is missing", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadDebugFlag(bad)).toBe(false);
    expect(() => saveDebugFlag(true, bad)).not.toThrow();
    expect(loadDebugFlag(undefined)).toBe(false);
    expect(() => saveDebugFlag(true, undefined)).not.toThrow();
  });
  it("the panel shows only while the box is ticked and the engine accepted the switch", () => {
    expect(debugPanelVisible(false, false)).toBe(false);
    expect(debugPanelVisible(true, false)).toBe(false);
    expect(debugPanelVisible(false, true)).toBe(false);
    expect(debugPanelVisible(true, true)).toBe(true);
  });
});

describe("the picker: filter and sort", () => {
  it("filters by name, type line and rules text, every word, ignoring case and accents", () => {
    expect(filterPickerCards(LIB, "").length).toBe(LIB.length);
    expect(filterPickerCards(LIB, "sol ring").map((c) => c.name)).toEqual(["Sol Ring"]);
    expect(filterPickerCards(LIB, "LAND").map((c) => c.name)).toEqual(["Forest", "Cultivate"]); // type line and oracle text
    expect(filterPickerCards(LIB, "artifact creature").map((c) => c.name)).toEqual(["Esper Sentinel"]);
    expect(filterPickerCards(LIB, "counter target").map((c) => c.name)).toEqual(["Counterspell"]);
    expect(filterPickerCards(LIB, "unicorn").map((c) => c.name)).toEqual(["Ünicorn"]);
    expect(filterPickerCards(LIB, "zzz")).toEqual([]);
  });
  it("sorts by library order (as given), name, mana value (ties by name) and type", () => {
    expect(sortPickerCards(LIB, "library").map((c) => c.name)).toEqual(LIB.map((c) => c.name));
    expect(sortPickerCards(LIB, "name").map((c) => c.name)).toEqual(["Counterspell", "Cultivate", "Esper Sentinel", "Forest", "Sol Ring", "Ünicorn"]);
    expect(sortPickerCards(LIB, "mana").map((c) => c.name)).toEqual(["Forest", "Esper Sentinel", "Sol Ring", "Counterspell", "Ünicorn", "Cultivate"]);
    expect(sortPickerCards(LIB, "type").map((c) => c.name)).toEqual(["Forest", "Esper Sentinel", "Ünicorn", "Sol Ring", "Counterspell", "Cultivate"]);
    expect(LIB[0].name).toBe("Sol Ring"); // the input is not mutated
  });
  it("pickerCards filters, then sorts; the count line says how many are shown", () => {
    expect(pickerCards(LIB, "creature", "name").map((c) => c.name)).toEqual(["Esper Sentinel", "Ünicorn"]);
    expect(pickerCount(2, 6)).toBe("2 of 6 cards"); expect(pickerCount(6, 6)).toBe("6 cards"); expect(pickerCount(1, 1)).toBe("1 card");
  });
  it("a pick out of the library is a tutor (to hand by default), out of another zone a move; the same zone is not a destination", () => {
    expect(pickAction("library", "#4")).toEqual({ type: "sandboxTutor", cardId: "#4", to: "hand" });
    expect(pickAction("library", "#4", "top_of_library")).toEqual({ type: "sandboxTutor", cardId: "#4", to: "top_of_library" });
    expect(pickAction("hand", "#4", "graveyard")).toEqual({ type: "sandboxMove", cardId: "#4", to: "graveyard" });
    expect(PICKER_DESTINATIONS[0].id).toBe("hand");
    expect(destinationsFor("library").map((d) => d.id)).toEqual(["hand", "battlefield", "graveyard", "exile", "top_of_library"]);
    expect(destinationsFor("graveyard").map((d) => d.id)).not.toContain("graveyard");
  });
});

describe("conjure and small buttons", () => {
  const NAMES = ["Sol Ring", "Solemn Simulacrum", "Mystic Remora", "Forest", "Swords to Plowshares", "Arcane Signet"];
  it("matches every word, prefix matches first, capped", () => {
    expect(conjureMatches(NAMES, "")).toEqual([]);
    expect(conjureMatches(NAMES, "sol")).toEqual(["Sol Ring", "Solemn Simulacrum"]);
    expect(conjureMatches(NAMES, "ring sol")).toEqual(["Sol Ring"]);
    expect(conjureMatches(NAMES, "s", 2).length).toBe(2);
    expect(conjureMatches(NAMES, "remora")).toEqual(["Mystic Remora"]);
  });
  it("life buttons set the new total", () => { expect(lifeAction(40, -10)).toEqual({ type: "sandboxSetLife", life: 30 }); });
  it("the card inspector's entry: only your own hand / graveyard / exile / command cards, only while debug is on", () => {
    const o = { zone: "hand", owner: "p1", id: "#3", isLand: false };
    expect(debugCardAction(false, o, "p1")).toBeUndefined();
    expect(debugCardAction(true, { ...o, owner: "p2" }, "p1")).toBeUndefined();
    expect(debugCardAction(true, { ...o, zone: "battlefield" }, "p1")).toBeUndefined();
    expect(debugCardAction(true, o, "p1")).toMatchObject({ id: "debug:cast:#3", label: "Cast for free (debug)" });
    expect(debugCardAction(true, { ...o, zone: "graveyard", isLand: true }, "p1")?.label).toMatch(/battlefield/);
    expect(debugOptionAction("debug:cast:#3", () => false)).toEqual({ type: "sandboxCast", cardId: "#3" });
    expect(debugOptionAction("debug:cast:#3", () => true)).toEqual({ type: "sandboxPlayLand", cardId: "#3" });
    expect(debugOptionAction("castSpell:#3", () => false)).toBeUndefined();
  });
});

function game() {
  const t = mini(["p1", "p2"], { phase: "end_step" as never });
  for (let i = 0; i < 5; i++) { t.give("p1", "Forest", "library"); t.give("p2", "Island", "library"); }
  const hand = t.give("p1", "Esper Sentinel", "hand"), land = t.give("p1", "Forest", "hand"), sorcery = t.give("p1", "Blasphemous Edict", "hand");
  t.give("p2", "Ledger Shredder", "battlefield");
  const ks = KernelSession.fromState(t.state, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } } as never);
  ks.state.config.manualPay = ["p1"];
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  return { ks, c, hand, land, sorcery };
}

describe("controller: debug mode", () => {
  it("off by default: no debug entry on cards, free-cast does nothing, the actions are refused with a note", () => {
    const { ks, c, hand } = game();
    expect(c.debugOn()).toBe(false);
    expect(c.cardActions(hand).some((a) => a.id.startsWith("debug:"))).toBe(false);
    c.toggleFreeCast(); expect(c.freeCast).toBe(false);
    expect(c.debug({ type: "sandboxDraw", count: 1 })).toBe(false);
    expect(ks.state.players[0].hand.length).toBe(3);
    expect(c.table().session.events[0].message).toMatch(/debug mode is off/i);
    expect(c.debugCards("library")).toEqual([]); // the library list is only for debug mode
  });
  it("the checkbox switches it on (public log line), the card entry appears, free-cast mode casts a hand card with no payment at the wrong time", () => {
    const { ks, c, hand, land, sorcery } = game();
    c.setDebug(true);
    expect(c.debugOn()).toBe(true);
    expect(ks.log("p1").map((l) => l.message)).toContain("Debug mode ON");
    expect(c.cardActions(hand).map((a) => a.label)).toContain("Cast for free (debug)");
    c.toggleFreeCast(); expect(c.freeCast).toBe(true);
    expect(c.handHints().castable).toEqual(expect.arrayContaining([hand, land, sorcery]));
    c.playCard("p1", hand);
    expect(ks.state.stack.some((i) => i.objectId === hand)).toBe(true);
    expect(ks.state.pending?.kind).not.toBe("pay_mana");
    c.playCard("p1", land); // a land: onto the battlefield, no land drop used
    expect(ks.state.objects[land].zone).toBe("battlefield"); expect(ks.state.players[0].landsPlayed).toBe(0);
    // the inspector's per-card entry does the same for a sorcery on a non-empty stack
    const entry = c.cardActions(sorcery).find((a) => a.id.startsWith("debug:"))!;
    c.doOption(entry.id);
    expect(ks.state.pending?.kind === "choose_targets" || ks.state.stack.some((i) => i.objectId === sorcery)).toBe(true);
    c.setDebug(false);
    expect(c.debugOn()).toBe(false); expect(c.freeCast).toBe(false);
    expect(c.cardActions(hand).some((a) => a.id.startsWith("debug:"))).toBe(false);
  });
  it("the library picker lists the whole library with art-capable tiles and a pick tutors the card to hand", () => {
    const { ks, c } = game();
    c.setDebug(true);
    const lib = c.debugCards("library");
    expect(lib.length).toBe(5);
    expect(lib.every((x) => x.name === "Forest" && x.zone === "library")).toBe(true);
    const lifeBefore = c.humanLife();
    expect(c.debug(pickAction("library", lib[2].id))).toBe(true);
    expect(ks.state.objects[lib[2].id].zone).toBe("hand");
    expect(c.debugCards("library").length).toBe(4);
    c.debug(lifeAction(lifeBefore, -10)); expect(c.humanLife()).toBe(lifeBefore - 10);
    expect(c.debugNames().length).toBeGreaterThan(0);
  });
});

describe("multiplayer: a guest cannot reach debug mode", () => {
  it("the guest intent registry has no sandbox / debug intent, and no action type of the sandbox is a wire name", () => {
    const names = Object.keys(INTENT_SPECS);
    expect(names.filter((n) => /sandbox|debug/i.test(n))).toEqual([]);
    for (const t of SANDBOX_ACTION_TYPES) expect(names).not.toContain(t);
  });
});
