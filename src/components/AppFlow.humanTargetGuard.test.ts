// Guard: a HUMAN seat never has a target picked for it ("make sure that all target stuff gives the human a prompt, no auto targeting").
// Every targeted spell / Aura / triggered ability of the shipped decks gives the human a choice prompt, even with a single legal target; only the
// documented exceptions below are resolved another way. Agents keep their automatic targeting (AppFlow.stackTargetsAll.test.ts guards that side).
// Real catalog text throughout. The prompts are addressed to the controlling seat (host or remote friend) through pendingRuleChoice
// (lib/multiplayer/seatPrompts.ts) and answered through whitelisted intents (lib/multiplayer/intentSpecs.ts).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { zoneChoiceSpecFor } from "@/engine/abilities";
import { findAttackTriggers, findCastTriggers, findCombatDamageToPlayerTriggers, findCommonTriggersForPermanentDied } from "@/engine/triggerFinders";
import { triggerCardPrompt, triggerTargetOptionPrompt } from "@/engine/triggerPrompts";
import { commonTriggerEffect, findCommonTriggersForPermanentEntered, isMerenEndStepEffect, makeCommonTrigger, phaseEffectText } from "@/engine/triggers";
import { humanPhaseGraveyardChoice, isReanimateFromAnyGraveyardPhaseTrigger, targetCreatureCounterPhaseTrigger } from "@/engine/turnFlow";
import type { PendingRuleChoice } from "@/engine/types";
import { legalTargets } from "@/lib/targeting";
import { parseZoneEffect } from "@/lib/zoneEffects";
import { parseRemovalEffect } from "@/lib/removalSpells";
import { removalEffectTargetSpec } from "@/lib/targetSpecs";
import { promptSlotsForSeat } from "@/lib/multiplayer/seatPrompts";
import { INTENT_SPECS } from "@/lib/multiplayer/intentSpecs";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { agentCastTimeRemovalChoices, castTargetLegal, nextCastPrompt, resolveTriggerEffect } from "./AppFlow";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const mk = (id: string, typeLine: string, extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Thing ${id}`, typeLine, power: typeLine.includes("Creature") ? "2" : undefined, toughness: typeLine.includes("Creature") ? "2" : undefined, colors: ["G"], role: "permanent", zone: "battlefield", manaValue: 3, oracleText: "", ...extra }) as VisibleCard;
function seat(id: string, kind: "human" | "agent", board: Partial<PlayerSeat["board"]> = {}): PlayerSeat {
  const b = { hand: [], battlefield: [], graveyard: [], exile: [], ...board };
  return { id, name: id, kind, life: 40, commanderDamage: {}, zones: { library: 0, hand: b.hand.length, battlefield: b.battlefield.length, graveyard: b.graveyard.length, exile: 0, command: 0 }, board: b } as PlayerSeat;
}
function session(seats: PlayerSeat[]): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] };
}
const gy = (id: string, typeLine: string) => mk(id, typeLine, { zone: "graveyard", manaValue: 2 });
// ONE legal candidate of each kind per seat: the prompt must still appear (the human confirms it).
function world(extraMine: VisibleCard[] = []): GameSession {
  return session([
    seat("me", "human", { battlefield: [mk("mc", "Creature — Bear"), mk("ma", "Artifact"), mk("me1", "Enchantment"), mk("ml", "Basic Land — Forest"), ...extraMine], graveyard: [gy("mgc", "Creature — Bear"), gy("mga", "Artifact"), gy("mge", "Enchantment")] }),
    seat("opp", "agent", { battlefield: [mk("oc", "Creature — Bear", { tapped: true }), mk("oa", "Artifact"), mk("oe", "Enchantment"), mk("ol", "Land"), mk("op", "Legendary Planeswalker — X")], graveyard: [gy("ogc", "Creature — Bear")] })
  ]);
}
function deckCardNames(file: string): string[] {
  return readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(\d+\s|Commander:)/.test(l))
    .map((l) => l.replace(/^Commander:\s*/, "").replace(/^\d+\s+/, "").replace(/\s+\(.*$/, "").replace(/\s+\*.*$/, "").trim());
}
const DECKS = ["decks/custom/Aminatou.txt", "decks/custom/Meren.txt", "decks/custom/Meren of Clan Nel Toth Built on my Own.txt", "decks/custom/The Ur Dragon.txt", "decks/custom/Saheeli.txt", "decks/foundations/Squirreled Away.txt"];
const deckNames = [...new Set(DECKS.flatMap(deckCardNames))];
const asks = (s: GameSession, t: Parameters<typeof triggerCardPrompt>[1]) => triggerCardPrompt(s, t, s.seats[0]) !== undefined || triggerTargetOptionPrompt(s, t, s.seats[0]) !== undefined;

// ---- 1. Static guard: no human-facing target prompt may be skipped because there is only ONE legal candidate. ----
describe("guard: source never skips a human target prompt for a single candidate", () => {
  const files = ["src/components/game", "src/engine"].flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => `${dir}/${f}`));
  const SKIP_PATTERNS = [
    /legalTargets\([^\n]*\)\.length\s*(<=\s*1|>\s*1|>=\s*2|<\s*2)\b/,
    /labeledTargetOptions\([^\n]*\)\.length\s*(<=\s*1|>\s*1|>=\s*2|<\s*2)\b/,
    /\b(regrowPool|removalPool|aimOptions|aiming\.options|cardPrompt\.cards)\.length\s*(<=\s*1|>\s*1|>=\s*2|<\s*2)\b/
  ];
  it("no `legalTargets(...).length > 1`-style skip remains in the engine or the game hooks", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
        if (SKIP_PATTERNS.some((pattern) => pattern.test(line))) offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

// ---- 2. Spells and Auras. ----
const SPELL_EXCEPTIONS: Record<string, string> = {
  // Counterspells are NOT exceptions any more: a human is asked which spell on the stack to counter (checked with a real stack below).
  Portent: "'target player's library': asked through choose_effect_target (library_look) when the spell resolves",
  "Animate Dead": "'enchant creature card in a graveyard': the graveyard creature is asked by the aura_reanimate enters trigger (tested below)",
  "Agadeem's Awakening": "'any number of target creature cards with different mana values': Rules Advisor planned, chosen at resolution",
  Find: "'up to two target creature cards': Rules Advisor planned",
  "Malakir Rebirth": "no deterministic parser (Rules Advisor planned)",
  "Revitalizing Repast": "no deterministic parser (Rules Advisor planned)",
  "Immoral Bargain": "X targets after an X sacrifice cost: Rules Advisor planned",
  "Pest Infestation": "'up to X' targets: one at a time at resolution",
  "Crackle with Power": "'each of up to X targets' divided damage: one at a time at resolution"
};
describe("guard: a human's targeted spell or Aura asks for its target(s), even with a single legal candidate", () => {
  it("every instant / sorcery / Aura face of the shipped decks prompts, or is a documented exception", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const name of deckNames) {
      const found = lookupCard(catalog, name) as { oracleText?: string; typeLine?: string; faces?: Array<{ name: string; typeLine: string; oracleText: string }> } | undefined;
      if (!found) continue;
      const faces = found.faces?.length ? found.faces : [{ name, typeLine: found.typeLine ?? "", oracleText: found.oracleText ?? "" }];
      for (const face of faces) {
        if (!/\btargets?\b|^Enchant /im.test(face.oracleText) || !/Instant|Sorcery|Aura/.test(face.typeLine)) continue;
        checked += 1;
        const card = real(name, "spell", { zone: "hand", name: face.name, typeLine: face.typeLine, oracleText: face.oracleText });
        // A stack with an instant and a creature spell on it: a counterspell must ask which one (even a one-spell stack asks).
        const stackWorld = world();
        const onStack = [mk("stk1", "Instant", { name: "Some Instant", zone: "hand" }), mk("stk2", "Creature — Bear", { name: "Some Bear", zone: "hand" })];
        stackWorld.seats[1].board.hand = onStack;
        const stack = onStack.map((c) => ({ id: `s-${c.id}`, type: "spell" as const, actorSeatId: "opp", cardId: c.id, cardName: c.name, manaSourceIds: [], message: "" }));
        if (!nextCastPrompt(stackWorld, "me", card, 3, { targets: [] }, stack)) missing.push(face.name);
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(missing.filter((name) => !(name in SPELL_EXCEPTIONS))).toEqual([]);
  });
  it("every counterspell of the shipped decks is a real (non-excepted) spell the guard above asked", () => {
    for (const name of ["Arcane Denial", "Counterspell", "Negate", "Swan Song"]) expect(deckNames).toContain(name);
    expect(Object.keys(SPELL_EXCEPTIONS)).not.toContain("Counterspell");
  });
  it("a one-candidate removal / bite still prompts", () => {
    const only = session([seat("me", "human", { battlefield: [mk("mine", "Creature — Bear")] }), seat("opp", "agent", { battlefield: [mk("theirs", "Creature — Bear")] })]);
    expect((nextCastPrompt(only, "me", real("Swords to Plowshares", "s", { zone: "hand" }), undefined, { targets: [] }) as { options: unknown[] }).options).toHaveLength(2);
    const bite = nextCastPrompt(only, "me", real("Bite Down", "b", { zone: "hand" }), undefined, { targets: [] }) as { options: unknown[] } | undefined;
    expect(bite?.options).toHaveLength(1);
  });
  it("'Enchant player' Auras ask which player (Overwhelming Splendor: any player, never the old 'highest life opponent' auto-pick)", () => {
    const aura = real("Overwhelming Splendor", "os", { zone: "hand" });
    const prompt = nextCastPrompt(world(), "me", aura, undefined, { targets: [] }) as { options: Array<{ target: { kind: string; seatId: string } }> };
    expect(prompt.options.map((o) => `${o.target.kind}:${o.target.seatId}`).sort()).toEqual(["player:me", "player:opp"]);
    expect(castTargetLegal(world(), "me", aura, { kind: "player", seatId: "opp" })).toBe(true);
    const hexproofOpponent = world();
    hexproofOpponent.seats[1].board.battlefield.push({ id: "ley", name: "Leyline of Sanctity", typeLine: "Enchantment", oracleText: "You have hexproof.", colors: [], role: "permanent", zone: "battlefield", manaValue: 4 } as VisibleCard);
    expect(castTargetLegal(hexproofOpponent, "me", aura, { kind: "player", seatId: "opp" })).toBe(false);
    const hidden = nextCastPrompt(hexproofOpponent, "me", aura, undefined, { targets: [] }) as { options: Array<{ target: { seatId: string } }> };
    expect(hidden.options.map((o) => o.target.seatId)).toEqual(["me"]);
  });
  it("'Enchant land' Auras (Squirrel Nest, Wolfwillow Haven) offer exactly the lands; 'creature, land, or planeswalker' (Imprisoned in the Moon) offers those three kinds", () => {
    const options = (name: string) => (nextCastPrompt(world(), "me", real(name, "a", { zone: "hand" }), undefined, { targets: [] }) as { options: Array<{ target: { cardId: string } }> }).options.map((o) => o.target.cardId).sort();
    expect(options("Squirrel Nest")).toEqual(["ml", "ol"]);
    expect(options("Wolfwillow Haven")).toEqual(["ml", "ol"]);
    expect(options("Imprisoned in the Moon")).toEqual(["mc", "ml", "oc", "ol", "op"]);
  });
  it("an agent's Aura keeps its automatic pick (agents are unchanged)", () => {
    const agentWorld = session([seat("opp", "agent"), seat("me", "human", { battlefield: [mk("victim", "Creature — Bear", { power: "6", toughness: "6" })] })]);
    expect(agentCastTimeRemovalChoices(agentWorld, "opp", real("Pacifism", "pf", { zone: "hand" }))?.targets[0]).toMatchObject({ cardId: "victim" });
  });
});

// ---- 3. Triggered abilities: targets are chosen as the trigger goes on the stack (queueCommonTriggers asks for these). ----
describe("guard: a human's targeted triggered ability asks for its target as it goes on the stack", () => {
  const TRIGGER_EXCEPTIONS: Record<string, string> = {
    "Hazel's Brewmaster": "'exile up to one target card from a graveyard' is not modelled at all (nothing is picked for anyone)"
  };
  const AIMING_KINDS = ["targeted_effect", "damage_effect", "context_power_damage", "add_counter", "pump_target_creature", "double_power_counters", "target_creature_gains_keyword", "destroy_tapped_creature", "aura_reanimate", "exile_card_from_graveyard", "become_artifact_target", "gain_control_target_artifact"];
  it("enters / attacks / combat damage / cast / dies triggers of every deck permanent that say 'target' prompt the human", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const name of deckNames) {
      const found = lookupCard(catalog, name) as { typeLine?: string; oracleText?: string } | undefined;
      if (!found || /Instant|Sorcery/.test(found.typeLine ?? "") || !/\btarget\b/i.test(found.oracleText ?? "")) continue;
      const card = real(name, "src");
      const s = world([card]);
      const batches: Array<[string, Array<{ controllerSeatId: string; effect: { kind: string } }>]> = [
        ["enters", findCommonTriggersForPermanentEntered(s, "me", card)],
        ["attacks", findAttackTriggers(s, { seatId: "me", card, defendingSeatId: "opp" }).triggers],
        ["damage", findCombatDamageToPlayerTriggers(s, "me", card, "opp")],
        ["cast", findCastTriggers(s, "me", real("Probe", "probe", { zone: "hand", typeLine: "Enchantment", manaValue: 3 }), 1)],
        ["dies", findCommonTriggersForPermanentDied(s, "me", mk("dead", "Creature — Bear", { zone: "graveyard" }))],
        ["another enters", findCommonTriggersForPermanentEntered(world([card, mk("newcomer", "Creature — Dragon", { power: "3", toughness: "3" })]), "me", mk("newcomer", "Creature — Dragon", { power: "3", toughness: "3" }))]
      ];
      for (const [label, list] of batches) {
        for (const t of list) {
          if (t.controllerSeatId !== "me" || !AIMING_KINDS.includes(t.effect.kind)) continue;
          if (t.effect.kind === "add_counter" && !/\btarget\b[^.]*counter|counter[^.]*\btarget\b/i.test(found.oracleText ?? "")) continue;
          checked += 1;
          if (!asks(label === "another enters" ? world([card, mk("newcomer", "Creature — Dragon", { power: "3", toughness: "3" })]) : s, t as never) && !(name in TRIGGER_EXCEPTIONS)) missing.push(`${label}: ${name} (${t.effect.kind})`);
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(5);
    expect(missing).toEqual([]);
  });
  it("Scourge of Valkas: a human is asked who to hit (even with one legal target), and the chosen target is the one hit, not the heuristic's best", () => {
    const scourge = real("Scourge of Valkas", "sv");
    const w = session([seat("me", "human", { battlefield: [scourge] }), seat("opp", "agent", { battlefield: [mk("big", "Creature — Giant", { power: "9", toughness: "9" }), mk("small", "Creature — Bear")] })]);
    const [trigger] = findCommonTriggersForPermanentEntered(w, "me", scourge);
    expect(triggerTargetOptionPrompt(w, trigger, w.seats[0])?.options.length).toBeGreaterThanOrEqual(1);
    const hit = resolveTriggerEffect(w, { ...trigger, effect: { ...trigger.effect, chosenOption: "c:opp:small" } } as never);
    expect(hit.seats[1].board.battlefield.find((c) => c.id === "small")?.damage ?? 0).toBeGreaterThan(0);
    expect(hit.seats[1].board.battlefield.find((c) => c.id === "big")?.damage ?? 0).toBe(0);
    const lone = session([seat("me", "human", { battlefield: [scourge] }), seat("opp", "agent")]);
    expect(triggerTargetOptionPrompt(lone, findCommonTriggersForPermanentEntered(lone, "me", scourge)[0], lone.seats[0])?.options.length).toBeGreaterThanOrEqual(1);
  });
  it("Terror of the Peaks ('deals damage equal to that creature's power to any target') asks a human", () => {
    const newcomer = mk("newcomer", "Creature — Dragon", { power: "4", toughness: "4" });
    const w = session([seat("me", "human", { battlefield: [real("Terror of the Peaks", "top"), newcomer] }), seat("opp", "agent", { battlefield: [mk("only", "Creature — Bear")] })]);
    const [aim] = findCommonTriggersForPermanentEntered(w, "me", newcomer);
    expect(aim.effect.kind).toBe("context_power_damage");
    expect(triggerTargetOptionPrompt(w, aim, w.seats[0])?.options.length).toBeGreaterThanOrEqual(1);
  });
  it("Blood Artist asks a human ('target player') and Scurry of Squirrels asks for its +1/+1 counter creature", () => {
    const w = world([real("Blood Artist", "ba")]);
    const [t] = findCommonTriggersForPermanentDied(w, "me", mk("dead", "Creature — Bear", { zone: "graveyard" })).filter((x) => x.controllerSeatId === "me");
    expect(triggerTargetOptionPrompt(w, t, w.seats[0])?.options.length).toBeGreaterThanOrEqual(1);
    const scurry = real("Scurry of Squirrels", "sq");
    const w2 = session([seat("me", "human", { battlefield: [scurry] }), seat("opp", "agent")]);
    expect(asks(w2, findCombatDamageToPlayerTriggers(w2, "me", scurry, "opp")[0] as never)).toBe(true);
  });
  it("Fear of Sleep Paralysis and Animate Dead prompt with a single legal creature / graveyard creature", () => {
    const fear = real("Fear of Sleep Paralysis", "fear");
    const w = session([seat("me", "human", { battlefield: [fear] }), seat("opp", "agent", { battlefield: [mk("lone", "Creature — Bear")] })]);
    const [t] = findCommonTriggersForPermanentEntered(w, "me", fear);
    expect(triggerCardPrompt(w, t, w.seats[0])?.cards.map((c) => c.cardId)).toContain("lone");
    const ad = real("Animate Dead", "ad");
    const w2 = session([seat("me", "human", { battlefield: [ad] }), seat("opp", "agent", { graveyard: [gy("g1", "Creature — Bear")] })]);
    const [adTrigger] = findCommonTriggersForPermanentEntered(w2, "me", ad);
    expect(triggerCardPrompt(w2, adTrigger, w2.seats[0])?.cards).toEqual([{ seatId: "opp", cardId: "g1" }]);
  });
  it("beginning-of-step triggers (upkeep / end step) of the shipped decks prompt the human (graveyard picks, target counters, aimed one-verb effects)", () => {
    const unprompted: string[] = [];
    const PHASE_EXCEPTIONS: Record<string, string> = {
      "Moseo, Vein's New Dean": "infusion 'up to one target creature card' returns via the Rules Advisor path (not deterministic)",
      "Witch of the Moors": "'return up to one target creature card' rider via the Rules Advisor path (not deterministic)"
    };
    let checked = 0;
    for (const name of deckNames) {
      const found = lookupCard(catalog, name) as { typeLine?: string } | undefined;
      if (!found || /Instant|Sorcery/.test(found.typeLine ?? "")) continue;
      const card = real(name, "src");
      const s = world([card]);
      for (const phase of ["upkeep step", "end step"] as const) {
        const clause = phaseEffectText(card.oracleText, phase);
        if (!clause || !/target|choose/i.test(clause)) continue;
        checked += 1;
        const effect = commonTriggerEffect(clause, "clause", undefined, s.seats[0]);
        const prompted =
          Boolean(humanPhaseGraveyardChoice(s, "me", card, phase)) ||
          isReanimateFromAnyGraveyardPhaseTrigger(card, phase) ||
          (phase === "end step" && isMerenEndStepEffect(card.oracleText)) ||
          Boolean(targetCreatureCounterPhaseTrigger(card, phase)) ||
          effect?.kind === "targeted_effect" ||
          effect?.kind === "modal" ||
          (effect !== undefined && asks(s, makeCommonTrigger("me", "me", card, effect, "x")));
        if (!prompted) unprompted.push(name);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
    expect(unprompted.filter((name) => !(name in PHASE_EXCEPTIONS))).toEqual([]);
  });
});

// ---- 4. Activated abilities, enters-as-removal creatures, single-candidate helpers. ----
describe("a human's ability / enters-effect target is offered even when only one candidate is legal", () => {
  it("'enters, destroy target ...' creatures (Ravenous Chupacabra, Shriekmaw, Acidic Slime, Reclamation Sage) have a target spec with a single legal target", () => {
    const w = world();
    w.seats[1].board.battlefield = [mk("oc", "Creature — Bear"), mk("oa", "Artifact"), mk("oe", "Enchantment"), mk("ol", "Land")];
    for (const name of ["Ravenous Chupacabra", "Shriekmaw", "Acidic Slime", "Reclamation Sage"]) {
      const card = real(name, "etb");
      const text = card.oracleText.split("\n").find((line) => /^When this creature enters/i.test(line)) ?? "";
      const removal = parseRemovalEffect(text);
      expect(removal, name).toBeDefined();
      const spec = removalEffectTargetSpec(removal!, card.id);
      expect(spec, name).toBeDefined();
      expect(legalTargets(w, "me", spec!, card).length, name).toBeGreaterThanOrEqual(1);
    }
  });
  it("Garruk, Cursed Huntsman's -3 ('Destroy target creature. Draw a card.') is an aimed destroy plus a draw rider; Aminatou's -1 (blink) is not mistaken for removal", () => {
    const garruk = real("Garruk, Cursed Huntsman", "g");
    const line = garruk.oracleText.split("\n").find((l) => /Destroy target creature/.test(l))!.replace(/^[−-]\d+:\s*/, "");
    const removal = parseRemovalEffect(line);
    expect(removal?.kind).toBe("destroy");
    expect(commonTriggerEffect(line.split(/(?<=\.)\s+/).slice(1).join(" "), "clause")?.kind).toBe("draw_cards");
    const w = session([seat("me", "human", { battlefield: [garruk] }), seat("opp", "agent", { battlefield: [mk("lone", "Creature — Bear")] })]);
    const spec = removalEffectTargetSpec(removal!, garruk.id);
    expect(legalTargets(w, "me", spec!, garruk).map((t) => (t.kind === "card" ? t.card.id : t.seatId))).toEqual(["lone"]);
  });
  it("graveyard-return abilities (zoneChoiceSpecFor) produce a spec with a single legal card, so the human is asked; none when nothing is legal", () => {
    const w = session([seat("me", "human", { graveyard: [gy("only", "Creature — Bear")] }), seat("opp", "agent")]);
    const effect = parseZoneEffect("Return target creature card from your graveyard to your hand.");
    expect(effect).toBeDefined();
    expect(zoneChoiceSpecFor(w, "me", effect!, mk("src", "Artifact"))).toBeDefined();
    expect(zoneChoiceSpecFor(session([seat("me", "human"), seat("opp", "agent")]), "me", effect!, mk("src", "Artifact"))).toBeUndefined();
  });
});

// ---- 5. Addressing: the prompt reaches only the controlling seat (host or friend) and is answerable through whitelisted intents. ----
describe("target prompts are addressed to the controlling seat and answered through whitelisted intents", () => {
  const choice = (controllerSeatId: string, kind: string) => ({ id: "r", kind, controllerSeatId, sourceCardId: "c", sourceCardName: "X", prompt: "?", cards: [], picked: [], picksNeeded: 1, zone: "battlefield", options: [] }) as unknown as PendingRuleChoice;
  it.each(["choose_trigger_card", "choose_trigger_option", "choose_effect_target", "choose_cast_targets", "choose_labeled_target", "choose_equip_target"])("%s opened for a friend never reaches the host (and vice versa)", (kind) => {
    const friendOwned = { pendingRuleChoice: choice("friend", kind) };
    expect(promptSlotsForSeat(friendOwned, "host").pendingRuleChoice).toBeUndefined();
    expect(promptSlotsForSeat(friendOwned, "friend").pendingRuleChoice).toBeDefined();
    expect(promptSlotsForSeat({ pendingRuleChoice: choice("host", kind) }, "friend").pendingRuleChoice).toBeUndefined();
  });
  it("the intents that answer target prompts exist and are gated by 'answerRule' (only the owner of the open prompt may answer)", () => {
    for (const name of ["onChooseEffectTarget", "onChooseModalOption", "onChooseBattlefieldCreatureTarget", "onChooseGraveyardReanimationTarget", "onChooseEquipTarget", "onDeclineEffectTarget"]) {
      expect((INTENT_SPECS as unknown as Record<string, { when: string }>)[name]?.when, name).toBe("answerRule");
    }
  });
});
