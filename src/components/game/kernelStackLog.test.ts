// The stack / trigger resolution log (kernel/integration/stackLog.ts): exact order and counts for real multi-trigger cases, replacement chains, counterspells,
// fizzles, combat damage triggers and declined "unless pays", plus the pure helpers the panel uses (filters, text export, group cap).
import { describe, expect, it } from "vitest";
import "@/kernel/engine/resolve"; // the engine modules import each other in a cycle that only initialises when resolve.ts is entered first
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { StackLogBuilder, stackLogText, visibleLines, type StackLogGroup } from "@/kernel/integration/stackLog";
import type { GameEvent } from "@/kernel/engine/types";

/** answer every open decision with the first options (or "no" to yes/no questions) and pass priority until the stack is empty */
export function drive(ks: KernelSession, pick: (kind: string, ids: string[]) => string[] | undefined = () => undefined): void {
  for (let i = 0; i < 80; i++) {
    const s = ks.state;
    const p = s.pending;
    if (p) {
      const ids = pick(p.kind, p.options.map((o) => o.id)) ?? p.options.slice(0, Math.max(p.min, 1)).map((o) => o.id);
      const choice = p.numeric ? { number: p.min } : p.kind === "choose_yes_no" || p.kind === "pay_unless" ? { yes: false } : { ids };
      const r = ks.dispatch(p.player, { type: "answerDecision", player: p.player, decisionId: p.id, choice });
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      continue;
    }
    if (s.stack.length && s.priority) {
      const r = ks.dispatch(s.priority, { type: "passPriority", player: s.priority });
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      continue;
    }
    break;
  }
}

const group = (ks: KernelSession, viewer = "p1", i = 0): StackLogGroup => ks.stackLog(viewer).groups[i];
const texts = (g: StackLogGroup): string[] => g.lines.map((l) => l.text);

function library(m: ReturnType<typeof mini>, n = 6) { for (let i = 0; i < n; i++) { m.give("p1", "Forest", "library"); m.give("p2", "Island", "library"); } }

describe("stack log: many simultaneous triggers (Redress Fate)", () => {
  function redressFate() {
    const m = mini();
    library(m);
    m.give("p1", "Doomwake Giant", "battlefield");
    m.give("p2", "Grizzly Bears", "battlefield");
    for (const n of ["Sphere of Safety", "Greed", "Sphere of Safety"]) m.give("p1", n, "graveyard");
    for (let i = 0; i < 6; i++) m.give("p1", "Plains", "battlefield");
    m.give("p1", "Island", "battlefield"); m.give("p1", "Plains", "battlefield");
    const spell = m.give("p1", "Redress Fate", "hand");
    const ks = KernelSession.fromState(m.state, { ctx });
    const cast = ks.dispatch("p1", { type: "castSpell", player: "p1", cardId: spell, autoPay: true });
    expect(cast.ok, JSON.stringify(cast.error)).toBe(true);
    drive(ks);
    return ks;
  }

  it("is one group headed by the cast with its cost, and ends with the stack empty", () => {
    const ks = redressFate();
    const g = group(ks);
    expect(ks.stackLog("p1").groups).toHaveLength(1);
    expect(g.title).toMatch(/^p1 casts Redress Fate \(cost paid: mana \{[^)]*\)$/);
    expect(g.stackEmpty).toBe(true);
    expect(texts(g)[0]).toBe("Put on the stack.");
  });

  it("lists every Constellation trigger once, in resolution order 1..N, with its cause and who ordered it", () => {
    const ks = redressFate();
    const g = group(ks);
    const trig = g.lines.filter((l) => l.cat === "trigger" && l.head && l.text.includes("Doomwake Giant") && !l.text.startsWith("Resolving"));
    expect(trig).toHaveLength(3);
    expect(trig.map((l) => l.text.match(/^(\d+)\./)?.[1])).toEqual(["1", "2", "3"]);
    for (const l of trig) { expect(l.text).toContain("entered the battlefield"); 
 expect(l.text).toMatch(/\[stack position \d+\]/); expect(l.detail).toContain("Constellation"); }
    expect(g.lines.some((l) => /chose the order of 3 triggers/.test(l.text))).toBe(true);
    expect(g.lines.find((l) => l.cat === "trigger" && !l.head)?.text).toMatch(/3 triggers put on the stack/);
  });

  it("resolves them top first: Resolving 1., 2., 3., each with its concrete result", () => {
    const g = group(redressFate());
    const resolving = g.lines.filter((l) => l.head && l.text.startsWith("Resolving") && l.text.includes("Doomwake"));
    expect(resolving.map((l) => l.text.match(/^Resolving (\d+)\./)?.[1])).toEqual(["1", "2", "3"]);
    // every resolution of a constellation trigger is followed by an indented result (the -1/-1 effect is a continuous effect: "No visible effect." or a death)
    for (const l of resolving) expect(g.lines[g.lines.indexOf(l) + 1].depth).toBeGreaterThan(l.depth);
  });

  it("the cast, the permanents entering and the resolution of the spell are all there in order", () => {
    const g = group(redressFate());
    const t = texts(g);
    const iPut = t.indexOf("Put on the stack.");
    const iRes = t.findIndex((x) => x.startsWith("Resolving Redress Fate"));
    const iDone = t.findIndex((x) => x.startsWith("Redress Fate resolves"));
    expect(iPut).toBeLessThan(iRes);
    expect(iRes).toBeLessThan(iDone);
    expect(t.filter((x) => /enters the battlefield\./.test(x)).length).toBeGreaterThanOrEqual(3);
    expect(t[iDone]).toBe("Redress Fate resolves and goes to the graveyard.");
  });

  it("category filters hide only their own lines", () => {
    const g = group(redressFate());
    const noTriggers = visibleLines(g, new Set(["trigger"]));
    expect(noTriggers.some((l) => l.cat === "trigger")).toBe(false);
    expect(noTriggers.some((l) => l.cat === "spell")).toBe(true);
    expect(visibleLines(g, new Set())).toBe(g.lines);
  });
});

describe("stack log: replacement chain (Chatterfang + Academy Manufactor)", () => {
  it("names each replacing permanent, what it changed, and the tokens made", () => {
    const m = mini();
    library(m);
    m.give("p1", "Chatterfang, Squirrel General", "battlefield");
    m.give("p1", "Academy Manufactor", "battlefield");
    m.give("p1", "Forest", "battlefield"); m.give("p1", "Forest", "battlefield");
    const goose = m.give("p1", "Gilded Goose", "hand");
    const ks = KernelSession.fromState(m.state, { ctx });
    expect(ks.dispatch("p1", { type: "castSpell", player: "p1", cardId: goose, autoPay: true }).ok).toBe(true);
    drive(ks);
    const t = texts(group(ks));
    const repl = group(ks).lines.filter((l) => l.cat === "replacement");
    expect(repl.length).toBeGreaterThanOrEqual(2);
    expect(repl.some((l) => l.text.startsWith("Academy Manufactor's replacement effect") && /creates \d tokens instead of \d/.test(l.text) && /Clue/.test(l.text) && /Food/.test(l.text) && /Treasure/.test(l.text))).toBe(true);
    expect(repl.some((l) => l.text.startsWith("Chatterfang, Squirrel General's replacement effect"))).toBe(true);
    expect(repl.every((l) => l.detail && l.detail.length > 10)).toBe(true); // the replacing ability's text is on the line
    // the Food from the Goose's enters trigger is made inside that trigger's resolution
    const iTrig = t.findIndex((x) => x.startsWith("Resolving Gilded Goose"));
    expect(iTrig).toBeGreaterThan(0);
    expect(t.slice(iTrig).some((x) => /creates (Food|Clue|Treasure|Squirrel)/.test(x))).toBe(true);
  });
});

describe("stack log: counterspell and fizzle", () => {
  it("shows a spell cast in response nested under the first, and the counter", () => {
    const m = mini();
    library(m);
    m.give("p1", "Plains", "battlefield"); m.give("p1", "Plains", "battlefield");
    m.give("p2", "Island", "battlefield"); m.give("p2", "Island", "battlefield");
    const bears = m.give("p1", "Grizzly Bears", "hand");
    m.give("p1", "Forest", "battlefield");
    const cs = m.give("p2", "Counterspell", "hand");
    const ks = KernelSession.fromState(m.state, { ctx });
    expect(ks.dispatch("p1", { type: "castSpell", player: "p1", cardId: bears, autoPay: true }).ok).toBe(true);
    expect(ks.dispatch("p1", { type: "passPriority", player: "p1" }).ok).toBe(true);
    const r = ks.dispatch("p2", { type: "castSpell", player: "p2", cardId: cs, autoPay: true });
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    drive(ks, (kind, ids) => (kind === "choose_targets" ? ids.filter((i) => ks.state.objects[i]?.cardName === "Grizzly Bears").slice(0, 1) : undefined));
    const g = group(ks);
    expect(ks.stackLog("p1").groups).toHaveLength(1);
    const cast2 = g.lines.find((l) => l.text.startsWith("p2 casts Counterspell"));
    expect(cast2).toBeDefined();
    expect(cast2!.depth).toBeGreaterThan(0);
    expect(cast2!.text).toContain("targeting Grizzly Bears");
    const t = texts(g);
    expect(t.some((x) => x === "Grizzly Bears is countered by Counterspell.")).toBe(true);
    expect(t.findIndex((x) => x.startsWith("Resolving Counterspell"))).toBeLessThan(t.indexOf("Grizzly Bears is countered by Counterspell."));
    expect(g.stackEmpty).toBe(true);
  });

  it("says a spell fizzled when its target became illegal", () => {
    const m = mini();
    library(m);
    m.give("p1", "Plains", "battlefield"); m.give("p2", "Plains", "battlefield");
    const bears = m.give("p2", "Grizzly Bears", "battlefield");
    const s1 = m.give("p1", "Swords to Plowshares", "hand");
    const s2 = m.give("p2", "Swords to Plowshares", "hand");
    const ks = KernelSession.fromState(m.state, { ctx });
    expect(ks.dispatch("p1", { type: "castSpell", player: "p1", cardId: s1, autoPay: true, targets: { t1: [bears] } }).ok).toBe(true);
    expect(ks.state.pending).toBeNull();
    expect(ks.dispatch("p1", { type: "passPriority", player: "p1" }).ok).toBe(true); // p1 passes, p2 may respond
    const r = ks.dispatch("p2", { type: "castSpell", player: "p2", cardId: s2, autoPay: true });
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    drive(ks, (kind) => (kind === "choose_targets" ? [bears] : undefined));
    const t = texts(group(ks));
    expect(t.some((x) => /^Swords to Plowshares fizzles: all of its targets are illegal\.$/.test(x))).toBe(true);
  });
});

describe("stack log: declined 'unless pays' (Esper Sentinel)", () => {
  it("says who declined to pay what", () => {
    const m = mini();
    library(m);
    m.give("p2", "Esper Sentinel", "battlefield");
    m.give("p2", "Grizzly Bears", "battlefield");
    m.give("p1", "Plains", "battlefield"); m.give("p1", "Plains", "battlefield"); m.give("p1", "Plains", "battlefield");
    const sw = m.give("p1", "Swords to Plowshares", "hand");
    const ks = KernelSession.fromState(m.state, { ctx });
    expect(ks.dispatch("p1", { type: "castSpell", player: "p1", cardId: sw, autoPay: true }).ok).toBe(true);
    drive(ks); // the driver answers "no" to the pay question
    const t = texts(group(ks));
    expect(t.some((x) => /^Esper Sentinel: p1 declined to pay \{1\}\.$/.test(x))).toBe(true);
    expect(t.some((x) => /^p2 draws /.test(x))).toBe(true);
  });
});

describe("stack log: events fed by hand (combat, state-based actions, life changes)", () => {
  const names = { card: (id: string | undefined) => (id === "#1" ? "Grizzly Bears" : id === "#2" ? "Soul Warden" : "a card"), player: (id: string | undefined) => (id === "p1" ? "Alice" : id === "p2" ? "Bob" : "someone") };
  let seq = 0;
  const ev = (type: string, f: Record<string, unknown> = {}): GameEvent => ({ type, seq: seq++, ...f });

  it("combat damage forms a combat group; the trigger it causes nests inside it; life is shown before -> after", () => {
    const b = new StackLogBuilder();
    b.push([
      ev("phase_changed", { phase: "declare_attackers" }), ev("attackers_declared", { player: "p1", count: 2 }),
      ev("combat_damage_step", { which: "regular" }),
      ev("damage", { source: "#1", target: "p2", amount: 3, combat: true }), ev("life_loss", { player: "p2", amount: 3, life: 37 }),
      ev("trigger_on_stack", { source: "#2", ability: "a1", controller: "p1", item: "s5", depth: 1, text: "Whenever a creature deals combat damage to a player, draw a card.", cause: "#1", causeEvent: "deals_combat_damage_to_player" }),
      ev("resolving", { item: "s5", kind: "triggered", source: "#2", ability: "a1", controller: "p1", left: 0 }),
      ev("draw", { player: "p1", id: "#9" }),
      ev("ability_resolved", { source: "#2", kind: "triggered", item: "s5", left: 0 })
    ], names);
    expect(b.groups).toHaveLength(2);
    expect(b.groups[0].title).toBe("Alice attacks with 2 creatures");
    expect(b.groups[0].cat).toBe("combat");
    const g = b.groups[1];
    expect(g.title).toBe("Combat damage");
    expect(texts(g)[0]).toBe("Grizzly Bears deals 3 combat damage to Bob (life 40 -> 37).");
    expect(g.lines[0].cat).toBe("combat");
    const trig = g.lines.find((l) => l.cat === "trigger" && l.head)!;
    expect(trig.text).toContain("because Grizzly Bears dealt combat damage to a player");
    expect(g.stackEmpty).toBe(true);
    expect(g.lines.find((l) => l.text.startsWith("Resolving"))!.item).toBe("s5");
  });

  it("highlights the resolving item and clears it afterwards", () => {
    const b = new StackLogBuilder();
    b.push([ev("cast", { id: "#1", player: "p1", name: "Grizzly Bears", item: "s1", depth: 1, paid: { mana: "{1}{G}" } }), ev("resolving", { item: "s1", kind: "spell", source: "#1", controller: "p1", left: 0 })], names);
    expect(b.resolvingItem).toBe("s1");
    b.push([ev("spell_resolved", { id: "#1", player: "p1", item: "s1", left: 0 })], names);
    expect(b.resolvingItem).toBeUndefined();
    expect(b.groups[0].stackEmpty).toBe(true);
  });

  it("state-based actions and player losses are their own category", () => {
    const b = new StackLogBuilder();
    b.push([ev("cast", { id: "#1", player: "p1", name: "Lightning Bolt", item: "s1", depth: 1 }), ev("resolving", { item: "s1", kind: "spell", source: "#1", controller: "p1", left: 0 }),
      ev("damage", { source: "#1", target: "#2", amount: 3, combat: false }), ev("destroyed", { id: "#2", lethalDamage: true }), ev("player_lost", { player: "p2", reason: "life" }),
      ev("spell_resolved", { id: "#1", player: "p1", item: "s1", left: 0 })], names);
    const g = b.groups[0];
    expect(g.lines.filter((l) => l.cat === "state").map((l) => l.text)).toEqual(["State-based action: Soul Warden is destroyed (lethal damage).", "State-based action: Bob loses the game (life)."]);
  });

  it("keeps at most maxGroups and counts the dropped ones; text export indents by depth", () => {
    const b = new StackLogBuilder({ maxGroups: 3 });
    for (let i = 0; i < 5; i++) b.push([ev("land_played", { player: "p1", id: "#1" })], names);
    expect(b.groups).toHaveLength(3);
    expect(b.dropped).toBe(2);
    b.push([ev("cast", { id: "#2", player: "p2", name: "Soul Warden", item: "s9", depth: 1 })], names);
    const text = stackLogText(b.groups, { last: 1 });
    expect(text.split("\n")[0]).toBe("Bob casts Soul Warden");
    expect(text.split("\n")[1]).toBe("  Put on the stack.");
  });
});
