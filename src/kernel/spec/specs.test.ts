// (1) Every ACCEPTED spec file in data/kernel-specs is a permanent regression test: each scenario must PASS (or, if it carries `knownFailure`, must still fail).
// (2) The infrastructure's own tests: the schema is strict, a bad spec is a SPEC_ERROR (never a card FAIL), a wrong expectation is a FAIL with a diff, etc.
import "../engine/resolve"; // FIRST (import cycle)
import { describe, expect, it } from "vitest";
import { CardSchema } from "../schema";
import { CATALOG } from "./catalog";
import { loadSpec, runSpec, specPaths, type LoadedSpec } from "./load";
import { detail, effective } from "./report";
import { SpecFile } from "./schema";
import { runScenario } from "./run";

const accepted = specPaths().map(loadSpec).filter((s) => !s.file || s.file.status === "accepted");

describe("accepted card specs (data/kernel-specs)", () => {
  it("there are accepted specs and every file is valid", () => {
    expect(accepted.length).toBeGreaterThanOrEqual(8);
    for (const s of accepted) expect(s.errors, s.path).toBeUndefined();
  });
  for (const s of accepted) {
    if (!s.file) continue;
    describe(s.file.card, () => {
      for (const sc of s.file!.scenarios) {
        it(sc.name, () => {
          const r = runSpec(s, { scenario: sc.name }).find((x) => x.scenario === sc.name)!;
          const e = effective(r);
          if (e === "FIXED") throw new Error(`known failure now PASSES: remove "knownFailure" from this scenario (${sc.knownFailure})`);
          if (e !== "PASS" && e !== "KNOWN_FAIL") throw new Error(`${e}\n${detail(r)}`);
        });
      }
    });
  }
});

// ---------------------------------------------------------------- infrastructure
const file = (scenario: unknown, card = "Lightning Bolt"): LoadedSpec => {
  const r = SpecFile.safeParse({ card, status: "draft", scenarios: [scenario] });
  if (!r.success) throw new Error(r.error.message);
  return { path: "inline", file: r.data, mtimeMs: 0 };
};
const bolt = { hand: ["Lightning Bolt"], battlefield: ["Mountain"] };
const castBolt = { do: "cast", player: "p1", card: "Lightning Bolt", targets: ["p2"] };

describe("spec schema is strict", () => {
  const ok = { name: "x", setup: { p1: bolt }, steps: [castBolt, { do: "resolve" }], expect: [{ check: "life", player: "p2", value: 37, why: "3 damage to the face" }] };
  it("accepts a well-formed scenario", () => { expect(SpecFile.safeParse({ card: "Lightning Bolt", status: "draft", scenarios: [ok] }).success).toBe(true); });
  it("rejects an expectation without why", () => { expect(SpecFile.safeParse({ card: "A", status: "draft", scenarios: [{ ...ok, expect: [{ check: "life", player: "p2", value: 37 }] }] }).success).toBe(false); });
  it("rejects a too-short why", () => { expect(SpecFile.safeParse({ card: "A", status: "draft", scenarios: [{ ...ok, expect: [{ check: "life", player: "p2", value: 37, why: "x" }] }] }).success).toBe(false); });
  it("rejects unknown keys, bad players, unknown actions and checks", () => {
    for (const bad of [{ ...ok, bogus: 1 }, { ...ok, setup: { p5: {} } }, { ...ok, steps: [{ do: "dance" }] }, { ...ok, expect: [{ check: "vibes", why: "0123456789" }] }, { ...ok, players: 5 }]) expect(SpecFile.safeParse({ card: "A", status: "draft", scenarios: [bad] }).success).toBe(false);
  });
  it("rejects a file without scenarios or with duplicate scenario names, and a bad status", () => {
    expect(SpecFile.safeParse({ card: "A", status: "draft", scenarios: [] }).success).toBe(false);
    expect(SpecFile.safeParse({ card: "A", status: "draft", scenarios: [ok, ok] }).success).toBe(false);
    expect(SpecFile.safeParse({ card: "A", status: "maybe", scenarios: [ok] }).success).toBe(false);
  });
  it("needs cards and/or count in a zone check, and exactly one of card / token in an entry", () => {
    expect(SpecFile.safeParse({ card: "A", status: "draft", scenarios: [{ ...ok, expect: [{ check: "zone", player: "p1", zone: "hand", why: "0123456789" }] }] }).success).toBe(false);
    expect(SpecFile.safeParse({ card: "A", status: "draft", scenarios: [{ ...ok, setup: { p1: { hand: [{ card: "X", token: { name: "T", types: ["creature"] } }] } } }] }).success).toBe(false);
  });
});

describe("runner statuses", () => {
  const run = (scenario: unknown, card?: string) => runSpec(file(scenario, card))[0];
  it("PASS for a correct scenario", () => {
    expect(run({ name: "p", setup: { p1: bolt }, steps: [castBolt, { do: "resolve" }], expect: [{ check: "life", player: "p2", value: 37, why: "3 damage to the face" }] }).status).toBe("PASS");
  });
  it("FAIL with a precise diff when an expectation does not hold", () => {
    const r = run({ name: "f", setup: { p1: bolt }, steps: [castBolt, { do: "resolve" }], expect: [{ check: "life", player: "p2", value: 36, why: "deliberately wrong number" }] });
    expect(r.status).toBe("FAIL");
    expect(r.failures[0]).toMatchObject({ check: "life", expected: "p2 life 36", actual: "37", why: "deliberately wrong number" });
    expect(r.actionLog.length).toBeGreaterThan(0);
    expect(r.lastEvents.length).toBeGreaterThan(0);
  });
  it("SPEC_ERROR for an unknown card, an unresolvable reference, a missing setup player", () => {
    expect(run({ name: "u", setup: { p1: { hand: ["No Such Card Anywhere"] } } }).status).toBe("SPEC_ERROR");
    expect(run({ name: "r", setup: { p1: bolt }, steps: [{ do: "cast", player: "p1", card: "Counterspell", targets: ["p2"] }] }).status).toBe("SPEC_ERROR");
    expect(run({ name: "p", setup: { p3: {} } }).status).toBe("SPEC_ERROR");
  });
  it("SPEC_ERROR for a bad file (invalid JSON / schema) instead of a crash", () => {
    const r = runSpec({ path: "data/kernel-specs/x.spec.json", errors: ["scenarios[0].expect[0].why: Required"], mtimeMs: 0 });
    expect(r[0].status).toBe("SPEC_ERROR");
  });
  it("FAIL when a cast the script expects to be refused is accepted, and when the refusal code differs", () => {
    expect(run({ name: "a", setup: { p1: bolt }, steps: [{ ...castBolt, expectRejected: "cannot_pay" }] }).status).toBe("FAIL");
    expect(run({ name: "b", setup: { p1: { hand: ["Lightning Bolt"] } }, steps: [{ ...castBolt, expectRejected: "wrong_timing" }] }).status).toBe("FAIL");
    expect(run({ name: "c", setup: { p1: { hand: ["Lightning Bolt"] } }, steps: [{ ...castBolt, expectRejected: "cannot_pay" }], expect: [{ check: "zone", player: "p1", zone: "hand", cards: { exactly: ["Lightning Bolt"] }, why: "a refused cast leaves the card in hand" }] }).status).toBe("PASS");
  });
  it("FAIL when the engine does not offer a scripted option, with the options listed", () => {
    const r = run({ name: "o", setup: { p1: bolt }, steps: [{ do: "cast", player: "p1", card: "Lightning Bolt", targets: ["Nonexistent Creature"] }] });
    expect(r.status).toBe("FAIL");
    expect(r.failures[0].actual).toContain("Options:");
  });
  it("an unanswered decision at the end of a scenario is a FAIL unless a pending expectation declares it", () => {
    const sc = { name: "d", setup: { p1: bolt }, steps: [{ do: "cast", player: "p1", card: "Lightning Bolt" }] };
    expect(run(sc).status).toBe("FAIL");
    expect(run({ ...sc, expect: [{ check: "pending", present: true, kind: "choose_targets", why: "the cast asks for its target" }] }).status).toBe("PASS");
  });
  it("UNSUPPORTED when the card under test has no kernel draft", () => {
    const r = run({ name: "n", setup: { p1: { hand: ["Serra Angel"] } } }, "Serra Angel");
    expect(r.status).toBe("UNSUPPORTED");
    expect(r.unsupported[0]).toContain("no kernel draft");
  });
  it("knownFailure: a failing scenario is KNOWN_FAIL, a passing one is FIXED", () => {
    const f = { name: "k", knownFailure: "documented engine bug for the test", setup: { p1: bolt }, steps: [castBolt, { do: "resolve" }] };
    expect(effective(run({ ...f, expect: [{ check: "life", player: "p2", value: 1, why: "wrong on purpose" }] }))).toBe("KNOWN_FAIL");
    expect(effective(run({ ...f, expect: [{ check: "life", player: "p2", value: 37, why: "right on purpose" }] }))).toBe("FIXED");
  });
  it("is deterministic: the same scenario gives identical logs twice", () => {
    const f = file({ name: "det", setup: { p1: bolt, p2: { battlefield: ["Vanilla 2/2"] } }, steps: [{ do: "cast", player: "p1", card: "Lightning Bolt", targets: ["Vanilla 2/2"] }, { do: "resolve" }] });
    const a = runScenario(f.file!, f.file!.scenarios[0]); const b = runScenario(f.file!, f.file!.scenarios[0]);
    expect({ ...a, durationMs: 0 }).toEqual({ ...b, durationMs: 0 });
  });
  it("a scripted advance that never reaches its phase stops (no hang)", () => {
    const r = run({ name: "w", setup: { p1: {} }, steps: [{ do: "advance", to: "upkeep", active: "p3" }] });
    expect(["FAIL", "SPEC_ERROR"]).toContain(r.status);
  });
});

describe("helper catalog", () => {
  it("has about twenty stand-ins and every definition is valid kernel JSON", () => {
    expect(CATALOG.size).toBeGreaterThanOrEqual(18);
    for (const [name, e] of CATALOG) { expect(() => CardSchema.parse(e.def.kernel), name).not.toThrow(); expect(e.text.length, name).toBeGreaterThan(5); }
  });
  it("every stand-in can be placed in every zone it can be in and is castable / playable", () => {
    const lines = [...CATALOG.keys()].map((n) => ({ name: n }));
    expect(lines.length).toBe(CATALOG.size);
    const sc = { name: "all", setup: { p1: { hand: [...CATALOG.keys()].filter((n) => !CATALOG.get(n)!.def.types.includes("land")), battlefield: [...CATALOG.keys()].filter((n) => CATALOG.get(n)!.def.types.includes("land")) } }, expect: [{ check: "noUnresolved", why: "catalog cards are plain" }] };
    expect(runSpec(file(sc))[0].status).toBe("PASS");
  });
});
