// Continue mode, part 3: the real drafted cards (smoke), the host bridge, the sink format and the merged report.
import { describe, expect, it } from "vitest";
import { UnresolvedDeduper, validateUnresolvedPayload } from "../../lib/unresolvedLog";
import { aggregateUnresolved, parseUnresolvedJsonl, renderUnresolvedMarkdown } from "../../lib/unresolvedReport";
import { UnresolvedBridge, unresolvedEventToRecord, unresolvedRecordsOf } from "../unresolvedBridge";
import { generatePrompts } from "../prompts";
import { allDraftFiles, loadDraft, table } from "./testkit";
import { cardUnsupported } from "./support";
import { CONT, castAndResolve, perm, setup, spell, unres } from "./unresolvedkit";
import type { CardDef, GameEvent, ResolveResult } from "./types";
import path from "node:path";

const oddSpell = spell("Odd Spell", [{ kind: "life_change", lifeDelta: 2, who: "you" }, { kind: "goad_everything", target: "self" }], { text: "Gain 2 life. Goad everything." });

describe("the bridge turns kernel events into sink records", () => {
  const events = (): GameEvent[] => { const t = setup([oddSpell]); return castAndResolve(t, "Odd Spell").events; };
  const ctx = { gameId: "g1", decks: ["Saheeli"], seatKindOf: (id: string) => (id === "p1" ? ("human" as const) : ("agent" as const)), now: () => "2026-11-22T10:00:00.000Z" };

  it("maps card, clause, capability, engine kernel, turn, phase and seat", () => {
    const ev = unres(events())[0];
    const rec = unresolvedEventToRecord(ev, ctx)!;
    expect(rec).toMatchObject({ cardName: "Odd Spell", clause: "Gain 2 life. Goad everything.", capability: "step:goad_everything", engine: "kernel", turn: 1, phase: "precombat_main", seat: "p1", seatKind: "human", gameId: "g1", decks: ["Saheeli"], abilityKind: "spell_effect", effect: "skipped", at: "2026-11-22T10:00:00.000Z" });
  });
  it("the record is valid for the shared sink validator (round trip)", () => {
    const rec = unresolvedEventToRecord(unres(events())[0], ctx)!;
    expect(validateUnresolvedPayload(JSON.parse(JSON.stringify(rec)))).toEqual(rec);
  });
  it("ignores events that are not unresolved, and redacted ones", () => {
    expect(unresolvedEventToRecord({ type: "draw", seq: 0 } as GameEvent, ctx)).toBeUndefined();
    expect(unresolvedEventToRecord({ type: "unresolved", seq: 0, hidden: true, message: "x" } as GameEvent, ctx)).toBeUndefined();
  });
  it("rejects malformed events instead of throwing", () => {
    expect(unresolvedEventToRecord({ type: "unresolved", seq: 0 } as GameEvent, ctx)).toBeUndefined();
    expect(unresolvedEventToRecord({ type: "unresolved", seq: 0, card: "X", clause: "y", turn: -4, phase: "main" } as GameEvent, ctx)).toBeUndefined();
    expect(unresolvedEventToRecord(null as never, ctx)).toBeUndefined();
  });
  it("falls back to the log sentence when the event has no clause", () => {
    const rec = unresolvedEventToRecord({ type: "unresolved", seq: 0, card: "X", clause: "", message: "X: step foo not supported", abilityKind: "engine", capability: "step:foo", turn: 2, phase: "upkeep", player: "p2" } as GameEvent, ctx)!;
    expect(rec.clause).toBe("X: step foo not supported");
    expect(rec.seatKind).toBe("agent");
  });
  it("defaults to agent seats, and truncates oversize / control characters like every sink record", () => {
    const rec = unresolvedEventToRecord({ type: "unresolved", seq: 0, card: "X", clause: `a\nb${"c".repeat(900)}`, abilityKind: "static", capability: "static:x", turn: 1, phase: "main", player: "p1" } as GameEvent, { gameId: "g" })!;
    expect(rec.clause.startsWith("a b")).toBe(true);
    expect(rec.clause.length).toBe(600);
    expect(rec.seatKind).toBe("agent");
  });
  it("dedupes per game + card + clause + capability", () => {
    const ev = unres(events())[0];
    expect(unresolvedRecordsOf([ev, ev, { ...ev, capability: "step:other", capabilities: ["step:other"] }], ctx)).toHaveLength(2);
  });
  it("the stateful bridge sends each record once per game and survives a throwing sink", () => {
    const got: string[] = [];
    const bridge = new UnresolvedBridge(ctx, (r) => { got.push(r.cardName); });
    const evs = events();
    expect(bridge.push(evs)).toHaveLength(1);
    expect(bridge.push(evs)).toHaveLength(0);
    expect(got).toEqual(["Odd Spell"]);
    const boom = new UnresolvedBridge(ctx, () => { throw new Error("disk full"); });
    expect(() => boom.push(evs)).not.toThrow();
  });
  it("kernel records and legacy records merge into one report with an engine column", () => {
    const kernel = unresolvedEventToRecord(unres(events())[0], ctx)!;
    const legacy = validateUnresolvedPayload({ cardName: "Odd Spell", clause: "Gain 2 life. Goad everything.", abilityKind: "spell", engine: "legacy", decks: ["Meren"], turn: 3, phase: "main", seatKind: "agent", gameId: "g2" })!;
    const other = validateUnresolvedPayload({ cardName: "Swan Song", clause: "Counter it.", abilityKind: "spell", engine: "legacy", decks: [], turn: 3, phase: "main", seatKind: "agent", gameId: "g2" })!;
    const text = [kernel, legacy, other].map((r) => JSON.stringify(r)).join("\n");
    const rows = aggregateUnresolved(parseUnresolvedJsonl(text), () => "unknown");
    expect(rows).toHaveLength(3); // the kernel row keeps its capability, so it stays apart from the legacy row of the same clause
    expect(rows.flatMap((r) => r.engines).sort()).toEqual(["kernel", "legacy", "legacy"]);
    const md = renderUnresolvedMarkdown(rows);
    expect(md).toContain("| engine |");
    expect(md).toContain("kernel");
    expect(md).toContain("legacy");
    expect(md).toContain("step:goad_everything");
  });
  it("a legacy record without capability still aggregates and renders (older files)", () => {
    const rows = aggregateUnresolved(parseUnresolvedJsonl(JSON.stringify({ cardName: "A", clause: "c", engine: "legacy", at: "2026-01-01T00:00:00.000Z", decks: [] })), () => "no");
    expect(rows[0]).toMatchObject({ engines: ["legacy"], capabilities: [] });
  });
  it("the sink deduper treats a different capability as a different record", () => {
    const d = new UnresolvedDeduper();
    const base = { gameId: "g", cardName: "A", clause: "x" };
    expect(d.admit({ ...base, capability: "step:a" })).toBe(true);
    expect(d.admit({ ...base, capability: "step:a" })).toBe(false);
    expect(d.admit({ ...base, capability: "step:b" })).toBe(true);
    expect(d.admit(base)).toBe(true);
  });
  it("validateUnresolvedPayload keeps capability / seat / effect and drops an invalid effect", () => {
    const rec = validateUnresolvedPayload({ cardName: "A", clause: "c", abilityKind: "static", engine: "kernel", turn: 1, phase: "main", seatKind: "agent", gameId: "g", capability: "static:x", seat: "p2", effect: "ignored" })!;
    expect(rec).toMatchObject({ capability: "static:x", seat: "p2", effect: "ignored" });
    expect(validateUnresolvedPayload({ cardName: "A", clause: "c", abilityKind: "static", engine: "kernel", turn: 1, phase: "main", seatKind: "agent", gameId: "g", effect: "exploded" })).not.toHaveProperty("effect");
  });
});

describe("continue mode vs strict mode", () => {
  it("strict stays the default: an unsupported cast is a refusal and emits no unresolved event", () => {
    const t = table(["p1", "p2"], { extra: { "Odd Spell": oddSpell } });
    t.lands("p1", "Island", 2);
    const id = t.give("p1", "Odd Spell", "hand");
    const res = t.do({ type: "castSpell", player: "p1", cardId: id });
    expect(res.error?.code).toBe("unsupported");
    expect(res.events).toHaveLength(0);
  });
  it("explicit onUnsupported 'error' behaves like the default", () => {
    const t = table(["p1", "p2"], { extra: { "Odd Spell": oddSpell }, config: { onUnsupported: "error" } });
    t.lands("p1", "Island", 2);
    const id = t.give("p1", "Odd Spell", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: id }).error?.code).toBe("unsupported");
  });
  it("strict mode: a land with an unsupported static is refused to be played; continue mode plays it and reports once", () => {
    const land = (n: string): CardDef => ({ name: n, types: ["land"], kernel: generatePrompts({ schemaVersion: 2, abilities: [{ id: "a1", kind: "static", text: "Odd land.", static: { affects: "self", modify: [{ teleport: true }] } }] } as never, n) });
    const strict = table(["p1", "p2"], { extra: { "Odd Land": land("Odd Land") } });
    const s1 = strict.give("p1", "Odd Land", "hand");
    expect(strict.do({ type: "playLand", player: "p1", cardId: s1 }).error?.code).toBe("unsupported");
    const cont = table(["p1", "p2"], { extra: { "Odd Land": land("Odd Land") }, config: CONT });
    const c1 = cont.give("p1", "Odd Land", "hand");
    const res = cont.ok({ type: "playLand", player: "p1", cardId: c1 });
    expect(cont.obj(c1).zone).toBe("battlefield");
    expect(unres(res.events)).toHaveLength(1);
  });
  it("a delayed trigger created by a supported step but with an unsupported step inside is skipped when it fires", () => {
    const c = spell("Delayed Odd", [{ kind: "create_delayed_trigger", at: { event: "begin_step", step: "end_step", next: true }, steps: [{ kind: "goad_everything", target: "self" }, { kind: "life_change", lifeDelta: 6, who: "you" }] }]);
    const t = setup([c]);
    const life = t.p("p1").life;
    castAndResolve(t, "Delayed Odd");
    const evs: GameEvent[] = [];
    for (let i = 0; i < 12 && t.p("p1").life === life; i++) {
      const r = t.ok({ type: "advancePhase", player: t.state.priority ?? "p1" });
      evs.push(...r.events);
      while (t.state.stack.length) evs.push(...t.resolveTop().events);
    }
    expect(unres(evs).map((e) => e.capability)).toContain("step:goad_everything");
    expect(t.p("p1").life).toBe(life + 6);
  });
  it("an enchantment whose only ability is a cast-time static (zone stack) is reported when cast, once", () => {
    const c = perm("Stack Odd", [{ kind: "static", text: "Stack Odd can't be teleported.", zone: "stack", static: { affects: "self", modify: [{ teleport: true }] } }]);
    const t = setup([c]);
    const { events } = castAndResolve(t, "Stack Odd");
    expect(unres(events)).toHaveLength(1);
  });
  it("a hybrid situation: unsupported static AND an unsupported ETB step: both reported, both distinct capabilities", () => {
    const c = perm("Both Odd", [
      { kind: "static", text: "Odd static.", static: { affects: "self", modify: [{ teleport: true }] } },
      { kind: "triggered", text: "When this enters, goad everything.", trigger: { event: "etb", subject: "self" }, steps: [{ kind: "goad_everything", target: "self" }] }
    ]);
    const t = setup([c]);
    const { events } = castAndResolve(t, "Both Odd");
    expect(unres(events).map((e) => e.capability).sort()).toEqual(["static:teleport", "step:goad_everything"]);
  });
});

/** answers every decision with its first `min` options (numbers: the minimum), so a spell can run to the end */
function drain(t: ReturnType<typeof table>, first: ResolveResult): GameEvent[] {
  const evs = [...first.events];
  let res = first;
  for (let i = 0; i < 40; i++) {
    if (res.pending) {
      const p = res.pending;
      res = t.do({ type: "answerDecision", player: p.player, decisionId: p.id, choice: p.numeric ? { number: p.min } : p.kind === "choose_yes_no" ? { yes: false } : p.kind === "choose_targets" || p.kind === "cast_target_player" ? { ids: p.options.slice(0, Math.max(p.min, 1)).map((o) => o.id) } : { ids: p.options.slice(0, p.min).map((o) => o.id) } });
      if (res.error) break;
      evs.push(...res.events);
      continue;
    }
    if (!t.state.stack.length) break;
    res = t.do({ type: "passPriority", player: t.state.priority! });
    if (res.error) break;
    evs.push(...res.events);
  }
  return evs;
}

describe("real drafted cards never make continue mode refuse or crash", () => {
  const files = allDraftFiles().sort();
  const cards: CardDef[] = [];
  for (const f of files) {
    const slug = path.basename(f, ".json");
    try {
      const kernel = loadDraft(slug);
      const nonPerm = kernel.abilities.some((a) => a.kind === "spell_effect");
      const def: CardDef = { name: slug, manaCost: "{1}", types: nonPerm ? ["instant"] : ["artifact"], kernel };
      if (!cardUnsupported(def).ok) cards.push(def);
    } catch { /* an invalid draft is not this test's business */ }
  }
  const sample = cards.filter((_, i) => i % Math.max(1, Math.floor(cards.length / 120)) === 0).slice(0, 120);

  it("sampled at least 20 real cards that the strict engine would refuse", () => {
    expect(sample.length).toBeGreaterThanOrEqual(20);
  });
  it("casting each of them and letting it resolve gives no error code 'unsupported' and no exception", () => {
    let reported = 0;
    for (const def of sample) {
      const t = table(["p1", "p2"], { extra: { [def.name]: def }, config: CONT });
      t.lands("p1", "Island", 3);
      t.give("p2", "Island", "battlefield"); t.give("p2", "Island", "library"); t.give("p1", "Island", "library");
      const id = t.give("p1", def.name, "hand");
      const first = t.do({ type: "castSpell", player: "p1", cardId: id });
      expect(first.error?.code, def.name).not.toBe("unsupported");
      if (first.error) continue;
      const evs = drain(t, first);
      expect(evs.some((e) => e.type === "unresolved" && !(e as GameEvent & { message?: string }).message), def.name).toBe(false);
      reported += unres(evs).length;
    }
    expect(reported).toBeGreaterThan(20);
  });
  it("the same sample in strict mode really is refused (continue mode is what makes the difference)", () => {
    let refused = 0;
    for (const def of sample.slice(0, 40)) {
      const t = table(["p1", "p2"], { extra: { [def.name]: def } });
      t.lands("p1", "Island", 3);
      const id = t.give("p1", def.name, "hand");
      if (t.do({ type: "castSpell", player: "p1", cardId: id }).error?.code === "unsupported") refused++;
    }
    expect(refused).toBeGreaterThan(30);
  });
});
