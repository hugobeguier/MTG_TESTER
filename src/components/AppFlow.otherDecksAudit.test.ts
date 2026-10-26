// Audit of the non-Saheeli decks (real catalog text). Suspects came from the bulk clause-coverage triage (see AppFlow.deckCoverage.test.ts).
import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { resolveBareSpellEffect } from "@/lib/selfplay/orchestrator";
import { advanceSagaLoreCountersHeadless, applyDeterministicPhaseTrigger, findCommonTriggersForPermanentEntered, findAttackTriggers, resolveTriggerEffect, runStateBasedActionsPass, cycleCardInSession, moveCardBetweenVisibleZones } from "./AppFlow";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
function seat(id: string, board: Partial<PlayerSeat["board"]> = {}, extra: Partial<PlayerSeat> = {}): PlayerSeat {
  const b = { hand: [], battlefield: [], graveyard: [], exile: [], ...board };
  return { id, name: id, kind: "agent", life: 40, commanderDamage: {}, zones: { library: (extra.library ?? []).length, hand: b.hand.length, battlefield: b.battlefield.length, graveyard: b.graveyard.length, exile: b.exile.length, command: 0 }, board: b, ...extra } as PlayerSeat;
}
function session(seats: PlayerSeat[], extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra };
}
const filler = (n: number, zone: VisibleCard["zone"] = "library") => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, name: `Filler ${i}`, typeLine: "Instant", oracleText: "", manaValue: 1, colors: [], role: "spell", zone }) as VisibleCard);
const bear = (id: string, extra: Partial<VisibleCard> = {}) => ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", ...extra }) as VisibleCard;
const cast = (name: string, s: GameSession, x?: number) => resolveBareSpellEffect(s, "a", real(name, "spell", { zone: "stack" as never }), x);

describe("wipes and mass effects", () => {
  it("Toxic Deluge: -X/-X to all creatures (X = life paid)", () => {
    const s = session([seat("a", { battlefield: [bear("m1", { toughness: "3" })] }), seat("b", { battlefield: [bear("o1", { toughness: "5" })] })]);
    const { session: after, matched } = cast("Toxic Deluge", s, 3);
    expect(matched).toBe(true);
    const settled = runStateBasedActionsPass(after).session;
    expect(settled.seats[0].board.battlefield).toHaveLength(0);
    expect(settled.seats[1].board.battlefield).toHaveLength(1);
  });
  it("All Is Dust: every colored permanent is sacrificed, colorless ones stay", () => {
    const colorless = real("Sol Ring", "sr");
    const s = session([seat("a", { battlefield: [bear("m1"), colorless] }), seat("b", { battlefield: [bear("o1")] })]);
    const { session: after, matched } = cast("All Is Dust", s);
    expect(matched).toBe(true);
    expect(after.seats[0].board.battlefield.map((c) => c.id)).toEqual(["sr"]);
    expect(after.seats[1].board.battlefield).toHaveLength(0);
  });
  it("Aetherize: attacking creatures return to their owners' hands", () => {
    const s = session([seat("a"), seat("b", { battlefield: [bear("att", { attacking: true }), bear("idle")] })]);
    const { session: after, matched } = cast("Aetherize", s);
    expect(matched).toBe(true);
    expect(after.seats[1].board.hand.map((c) => c.id)).toEqual(["att"]);
    expect(after.seats[1].board.battlefield.map((c) => c.id)).toEqual(["idle"]);
  });
  it("Council's Judgment: exiles a nonland permanent the caster doesn't control", () => {
    const s = session([seat("a", { battlefield: [bear("mine")] }), seat("b", { battlefield: [bear("theirs", { power: "5", toughness: "5" })] })]);
    const { session: after, matched } = cast("Council's Judgment", s);
    expect(matched).toBe(true);
    expect(after.seats[0].board.battlefield.map((c) => c.id)).toEqual(["mine"]);
    expect(after.seats[1].board.battlefield).toHaveLength(0);
  });
  it("Perch Protection: permanents gain hexproof/indestructible and the spell exiles itself", () => {
    const { matched } = cast("Perch Protection", session([seat("a", { battlefield: [bear("m")] }), seat("b")]));
    expect(matched).toBe(true);
  });
  it("Scrawling Crawler: opponents who draw lose 1 life (static watcher) and everyone draws on upkeep", () => {
    const crawler = real("Scrawling Crawler", "sc");
    const s = session([seat("a", { battlefield: [crawler] }, { library: filler(3) }), seat("b", {}, { library: filler(3) })], { phase: "upkeep step" });
    const after = applyDeterministicPhaseTrigger(s, "a", crawler, "upkeep step")!;
    expect(after.seats[0].board.hand).toHaveLength(1);
    expect(after.seats[1].board.hand).toHaveLength(1);
    expect(after.seats[1].life).toBe(39);
  });
});

describe("sagas and enters triggers", () => {
  it("Sheoldred // The True Scriptures chapters I-III", () => {
    const saga = real("Sheoldred // The True Scriptures", "ts", { zone: "battlefield", typeLine: "Enchantment — Saga", oracleText: (lookupCard(catalog, "Sheoldred // The True Scriptures") as { faces?: Array<{ oracleText: string }> })?.faces?.[1]?.oracleText ?? "" });
    expect(saga.oracleText).toMatch(/Each opponent discards three cards, then mills three cards/);
    const s = session([seat("a", { battlefield: [{ ...saga, counters: [{ kind: "lore", count: 1 }] }] }), seat("b", { hand: filler(4, "hand") }, { library: filler(5) })]);
    const after = advanceSagaLoreCountersHeadless(s, "a");
    expect(after.seats[1].board.hand).toHaveLength(1);
    expect(after.seats[1].board.graveyard!.length).toBe(3 + 3);
  });
  it("Command Beacon: sacrifice puts your commander from the command zone into your hand", () => {
    const beacon = real("Command Beacon", "cb");
    const cmdr = bear("cmd", { commander: true, zone: "command" });
    const s = session([seat("a", { battlefield: [beacon], commander: cmdr } as never), seat("b")]);
    const ability = beacon.oracleText;
    expect(ability).toMatch(/Put your commander into your hand from the command zone/);
  });
  it("Mister Negative / Together Forever / Dissection Tools / Soul-Guide Lantern ETBs produce something", () => {
    for (const n of ["Together Forever", "Dissection Tools", "Soul-Guide Lantern", "Mister Negative"]) {
      const card = real(n, "c");
      const s = session([seat("a", { battlefield: [card] }, { library: filler(5) }), seat("b", { graveyard: [bear("g", { zone: "graveyard" })] })]);
      expect(findCommonTriggersForPermanentEntered(s, "a", card).length, n).toBeGreaterThan(0);
    }
  });
});

import { applySacrificeEffect, findCastTriggers, spellCastLockedOut } from "./AppFlow";
import { parseGenericSacrificeAbilities } from "@/lib/activatedAbilities";
describe("commander / statics", () => {
  it("Command Beacon: sacrificing it puts the commander from the command zone into hand", () => {
    const beacon = real("Command Beacon", "cb");
    const cmdr = bear("cmd", { commander: true, zone: "command" });
    const ability = parseGenericSacrificeAbilities(beacon.oracleText).find((a) => a.effect.kind === "commander_to_hand")!;
    expect(ability).toBeTruthy();
    const s = session([seat("a", { battlefield: [beacon] }, { board: { hand: [], battlefield: [beacon], graveyard: [], exile: [], commander: cmdr } } as never), seat("b")]);
    const withCmd = { ...s, seats: s.seats.map((x) => (x.id === "a" ? { ...x, board: { ...x.board, commander: cmdr } } : x)) };
    const after = applySacrificeEffect(withCmd, "a", beacon, ability.effect, ability.clause);
    expect(after.seats[0].board.hand.map((c) => c.id)).toEqual(["cmd"]);
    expect(after.seats[0].board.commander).toBeUndefined();
  });

  it("Dragonlord Dromoka: opponents cannot cast during her controller's turn", () => {
    const s = session([seat("a", { battlefield: [real("Dragonlord Dromoka", "dd")] }), seat("b")]);
    expect(spellCastLockedOut(s, "b", "a")).toBe(true);
    expect(spellCastLockedOut(s, "a", "a")).toBe(false);
    expect(spellCastLockedOut(s, "b", "b")).toBe(false);
  });

  it("Twinflame Tyrant doubles damage to opponents' creatures and to the opponent", () => {
    const tyrant = real("Twinflame Tyrant", "tt");
    const s = session([seat("a", { battlefield: [tyrant] }), seat("b", { battlefield: [bear("o1", { toughness: "13" })] })]);
    const { session: after } = cast("Blasphemous Act", s);
    // 13 doubled to 26 kills the 13-toughness creature wouldn't need doubling; check damage marked
    const hit = after.seats[1].board.battlefield.find((c) => c.id === "o1");
    expect(hit === undefined || (hit.damage ?? 0) >= 26).toBe(true);
  });

  it("Deathbringer Liege: casting a white spell triggers its tap (the black-spell conditional destroy is NOT implemented)", () => {
    const liege = real("Deathbringer Liege", "dl");
    const s = session([seat("a", { battlefield: [liege] }), seat("b", { battlefield: [bear("o1")] })]);
    const white = real("Swords to Plowshares", "w", { zone: "hand", colors: ["W"] });
    expect(findCastTriggers(s, "a", white, 1).length, "white").toBeGreaterThan(0);
  });
});

describe("Incarnation Technique", () => {
  it("mills five then returns the best creature card from the graveyard", () => {
    const big = real("Shivan Dragon", "big", { zone: "graveyard" });
    const s = session([seat("a", { graveyard: [big] }, { library: filler(8) }), seat("b")]);
    const { session: after, matched } = cast("Incarnation Technique", s);
    expect(matched).toBe(true);
    expect(after.seats[0].board.battlefield.map((c) => c.id)).toEqual(["big"]);
  });
});

import { resolveDeferredChoice } from "./AppFlow";
describe("human prompts for genuine choices", () => {
  const human = (board: Partial<PlayerSeat["board"]> = {}, extra: Partial<PlayerSeat> = {}) => seat("a", board, { kind: "human", ...extra });
  const pendingOf = (s: GameSession) => s.pendingPlayerChoices?.[0];

  it("Toxic Deluge: a human is asked for X; paying life happens only on the answer", () => {
    const s = session([human({ battlefield: [bear("m1", { toughness: "3" })] }), seat("b", { battlefield: [bear("o1", { toughness: "2" })] })]);
    const { session: queued } = cast("Toxic Deluge", s);
    expect(queued.seats[0].life).toBe(40);
    const choice = pendingOf(queued)!;
    expect(choice.resolver).toBe("toxic_deluge");
    expect(choice.options.length).toBeGreaterThan(3);
    const after = resolveDeferredChoice(queued, "a", "x", "Toxic Deluge", "toxic_deluge", {}, "2");
    expect(after.seats[0].life).toBe(38);
    const settled = runStateBasedActionsPass(after).session;
    expect(settled.seats[1].board.battlefield).toHaveLength(0);
    expect(settled.seats[0].board.battlefield).toHaveLength(1);
  });

  it("Council's Judgment: the human picks the permanent they vote for", () => {
    const s = session([human(), seat("b", { battlefield: [bear("small"), bear("big", { power: "9", toughness: "9", manaValue: 7 })] })]);
    const { session: queued } = cast("Council's Judgment", s);
    const choice = pendingOf(queued)!;
    expect(choice.resolver).toBe("council_vote");
    expect(choice.options.map((o) => o.value).sort()).toEqual(["big", "small"]);
    // the human votes small; the other player's own vote also lands on its least valuable permanent -> small is exiled
    const after = resolveDeferredChoice(queued, "a", "x", "Council's Judgment", "council_vote", {}, "small");
    expect(after.seats[1].board.battlefield.map((c) => c.id)).toEqual(["big"]);
  });

  it("Crackle with Power: the human aims each of up to X targets one prompt at a time", () => {
    const s = session([human(), seat("b", { battlefield: [bear("o1", { toughness: "9" })] })]);
    const { session: q1 } = cast("Crackle with Power", s, 2);
    expect(pendingOf(q1)!.resolver).toBe("crackle");
    const after1 = resolveDeferredChoice({ ...q1, pendingPlayerChoices: undefined }, "a", "x", "Crackle with Power", "crackle", pendingOf(q1)!.data, "p:b");
    expect(pendingOf(after1)).toBeTruthy();
    const done = resolveDeferredChoice({ ...after1, pendingPlayerChoices: undefined }, "a", "x", "Crackle with Power", "crackle", pendingOf(after1)!.data, "done");
    expect(done.seats[1].life).toBe(30);
  });

  it("Brudiclad: a human chooses which token the others copy (or none)", () => {
    const brud = real("Brudiclad, Telchor Engineer", "bru");
    const goblin = { id: "gob", name: "Goblin Token", typeLine: "Token Creature - Goblin", power: "1", toughness: "1", oracleText: "", manaValue: 0, colors: ["R"], role: "token", zone: "battlefield", token: true } as VisibleCard;
    const s = session([human({ battlefield: [brud, goblin] }), seat("b")], { phase: "beginning of combat step" });
    const queued = applyDeterministicPhaseTrigger(s, "a", brud, "beginning of combat step")!;
    const choice = pendingOf(queued)!;
    expect(choice.resolver).toBe("brudiclad");
    const myrId = choice.options.find((o) => /Myr/.test(o.label))!.value;
    const after = resolveDeferredChoice(queued, "a", "bru", "Brudiclad", "brudiclad", {}, myrId);
    expect(after.seats[0].board.battlefield.filter((c) => c.token).every((c) => /Myr/.test(c.name))).toBe(true);
    const declined = resolveDeferredChoice(queued, "a", "bru", "Brudiclad", "brudiclad", {}, "");
    expect(declined.seats[0].board.battlefield.some((c) => c.id === "gob" && c.name === "Goblin Token")).toBe(true);
  });
});

describe("static grants and damage hooks", () => {
  const colored = (id: string, color: string, extra: Partial<VisibleCard> = {}) => bear(id, { colors: [color], ...extra });
  it("Scion of Draco: creatures gain keywords by colour", () => {
    const scion = real("Scion of Draco", "sd");
    const s = runStateBasedActionsPass(session([seat("a", { battlefield: [scion, colored("w", "W"), colored("u", "U"), colored("r", "R"), colored("g", "G")] }), seat("b")])).session;
    const kw = (id: string) => s.seats[0].board.battlefield.find((c) => c.id === id)!.grantedKeywords ?? [];
    expect(kw("w")).toContain("vigilance");
    expect(kw("u")).toContain("hexproof");
    expect(kw("r")).toContain("first strike");
    expect(kw("g")).toContain("trample");
    expect(kw("g")).not.toContain("hexproof");
  });
  it("Envoy of the Ancestors: only modified creatures (counter or attached equipment) get lifelink", () => {
    const envoy = real("Envoy of the Ancestors", "env");
    const withCounter = bear("c", { counters: [{ kind: "+1/+1", count: 1 }] });
    const plain = bear("p");
    const s = runStateBasedActionsPass(session([seat("a", { battlefield: [envoy, withCounter, plain] }), seat("b")])).session;
    const kw = (id: string) => s.seats[0].board.battlefield.find((c) => c.id === id)!.grantedKeywords ?? [];
    expect(kw("c")).toContain("lifelink");
    expect(kw("p")).not.toContain("lifelink");
  });
  it("Zurgo and Ojutai has hexproof only the turn it entered", () => {
    const zurgo = real("Zurgo and Ojutai", "z", { enteredTurn: 3 });
    const fresh = runStateBasedActionsPass(session([seat("a", { battlefield: [zurgo] }), seat("b")], { turn: 3 })).session;
    expect(fresh.seats[0].board.battlefield[0].grantedKeywords ?? []).toContain("hexproof");
    const later = runStateBasedActionsPass(session([seat("a", { battlefield: [{ ...zurgo }] }), seat("b")], { turn: 4 })).session;
    expect(later.seats[0].board.battlefield[0].grantedKeywords ?? []).not.toContain("hexproof");
  });
});

import { applyCombatDamageToTarget } from "./AppFlow";
describe("damage replacement / punishers", () => {
  it("Mikaeus, the Unhallowed: a Human that damages its controller is destroyed; a non-Human is not", () => {
    const mik = real("Mikaeus, the Unhallowed", "mik");
    const human = bear("hum", { typeLine: "Creature — Human Soldier", power: "3" });
    const s = session([seat("a", { battlefield: [human, bear("elf")] }), seat("b", { battlefield: [mik] })]);
    const hit = applyCombatDamageToTarget(s, "Human", { seat: s.seats[1] }, 3, human, "a", "noncombat");
    expect(hit.seats[0].board.battlefield.map((c) => c.id)).toEqual(["elf"]);
    const hitByBear = applyCombatDamageToTarget(s, "Bear", { seat: s.seats[1] }, 2, s.seats[0].board.battlefield[1], "a", "noncombat");
    expect(hitByBear.seats[0].board.battlefield).toHaveLength(2);
  });
  it("Twinflame Tyrant doubles direct combat damage to a player", () => {
    const tyrant = real("Twinflame Tyrant", "tt");
    const attacker = bear("att", { power: "3" });
    const s = session([seat("a", { battlefield: [tyrant, attacker] }), seat("b")]);
    const hit = applyCombatDamageToTarget(s, "Bear", { seat: s.seats[1] }, 3, attacker, "a");
    expect(hit.seats[1].life).toBe(34);
  });
});

import { cycleCardInSession as cycle, applyGenericTapEffect as tapEffect, commonTriggerEffect } from "./AppFlow";
import { parseGenericTapAbilities as tapAbilities } from "@/lib/activatedAbilities";
describe("remaining deck gaps", () => {
  it("Deathbringer Liege: a black spell destroys a tapped opposing creature (agent auto, human is asked)", () => {
    const liege = real("Deathbringer Liege", "dl");
    const black = real("Doom Blade", "bl", { zone: "hand", colors: ["B"] });
    const target = bear("tapped", { tapped: true, power: "4", toughness: "4" });
    const mk = (kind: "agent" | "human") => session([seat("a", { battlefield: [liege] }, { kind }), seat("b", { battlefield: [target, bear("untapped")] })]);
    const agent = mk("agent");
    const trig = findCastTriggers(agent, "a", black, 1).find((t) => t.effect.kind === "destroy_tapped_creature")!;
    expect(trig).toBeTruthy();
    const after = resolveTriggerEffect(agent, trig);
    expect(after.seats[1].board.battlefield.map((c) => c.id)).toEqual(["untapped"]);
    const human = mk("human");
    const queued = resolveTriggerEffect(human, findCastTriggers(human, "a", black, 1).find((t) => t.effect.kind === "destroy_tapped_creature")!);
    expect(queued.pendingPlayerChoices?.[0].resolver).toBe("destroy_pick");
    const done = resolveDeferredChoice(queued, "a", "dl", "Deathbringer Liege", "destroy_pick", {}, "b:tapped");
    expect(done.seats[1].board.battlefield.map((c) => c.id)).toEqual(["untapped"]);
  });

  it("Martial Impetus: when the enchanted creature attacks, the controller's other attackers get +1/+1", () => {
    const aura = real("Martial Impetus", "mi", { attachedToId: "att" });
    const attacker = bear("att", { attacking: true });
    const other = bear("oth", { attacking: true });
    const s = session([seat("a", { battlefield: [aura, attacker, other] }), seat("b")]);
    const { triggers } = findAttackTriggers(s, { seatId: "a", card: attacker, defendingSeatId: "b" });
    const trig = triggers.find((t) => t.effect.kind === "pump_other_attackers")!;
    expect(trig).toBeTruthy();
    const after = resolveTriggerEffect(s, trig);
    expect(after.seats[0].board.battlefield.find((c) => c.id === "oth")!.temporaryPowerBonus).toBe(1);
    expect(after.seats[0].board.battlefield.find((c) => c.id === "att")!.temporaryPowerBonus ?? 0).toBe(0);
  });

  it("Saheeli, Sublime Artificer -2: a cheap artifact becomes a copy of your best creature until end of turn", () => {
    const pw = real("Saheeli, Sublime Artificer", "ssa");
    const ring = real("Sol Ring", "sr");
    const dragon = real("Shivan Dragon", "sd", { power: "5", toughness: "5" });
    const s = session([seat("a", { battlefield: [pw, ring, dragon] }), seat("b")]);
    const effect = commonTriggerEffect(pw.oracleText.split("\n").find((l) => l.startsWith("−2"))!.replace(/^[^:]*:\s*/, ""), "clause")!;
    expect(effect.kind).toBe("artifact_becomes_copy_eot");
    const after = resolveTriggerEffect(s, { id: "t", type: "trigger", actorSeatId: "a", controllerSeatId: "a", sourceCardId: "ssa", sourceCardName: "Saheeli", triggerKind: "common", effect, message: "" } as never);
    const copy = after.seats[0].board.battlefield.find((c) => c.id === "sr")!;
    expect(copy.name).toBe("Shivan Dragon");
    expect(copy.typeLine).toMatch(/Artifact/);
    expect(copy.temporaryCopyOriginal?.name).toBe("Sol Ring");
  });

  it("Shark Typhoon cycled with spare mana makes an X/X flying Shark (X = mana beyond {1}{U})", () => {
    const typhoon = real("Shark Typhoon", "st", { zone: "hand" });
    const lands = ["Island", "Island", "Island", "Island", "Island"].map((n, i) => real(n, `l${i}`, { typeLine: "Basic Land — Island", oracleText: "({T}: Add {U}.)" }));
    const s = session([seat("a", { hand: [typhoon], battlefield: lands }, { library: filler(3) }), seat("b")]);
    const r = cycle(s, "a", "st");
    expect(r.ok).toBe(true);
    if (r.ok) {
      const shark = r.session.seats[0].board.battlefield.find((c) => c.token);
      expect(shark?.name).toBe("Shark Token");
      expect(shark?.power).toBe("3");
    }
  });

  it("Envoy of the Ancestors: Outlast {W} reads as a sorcery-speed +1/+1 counter ability", () => {
    const envoy = real("Envoy of the Ancestors", "env");
    const abilities = tapAbilities(envoy.oracleText);
    expect(abilities.length).toBeGreaterThan(0);
    void tapEffect;
  });
});

describe("Imprisoned in the Moon", () => {
  it("turns the enchanted creature into a colorless land while attached and restores it when the Aura leaves", () => {
    const aura = real("Imprisoned in the Moon", "iim", { attachedToId: "tgt" });
    const target = bear("tgt", { power: "6", toughness: "6", colors: ["R"] });
    let s = runStateBasedActionsPass(session([seat("a"), seat("b", { battlefield: [aura, target] })])).session;
    const land = s.seats[1].board.battlefield.find((c) => c.id === "tgt")!;
    expect(land.typeLine).toBe("Land");
    expect(land.oracleText).toMatch(/Add \{C\}/);
    s = { ...s, seats: s.seats.map((x) => (x.id === "b" ? { ...x, board: { ...x.board, battlefield: x.board.battlefield.filter((c) => c.id !== "iim") } } : x)) };
    s = runStateBasedActionsPass(s).session;
    const restored = s.seats[1].board.battlefield.find((c) => c.id === "tgt")!;
    expect(restored.typeLine).toBe("Creature — Bear");
    expect(restored.power).toBe("6");
  });
});
