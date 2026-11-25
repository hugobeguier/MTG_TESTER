// Delayed "at the beginning of the next end step ..." effects (Hellkite Courser bug: the commander it put onto the battlefield never went back).
// Root cause: the delayed steps were rewritten "chosen" -> "__c" when the trigger was created, and the static support check that every resolving
// step goes through did not know "__c" (only "t1"...), so in live (continue) mode the return step was skipped as "unresolved".
// Part 1: the real Hellkite Courser / The Ur-Dragon drafts through KernelSession (stack log included), from several timings.
// Part 2: one synthetic spell per distinct delayed shape (return to hand / command zone / exile / sacrifice / battlefield) from each timing.
import { describe, expect, it } from "vitest";
import { G, base, rich } from "./aminatoukit";
import { generatePrompts } from "../prompts";
import type { Ability, Card, Step } from "../schema";
import { CARDS } from "./testcards";
import { table, type Table } from "./testkit";
import type { Action, CardDef, ObjId } from "./types";

// ---------------------------------------------------------------- part 1: the real cards
const toCommand = (g: G, id: string) => { const s = g.s; const p = s.players.find((x) => x.id === "p1")!; p.hand = p.hand.filter((x) => x !== id); p.command.push(id); s.objects[id].zone = "command"; s.objects[id].isCommander = true; };
function advance(g: G, until: (g: G) => boolean) {
  for (let i = 0; i < 80 && !until(g); i++) {
    if (g.s.pending || (g.s.stack.length && g.s.priority)) { g.drive(); continue; }
    if (g.s.combat?.expect) { const ex = g.s.combat.expect as { kind: string; player?: string; players?: string[] }; if (ex.kind === "attackers") g.do(ex.player!, { type: "declareAttackers", player: ex.player!, attackers: [] } as Action); else for (const p of ex.players!) g.do(p, { type: "declareBlockers", player: p, blocks: [] } as Action); continue; }
    const a = g.s.turn.active; g.do(a, { type: "advancePhase", player: a } as Action);
  }
  expect(until(g), `never reached (stuck at turn ${g.s.turn.number} ${g.s.turn.phase})`).toBe(true);
}
const atPhase = (phase: string, turn?: number) => (g: G) => g.s.turn.phase === phase && (turn === undefined || g.s.turn.number === turn) && !g.s.stack.length && !g.s.pending;
const unresolvedOf = (g: G) => g.events.filter((e) => (e as never as { type: string }).type === "unresolved");

function courser(opts: { timing: "main" | "combat" | "opp" | "end"; viaDebugCast?: boolean }) {
  const m = base(); rich(m); m.give("p1", "Mountain", "battlefield"); m.give("p1", "Mountain", "battlefield");
  const c = m.give("p1", "Hellkite Courser", "hand"); const u = m.give("p1", "The Ur-Dragon", "hand");
  const g = new G(m); toCommand(g, u);
  if (opts.timing === "combat") advance(g, atPhase("beginning_of_combat"));
  if (opts.timing === "opp") advance(g, (x) => x.s.turn.active === "p2" && x.s.turn.phase === "precombat_main");
  if (opts.timing === "end") advance(g, atPhase("end_step"));
  if (opts.timing === "main") g.cast("p1", c);
  else {
    // Courser has no flash: debug free cast ignores the timing, which is all this test needs to place the enters trigger in another phase
    g.do("p1", { type: "sandboxMode", player: "p1", on: true } as Action);
    g.do("p1", { type: "sandboxCast", player: "p1", cardId: c } as Action);
    g.drive();
  }
  return { g, c, u };
}

describe("Hellkite Courser: the commander goes back to the command zone at the beginning of the next end step", () => {
  it("cast in the main phase: puts it onto the battlefield with haste, says so in the log, returns it at this turn's end step", () => {
    const { g, u } = courser({ timing: "main" });
    expect(g.zone(u)).toBe("battlefield");
    expect(g.chars(u).keywords.map((k: string) => k.toLowerCase())).toContain("haste");
    const text = g.log().join("\n");
    expect(text).toMatch(/Delayed trigger created: Hellkite Courser: at the beginning of the next end step, return The Ur-Dragon to its owner's command zone/);
    expect(g.s.delayedTriggers).toHaveLength(1);
    advance(g, atPhase("end_step", 1));
    expect(g.zone(u)).toBe("command");
    expect(g.s.delayedTriggers ?? []).toEqual([]);
    expect(unresolvedOf(g)).toEqual([]);
    expect(g.noEffect()).toEqual([]);
    expect(g.log().join("\n")).toMatch(/Hellkite Courser: at the beginning of the next end step, return The Ur-Dragon to its owner's command zone \(p1\)/); // the trigger on the stack names what it does
    expect(g.log().join("\n")).toMatch(/The Ur-Dragon returns to the command zone|command zone/);
  });
  it("entering in the beginning of combat: still this turn's end step", () => {
    const { g, u } = courser({ timing: "combat" });
    expect(g.zone(u)).toBe("battlefield");
    advance(g, atPhase("end_step", 1));
    expect(g.zone(u)).toBe("command");
    expect(unresolvedOf(g)).toEqual([]);
  });
  it("entering in the opponent's turn: that turn's end step (the opponent's), not the owner's", () => {
    const { g, u } = courser({ timing: "opp" });
    expect(g.zone(u)).toBe("battlefield");
    expect(g.s.turn.active).toBe("p2");
    advance(g, atPhase("end_step", 2));
    expect(g.zone(u)).toBe("command");
    expect(unresolvedOf(g)).toEqual([]);
  });
  it("entering during the end step itself: waits for the NEXT turn's end step", () => {
    const { g, u } = courser({ timing: "end" });
    expect(g.zone(u)).toBe("battlefield");
    expect(g.s.turn.number).toBe(1);
    advance(g, atPhase("precombat_main", 2));
    expect(g.zone(u)).toBe("battlefield");
    advance(g, atPhase("end_step", 2));
    expect(g.zone(u)).toBe("command");
    expect(g.s.delayedTriggers ?? []).toEqual([]);
  });
  it("the commander died before the end step: the return finds nothing on the battlefield and nothing is stuck", () => {
    const { g, u } = courser({ timing: "main" });
    g.s.battlefield = g.s.battlefield.filter((x) => x !== u); g.s.objects[u].zone = "graveyard"; g.pl("p1").graveyard.push(u);
    advance(g, atPhase("end_step", 1));
    expect(g.zone(u)).not.toBe("battlefield"); // (a commander in the graveyard may go to the command zone by the commander rule)
    expect(g.s.delayedTriggers ?? []).toEqual([]);
  });
  it("the commander left for the command zone by itself (replacement choice) before the end step: the return is a harmless no-op", () => {
    const { g, u } = courser({ timing: "main" });
    g.s.battlefield = g.s.battlefield.filter((x) => x !== u); g.s.objects[u].zone = "command"; g.pl("p1").command.push(u);
    advance(g, atPhase("end_step", 1));
    expect(g.zone(u)).toBe("command");
  });
});

// ---------------------------------------------------------------- part 2: every delayed shape x every timing
const one = { min: 1, max: 1 };
const handCard = (name: string, abilities: Ability[]): CardDef => ({ name, manaCost: "{1}", types: ["instant"], kernel: generatePrompts({ schemaVersion: 2, abilities } as Card, name) });
const delayed = (inner: Step[], before: Step[] = []): Ability[] => [{
  id: "a1", kind: "spell_effect", text: "Delay.",
  targets: [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: one }],
  steps: [...before, { kind: "create_delayed_trigger", trigger: { event: "begin_step", step: "end_step", whose: "each" }, steps: inner } as unknown as Step]
}];
const bear: CardDef = { name: "Test Bear", manaCost: "{1}{G}", types: ["creature"], subtypes: ["Bear"], power: 2, toughness: 2, kernel: { schemaVersion: 2, abilities: [] } };
const SHAPES: Record<string, { card: CardDef; zone: string }> = {
  hand: { card: handCard("Delay Hand", delayed([{ kind: "bounce_target", target: "t1" }])), zone: "hand" },
  command: { card: handCard("Delay Command", delayed([{ kind: "move_card_zone", target: "t1", moveFrom: "battlefield", moveTo: "command" } as Step])), zone: "command" },
  exile: { card: handCard("Delay Exile", delayed([{ kind: "exile_target", target: "t1" }])), zone: "exile" },
  sacrifice: { card: handCard("Delay Sacrifice", delayed([{ kind: "sacrifice_permanent", target: "t1" } as Step])), zone: "graveyard" },
  // blink: exile now, back at the beginning of the next end step (the Ephemerate / Parting Gust shape)
  battlefield: { card: handCard("Delay Blink", delayed([{ kind: "move_card_zone", target: "t1", moveFrom: "exile", moveTo: "battlefield" } as Step], [{ kind: "exile_target", target: "t1" }])), zone: "battlefield" }
};
const extra = { ...CARDS, "Test Bear": bear, ...Object.fromEntries(Object.values(SHAPES).map((s) => [s.card.name, s.card])) };

function advanceTo(t: Table, turnNo: number, phase: string) {
  for (let i = 0; i < 80; i++) {
    if (t.state.pending || (t.state.turn.number === turnNo && t.state.turn.phase === phase && !t.state.stack.length)) return;
    const s = t.state;
    if (s.combat?.expect?.kind === "attackers") { t.ok({ type: "declareAttackers", player: s.combat.expect.player, attackers: [] }); continue; }
    if (s.combat?.expect?.kind === "blockers") { for (const p of (s.combat.expect as { players: string[] }).players) t.ok({ type: "declareBlockers", player: p, blocks: [] }); continue; }
    if (s.stack.length) { t.ok({ type: "passPriority", player: s.priority!, fastForward: true }); continue; }
    t.ok({ type: "advancePhase", player: s.turn.active });
  }
  throw new Error(`did not reach turn ${turnNo} ${phase}: at ${t.state.turn.number} ${t.state.turn.phase}`);
}
const TIMINGS = [
  { name: "main phase", go: (t: Table) => advanceTo(t, 1, "precombat_main"), endTurn: 1 },
  { name: "beginning of combat", go: (t: Table) => advanceTo(t, 1, "beginning_of_combat"), endTurn: 1 },
  { name: "opponent's turn", go: (t: Table) => advanceTo(t, 2, "precombat_main"), endTurn: 2 },
  { name: "the end step itself (waits for the next turn's)", go: (t: Table) => advanceTo(t, 1, "end_step"), endTurn: 2 }
] as const;

describe.each(Object.entries(SHAPES))("delayed %s shape", (shape, { card, zone }) => {
  it.each(TIMINGS)(`$name`, ({ go, endTurn }) => {
    const t = table(["p1", "p2"], { extra });
    for (let i = 0; i < 10; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
    t.lands("p1", "Island", 2);
    const bearId: ObjId = t.give("p1", "Test Bear", "battlefield");
    if (shape === "command") t.state.objects[bearId].isCommander = true;
    const spell = t.give("p1", card.name, "hand");
    go(t);
    t.state = { ...t.state, priority: "p1" };
    t.ok({ type: "castSpell", player: "p1", cardId: spell, targets: { t1: [bearId] } });
    for (let i = 0; i < 6 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority!, fastForward: true });
    expect(t.state.delayedTriggers, "delayed trigger registered").toHaveLength(1);
    expect(t.obj(bearId).zone).toBe(shape === "battlefield" ? "exile" : "battlefield"); // nothing happens before the end step
    if (endTurn > t.state.turn.number) { advanceTo(t, endTurn, "precombat_main"); expect(t.obj(bearId).zone, "not yet").toBe(shape === "battlefield" ? "exile" : "battlefield"); }
    advanceTo(t, endTurn, "end_step");
    expect(t.obj(bearId).zone).toBe(zone);
    expect(t.state.delayedTriggers ?? []).toEqual([]);
    expect(t.state.stack).toEqual([]);
  });
});

// ---------------------------------------------------------------- the copy-token shape ("exile those tokens at the beginning of the next end step")
describe("Saheeli, the Gifted -7: the token copies are exiled at the next end step", () => {
  it("copies an artifact with haste, then exiles the token (and only the token) at the end step", () => {
    const m = base();
    const s = m.give("p1", "Saheeli, the Gifted", "battlefield", { counters: { loyalty: 7 } });
    const stone = m.give("p1", "Fellwar Stone", "battlefield");
    const g = new G(m);
    g.act("p1", s, "a3");
    const copies = g.bf("Fellwar Stone").filter((i) => g.obj(i).token);
    expect(copies).toHaveLength(1);
    expect(g.zone(stone)).toBe("battlefield");
    expect(g.log().join("\n")).toMatch(/Delayed trigger created|exile/i);
    advance(g, atPhase("end_step", 1));
    expect(g.bf("Fellwar Stone").filter((i) => g.obj(i).token)).toEqual([]);
    expect(g.zone(stone)).toBe("battlefield");
    expect(unresolvedOf(g)).toEqual([]);
  });
});
