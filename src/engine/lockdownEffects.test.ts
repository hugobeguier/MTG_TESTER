// Debuff / lockdown effects through the shared layer, with real Oracle text: per-player attack bans (Vow of Malice, Combat Calligrapher, Promise of
// Loyalty, Orzhov Advokist), "loses [keyword]" (Archetype of Imagination, Shadowspear), base P/T setters (Sigarda's Summons, Graaz), Gadrak's conditional
// attack restriction, Perch Protection's phasing, Fall from Favor, intimidate/fear.
import { describe, expect, it } from "vitest";
import { canAttack, canBlock, legalAttackActions } from "@/engine/combat";
import { applyDeterministicPhaseTrigger } from "@/engine/triggers";
import { resolveDeferredChoice } from "@/engine/effects";
import { applyGenericAbilityEffect, parseGenericAbilityEffect } from "@/engine/abilities";
import { applyAdvokistChoice, applyPerchProtection, applyPromiseOfLoyalty, attackBannedAgainst } from "@/engine/lockdownEffects";
import { applyCombatDamageToTarget } from "@/engine/damage";
import { runStateBasedActionsPass } from "@/engine/stateBased";
import { clearTemporaryBuffs, untapForSeat } from "@/engine/turnFlow";
import { applyCounterDelta } from "@/engine/zones";
import { hasKeyword } from "@/engine/shared";
import { cantUntap } from "@/lib/combatRestrictions";
import { effectivePower, effectiveToughness } from "@/lib/counters";
import { parseGenericManaAbilities } from "@/lib/activatedAbilities";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { parseConditionalAttackRestriction, parseGroupBaseSet, parseKeywordLossEffect, parseKeywordLossStatics, parseStaticAttackBans } from "@/lib/lockdown";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const bear = (id: string, extra: Partial<VisibleCard> = {}): VisibleCard =>
  ({ id, name: "Bear", typeLine: "Creature — Bear", oracleText: "", manaValue: 2, colors: ["G"], power: "2", toughness: "2", role: "permanent", zone: "battlefield", summoningSick: false, ...extra }) as VisibleCard;
function seat(id: string, battlefield: VisibleCard[], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return { id, name: id, kind: "agent", life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield, graveyard: [] }, ...extra };
}
function session(seats: PlayerSeat[], extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "declare attackers", turn: 5, activePlayerId: seats[0].id, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra } as GameSession;
}
const settle = (s: GameSession) => runStateBasedActionsPass(s).session;
const find = (s: GameSession, id: string) => s.seats.flatMap((x) => x.board.battlefield).find((c) => c.id === id)!;
const seatOf = (s: GameSession, id: string) => s.seats.find((x) => x.id === id)!;
const attackTargets = (s: GameSession, attackerSeatId: string, cardId: string) =>
  legalAttackActions(seatOf(s, attackerSeatId), s.seats.filter((x) => x.id !== attackerSeatId)).filter((a) => a.cardId === cardId).flatMap((a) => a.targetIds);

describe("text readers (real Oracle text)", () => {
  it("static attack bans: Combat Calligrapher bans Inklings only; the Propaganda family is a tax, not a ban", () => {
    expect(parseStaticAttackBans(real("Combat Calligrapher", "x").oracleText)).toEqual([{ subtype: "Inkling" }]);
    expect(parseStaticAttackBans(real("Ghostly Prison", "x").oracleText)).toEqual([]);
    expect(parseStaticAttackBans(real("Archangel of Tithes", "x").oracleText)).toEqual([]);
  });
  it("keyword loss: Archetype of Imagination is a static with 'can't gain'; Shadowspear is an until-end-of-turn effect", () => {
    expect(parseKeywordLossStatics(real("Archetype of Imagination", "x").oracleText)).toEqual([{ type: "creature", controller: "opponents", keywords: ["flying"], cantGain: true }]);
    expect(parseKeywordLossStatics("Permanents your opponents control lose hexproof and indestructible until end of turn.")).toEqual([]);
    expect(parseKeywordLossEffect("Permanents your opponents control lose hexproof and indestructible until end of turn.")).toEqual({ type: "permanent", controller: "opponents", keywords: ["indestructible", "hexproof"] });
  });
  it("group base P/T: Sigarda's Summons and Graaz", () => {
    expect(parseGroupBaseSet(real("Sigarda's Summons", "x").oracleText)).toEqual([{ excludeSelf: false, requiresPlusCounter: true, power: 4, toughness: 4, keywords: ["flying"], addedSubtypes: ["Angel"] }]);
    expect(parseGroupBaseSet(real("Graaz, Unstoppable Juggernaut", "x").oracleText)).toEqual([{ excludeSelf: true, requiresPlusCounter: false, power: 5, toughness: 3, keywords: [], addedSubtypes: ["Juggernaut"] }]);
  });
  it("Gadrak's conditional attack restriction", () => {
    expect(parseConditionalAttackRestriction(real("Gadrak, the Crown-Scourge", "x").oracleText)).toEqual([{ type: "Artifact", count: 4 }]);
  });
});

describe("per-player attack bans", () => {
  it("Vow of Malice: +2/+2, intimidate, and the creature can't attack the Aura's controller (or their planeswalkers) but can attack others", () => {
    const victim = bear("victim", { attachTimestamp: undefined });
    const vow = real("Vow of Malice", "vow", { attachedToId: "victim", attachedToSeatId: "a", attachTimestamp: 3 });
    const s = settle(session([seat("a", [victim]), seat("b", [vow]), seat("c", [])]));
    const v = find(s, "victim");
    expect(v.attachmentCantAttackSeatIds).toEqual(["b"]);
    expect(v.attachmentCantAttack).toBeFalsy(); // not a blanket ban
    expect(effectivePower(v)).toBe(4);
    expect(hasKeyword(v, "intimidate")).toBe(true);
    expect(attackTargets(s, "a", "victim")).toEqual(["c"]);
  });
  it("Vow of Malice stops binding when the Aura leaves", () => {
    const victim = bear("victim");
    const vow = real("Vow of Malice", "vow", { attachedToId: "victim", attachedToSeatId: "a", attachTimestamp: 3 });
    const withAura = settle(session([seat("a", [victim]), seat("b", [vow])]));
    const gone = settle({ ...withAura, seats: withAura.seats.map((x) => ({ ...x, board: { ...x.board, battlefield: x.board.battlefield.filter((c) => c.id !== "vow") } })) });
    expect(attackTargets(gone, "a", "victim")).toEqual(["b"]);
  });
  it("Combat Calligrapher: Inklings can't attack its controller, other creatures can; Calligrapher phased out lifts it", () => {
    const inkling = bear("ink", { name: "Inkling", typeLine: "Token Creature — Inkling", colors: ["W", "B"] });
    const s = settle(session([seat("a", [inkling, bear("bear")]), seat("b", [real("Combat Calligrapher", "cc")]), seat("c", [])]));
    expect(attackTargets(s, "a", "ink")).toEqual(["c"]);
    expect(attackTargets(s, "a", "bear").sort()).toEqual(["b", "c"]);
    const phased = settle({ ...s, seats: s.seats.map((x) => ({ ...x, board: { ...x.board, battlefield: x.board.battlefield.map((c) => (c.id === "cc" ? { ...c, phasedOut: true } : c)) } })) });
    expect(attackTargets(phased, "a", "ink").sort()).toEqual(["b", "c"]);
  });

  describe("Promise of Loyalty", () => {
    const build = () => {
      const a = seat("a", [bear("a-big", { power: "5", toughness: "5" }), bear("a-small")]);
      const b = seat("b", [bear("b-big", { power: "4", toughness: "4" }), bear("b-small"), bear("b-tiny", { power: "1", toughness: "1" })]);
      return session([a, b], { activePlayerId: "b" });
    };
    it("each player keeps one creature with a vow counter and sacrifices the rest; the vowed creature can't attack the caster while the counter stays", () => {
      const after = settle(applyPromiseOfLoyalty(build(), "a", "Promise of Loyalty"));
      expect(seatOf(after, "a").board.battlefield.map((c) => c.id)).toEqual(["a-big"]);
      expect(seatOf(after, "b").board.battlefield.map((c) => c.id)).toEqual(["b-big"]);
      expect(seatOf(after, "b").board.graveyard!.map((c) => c.id).sort()).toEqual(["b-small", "b-tiny"]);
      expect(find(after, "b-big").counters).toEqual([{ kind: "vow", count: 1 }]);
      expect(attackBannedAgainst(seatOf(after, "b"), find(after, "b-big"), seatOf(after, "a"))).toBe(true);
      expect(attackTargets(after, "b", "b-big")).toEqual([]);
      // The caster's own creature is not banned from attacking the caster (irrelevant) and keeps its counter.
      expect(find(after, "a-big").attackBans).toBeUndefined();
    });
    it("losing the vow counter lifts the ban", () => {
      const after = settle(applyPromiseOfLoyalty(build(), "a", "Promise of Loyalty"));
      const lifted = { ...after, seats: after.seats.map((x) => ({ ...x, board: { ...x.board, battlefield: x.board.battlefield.map((c) => (c.id === "b-big" ? applyCounterDelta(c, "vow", -1) : c)) } })) };
      expect(attackTargets(lifted, "b", "b-big")).toEqual(["a"]);
    });
    it("a human is asked which creature to keep; the answer resolves the same way", () => {
      const s = build();
      const humanB: GameSession = { ...s, seats: s.seats.map((x) => (x.id === "b" ? { ...x, kind: "human" as const } : x)) };
      const asked = applyPromiseOfLoyalty(humanB, "a", "Promise of Loyalty");
      const [choice] = asked.pendingPlayerChoices!;
      expect(choice.seatId).toBe("b");
      expect(choice.options.map((o) => o.value).sort()).toEqual(["b-big", "b-small", "b-tiny"]);
      const done = settle(resolveDeferredChoice(asked, "b", choice.sourceCardId, choice.sourceCardName, choice.resolver, choice.data, "b-small"));
      expect(seatOf(done, "b").board.battlefield.map((c) => c.id)).toEqual(["b-small"]);
      expect(attackTargets(done, "b", "b-small")).toEqual([]);
    });
  });

  describe("Orzhov Advokist", () => {
    const build = (bKind: "agent" | "human" = "agent") =>
      session([seat("a", [real("Orzhov Advokist", "adv"), bear("a-bear")]), seat("b", [bear("b-bear")], { kind: bKind })], { phase: "upkeep step" });
    it("the controller puts two +1/+1 counters on its best creature; an agent opponent declines", () => {
      const after = settle(applyDeterministicPhaseTrigger(build(), "a", real("Orzhov Advokist", "adv"), "upkeep step")!);
      const counters = [find(after, "adv"), find(after, "a-bear")].map((c) => c.counters?.find((k) => k.kind === "+1/+1")?.count ?? 0);
      expect(counters.reduce((x, y) => x + y, 0)).toBe(2);
      expect(seatOf(after, "b").creatureAttackBans).toBeUndefined();
    });
    it("a human opponent who accepts gets two counters and can't attack the controller until the controller's next turn", () => {
      const asked = applyDeterministicPhaseTrigger(build("human"), "a", real("Orzhov Advokist", "adv"), "upkeep step")!;
      const choice = asked.pendingPlayerChoices!.find((c) => c.seatId === "b")!;
      expect(choice.options.map((o) => o.value)).toEqual(["b-bear", "none"]);
      const accepted = settle(resolveDeferredChoice(asked, "b", choice.sourceCardId, choice.sourceCardName, choice.resolver, choice.data, "b-bear"));
      expect(find(accepted, "b-bear").counters).toEqual([{ kind: "+1/+1", count: 2 }]);
      expect(attackTargets(accepted, "b", "b-bear")).toEqual([]);
      // A creature that arrives later is bound too (the ban is on the player's creatures).
      const withNew = settle({ ...accepted, seats: accepted.seats.map((x) => (x.id === "b" ? { ...x, board: { ...x.board, battlefield: [...x.board.battlefield, bear("late")] } } : x)) });
      expect(attackTargets(withNew, "b", "late")).toEqual([]);
      // "until your next turn": the controller's untap step ends it.
      const next = settle(untapForSeat(accepted, "a"));
      expect(attackTargets(next, "b", "b-bear")).toEqual(["a"]);
    });
    it("a human who declines gets nothing and no ban", () => {
      const asked = applyDeterministicPhaseTrigger(build("human"), "a", real("Orzhov Advokist", "adv"), "upkeep step")!;
      const choice = asked.pendingPlayerChoices!.find((c) => c.seatId === "b")!;
      const declined = resolveDeferredChoice(asked, "b", choice.sourceCardId, choice.sourceCardName, choice.resolver, choice.data, "none");
      expect(seatOf(declined, "b").creatureAttackBans).toBeUndefined();
      expect(applyAdvokistChoice(declined, "b", undefined, "a", "x")).toBe(declined);
    });
  });
});

describe("loses [keyword] (layer 6, timestamps)", () => {
  const flier = (id: string, extra: Partial<VisibleCard> = {}) => bear(id, { name: "Flier", oracleText: "Flying", ...extra });
  it("Archetype of Imagination: opponents' creatures lose flying and can't gain it (even from a later grant); its controller's keep it", () => {
    const archetype = real("Archetype of Imagination", "arch", { permanentTimestamp: 2 });
    let s = settle(session([seat("a", [archetype, flier("mine")]), seat("b", [flier("theirs")])]));
    expect(hasKeyword(find(s, "theirs"), "flying")).toBe(false);
    expect(hasKeyword(find(s, "mine"), "flying")).toBe(true);
    // Granted AFTER the loss, but "can't have or gain" still blocks it.
    s = settle({ ...s, seats: s.seats.map((x) => ({ ...x, board: { ...x.board, battlefield: x.board.battlefield.map((c) => (c.id === "theirs" ? { ...c, temporaryGrantedKeywords: ["flying"], grantedKeywords: ["flying"] } : c)) } })) });
    expect(hasKeyword(find(s, "theirs"), "flying")).toBe(false);
    // A flying attacker is now blockable by a ground creature.
    expect(canBlock(bear("ground"), find(s, "theirs"), [])).toBe(true);
    // Archetype gone: flying is back.
    const gone = settle({ ...s, seats: s.seats.map((x) => ({ ...x, board: { ...x.board, battlefield: x.board.battlefield.filter((c) => c.id !== "arch") } })) });
    expect(hasKeyword(find(gone, "theirs"), "flying")).toBe(true);
  });
  it("Archetype of Imagination does not touch noncreature permanents or phased-out Archetypes", () => {
    const s = settle(session([seat("a", [real("Archetype of Imagination", "arch", { phasedOut: true })]), seat("b", [flier("theirs")])]));
    expect(hasKeyword(find(s, "theirs"), "flying")).toBe(true);
  });
  it("Shadowspear's ability: opponents' permanents lose hexproof and indestructible until end of turn; later grants stick; gone at the turn change", () => {
    const spear = real("Shadowspear", "spear");
    const ability = parseGenericManaAbilities(spear.oracleText).find((entry) => /lose hexproof/i.test(entry.effectText))!;
    const effect = parseGenericAbilityEffect(ability.effectText)!;
    expect(effect.kind).toBe("lose_keywords");
    const theirs = bear("theirs", { oracleText: "Hexproof\nIndestructible" });
    const base = settle(session([seat("a", [spear]), seat("b", [theirs])]));
    expect(hasKeyword(find(base, "theirs"), "hexproof")).toBe(true);
    const lost = settle(applyGenericAbilityEffect(base, "a", find(base, "spear"), effect));
    expect(hasKeyword(find(lost, "theirs"), "hexproof")).toBe(false);
    expect(hasKeyword(find(lost, "theirs"), "indestructible")).toBe(false);
    expect(hasKeyword(find(lost, "spear"), "hexproof")).toBe(false); // never had it; own permanents are not affected either way
    // A grant made after the loss has a later timestamp and survives.
    const regranted = settle({ ...lost, seats: lost.seats.map((x) => ({ ...x, board: { ...x.board, battlefield: x.board.battlefield.map((c) => (c.id === "theirs" ? { ...c, temporaryGrantedKeywords: ["hexproof"], grantedKeywords: ["hexproof"] } : c)) } })) });
    expect(hasKeyword(find(regranted, "theirs"), "hexproof")).toBe(true);
    expect(hasKeyword(find(regranted, "theirs"), "indestructible")).toBe(false);
    // End of turn.
    const next = settle(clearTemporaryBuffs(lost));
    expect(hasKeyword(find(next, "theirs"), "hexproof")).toBe(true);
    expect(hasKeyword(find(next, "theirs"), "indestructible")).toBe(true);
  });
});

describe("base power/toughness setters", () => {
  it("Sigarda's Summons: creatures with +1/+1 counters are 4/4 flying Angels, counters and pumps on top; others untouched", () => {
    const withCounters = bear("c", { power: "1", toughness: "1", counters: [{ kind: "+1/+1", count: 2 }] });
    const s = settle(session([seat("a", [real("Sigarda's Summons", "ss", { permanentTimestamp: 2 }), withCounters, bear("plain")]), seat("b", [bear("theirs", { counters: [{ kind: "+1/+1", count: 1 }] })])]));
    const c = find(s, "c");
    expect(effectivePower(c)).toBe(6);
    expect(effectiveToughness(c)).toBe(6);
    expect(hasKeyword(c, "flying")).toBe(true);
    expect(c.grantedTypes).toContain("Angel");
    expect(effectivePower(find(s, "plain"))).toBe(2);
    expect(hasKeyword(find(s, "plain"), "flying")).toBe(false);
    expect(effectivePower(find(s, "theirs"))).toBe(3);
  });
  it("timestamp order: a later 'base 1/1' effect beats Sigarda's 4/4, an earlier one is overwritten by it", () => {
    const withCounters = bear("c", { counters: [{ kind: "+1/+1", count: 1 }] });
    const sigarda = (ts: number) => real("Sigarda's Summons", "ss", { permanentTimestamp: ts });
    const aura = (ts: number) => real("Utter Insignificance", "ui", { attachedToId: "c", attachedToSeatId: "a", attachTimestamp: ts });
    expect(effectivePower(find(settle(session([seat("a", [sigarda(2), withCounters, aura(9)])])), "c"))).toBe(2); // 1/1 base + counter
    expect(effectivePower(find(settle(session([seat("a", [sigarda(9), withCounters, aura(2)])])), "c"))).toBe(5); // 4/4 base + counter
  });
  it("Graaz: every other creature you control is a 5/3 Juggernaut; Graaz itself keeps its printed stats", () => {
    const graaz = real("Graaz, Unstoppable Juggernaut", "g", { permanentTimestamp: 2 });
    const s = settle(session([seat("a", [graaz, bear("x", { power: "1", toughness: "1" })]), seat("b", [bear("y")])]));
    expect(effectivePower(find(s, "x"))).toBe(5);
    expect(effectiveToughness(find(s, "x"))).toBe(3);
    expect(find(s, "x").grantedTypes).toContain("Juggernaut");
    expect(effectivePower(find(s, "g"))).toBe(Number(graaz.power));
    expect(effectivePower(find(s, "y"))).toBe(2);
  });
});

describe("Gadrak, the Crown-Scourge", () => {
  const artifact = (id: string) => ({ id, name: "Rock", typeLine: "Artifact", oracleText: "", manaValue: 1, colors: [], role: "permanent", zone: "battlefield" }) as VisibleCard;
  it("can't attack unless its controller controls four or more artifacts (Gadrak itself is not one)", () => {
    const gadrak = real("Gadrak, the Crown-Scourge", "gad");
    const three = [gadrak, artifact("1"), artifact("2"), artifact("3")];
    expect(canAttack(gadrak, three)).toBe(false);
    const four = [...three, artifact("4")];
    expect(canAttack(gadrak, four)).toBe(true);
    // Phased-out artifacts don't count, and a Gadrak that loses its abilities is no longer restricted.
    expect(canAttack(gadrak, [...three, { ...artifact("4"), phasedOut: true }])).toBe(false);
    expect(canAttack({ ...gadrak, abilitiesStripped: true }, three)).toBe(true);
  });
  it("is not offered as an attacker while the condition fails", () => {
    const gadrak = real("Gadrak, the Crown-Scourge", "gad");
    const s = session([seat("a", [gadrak, artifact("1")]), seat("b", [])]);
    expect(attackTargets(s, "a", "gad")).toEqual([]);
  });
});

describe("Perch Protection (gift promised)", () => {
  it("all your permanents phase out; you can't be damaged until your next turn; they phase in at your next untap", () => {
    const s = settle(applyPerchProtection(session([seat("a", [bear("m1"), bear("m2")]), seat("b", [bear("opp")])]), "a", "Perch Protection"));
    expect(find(s, "m1").phasedOut).toBe(true);
    expect(find(s, "m2").phasedOut).toBe(true);
    expect(find(s, "opp").phasedOut).toBeFalsy();
    expect(seatOf(s, "a").lockedUntilSeatTurn).toBe(true);
    const hit = applyCombatDamageToTarget(s, "Bear", { seat: seatOf(s, "a") }, 5, find(s, "opp"), "b");
    expect(seatOf(hit, "a").life).toBe(40);
    // The opponent's untap does not bring them back; the owner's does.
    const oppTurn = untapForSeat(s, "b");
    expect(find(oppTurn, "m1").phasedOut).toBe(true);
    expect(seatOf(oppTurn, "a").lockedUntilSeatTurn).toBe(true);
    const myTurn = settle(untapForSeat(s, "a"));
    expect(find(myTurn, "m1").phasedOut).toBe(false);
    expect(seatOf(myTurn, "a").lockedUntilSeatTurn).toBeUndefined();
    const hitLater = applyCombatDamageToTarget(myTurn, "Bear", { seat: seatOf(myTurn, "a") }, 5, find(myTurn, "opp"), "b");
    expect(seatOf(hitLater, "a").life).toBe(35);
  });
});

describe("other static lockdowns", () => {
  it("Fall from Favor: doesn't untap unless the controller is the monarch", () => {
    const aura = real("Fall from Favor", "ff", { attachedToId: "v" });
    const victim = bear("v");
    expect(cantUntap(victim as never, [victim, aura] as never[], { controllerSeatId: "a", monarchSeatId: "b" })).toBe(true);
    expect(cantUntap(victim as never, [victim, aura] as never[], { controllerSeatId: "a", monarchSeatId: "a" })).toBe(false);
    const tapped = { ...victim, tapped: true };
    const locked = untapForSeat(session([seat("a", [tapped, aura]), seat("b", [])], { monarchSeatId: "b" }), "a");
    expect(find(locked, "v").tapped).toBe(true);
    const monarch = untapForSeat(session([seat("a", [tapped, aura]), seat("b", [])], { monarchSeatId: "a" }), "a");
    expect(find(monarch, "v").tapped).toBe(false);
  });
  it("intimidate and fear restrict blockers (Mikaeus, Shriekmaw); an artifact creature can always block", () => {
    const mikaeus = real("Mikaeus, the Unhallowed", "mik");
    const green = bear("green");
    const black = bear("black", { colors: ["B"] });
    const artifactBear = bear("art", { typeLine: "Artifact Creature — Golem", colors: [] });
    expect(canBlock(green, mikaeus, [])).toBe(false);
    expect(canBlock(black, mikaeus, [])).toBe(true);
    expect(canBlock(artifactBear, mikaeus, [])).toBe(true);
    const shriekmaw = real("Shriekmaw", "shr");
    const red = bear("red", { colors: ["R"] });
    expect(canBlock(red, shriekmaw, [])).toBe(false);
    expect(canBlock(black, shriekmaw, [])).toBe(true);
  });
});
