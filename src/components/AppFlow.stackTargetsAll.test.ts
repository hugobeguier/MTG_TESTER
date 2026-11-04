// Every targeted spell and ability names its target(s) as it goes on the stack (rule 601.2c), for agents too, and re-checks them on resolution
// (rule 608.2b): pump/shrink, graveyard returns, two-target bites, modal spells, other "extra" effects, spell faces, advisor-planned spells,
// triggered abilities. Real catalog text throughout.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { describeStackItem } from "@/lib/stackDescription";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { agentCastTimeRemovalChoices, applyCastGenericModes, applyCastRemoval, castModeLabels, castStructure, castTargetLegal, resolveTriggerEffect, stackTargetText, applyZoneEffect, applyTargetedPumpEffect, applySpellExtraEffect } from "./AppFlow";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const creature = (id: string, extra: Partial<VisibleCard> = {}) => ({ id, name: `Creature ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", ...extra }) as VisibleCard;
function seat(id: string, kind: "human" | "agent", board: Partial<PlayerSeat["board"]> = {}): PlayerSeat {
  const b = { hand: [], battlefield: [], graveyard: [], exile: [], ...board };
  return { id, name: id, kind, life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: b.battlefield.length, graveyard: 0, exile: 0, command: 0 }, board: b } as PlayerSeat;
}
function session(seats: PlayerSeat[]): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] };
}
const deadGuy = (id: string) => creature(id, { name: `Dead ${id}`, zone: "graveyard", power: "4", toughness: "4", manaValue: 4 });
// The agent has a 4/4 and a 1/1; the human has a 5/5 and a 2/2 plus an artifact; both graveyards hold a creature.
const world = () =>
  session([
    seat("agent", "agent", { battlefield: [creature("mine", { power: "4", toughness: "4" }), creature("small", { power: "1", toughness: "1" })], graveyard: [deadGuy("ownDead")] }),
    seat("human", "human", {
      battlefield: [creature("victim", { power: "5", toughness: "5", manaValue: 5 }), creature("minor", { power: "2", toughness: "2" }), { id: "rock", name: "Rock", typeLine: "Artifact", oracleText: "", colors: [], role: "permanent", zone: "battlefield", manaValue: 2 } as VisibleCard],
      graveyard: [deadGuy("theirDead")]
    })
  ]);
const ids = (choices: { targets: Array<{ kind: string; seatId: string; cardId?: string }> } | undefined) => choices?.targets.map((t) => t.cardId ?? `p:${t.seatId}`);

describe("class 1: pump/shrink spells record their target", () => {
  it("a buff goes on the agent's own best creature", () => {
    const choices = agentCastTimeRemovalChoices(world(), "agent", real("Giant Growth", "gg", { zone: "hand" }));
    expect(ids(choices)).toEqual(["mine"]);
  });
  it("a shrink goes on an opposing creature, never the agent's own", () => {
    const choices = agentCastTimeRemovalChoices(world(), "agent", real("Disfigure", "df", { zone: "hand" }));
    expect(choices?.targets[0]).toMatchObject({ seatId: "human", cardId: "victim" });
  });
  it("a shrink skips a hexproof creature it could not legally target", () => {
    const s = world();
    s.seats[1].board.battlefield[0] = creature("victim", { power: "5", toughness: "5", oracleText: "Hexproof" });
    expect(agentCastTimeRemovalChoices(s, "agent", real("Disfigure", "df", { zone: "hand" }))?.targets[0]).toMatchObject({ cardId: "minor" });
  });
  it("on resolution the recorded creature gets the shrink; if it left, the spell does nothing", () => {
    const df = real("Disfigure", "df", { zone: "hand" });
    const structure = castStructure(df);
    if (structure?.kind !== "pump") throw new Error("expected pump");
    const hit = applyTargetedPumpEffect(world(), "agent", df, structure.effect, { kind: "card", seatId: "human", cardId: "minor" });
    expect(hit.seats[1].board.battlefield.find((c) => c.id === "minor")?.temporaryToughnessBonus).toBe(-2);
    expect(hit.seats[1].board.battlefield.find((c) => c.id === "victim")?.temporaryToughnessBonus).toBeUndefined();
    const s = world();
    s.seats[1].board.battlefield = [];
    expect(castTargetLegal(s, "agent", df, { kind: "card", seatId: "human", cardId: "minor" })).toBe(false);
  });
});

describe("class 2: graveyard returns record the card", () => {
  it("Reanimate takes the best creature from any graveyard", () => {
    const choices = agentCastTimeRemovalChoices(world(), "agent", real("Reanimate", "re", { zone: "hand" }));
    expect(choices?.targets).toHaveLength(1);
    expect(["ownDead", "theirDead"]).toContain(choices?.targets[0].kind === "card" ? choices.targets[0].cardId : "");
  });
  it("Raise Dead and Regrowth name a card in the agent's own graveyard", () => {
    expect(ids(agentCastTimeRemovalChoices(world(), "agent", real("Raise Dead", "rd", { zone: "hand" })))).toEqual(["ownDead"]);
    expect(ids(agentCastTimeRemovalChoices(world(), "agent", real("Regrowth", "rg", { zone: "hand" })))).toEqual(["ownDead"]);
  });
  it("Victimize records the graveyard creatures it returns", () => {
    const s = world();
    s.seats[0].board.graveyard = [deadGuy("g1"), deadGuy("g2")];
    expect(ids(agentCastTimeRemovalChoices(s, "agent", real("Victimize", "vz", { zone: "hand" })))?.sort()).toEqual(["g1", "g2"]);
  });
  it("the stack panel shows the graveyard card, and resolution fizzles when it is gone", () => {
    const rd = real("Raise Dead", "rd", { zone: "hand" });
    const choices = agentCastTimeRemovalChoices(world(), "agent", rd);
    const desc = describeStackItem(world(), { id: "s", type: "spell", actorSeatId: "agent", cardId: "rd", cardName: "Raise Dead", castChoices: choices, sourceCard: rd });
    expect(desc.targets[0].label).toMatch(/Dead ownDead \(in graveyard\)/);
    const s = world();
    s.seats[0].board.graveyard = [];
    expect(castTargetLegal(s, "agent", rd, choices!.targets[0])).toBe(false);
    const structure = castStructure(rd);
    if (structure?.kind !== "zone") throw new Error("expected zone");
    const legal = applyZoneEffect(world(), "agent", rd.name, structure.effect, undefined, choices!.targets[0]);
    expect(legal.seats[0].board.hand.some((c) => c.id === "ownDead")).toBe(true);
  });
});

describe("class 3: two-target bites record dealer and victim", () => {
  it("Bite Down: the agent's strongest creature bites the opposing creature it can kill (the 2/2; the 5/5 would survive 4 damage)", () => {
    expect(ids(agentCastTimeRemovalChoices(world(), "agent", real("Bite Down", "bd", { zone: "hand" })))).toEqual(["mine", "minor"]);
  });
  it("Ram Through (trample clause) is recorded the same way", () => {
    expect(ids(agentCastTimeRemovalChoices(world(), "agent", real("Ram Through", "rt", { zone: "hand" })))).toEqual(["mine", "minor"]);
  });
  it("no opposing creature it may target: nothing is recorded", () => {
    const s = world();
    s.seats[1].board.battlefield = s.seats[1].board.battlefield.slice(2);
    expect(agentCastTimeRemovalChoices(s, "agent", real("Bite Down", "bd", { zone: "hand" }))).toBeUndefined();
  });
  it("if either creature is gone on resolution nothing is damaged (608.2b)", () => {
    const bd = real("Bite Down", "bd", { zone: "hand" });
    const choices = agentCastTimeRemovalChoices(world(), "agent", bd)!;
    const s = world();
    s.seats[1].board.battlefield = s.seats[1].board.battlefield.filter((c) => c.id !== "minor");
    expect(choices.targets.every((t) => castTargetLegal(s, "agent", bd, t))).toBe(false);
    const ok = applySpellExtraEffect(world(), "agent", bd, { kind: "creature_bites" }, undefined, choices.targets);
    expect(ok.seats[1].board.battlefield.some((c) => c.id === "minor")).toBe(false);
  });
});

describe("class 4: modal spells record the modes and each mode's targets", () => {
  it("Abrade (removal modal): picks the damage mode and its creature", () => {
    const abrade = real("Abrade", "ab", { zone: "hand" });
    const choices = agentCastTimeRemovalChoices(world(), "agent", abrade);
    expect(choices?.modes).toHaveLength(1);
    expect(choices?.targets).toHaveLength(1);
    expect(choices?.targets[0].seatId).toBe("human");
    expect(castModeLabels(abrade, undefined, choices)[0]).toMatch(/damage|Destroy/i);
  });
  it("Abrade with only an artifact to hit takes the destroy-artifact mode", () => {
    const s = world();
    s.seats[1].board.battlefield = s.seats[1].board.battlefield.filter((c) => c.id === "rock");
    const choices = agentCastTimeRemovalChoices(s, "agent", real("Abrade", "ab", { zone: "hand" }));
    expect(choices?.targets).toEqual([{ kind: "card", seatId: "human", cardId: "rock" }]);
  });
  it("a modal spell resolves only the legal mode's target (a mode whose target left does nothing, 608.2b)", () => {
    const abrade = real("Abrade", "ab", { zone: "hand" });
    const choices = agentCastTimeRemovalChoices(world(), "agent", abrade)!;
    const structure = castStructure(abrade);
    if (structure?.kind !== "removal_modal") throw new Error("expected removal_modal");
    const gone = world();
    gone.seats[1].board.battlefield = [];
    const after = applyCastRemoval(gone, "agent", abrade, { kind: "modal", chooseCount: 1, modes: structure.modal.modes }, undefined, choices);
    expect(after.events[0].message).toMatch(/no longer legal/);
  });
  it("Saheeli's Artistry (generic 'one or both'): both modes with targets are recorded", () => {
    const art = real("Saheeli's Artistry", "sa", { zone: "hand" });
    const s = world();
    s.seats[0].board.battlefield.push({ id: "myrock", name: "My Rock", typeLine: "Artifact", oracleText: "", colors: [], role: "permanent", zone: "battlefield", manaValue: 2 } as VisibleCard);
    const choices = agentCastTimeRemovalChoices(s, "agent", art);
    expect(choices?.modes?.length).toBeGreaterThan(0);
    expect(choices?.targets.length).toBe(choices?.modes?.length);
    expect(castModeLabels(art, undefined, choices).length).toBe(choices?.modes?.length);
    expect(applyCastGenericModes(s, "agent", art, (castStructure(art) as unknown as { modal: Parameters<typeof applyCastGenericModes>[3] }).modal, choices!).seats[0].board.battlefield.length).toBeGreaterThan(s.seats[0].board.battlefield.length);
  });
  it("the log line names the chosen mode and its target", () => {
    const abrade = real("Abrade", "ab", { zone: "hand" });
    const choices = agentCastTimeRemovalChoices(world(), "agent", abrade)!;
    expect(stackTargetText(world(), choices.targets, undefined, castModeLabels(abrade, undefined, choices))).toMatch(/^ \(chooses: .+\) targeting /);
  });
  it("the stack panel lists the mode (describeStackItem modes) even for a mode with no target", () => {
    const desc = describeStackItem(world(), { id: "s", type: "spell", actorSeatId: "agent", cardName: "X", castChoices: { modes: [0], targets: [] }, modeLabels: ["Draw a card."] });
    expect(desc.modes).toEqual(["Draw a card."]);
    expect(desc.targetsPending).toBe(false);
  });
});

describe("class 5: other 'extra' effects with targets", () => {
  it("Chandra's Ignition records the creature that deals the damage", () => {
    expect(ids(agentCastTimeRemovalChoices(world(), "agent", real("Chandra's Ignition", "ci", { zone: "hand" })))).toEqual(["mine"]);
  });
  it("Consumed by Greed and Secret Rendezvous record the opponent as a player target", () => {
    expect(agentCastTimeRemovalChoices(world(), "agent", real("Consumed by Greed", "cg", { zone: "hand" }))?.targets).toEqual([{ kind: "player", seatId: "human" }]);
    expect(agentCastTimeRemovalChoices(world(), "agent", real("Secret Rendezvous", "sr", { zone: "hand" }))?.targets).toEqual([{ kind: "player", seatId: "human" }]);
  });
  it("Tamiyo's Safekeeping puts hexproof on one of the agent's own permanents", () => {
    const choices = agentCastTimeRemovalChoices(world(), "agent", real("Tamiyo's Safekeeping", "ts", { zone: "hand" }));
    expect(choices?.targets[0].seatId).toBe("agent");
  });
  it("target opponent with hexproof is not recorded", () => {
    const s = world();
    s.seats[1].board.battlefield.push({ id: "leyline", name: "Leyline of Sanctity", typeLine: "Enchantment", oracleText: "You have hexproof.", colors: [], role: "permanent", zone: "battlefield", manaValue: 4 } as VisibleCard);
    expect(agentCastTimeRemovalChoices(s, "agent", real("Secret Rendezvous", "sr", { zone: "hand" }))).toBeUndefined();
  });
});

describe("class 6: spell faces", () => {
  it("an Adventure's spell face (Stomp) is judged on its own text and records a target", () => {
    const giant = real("Bonecrusher Giant", "bg", { zone: "hand" });
    const face = giant.faces?.find((f) => /^Stomp/.test(f.name));
    expect(face).toBeTruthy();
    const shim = { ...giant, name: face!.name, typeLine: face!.typeLine, oracleText: face!.oracleText } as VisibleCard;
    expect(agentCastTimeRemovalChoices(world(), "agent", shim)?.targets).toHaveLength(1);
  });
});

describe("class 7: Rules Advisor planned spells", () => {
  it("a spell no deterministic parser owns, with no cached plan, records nothing (its plan is fetched asynchronously at resolution)", () => {
    expect(agentCastTimeRemovalChoices(world(), "agent", real("Hunter's Edge", "he", { zone: "hand" }))).toBeUndefined();
  });
});

describe("class 8: agent triggered abilities record their target as they go on the stack", () => {
  const source = (name: string, id: string) => real(name, id);
  it("a damage trigger (Scourge of Valkas style) is resolved against the recorded target and fizzles if it is gone", () => {
    const s = world();
    const trigger = { id: "t1", type: "trigger", actorSeatId: "agent", controllerSeatId: "agent", sourceCardId: "src", sourceCardName: "Src", triggerKind: "common", effect: { kind: "damage_effect", effect: { kind: "damage", amount: 3, targetType: "any" }, chosenOption: "c:human:minor" }, message: "" } as never;
    const withSrc = { ...s, seats: s.seats.map((x) => (x.id === "agent" ? { ...x, board: { ...x.board, battlefield: [...x.board.battlefield, source("Dragon Tempest", "src")] } } : x)) };
    const hit = resolveTriggerEffect(withSrc, trigger);
    expect(hit.seats[1].board.battlefield.some((c) => c.id === "minor")).toBe(false);
    const gone = { ...withSrc, seats: withSrc.seats.map((x) => (x.id === "human" ? { ...x, board: { ...x.board, battlefield: x.board.battlefield.filter((c) => c.id !== "minor") } } : x)) };
    const fizzled = resolveTriggerEffect(gone, trigger);
    expect(fizzled.events[0].message).toMatch(/no longer legal/);
    expect(fizzled.seats[1].board.battlefield.some((c) => c.id === "victim")).toBe(true);
  });
});

describe("no 'target not recorded' for spells that have no targets", () => {
  it("a creature spell with an enters effect that targets is not 'pending' (the ability targets when it triggers)", () => {
    const chup = real("Ravenous Chupacabra", "rc");
    const desc = describeStackItem(world(), { id: "s", type: "spell", actorSeatId: "agent", cardName: chup.name, sourceCard: chup });
    expect(desc.targetsPending).toBe(false);
  });
  it("a 'choose a creature'/sacrifice effect is not displayed as a target", () => {
    const wrath = real("Wrath of God", "w");
    const edict = real("Diabolic Edict", "de");
    for (const card of [wrath, edict]) {
      const desc = describeStackItem(world(), { id: "s", type: "spell", actorSeatId: "agent", cardName: card.name, sourceCard: card });
      expect(desc.targets).toEqual([]);
    }
  });
});

// ---- Guard: every deck instant/sorcery/Aura whose text says "target" records a target as an agent casts it, or is on the documented list. ----
const COUNTER = "counterspell: its target is the spell it answers, recorded as counterTargetId and shown as a stack target, not as castChoices";
const EXCEPTIONS: Record<string, string> = {
  "Arcane Denial": COUNTER, Counterspell: COUNTER, Negate: COUNTER, "Swan Song": COUNTER, "Mana Tithe": COUNTER, "Launch Mishap": COUNTER,
  Portent: "look-at-top workflow of the Rules Advisor chooses the player (self, for an agent)",
  "Sign in Blood": "'target player' is always the caster for an agent (self-targeting draw), nothing to respond to",
  "Scheming Symmetry": "'choose two target players' search effect is a Rules Advisor workflow",
  "Crackle with Power": "up to X targets with X-dependent count; asked one target at a time at resolution",
  "Monstrous Onslaught": "damage divided among any number of targets; the split is the engine's deterministic assignment at resolution",
  "Pest Infestation": "'up to X' targets (X chosen at cast): picked one at a time at resolution",
  "Immoral Bargain": "agents refuse to cast it (AGENT_UNSUPPORTED_SPELL_TEXT: X sacrifices cost)",
  "Loran's Escape": "'artifact or creature' hexproof grant has no deterministic parser (Rules Advisor planned)",
  "Parting Gust": "gift + exile-and-return needs the Rules Advisor plan",
  "Squirming Emergence": "fathomless-descent reanimation of a nonland permanent has no deterministic parser (Rules Advisor planned)",
  "Consuming Corruption": "X damage where X counts Swamps: Rules Advisor planned",
  "Tendrils of Corruption": "X damage where X counts Swamps: Rules Advisor planned"
};
function deckFiles(): string[] {
  const roots = readdirSync(".").filter((f) => f.endsWith(".txt") && !/Bugs2|Potential/.test(f));
  return [...roots, ...["decks/custom", "decks/foundations"].flatMap((d) => readdirSync(d).map((f) => `${d}/${f}`))];
}
function deckCardNames(file: string): string[] {
  return readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(\d+\s|Commander:)/.test(l))
    .map((l) => l.replace(/^Commander:\s*/, "").replace(/^\d+\s+/, "").replace(/\s+\(.*$/, "").replace(/\s+\*.*$/, "").trim());
}
describe("guard: deck spells that target record a target at cast time", () => {
  it("every targeted instant/sorcery in the shipped decks records one (or is a documented exception)", () => {
    const names = [...new Set(deckFiles().flatMap(deckCardNames))];
    const missing: string[] = [];
    for (const name of names) {
      const found = lookupCard(catalog, name) as { oracleText?: string; typeLine?: string; faces?: unknown[] } | undefined;
      if (!found?.oracleText || !/\btargets?\b/i.test(found.oracleText) || !/Instant|Sorcery/.test(found.typeLine ?? "") || found.faces?.length) continue;
      const card = real(name, "guard", { zone: "hand" });
      let choices;
      try {
        const board = world();
        board.seats[0].board.graveyard = [deadGuy("g1"), deadGuy("g2")];
        choices = agentCastTimeRemovalChoices(board, "agent", card, 3);
      } catch (error) {
        missing.push(`${name} (threw ${(error as Error).message})`);
        continue;
      }
      if (!choices || (choices.targets.length === 0 && !choices.modes?.length)) missing.push(name);
    }
    console.log("UNRECORDED:", JSON.stringify(missing));
    expect(missing.filter((name) => !(name in EXCEPTIONS))).toEqual([]);
  });
});
