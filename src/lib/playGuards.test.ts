import { describe, expect, it } from "vitest";
import { buildCatalog, lookupCard } from "./cardCatalog";
import { fallbackAction, resolveGuardedChoice, scoreLegalActions, type CardLike, type ScorableAction, type ScoringContext } from "./actionScoring";
import { evaluatePlayGuards, isProtectionInstant, parseTargetedRemoval, protectionGuard, removalGuard, sacrificeGuard } from "./playGuards";
import type { CardRecord } from "./types";

// Real Oracle text, looked up through the same catalog helpers the app uses.
function record(name: string, typeLine: string, manaValue: number, oracleText: string): CardRecord {
  return { id: `test-${name}`, name, typeLine, oracleText, manaValue, colors: [], colorIdentity: [] };
}
const catalog = buildCatalog(
  [
    record("Viscera Seer", "Creature — Vampire Wizard", 1, "Sacrifice a creature: Scry 1. (Look at the top card of your library. You may put that card on the bottom.)"),
    record("Pacifism", "Enchantment — Aura", 2, "Enchant creature\nEnchanted creature can't attack or block."),
    record("Kenrith's Transformation", "Enchantment — Aura", 2, "Enchant creature\nWhen this Aura enters, draw a card.\nEnchanted creature loses all abilities and is a green Elk creature with base power and toughness 3/3. (It loses all other card types and creature types.)"),
    record("Swords to Plowshares", "Instant", 1, "Exile target creature. Its controller gains life equal to its power."),
    record("Murder", "Instant", 3, "Destroy target creature."),
    record("Lightning Bolt", "Instant", 1, "Lightning Bolt deals 3 damage to any target."),
    record("Counterspell", "Instant", 2, "Counter target spell."),
    record("Tamiyo's Safekeeping", "Instant", 1, "Target permanent you control gains hexproof and indestructible until end of turn. You gain 2 life. (A permanent with hexproof and indestructible can't be the target of spells or abilities your opponents control. Damage and effects that say \"destroy\" don't destroy it.)"),
    record("Heroic Intervention", "Instant", 2, "Permanents you control gain hexproof and indestructible until end of turn."),
    record("Swiftfoot Boots", "Artifact — Equipment", 2, "Equipped creature has hexproof and haste.\nEquip {1}"),
    record("Blood Artist", "Creature — Vampire", 2, "Whenever this creature or another creature dies, target player loses 1 life and you gain 1 life."),
    record("Grave Titan", "Creature — Giant", 6, "Deathtouch\nWhenever this creature enters or attacks, create two 2/2 black Zombie creature tokens."),
    record("Vampire Nighthawk", "Creature — Vampire Shaman", 3, "Flying\nDeathtouch\nLifelink"),
    record("Grizzly Bears", "Creature — Bear", 2, ""),
    record("Wrath of God", "Sorcery", 4, "Destroy all creatures. They can't be regenerated.")
  ],
  undefined,
  "builtin"
);
const card = (name: string) => lookupCard(catalog, name)!;

let nextId = 0;
function perm(name: string, power: string, toughness: number | string, extra: Partial<CardLike> = {}): CardLike {
  const rec = card(name);
  nextId += 1;
  return { id: `${name}#${nextId}`, name, typeLine: rec.typeLine, oracleText: rec.oracleText, manaValue: rec.manaValue, power, toughness: String(toughness), ...extra };
}
function token(name: string, power: string, toughness: string): CardLike {
  nextId += 1;
  return { id: `${name}#${nextId}`, name, typeLine: "Token Creature — Goblin", oracleText: "", manaValue: 0, power, toughness, token: true };
}
function handCard(name: string): CardLike {
  const rec = card(name);
  return { id: `hand-${name}`, name, typeLine: rec.typeLine, oracleText: rec.oracleText, manaValue: rec.manaValue };
}
function castAction(name: string, targetIds: string[] = []): ScorableAction {
  const rec = card(name);
  return { id: `cast:hand-${name}`, actionType: "cast_spell", cardId: `hand-${name}`, targetIds, label: `cast ${name}`, detail: `{1} ${rec.typeLine}. ${rec.oracleText} Payable with 1 land.` };
}
function sacAction(source: CardLike, fodder: CardLike[]): ScorableAction {
  return {
    id: `activate-sacrifice:${source.id}:0`,
    actionType: "activate_ability",
    abilityKind: "generic_sacrifice",
    cardId: source.id,
    sacrificeCardIds: fodder.map((entry) => entry.id),
    targetIds: [],
    label: `activate ${source.name} (sacrifice ${fodder.map((entry) => entry.name).join(", ")})`,
    detail: source.oracleText
  };
}
function ctx(overrides: Partial<ScoringContext> & { mine?: CardLike[]; theirs?: CardLike[]; hand?: CardLike[]; life?: number } = {}): ScoringContext {
  const { mine = [], theirs = [], hand = [], life = 40, ...rest } = overrides;
  return {
    purpose: "main_phase",
    turn: 6,
    you: { id: "me", life, battlefield: mine, hand },
    opponents: [{ id: "opp", life: 40, battlefield: theirs }],
    ...rest
  };
}

describe("rule 1: pointless sacrifices (Viscera Seer)", () => {
  const seer = perm("Viscera Seer", "1", 1);
  it("vetoes sacrificing a real creature to scry", () => {
    const nighthawk = perm("Vampire Nighthawk", "2", 3);
    const verdict = sacrificeGuard(sacAction(seer, [nighthawk]), ctx({ mine: [seer, nighthawk] }));
    expect(verdict.allowed).toBe(false);
  });

  it("vetoes sacrificing the best creature even when a token exists elsewhere", () => {
    const titan = perm("Grave Titan", "6", 6);
    const gob = token("Goblin Token", "1", "1");
    expect(sacrificeGuard(sacAction(seer, [titan]), ctx({ mine: [seer, titan, gob] })).allowed).toBe(false);
  });

  it("caps repeated scry-sacrifices: the last spare tokens are not fed to the outlet", () => {
    const one = token("Goblin Token", "1", "1");
    const two = token("Goblin Token", "1", "1");
    expect(sacrificeGuard(sacAction(seer, [one]), ctx({ mine: [seer, one, two] })).allowed).toBe(false);
  });

  it("allows scrying away a token when there is plenty of fodder", () => {
    const tokens = [token("Goblin Token", "1", "1"), token("Goblin Token", "1", "1"), token("Goblin Token", "1", "1")];
    expect(sacrificeGuard(sacAction(seer, [tokens[0]]), ctx({ mine: [seer, ...tokens] })).allowed).toBe(true);
  });

  it("allows sacrificing a creature that is about to die to a removal spell on the stack", () => {
    const nighthawk = perm("Vampire Nighthawk", "2", 3);
    const context = ctx({
      purpose: "priority_response",
      mine: [seer, nighthawk],
      stack: [{ id: "s1", cardName: "Murder", oracleText: card("Murder").oracleText, actorSeatId: "opp", targetCardIds: [nighthawk.id] }],
      pendingAction: { id: "s1", cardName: "Murder", oracleText: card("Murder").oracleText, actorSeatId: "opp", targetCardIds: [nighthawk.id] }
    });
    expect(sacrificeGuard(sacAction(seer, [nighthawk]), context).allowed).toBe(true);
  });

  it("still vetoes when the removal on the stack is aimed at something else", () => {
    const nighthawk = perm("Vampire Nighthawk", "2", 3);
    const bears = perm("Grizzly Bears", "2", 2);
    const pending = { id: "s1", cardName: "Murder", oracleText: card("Murder").oracleText, actorSeatId: "opp", targetCardIds: [bears.id] };
    const context = ctx({ purpose: "priority_response", mine: [seer, nighthawk, bears], stack: [pending], pendingAction: pending });
    expect(sacrificeGuard(sacAction(seer, [nighthawk]), context).allowed).toBe(false);
  });

  it("allows it when a Blood Artist drain is lethal", () => {
    const artist = perm("Blood Artist", "0", 1);
    const bears = perm("Grizzly Bears", "2", 2);
    const context = ctx({ mine: [seer, artist, bears] });
    context.opponents![0].life = 1;
    expect(sacrificeGuard(sacAction(seer, [bears]), context).allowed).toBe(true);
  });

  it("does not guard sacrificing the source itself (fetch lands, mana rocks)", () => {
    const action = sacAction(seer, [seer]);
    expect(sacrificeGuard(action, ctx({ mine: [seer] })).allowed).toBe(true);
  });

  it("the heuristic picker therefore passes instead of sacrificing", () => {
    const nighthawk = perm("Vampire Nighthawk", "2", 3);
    const scored = scoreLegalActions(
      [sacAction(seer, [nighthawk]), { id: "pass-phase", actionType: "pass_priority", targetIds: [], label: "pass" }],
      ctx({ mine: [seer, nighthawk] })
    );
    expect(scored[0].id).toBe("pass-phase");
    expect(fallbackAction(scored, "x").legalActionId).toBe("pass-phase");
  });
});

describe("rule 2: removal on non-threats", () => {
  const bears = perm("Grizzly Bears", "2", 2);
  const titan = perm("Grave Titan", "6", 6);
  const nighthawk = perm("Vampire Nighthawk", "2", 3);

  it("recognizes targeted removal and removal Auras but not counterspells or burn that can go face", () => {
    expect(parseTargetedRemoval(castAction("Swords to Plowshares"))?.kind).toBe("exile");
    expect(parseTargetedRemoval(castAction("Murder"))?.kind).toBe("destroy");
    expect(parseTargetedRemoval(castAction("Pacifism"))?.kind).toBe("aura");
    expect(parseTargetedRemoval(castAction("Kenrith's Transformation"))?.kind).toBe("aura");
    expect(parseTargetedRemoval(castAction("Counterspell"))).toBeUndefined();
    expect(parseTargetedRemoval(castAction("Lightning Bolt"))).toBeUndefined();
    expect(parseTargetedRemoval(castAction("Wrath of God"))).toBeUndefined();
  });

  it("holds Swords / Pacifism / Kenrith's Transformation when the only creature is a Grizzly Bears", () => {
    for (const name of ["Swords to Plowshares", "Pacifism", "Kenrith's Transformation", "Murder"]) {
      const verdict = removalGuard(castAction(name), ctx({ theirs: [bears], hand: [handCard(name)] }));
      expect(verdict.allowed, name).toBe(false);
    }
  });

  it("casts removal when a real threat is on the table", () => {
    for (const name of ["Swords to Plowshares", "Pacifism", "Murder"]) {
      expect(removalGuard(castAction(name), ctx({ theirs: [bears, titan], hand: [handCard(name)] })).allowed, name).toBe(true);
    }
    expect(removalGuard(castAction("Murder"), ctx({ theirs: [nighthawk], hand: [handCard("Murder")] })).allowed).toBe(true);
  });

  it("allows removal on a minor creature when the opponent's board threatens lethal", () => {
    const attackers = [perm("Grizzly Bears", "2", 2), perm("Grizzly Bears", "2", 2), perm("Grizzly Bears", "2", 2)];
    const verdict = removalGuard(castAction("Swords to Plowshares"), ctx({ theirs: attackers, life: 6, hand: [handCard("Swords to Plowshares")] }));
    expect(verdict.allowed).toBe(true);
  });

  it("scores a vetoed removal below passing, and the route-level resolver replaces it", () => {
    const context = ctx({ theirs: [bears], hand: [handCard("Swords to Plowshares")] });
    const scored = scoreLegalActions(
      [{ ...castAction("Swords to Plowshares"), role: "removal" }, { id: "pass-phase", actionType: "pass_priority", targetIds: [], label: "pass" }],
      context
    );
    expect(scored[0].id).toBe("pass-phase");
    const resolved = resolveGuardedChoice(scored, "cast:hand-Swords to Plowshares");
    expect(resolved.overridden).toBe(true);
    expect(resolved.action?.id).toBe("pass-phase");
  });
});

describe("rule 3: protection spells", () => {
  const nighthawk = perm("Vampire Nighthawk", "2", 3);
  const sol = perm("Grizzly Bears", "2", 2);

  it("recognizes protection instants but not equipment", () => {
    expect(isProtectionInstant(castAction("Tamiyo's Safekeeping"))).toBe(true);
    expect(isProtectionInstant(castAction("Heroic Intervention"))).toBe(true);
    expect(isProtectionInstant(castAction("Swiftfoot Boots"))).toBe(false);
  });

  it("never casts protection on an empty stack", () => {
    for (const purpose of ["main_phase", "priority_response"]) {
      const context = ctx({ purpose, mine: [nighthawk, sol] });
      expect(protectionGuard(castAction("Tamiyo's Safekeeping"), context).allowed, purpose).toBe(false);
      expect(protectionGuard(castAction("Heroic Intervention"), context).allowed, purpose).toBe(false);
    }
  });

  it("does not cast it in response to an unrelated spell or the opponent's creature", () => {
    const pending = { id: "s1", cardName: "Grave Titan", oracleText: card("Grave Titan").oracleText, actorSeatId: "opp" };
    const context = ctx({ purpose: "priority_response", mine: [nighthawk], stack: [pending], pendingAction: pending });
    expect(protectionGuard(castAction("Tamiyo's Safekeeping"), context).allowed).toBe(false);
  });

  it("casts it in response to removal aimed at its permanent", () => {
    const pending = { id: "s1", cardName: "Murder", oracleText: card("Murder").oracleText, actorSeatId: "opp", targetCardIds: [nighthawk.id] };
    const context = ctx({ purpose: "priority_response", mine: [nighthawk], stack: [pending], pendingAction: pending });
    expect(protectionGuard(castAction("Tamiyo's Safekeeping"), context).allowed).toBe(true);
  });

  it("does not cast it when the removal is aimed at someone else's permanent", () => {
    const pending = { id: "s1", cardName: "Murder", oracleText: card("Murder").oracleText, actorSeatId: "opp", targetCardIds: ["someone-elses"] };
    const context = ctx({ purpose: "priority_response", mine: [nighthawk], stack: [pending], pendingAction: pending });
    expect(protectionGuard(castAction("Tamiyo's Safekeeping"), context).allowed).toBe(false);
  });

  it("casts Heroic Intervention against a board wipe", () => {
    const pending = { id: "s1", cardName: "Wrath of God", oracleText: card("Wrath of God").oracleText, actorSeatId: "opp" };
    const context = ctx({ purpose: "priority_response", mine: [nighthawk, sol], stack: [pending], pendingAction: pending });
    expect(protectionGuard(castAction("Heroic Intervention"), context).allowed).toBe(true);
  });

  it("never lets hexproof-only protection answer a wipe it cannot stop", () => {
    const pending = { id: "s1", cardName: "Wrath of God", oracleText: card("Wrath of God").oracleText, actorSeatId: "opp" };
    const hexproofOnly: ScorableAction = { ...castAction("Heroic Intervention"), detail: "{1} Instant. Permanents you control gain hexproof until end of turn." };
    const context = ctx({ purpose: "priority_response", mine: [nighthawk], stack: [pending], pendingAction: pending });
    expect(protectionGuard(hexproofOnly, context).allowed).toBe(false);
  });

  it("allows an indestructible instant in combat when it saves a blocker from lethal damage", () => {
    const blocker = perm("Grizzly Bears", "2", 2, { blocking: true });
    const attacker = perm("Grave Titan", "6", 6, { attacking: true });
    const context = ctx({ purpose: "priority_response", phase: "declare blockers step", mine: [blocker], theirs: [attacker] });
    expect(protectionGuard(castAction("Tamiyo's Safekeeping"), context).allowed).toBe(true);
  });

  it("evaluatePlayGuards vetoes a proactive Tamiyo's Safekeeping and the scorer sinks it below passing", () => {
    const context = ctx({ mine: [nighthawk] });
    expect(evaluatePlayGuards(castAction("Tamiyo's Safekeeping"), context).vetoed).toBe(true);
    const scored = scoreLegalActions([castAction("Tamiyo's Safekeeping"), { id: "pass-phase", actionType: "pass_priority", targetIds: [], label: "pass" }], context);
    expect(scored[0].id).toBe("pass-phase");
  });
});
