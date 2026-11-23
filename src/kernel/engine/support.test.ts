import { describe, expect, it } from "vitest";
import { generatePrompts } from "../prompts";
import { cardUnsupported } from "./support";
import { SUPPORTED_ENGINE_STEP_KINDS } from "./steps";
import { allDraftFiles, loadDraft, table } from "./testkit";
import type { CardDef } from "./types";
import fs from "node:fs";

const oddCard = (name: string, manaCost: string, step: Record<string, unknown>, extra: Record<string, unknown> = {}): CardDef => ({
  name, manaCost, types: ["instant"],
  kernel: generatePrompts({ schemaVersion: 2, abilities: [{ id: "a1", kind: "spell_effect", text: name, steps: [step as never], ...extra }] } as never, name)
});

describe("unsupported capabilities are errors, never silent skips", () => {
  it("a card with a step the engine lacks (step:goad_everything) is refused with the missing capability named", () => {
    const odd = oddCard("Odd Copier", "{U}", { kind: "goad_everything", target: "self" });
    const t = table(["p1", "p2"], { extra: { "Odd Copier": odd } });
    t.give("p1", "Island", "battlefield");
    const bs = t.give("p1", "Odd Copier", "hand");
    const res = t.do({ type: "castSpell", player: "p1", cardId: bs });
    expect(res.error?.code).toBe("unsupported");
    expect(res.error?.capability).toContain("step:goad_everything");
    expect(res.error?.message).toContain("Odd Copier");
    expect(t.obj(bs).zone).toBe("hand");
  });

  it("an unknown field on a step is named (one unsupported step blocks the whole card)", () => {
    const odd = oddCard("Odd Token", "{G}", { kind: "create_tokens", tokenCount: 1, tokenName: "Squirrel", target: "t1", bogusField: 1 } as never);
    const t = table(["p1", "p2"], { extra: { "Odd Token": odd } });
    t.give("p1", "Forest", "battlefield");
    const res = t.do({ type: "castSpell", player: "p1", cardId: t.give("p1", "Odd Token", "hand") });
    expect(res.error?.code).toBe("unsupported");
    expect(res.error?.capability).toContain("field:create_tokens.bogusField");
  });

  it("a replacement-effect land (Spymaster's Vault: enters tapped unless you control a Swamp) now runs through the replacement pipeline", () => {
    const t = table();
    const v = t.give("p1", "Spymaster's Vault", "hand");
    t.ok({ type: "playLand", player: "p1", cardId: v });
    expect(t.obj(v).tapped).toBe(true);
    const t2 = table();
    t2.give("p2", "Swamp", "battlefield"); // an opponent's Swamp does not count
    t2.give("p1", "Swamp", "battlefield");
    const v2 = t2.give("p1", "Spymaster's Vault", "hand");
    t2.ok({ type: "playLand", player: "p1", cardId: v2 });
    expect(t2.obj(v2).tapped).toBe(false);
  });

  it("an unknown field on a supported step kind is reported as field:<kind>.<field>", () => {
    const odd = oddCard("Odd Draw", "{U}", { kind: "draw_cards", amount: 1, who: "you", upTo: true });
    const t = table(["p1", "p2"], { extra: { "Odd Draw": odd } });
    t.give("p1", "Island", "battlefield");
    const id = t.give("p1", "Odd Draw", "hand");
    const res = t.do({ type: "castSpell", player: "p1", cardId: id });
    expect(res.error?.capability).toContain("field:draw_cards.upTo");
  });

  it("an unsupported predicate inside a step condition is named", () => {
    const odd = oddCard("Odd Cond", "{U}", { kind: "draw_cards", amount: 1, who: "you", condition: { when: "on_resolution", if: { check: "bogus_check", cmp: { op: ">=", value: 2 } } } as never });
    const t = table(["p1", "p2"], { extra: { "Odd Cond": odd } });
    t.give("p1", "Island", "battlefield");
    const id = t.give("p1", "Odd Cond", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: id }).error?.capability).toContain("predicate:bogus_check");
  });

  it("an unsupported step kind is named and nothing resolves", () => {
    const odd = oddCard("Odd Fight", "{U}", { kind: "fight", target: "self" });
    const t = table(["p1", "p2"], { extra: { "Odd Fight": odd } });
    t.give("p1", "Island", "battlefield");
    const id = t.give("p1", "Odd Fight", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: id }).error?.capability).toEqual(["step:fight"]);
  });

  it("a cast option the engine lacks (overload etc.) is unsupported rather than ignored", () => {
    const base = oddCard("Odd Kicker", "{U}", { kind: "draw_cards", amount: 1, who: "you" });
    base.kernel = { ...base.kernel, castOptions: [{ id: "k", kind: "overload", from: "hand", cost: [{ mana: "{1}" }], replacesManaCost: true, optional: true }] };
    const t = table(["p1", "p2"], { extra: { "Odd Kicker": base } });
    t.give("p1", "Island", "battlefield");
    const id = t.give("p1", "Odd Kicker", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: id }).error?.capability).toContain("cast_option:overload");
  });

  it("an unsupported mana symbol is an unsupported-cost error (hybrid symbols are supported since step 6)", () => {
    const odd = oddCard("Odd Symbol", "{Q}", { kind: "draw_cards", amount: 1, who: "you" });
    const t = table(["p1", "p2"], { extra: { "Odd Symbol": odd } });
    t.give("p1", "Island", "battlefield");
    const id = t.give("p1", "Odd Symbol", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: id }).error?.code).toBe("unsupported");
  });

  it("an unknown card name is reported, not guessed", () => {
    const t = table();
    const id = t.give("p1", "Island", "hand");
    t.state = { ...t.state, objects: { ...t.state.objects, [id]: { ...t.obj(id), cardName: "Nope" } } };
    expect(t.do({ type: "castSpell", player: "p1", cardId: id }).error?.code).toBe("unknown_card");
  });

  it("static vocabulary without an implementation (players can't gain life) still returns unsupported with the detail", () => {
    const odd: CardDef = { name: "Odd Static", manaCost: "{1}", types: ["artifact"], kernel: { schemaVersion: 2, abilities: [{ id: "a1", kind: "static", text: "Your opponents can't gain life.", static: { affects: "each_opponent", modify: [{ cant: "gain_life" }] } }] } };
    const t = table(["p1", "p2"], { extra: { "Odd Static": odd } });
    t.give("p1", "Island", "battlefield");
    t.give("p1", "Island", "battlefield");
    const id = t.give("p1", "Odd Static", "hand");
    expect(t.do({ type: "castSpell", player: "p1", cardId: id }).error?.capability).toContain("static:cant:gain_life");
  });

  it("an unsupported ability that is not the one being activated does not block the activation", () => {
    const t = table();
    const tome = t.give("p1", "Mazemind Tome", "battlefield");
    t.give("p1", "Plains", "library");
    expect(t.do({ type: "activateAbility", player: "p1", sourceId: tome, abilityId: "a1" }).error).toBeUndefined();
  });
});

describe("loop guard", () => {
  it("a mandatory infinite trigger loop is cut off: error loop_detected and the game is a draw, not a hang", () => {
    const t = table(["p1", "p2"], { config: { maxEventsPerPass: 400 } });
    t.lands("p1", "Plains", 2);
    const f = t.give("p1", "Soldier Factory", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: f });
    t.pass("p1");
    const res = t.do({ type: "passPriority", player: "p2", fastForward: true });
    expect(res.error?.code).toBe("loop_detected");
    expect(res.state.gameOver?.draw).toBe(true);
    expect(res.state.gameOver?.reason).toMatch(/loop/);
    expect(res.state.priority).toBeNull();
  });

  it("the same card without fast-forward advances one resolution per pass round (bounded)", () => {
    const t = table(["p1", "p2"]);
    t.lands("p1", "Plains", 2);
    const f = t.give("p1", "Soldier Factory", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: f });
    t.pass("p1", "p2"); // factory resolves, its own trigger goes on the stack
    for (let i = 1; i <= 5; i++) {
      expect(t.state.stack).toHaveLength(1);
      t.pass("p1", "p2");
      expect(t.state.battlefield.filter((id) => t.obj(id).token)).toHaveLength(i);
    }
  });

  it("a finite chain with fast-forward resolves the whole stack in one action", () => {
    const t = table(["p1", "p2"]);
    t.lands("p1", "Mountain", 3);
    const b1 = t.give("p1", "Lightning Bolt", "hand"), b2 = t.give("p1", "Lightning Bolt", "hand"), b3 = t.give("p1", "Lightning Bolt", "hand");
    for (const b of [b1, b2, b3]) t.ok({ type: "castSpell", player: "p1", cardId: b, targets: { t1: ["p2"] } });
    t.pass("p1");
    const res = t.do({ type: "passPriority", player: "p2", fastForward: true });
    expect(res.error).toBeUndefined();
    expect(t.state.stack).toHaveLength(0);
    expect(t.p("p2").life).toBe(31);
  });

  it("fast-forward stops at a pending decision", () => {
    const t = table(["p1", "p2"]);
    t.lands("p1", "Swamp", 3);
    const rot = t.give("p1", "Mind Rot", "hand");
    for (let i = 0; i < 4; i++) t.give("p2", "Island", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: rot, targets: { t1: ["p2"] } });
    t.pass("p1");
    const res = t.do({ type: "passPriority", player: "p2", fastForward: true });
    expect(res.pending?.kind).toBe("choose_cards");
  });
});

describe("engine support analysis over every drafted card", () => {
  const files = allDraftFiles();

  it("analyses every draft without throwing", () => {
    expect(files.length).toBeGreaterThan(500);
    for (const f of files) {
      const raw = JSON.parse(fs.readFileSync(f, "utf8"));
      if (!raw.abilities) continue;
      expect(() => cardUnsupported({ name: f, types: [], kernel: raw })).not.toThrow();
    }
  });

  it("a meaningful share of the drafts is fully supported", () => {
    let ok = 0, total = 0;
    for (const f of files) {
      const raw = JSON.parse(fs.readFileSync(f, "utf8"));
      if (!raw.abilities) continue;
      total++;
      if (cardUnsupported({ name: f, types: [], kernel: raw }).ok) ok++;
    }
    expect(ok / total).toBeGreaterThan(0.2);
  });

  it("the cards the engine tests rely on are fully supported (except the deliberate refusals)", () => {
    for (const slug of ["lightning-bolt", "sol-ring", "arcane-signet", "valorous-stance", "casualties-of-war", "ledger-shredder", "counterspell", "negate", "swords-to-plowshares", "mind-stone", "ravenous-chupacabra", "midnight-reaper", "plaguecrafter", "llanowar-elves"]) {
      const s = cardUnsupported({ name: slug, types: [], kernel: loadDraft(slug) });
      expect(s.all, slug).toEqual([]);
    }
  });

  it("every step kind the engine implements is one of the schema's step kinds", async () => {
    const { STEP_KINDS } = await import("../schema");
    for (const k of SUPPORTED_ENGINE_STEP_KINDS) expect((STEP_KINDS as readonly string[]).includes(k), k).toBe(true);
    expect(SUPPORTED_ENGINE_STEP_KINDS.size).toBeGreaterThanOrEqual(24);
  });
});
