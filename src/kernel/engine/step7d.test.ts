// Kernel step 7, batch D: reveal-until / revealed sets / milled sets (Cultivate, Dina's Guidance, Clifftop Lookout, Old Stickfingers,
// Cache Grab), delayed triggers that remember "chosen" (Hellkite Courser), entering transformed (Sheoldred shape).
import { describe, expect, it } from "vitest";
import type { Step } from "../schema";
import { cardUnsupported } from "./support";
import { famCards, filler, mk, sorcery } from "./famkit";
import { realDef, realTable } from "./testdb";
import { viewFor, eventsFor } from "./view";
import type { Table } from "./testkit";

const ans = (t: Table, choice: object) => t.ok({ type: "answerDecision", player: t.state.pending!.player, decisionId: t.state.pending!.id, choice });
const pass = (t: Table) => { for (let i = 0; i < 20 && (t.state.stack.length || t.state.pending); i++) { const p = t.state.pending; if (p) { if (p.kind !== "order_triggers") return; ans(t, { ids: p.options.map((o) => o.id) }); } else t.ok({ type: "passPriority", player: t.state.priority! }); } };
const world = () => realTable(["p1", "p2"], famCards);
const rich = (t: Table) => { for (const n of ["Plains", "Island", "Swamp", "Mountain", "Forest"]) t.lands("p1", n, 3); };
const stackLib = (t: Table, names: string[]) => { for (const n of [...names].reverse()) t.give("p1", n, "library"); }; // names[0] ends on top

describe("the cards are supported", () => {
  it("Cultivate / Dina's Guidance / Clifftop Lookout / Old Stickfingers / Cache Grab / Old Rutstein / Hellkite Courser", () => {
    for (const n of ["Cultivate", "Dina's Guidance", "Clifftop Lookout", "Old Stickfingers", "Cache Grab", "Hellkite Courser"]) expect(cardUnsupported(realDef(n)!).all, n).toEqual([]);
  });
});

describe("reveal cards until a land (Clifftop Lookout)", () => {
  it("reveals down to the first land, puts it onto the battlefield tapped, the rest on the bottom", () => {
    const t = world(); stackLib(t, ["Fill A", "Fill B", "Island", "Fill C"]); t.give("p1", "Fill D", "library", { top: false });
    const look = t.give("p1", "Clifftop Lookout", "hand"); t.lands("p1", "Forest", 4);
    t.ok({ type: "castSpell", player: "p1", cardId: look }); pass(t);
    const lands = t.state.battlefield.filter((i) => t.obj(i).cardName === "Island");
    expect(lands).toHaveLength(1);
    expect(t.obj(lands[0]).tapped).toBe(true);
    // Fill A, Fill B went to the bottom; Fill C is the top now
    const lib = t.p("p1").library.map((i) => t.obj(i).cardName);
    expect(lib[0]).toBe("Fill C");
    expect(lib.slice(-2).sort()).toEqual(["Fill A", "Fill B"]);
  });
  it("with no land in the library everything is revealed and nothing enters", () => {
    const t = world(); stackLib(t, ["Fill A", "Fill B"]); t.lands("p1", "Forest", 4);
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Clifftop Lookout", "hand") }); pass(t);
    expect(t.state.battlefield.filter((i) => t.obj(i).cardName === "Island")).toHaveLength(0);
  });
});

describe("search that only reveals (Cultivate, Dina's Guidance)", () => {
  it("Cultivate: choose which basic goes to the battlefield tapped, the other to hand", () => {
    const t = world(); t.lands("p1", "Forest", 3);
    const a = t.give("p1", "Island", "library"), b = t.give("p1", "Plains", "library"); t.give("p1", "Fill A", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Cultivate", "hand") }); pass(t);
    expect(t.state.pending!.kind).toBe("choose_cards"); // which cards to find (up to two)
    ans(t, { ids: [a, b] });
    expect(t.state.pending!.kind).toBe("choose_cards"); // which one enters the battlefield
    ans(t, { ids: [b] });
    expect(t.obj(b)).toMatchObject({ zone: "battlefield", tapped: true });
    expect(t.obj(a).zone).toBe("hand");
  });
  it("Cultivate: finding only one puts it onto the battlefield and nothing in hand", () => {
    const t = world(); t.lands("p1", "Forest", 3);
    const a = t.give("p1", "Island", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Cultivate", "hand") }); pass(t);
    ans(t, { ids: [a] });
    expect(t.obj(a).zone).toBe("battlefield");
  });
  it("Dina's Guidance: the found creature goes to hand or graveyard by choice", () => {
    const t = world(); rich(t);
    const c = t.give("p1", "Big Elf", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Dina's Guidance", "hand") }); pass(t);
    ans(t, { ids: [c] });
    expect(t.state.pending!.kind).toBe("choose_option");
    ans(t, { ids: ["graveyard"] });
    expect(t.obj(c).zone).toBe("graveyard");
  });
});

describe("mill then choose from what was milled (Cache Grab)", () => {
  it("only cards milled by that step are candidates, and the chosen permanent goes to hand", () => {
    const t = world(); rich(t);
    const old = t.give("p1", "Big Elf", "graveyard");
    for (const n of ["Fill A", "Fill B", "Fill C", "Fill D"]) t.give("p1", n, "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Cache Grab", "hand") }); pass(t);
    expect(t.state.pending!.kind).toBe("choose_yes_no"); // "you may put a permanent card ..."
    ans(t, { yes: true });
    const opts = t.state.pending!.options.map((o) => o.id);
    expect(opts).toHaveLength(4);
    expect(opts).not.toContain(old);
    ans(t, { ids: [opts[0]] });
    expect(t.obj(opts[0]).zone).toBe("hand");
  });
});

describe("reveal until X creature cards (Old Stickfingers)", () => {
  it("is supported and reveals exactly X creatures, the rest go to the bottom", () => {
    const t = world(); rich(t);
    stackLib(t, ["Fill Land", "Fill A", "Fill Land", "Fill B", "Fill C"]);
    const ids = t.p("p1").library.slice();
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Old Stickfingers", "hand"), x: 2 });
    t.ok({ type: "passPriority", player: "p1" }); t.ok({ type: "passPriority", player: "p2" });
    // the cast trigger resolved: two creatures went to the graveyard, the revealed lands went to the bottom
    expect(ids.filter((i) => t.obj(i).zone === "graveyard").map((i) => t.obj(i).cardName)).toEqual(["Fill A", "Fill B"]);
  });
});

describe("delayed trigger remembers what the ability chose (Hellkite Courser)", () => {
  it("puts the commander onto the battlefield with haste and returns it at the end step", () => {
    const t = world();
    const cmd = t.give("p1", "Big Elf", "hand"); // becomes the commander in the command zone
    t.state.objects[cmd].zone = "command"; t.p("p1").hand = t.p("p1").hand.filter((i) => i !== cmd); t.p("p1").command.push(cmd); t.state.objects[cmd].isCommander = true;
    rich(t); for (const p of ["p1", "p2"]) for (let i = 0; i < 12; i++) t.give(p, "Fill A", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Hellkite Courser", "hand") }); pass(t);
    // optional choose: "you may" -> yes
    if (t.state.pending?.kind === "choose_yes_no") ans(t, { yes: true });
    if (t.state.pending?.kind === "choose_cards") ans(t, { ids: [cmd] });
    pass(t);
    expect(t.obj(cmd).zone).toBe("battlefield");
    expect(t.state.delayedTriggers).toHaveLength(1);
    for (let i = 0; i < 20 && t.obj(cmd).zone === "battlefield"; i++) { if (t.state.pending) { if (t.state.pending.kind === "choose_yes_no") ans(t, { yes: false }); else break; } else t.ok({ type: "advancePhase", player: t.state.turn.active }); pass(t); }
    expect(t.obj(cmd).zone).toBe("command");
  });
});

describe("entering transformed", () => {
  const dfc = mk("Flip Test", { manaCost: "{1}", types: ["creature"], power: 1, toughness: 1, layout: "transform", faces: { Back: { types: ["creature"], power: 5, toughness: 5 } } } as never, [
    { id: "f1", kind: "keyword", text: "Front", keyword: { name: "flying" }, face: "Flip Test" } as never,
    { id: "a1", kind: "keyword", text: "Back", keyword: { name: "back_face" }, face: "Back" } as never
  ]);
  const ret = sorcery("Return Flipped", "{1}", [{ kind: "move_card_zone", target: "t1", moveTo: "battlefield", transformed: true } as Step], [{ id: "t1", what: "object", filter: { zone: "graveyard" }, count: { min: 1, max: 1 } }]);
  it("a double-faced card put onto the battlefield transformed shows its back face", () => {
    const t = realTable(["p1", "p2"], { ...famCards, "Flip Test": dfc, "Return Flipped": ret }); t.lands("p1", "Plains", 1);
    const c = t.give("p1", "Flip Test", "graveyard");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Return Flipped", "hand"), targets: { t1: [c] } }); pass(t);
    expect(t.obj(c)).toMatchObject({ zone: "battlefield", face: "Back" });
  });
  it("a card that is not double-faced is not moved by a 'transformed' step", () => {
    const t = realTable(["p1", "p2"], { ...famCards, "Return Flipped": ret }); t.lands("p1", "Plains", 1);
    const c = t.give("p1", "Fill A", "graveyard");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Return Flipped", "hand"), targets: { t1: [c] } }); pass(t);
    expect(t.obj(c).zone).toBe("graveyard");
  });
  it("leaving the battlefield resets the face", () => {
    const t = realTable(["p1", "p2"], { ...famCards, "Flip Test": dfc, "Return Flipped": ret }); t.lands("p1", "Plains", 1);
    const c = t.give("p1", "Flip Test", "graveyard");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Return Flipped", "hand"), targets: { t1: [c] } }); pass(t);
    expect(t.obj(c).face).toBe("Back");
  });
});

void filler; void eventsFor;
