import { describe, expect, it } from "vitest";
import { buildCatalog, lookupCard } from "./cardCatalog";
import { scoreLegalActions, type CardLike, type ScorableAction, type ScoringContext } from "./actionScoring";
import { evaluatePlayGuards, situationalTimingGuard } from "./playGuards";
import type { CardRecord } from "./types";

function record(name: string, typeLine: string, manaValue: number, oracleText: string): CardRecord {
  return { id: `test-${name}`, name, typeLine, oracleText, manaValue, colors: [], colorIdentity: [] };
}
const catalog = buildCatalog(
  [
    record("Arachnogenesis", "Instant", 3, "Create X 1/2 green Spider creature tokens with reach, where X is the number of creatures attacking you. Prevent all combat damage that would be dealt this turn by non-Spider creatures."),
    record("Fog", "Instant", 1, "Prevent all combat damage that would be dealt this turn."),
    record("Giant Growth", "Instant", 1, "Target creature gets +3/+3 until end of turn."),
    record("Settle the Wreckage", "Instant", 4, "Exile all attacking creatures target player controls. That player may search their library for that many basic lands, put those cards onto the battlefield tapped, then shuffle."),
    record("Grizzly Bears", "Creature — Bear", 2, ""),
    record("Grave Titan", "Creature — Giant", 6, "Deathtouch\nWhenever this creature enters or attacks, create two 2/2 black Zombie creature tokens."),
    record("Overrun", "Sorcery", 5, "Creatures you control get +3/+3 and gain trample until end of turn.")
  ],
  undefined,
  "builtin"
);
const card = (name: string) => lookupCard(catalog, name)!;

let nextId = 0;
function perm(name: string, power: string, toughness: number, extra: Partial<CardLike> = {}): CardLike {
  const rec = card(name);
  nextId += 1;
  return { id: `${name}#${nextId}`, name, typeLine: rec.typeLine, oracleText: rec.oracleText, manaValue: rec.manaValue, power, toughness: String(toughness), ...extra };
}
function castAction(name: string): ScorableAction {
  const rec = card(name);
  return { id: `cast:hand-${name}`, actionType: "cast_spell", cardId: `hand-${name}`, targetIds: [], label: `cast ${name}`, detail: `{1} ${rec.typeLine}. ${rec.oracleText} Payable with 1 land.` };
}
function ctx(overrides: Partial<ScoringContext> & { mine?: CardLike[]; theirs?: CardLike[]; life?: number; oppLife?: number } = {}): ScoringContext {
  const { mine = [], theirs = [], life = 40, oppLife = 40, ...rest } = overrides;
  return {
    purpose: "main_phase",
    turn: 6,
    phase: "precombat main phase",
    you: { id: "me", life, battlefield: mine, hand: [] },
    opponents: [{ id: "opp", life: oppLife, battlefield: theirs }],
    ...rest
  };
}
const attackers = (n: number) => Array.from({ length: n }, () => perm("Grave Titan", "6", 6, { attacking: true, attackTargetId: "me" }));

describe("situational timing guard", () => {
  it("vetoes Arachnogenesis in the caster's own precombat main phase (the observed Malik play)", () => {
    const context = ctx({ mine: [perm("Grizzly Bears", "2", 2)] });
    expect(situationalTimingGuard(castAction("Arachnogenesis"), context).allowed).toBe(false);
    expect(evaluatePlayGuards(castAction("Arachnogenesis"), context).vetoed).toBe(true);
    const scored = scoreLegalActions([castAction("Arachnogenesis"), { id: "pass", actionType: "pass_priority", targetIds: [], label: "pass" }], context);
    expect(scored[0].id).toBe("pass");
  });

  it("allows Arachnogenesis in the declare attackers step when 3 creatures attack the caster", () => {
    const context = ctx({ phase: "declare attackers step", purpose: "priority_response", theirs: attackers(3) });
    expect(situationalTimingGuard(castAction("Arachnogenesis"), context).allowed).toBe(true);
    const scored = scoreLegalActions([castAction("Arachnogenesis"), { id: "pass", actionType: "pass_priority", targetIds: [], label: "pass" }], context);
    expect(scored[0].id).toBe("cast:hand-Arachnogenesis");
  });

  it("vetoes Fog during combat when the attackers are aimed at another player", () => {
    const aimedElsewhere = ctx({ phase: "declare attackers step", theirs: [perm("Grave Titan", "6", 6, { attacking: true, attackTargetId: "someone-else" })] });
    expect(situationalTimingGuard(castAction("Fog"), aimedElsewhere).allowed).toBe(false);
  });

  it("vetoes Fog on an empty combat and allows it against a real attack", () => {
    expect(situationalTimingGuard(castAction("Fog"), ctx({ phase: "declare attackers step" })).allowed).toBe(false);
    expect(situationalTimingGuard(castAction("Fog"), ctx({ phase: "declare blockers step", theirs: attackers(1) })).allowed).toBe(true);
  });

  it("vetoes Fog against a trivial 1-power attacker", () => {
    const pinger = perm("Grizzly Bears", "1", 1, { attacking: true, attackTargetId: "me" });
    expect(situationalTimingGuard(castAction("Fog"), ctx({ phase: "declare attackers step", theirs: [pinger] })).allowed).toBe(false);
  });

  it("vetoes a pump trick in the main phase and on an empty combat", () => {
    const bears = perm("Grizzly Bears", "2", 2);
    expect(situationalTimingGuard(castAction("Giant Growth"), ctx({ mine: [bears] })).allowed).toBe(false);
    expect(situationalTimingGuard(castAction("Giant Growth"), ctx({ phase: "declare attackers step", mine: [{ ...bears, attacking: true }] })).allowed).toBe(false);
  });

  it("allows a pump trick that saves a blocking creature or kills an attacker", () => {
    const blocker = perm("Grizzly Bears", "2", 2, { blocking: true });
    const attacker = perm("Grizzly Bears", "3", 3, { attacking: true, attackTargetId: "me" });
    const context = ctx({ phase: "declare blockers step", purpose: "priority_response", mine: [blocker], theirs: [attacker] });
    expect(situationalTimingGuard(castAction("Giant Growth"), context).allowed).toBe(true);
  });

  it("vetoes a pump that cannot change a combat the creature already wins", () => {
    const blocker = perm("Grizzly Bears", "4", 4, { blocking: true });
    const attacker = perm("Grizzly Bears", "2", 2, { attacking: true, attackTargetId: "me" });
    const context = ctx({ phase: "declare blockers step", mine: [blocker], theirs: [attacker] });
    expect(situationalTimingGuard(castAction("Giant Growth"), context).allowed).toBe(false);
  });

  it("allows a sorcery-speed mass pump precombat only with an obvious lethal attack", () => {
    const team = [perm("Grave Titan", "6", 6), perm("Grave Titan", "6", 6)];
    expect(situationalTimingGuard(castAction("Overrun"), ctx({ mine: team, oppLife: 10 })).allowed).toBe(true);
    expect(situationalTimingGuard(castAction("Overrun"), ctx({ mine: team, oppLife: 40 })).allowed).toBe(false);
  });

  it("vetoes Settle the Wreckage with nothing attacking and allows it against a real attack", () => {
    expect(situationalTimingGuard(castAction("Settle the Wreckage"), ctx({ mine: [perm("Grizzly Bears", "2", 2)] })).allowed).toBe(false);
    expect(situationalTimingGuard(castAction("Settle the Wreckage"), ctx({ phase: "declare attackers step", theirs: attackers(3) })).allowed).toBe(true);
  });

  it("generic fallback: 'attacking creature' text with no attackers is held, but permanents and creature spells are untouched", () => {
    const custom: ScorableAction = { id: "c", actionType: "cast_spell", targetIds: [], label: "cast Smite", detail: "{W} Instant. Destroy target attacking creature. Payable with 1 land." };
    expect(situationalTimingGuard(custom, ctx({ theirs: [perm("Grizzly Bears", "2", 2)] })).allowed).toBe(false);
    const permanent: ScorableAction = { ...custom, detail: "{2}{W} Enchantment. Attacking creatures you control get +1/+0. Payable with 1 land." };
    expect(situationalTimingGuard(permanent, ctx()).allowed).toBe(true);
    expect(situationalTimingGuard(castAction("Grizzly Bears"), ctx()).allowed).toBe(true);
  });
});
