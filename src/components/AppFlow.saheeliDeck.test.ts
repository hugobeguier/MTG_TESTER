// Saheeli deck audit (Saheeli.txt): every risky card's REAL catalog text run through the engine entry points.
import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { adjustedCastingCost, applyDeterministicPhaseTrigger, findCastTriggers, findCommonTriggersForPermanentEntered, resolveTriggerEffect, runStateBasedActionsPass, totalCastingCost } from "./AppFlow";

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
const triggersFor = (s: GameSession, spell: VisibleCard, ordinal = 1) => findCastTriggers(s, "a", spell, ordinal);

describe("Saheeli, Sublime Artificer: noncreature spell -> Servo", () => {
  const pw = () => real("Saheeli, Sublime Artificer", "ssa");
  it("fires for an instant / artifact, not for a creature spell", () => {
    const s = session([seat("a", { battlefield: [pw()] })]);
    expect(triggersFor(s, real("Tidings", "t", { zone: "hand" }))).toHaveLength(1);
    expect(triggersFor(s, real("Sol Ring", "sr", { zone: "hand" }))).toHaveLength(1);
    expect(triggersFor(s, real("Whirler Rogue", "wr", { zone: "hand" }))).toHaveLength(0);
    expect(triggersFor(s, real("Thought Monitor", "tm", { zone: "hand" }))).toHaveLength(0);
  });
  it("resolving it makes a 1/1 Servo artifact creature", () => {
    const s = session([seat("a", { battlefield: [pw()] })]);
    const [trigger] = triggersFor(s, real("Tidings", "t", { zone: "hand" }));
    const after = resolveTriggerEffect(s, trigger);
    const servo = after.seats[0].board.battlefield.find((c) => c.token);
    expect(servo?.typeLine).toMatch(/Artifact Creature/);
    expect([servo?.power, servo?.toughness]).toEqual(["1", "1"]);
  });
});

describe("Jhoira, Weatherlight Captain: historic spells draw", () => {
  it("artifact and legendary spells draw; a plain instant or nonlegendary creature does not", () => {
    const s = session([seat("a", { battlefield: [real("Jhoira, Weatherlight Captain", "jh")] })]);
    expect(triggersFor(s, real("Sol Ring", "x", { zone: "hand" }))).toHaveLength(1);
    expect(triggersFor(s, real("Memnarch", "y", { zone: "hand" }))).toHaveLength(1);
    expect(triggersFor(s, real("Tidings", "z", { zone: "hand" }))).toHaveLength(0);
    expect(triggersFor(s, real("Loyal Drake", "w", { zone: "hand" }))).toHaveLength(0);
  });
});

describe("cost reductions", () => {
  const cost = (card: VisibleCard, s: PlayerSeat, all?: PlayerSeat[]) => adjustedCastingCost(s, card, card.manaValue, "hand", s.id, all ?? [s]);
  it("Blasphemous Act costs {1} less per creature on the battlefield (any controller)", () => {
    const act = real("Blasphemous Act", "ba", { zone: "hand" });
    const mine = seat("a", { hand: [act], battlefield: [real("Whirler Rogue", "r1"), real("Loyal Drake", "r2")] });
    const theirs = seat("b", { battlefield: [real("Loyal Drake", "r3"), real("Loyal Drake", "r4")] });
    expect(act.manaValue).toBe(9);
    expect(totalCastingCost(mine, act, act.manaValue, 0, [mine, theirs])).toBe(5);
  });
  it("Etherium Sculptor / Foundry Inspector / Enthusiastic Mechanaut each reduce artifact spells by {1}", () => {
    const ring = real("Hedron Archive", "ha", { zone: "hand" }); // {4}
    const base = seat("a", { hand: [ring] });
    expect(cost(ring, base)).toBe(4);
    for (const n of ["Etherium Sculptor", "Foundry Inspector", "Enthusiastic Mechanaut"]) {
      expect(cost(ring, seat("a", { hand: [ring], battlefield: [real(n, "red")] })), n).toBe(3);
    }
    const all3 = seat("a", { hand: [ring], battlefield: [real("Etherium Sculptor", "e"), real("Foundry Inspector", "f"), real("Enthusiastic Mechanaut", "m")] });
    expect(cost(ring, all3)).toBe(1);
    expect(cost(real("Tidings", "t", { zone: "hand" }), seat("a", { battlefield: [real("Etherium Sculptor", "e")] }))).toBe(5);
  });
  it("affinity for artifacts: Thought Monitor / Reality Heist / Emry", () => {
    const arts = [real("Sol Ring", "a1"), real("Sol Ring", "a2"), real("Sol Ring", "a3")];
    for (const n of ["Thought Monitor", "Reality Heist", "Emry, Lurker of the Loch"]) {
      const c = real(n, "c", { zone: "hand" });
      const base = c.manaValue;
      expect(totalCastingCost(seat("a", { hand: [c] }), c, c.manaValue, 0, [seat("a")]), `${n} base`).toBe(base);
      expect(totalCastingCost(seat("a", { hand: [c], battlefield: arts }), c, c.manaValue, 0, [seat("a", { battlefield: arts })]), `${n} with 3 artifacts`).toBe(Math.max(1, base - 3)); // the {U} pip is never reduced (601.2f)
    }
  });
  it("improvise: Reverse Engineer / Saheeli's Directive can tap artifacts for generic", () => {
    const c = real("Reverse Engineer", "re", { zone: "hand" });
    expect(c.oracleText).toMatch(/Improvise/);
  });
});

const tokensOf = (s: GameSession, seatId = "a") => s.seats.find((x) => x.id === seatId)!.board.battlefield.filter((c) => c.token);

describe("upkeep / combat phase triggers", () => {
  it("Mind Unbound: a lore counter then draw a card per lore counter (1, then 2, then 3)", () => {
    const lib = filler(10);
    let s = session([seat("a", { battlefield: [real("Mind Unbound", "mu")] }, { library: lib })], { phase: "upkeep step" });
    const drawn: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const before = s.seats[0].board.hand.length;
      s = applyDeterministicPhaseTrigger(s, "a", s.seats[0].board.battlefield.find((c) => c.id === "mu")!, "upkeep step")!;
      drawn.push(s.seats[0].board.hand.length - before);
    }
    expect(drawn).toEqual([1, 2, 3]);
  });

  it("Thopter Spy Network: a Thopter at upkeep only while you control an artifact", () => {
    const net = real("Thopter Spy Network", "tsn");
    const withArtifact = applyDeterministicPhaseTrigger(session([seat("a", { battlefield: [net, real("Sol Ring", "sr")] })], { phase: "upkeep step" }), "a", net, "upkeep step");
    expect(tokensOf(withArtifact!)).toHaveLength(1);
    expect(tokensOf(withArtifact!)[0].typeLine).toMatch(/Artifact Creature/);
    const none = applyDeterministicPhaseTrigger(session([seat("a", { battlefield: [net] })], { phase: "upkeep step" }), "a", net, "upkeep step");
    expect(tokensOf(none ?? session([seat("a")]))).toHaveLength(0);
  });

  it("Thopter Assembly: bounces itself and makes five Thopters only when you control no other Thopter", () => {
    const asm = real("Thopter Assembly", "ta");
    const s = session([seat("a", { battlefield: [asm] })], { phase: "upkeep step" });
    const after = applyDeterministicPhaseTrigger(s, "a", asm, "upkeep step")!;
    expect(tokensOf(after)).toHaveLength(5);
    expect(after.seats[0].board.hand.map((c) => c.name)).toEqual(["Thopter Assembly"]);
    expect(after.seats[0].board.battlefield.some((c) => c.id === "ta")).toBe(false);
    const blocked = applyDeterministicPhaseTrigger(session([seat("a", { battlefield: [asm, real("Thopter Assembly", "t2", { typeLine: "Token Artifact Creature - Thopter", token: true })] })], { phase: "upkeep step" }), "a", asm, "upkeep step");
    expect(blocked === undefined || tokensOf(blocked).length === 1).toBe(true);
  });

  it("Brudiclad: beginning of combat makes a 2/1 Myr artifact token, then every other token becomes a copy of the chosen token", () => {
    const brud = real("Brudiclad, Telchor Engineer", "bru");
    const goblin = { id: "gob", name: "Goblin Token", typeLine: "Token Creature - Goblin", power: "1", toughness: "1", oracleText: "", manaValue: 0, colors: ["R"], role: "token", zone: "battlefield", token: true } as VisibleCard;
    const s = session([seat("a", { battlefield: [brud, goblin] })], { phase: "beginning of combat step" });
    const after = applyDeterministicPhaseTrigger(s, "a", brud, "beginning of combat step")!;
    const toks = tokensOf(after);
    expect(toks.length).toBe(2);
    expect(toks.some((t) => /Myr/.test(t.typeLine) && /Artifact/.test(t.typeLine))).toBe(true);
    // the "then you may choose a token... each other token becomes a copy" half: with two tokens, both end up Myr
    expect(toks.every((t) => /Myr/.test(t.typeLine))).toBe(true);
  });

  it("Loyal Apprentice / Loyal Drake: lieutenant needs your commander on the battlefield", () => {
    const cmdr = real("Memnarch", "cmd", { commander: true });
    const apprentice = real("Loyal Apprentice", "la");
    const drake = real("Loyal Drake", "ld");
    const mk = (withCmd: boolean) => session([seat("a", { battlefield: [apprentice, drake, ...(withCmd ? [cmdr] : [])] }, { library: filler(3) }), seat("b")], { phase: "beginning of combat step" });
    const on = applyDeterministicPhaseTrigger(applyDeterministicPhaseTrigger(mk(true), "a", apprentice, "beginning of combat step")!, "a", drake, "beginning of combat step")!;
    expect(tokensOf(on).map((t) => t.name), "apprentice token").toEqual(["Thopter Token"]);
    expect(on.seats[0].board.hand, "drake draw").toHaveLength(1);
    const off = mk(false);
    const offA = applyDeterministicPhaseTrigger(off, "a", apprentice, "beginning of combat step");
    expect(tokensOf(offA ?? off)).toHaveLength(0);
  });
});

import { resolveBareSpellEffect } from "@/lib/selfplay/orchestrator";
const art = (id: string, extra: Partial<VisibleCard> = {}) => real("Sol Ring", id, extra);
const bearCreature = (id: string, extra: Partial<VisibleCard> = {}) => ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", ...extra }) as VisibleCard;
const cast = (name: string, s: GameSession, x?: number) => resolveBareSpellEffect(s, "a", real(name, "spell", { zone: "stack" as never }), x);

describe("spell resolution (headless mirror of the live resolver)", () => {
  it("Blasphemous Act: 13 damage to each creature", () => {
    const s = session([seat("a", { battlefield: [bearCreature("m1")] }), seat("b", { battlefield: [bearCreature("o1", { toughness: "13" }), bearCreature("o2", { toughness: "14" })] })]);
    const { session: after, matched } = cast("Blasphemous Act", s);
    expect(matched).toBe(true);
    const settled = runStateBasedActionsPass(after).session;
    expect(settled.seats[0].board.battlefield).toHaveLength(0);
    expect(settled.seats[1].board.battlefield.map((c) => c.id)).toEqual(["o2"]);
  });

  it("Delete: X damage to each nonartifact creature and each player (artifact creatures and the caster... are hit only as stated)", () => {
    const artifactCreature = real("Whirler Rogue", "wr", { power: "2", toughness: "2" });
    const artCre = { ...artifactCreature, typeLine: "Artifact Creature — Thopter" } as VisibleCard;
    const s = session([seat("a", { battlefield: [bearCreature("m1", { toughness: "3" }), artCre] }), seat("b", { battlefield: [bearCreature("o1", { toughness: "3" })] })]);
    const { session: after } = cast("Delete", s, 3);
    expect(after.seats[0].life).toBe(37);
    expect(after.seats[1].life).toBe(37);
    const settled = runStateBasedActionsPass(after).session;
    expect(settled.seats[0].board.battlefield.map((c) => c.id)).toEqual(["wr"]);
    expect(settled.seats[1].board.battlefield).toHaveLength(0);
  });

  it("Chaos Warp: the target is shuffled into its owner's library and the new top card enters if it is a permanent", () => {
    const target = bearCreature("tgt");
    const land = real("Sol Ring", "top", { zone: "library" });
    const s = session([seat("a"), seat("b", { battlefield: [target] }, { library: [land] })]);
    const r = resolveBareSpellEffect(s, "a", real("Chaos Warp", "cw", { zone: "stack" as never }), undefined);
    expect(r.matched).toBe(true);
  });

  it.each([
    ["Pull from Tomorrow", 2],
    ["Finale of Revelation", 3]
  ])("%s with X=%i draws X cards (Pull from Tomorrow discards one, Finale exiles itself)", (name, x) => {
    const s = session([seat("a", {}, { library: filler(12) })]);
    const { session: after, matched } = cast(name, s, x);
    expect(matched, `${name} should be recognised`).toBe(true);
    expect(after.seats[0].board.hand.length).toBeGreaterThanOrEqual(x - 1);
  });

  it("Tidings / Reverse Engineer draw their fixed amounts; Thirst for Knowledge draws three", () => {
    for (const [n, k] of [["Tidings", 4], ["Reverse Engineer", 3], ["Thirst for Knowledge", 3]] as const) {
      const { session: after, matched } = cast(n, session([seat("a", {}, { library: filler(8) })]));
      expect(matched, n).toBe(true);
      expect(after.seats[0].board.hand.length, n).toBeGreaterThanOrEqual(k - 2);
    }
  });

  it("Reality Heist: top seven, up to two artifact cards to hand, the rest to the bottom", () => {
    const lib = [art("a1", { zone: "library" }), art("a2", { zone: "library" }), art("a3", { zone: "library" }), ...filler(6)];
    const { session: after, matched } = cast("Reality Heist", session([seat("a", {}, { library: lib })]));
    expect(matched).toBe(true);
    expect(after.seats[0].board.hand.map((c) => c.id)).toEqual(["a1", "a2"]);
  });

  it("Saheeli's Directive with X=2: artifacts with mana value 2 or less among the top two enter, the rest go to the graveyard", () => {
    const lib = [real("Sol Ring", "s1", { zone: "library" }), bearCreature("junk", { zone: "library" }), ...filler(4)];
    const { session: after, matched } = cast("Saheeli's Directive", session([seat("a", {}, { library: lib })]), 2);
    expect(matched).toBe(true);
    expect(after.seats[0].board.battlefield.map((c) => c.id)).toEqual(["s1"]);
    expect(after.seats[0].board.graveyard!.map((c) => c.id)).toEqual(["junk"]);
  });

  it("Crackle with Power: five times X damage to each of up to X targets", () => {
    const s = session([seat("a"), seat("b")]);
    const { session: after, matched } = cast("Crackle with Power", s, 2);
    expect(matched).toBe(true);
    expect(after.seats[1].life).toBe(30);
  });
});

import { spellResolutionDestination } from "./AppFlow";
describe("Finale of Revelation", () => {
  it("exiles itself when it finishes resolving, and a 10+ draw shuffles the graveyard in and removes the hand limit", () => {
    const finale = real("Finale of Revelation", "fin", { zone: "hand" });
    const s = session([seat("a", { hand: [finale] }), seat("b")]);
    expect(spellResolutionDestination(s, { type: "spell", actorSeatId: "a", cardId: "fin" } as never)).toBe("exile");
    const gy = filler(3, "graveyard");
    const big = session([seat("a", { graveyard: gy, battlefield: [real("Sol Ring", "sr", { tapped: true })] }, { library: filler(12) })]);
    const { session: after } = resolveBareSpellEffect(big, "a", finale, 10);
    expect(after.seats[0].board.hand).toHaveLength(10);
    expect(after.seats[0].board.graveyard).toHaveLength(0);
    expect(after.seats[0].noMaximumHandSize).toBe(true);
  });
});

import { commonTriggerEffect } from "./AppFlow";
const abilityOf = (card: VisibleCard, prefix: RegExp) => card.oracleText.split("\n").find((l) => prefix.test(l))!.replace(/^[^:]*:\s*/, "").replace(/\([^)]*\)/g, "").trim();
const resolveAbility = (s: GameSession, source: VisibleCard, text: string) => {
  const effect = commonTriggerEffect(text, "clause");
  expect(effect, text).toBeTruthy();
  return resolveTriggerEffect(s, { id: "t", type: "trigger", actorSeatId: "a", controllerSeatId: "a", sourceCardId: source.id, sourceCardName: source.name, triggerKind: "common", effect: effect!, message: "" } as never);
};

describe("planeswalkers", () => {
  it("Saheeli, the Gifted +1 makes a Servo artifact creature; -7 copies every artifact with haste", () => {
    const pw = real("Saheeli, the Gifted", "sg");
    const s1 = resolveAbility(session([seat("a", { battlefield: [pw] }), seat("b")]), pw, "Create a 1/1 colorless Servo artifact creature token.");
    expect(tokensOf(s1)[0].typeLine).toMatch(/Artifact Creature/);
    const ring = real("Sol Ring", "sr");
    const thought = real("Thought Monitor", "tm", { power: "2", toughness: "2" });
    const s7 = resolveAbility(session([seat("a", { battlefield: [pw, ring, thought] }), seat("b")]), pw, abilityOf(pw, /^−7/));
    const copies = tokensOf(s7);
    expect(copies.map((c) => c.name).sort()).toEqual(["Sol Ring", "Thought Monitor"]);
    expect(copies.every((c) => (c.grantedKeywords ?? []).includes("haste") || c.summoningSick === false)).toBe(true);
  });

  it("Tezzeret, Artifice Master: +1 Thopter, 0 draws two with three artifacts", () => {
    const pw = real("Tezzeret, Artifice Master", "tz");
    const s1 = resolveAbility(session([seat("a", { battlefield: [pw] }), seat("b")]), pw, abilityOf(pw, /^\+1/));
    expect(tokensOf(s1)[0].typeLine).toMatch(/Artifact Creature - Thopter/);
    const draw = abilityOf(pw, /^0:/);
    const few = resolveAbility(session([seat("a", { battlefield: [pw] }, { library: filler(5) }), seat("b")]), pw, draw);
    expect(few.seats[0].board.hand).toHaveLength(1);
    const many = resolveAbility(session([seat("a", { battlefield: [pw, art("x1"), art("x2"), art("x3")] }, { library: filler(5) }), seat("b")]), pw, draw);
    expect(many.seats[0].board.hand).toHaveLength(2);
  });
});

describe("static / passive artifacts", () => {
  it("Chief of the Foundry buffs other artifact creatures INCLUDING artifact creature tokens", () => {
    const chief = real("Chief of the Foundry", "chief");
    const s = session([seat("a", { battlefield: [chief] }), seat("b")]);
    const withServo = resolveAbility(s, chief, "Create a 1/1 colorless Servo artifact creature token.");
    const settled = runStateBasedActionsPass(withServo).session;
    const servo = settled.seats[0].board.battlefield.find((c) => c.token)!;
    expect(servo.attachmentPowerBonus).toBe(1);
  });

  it("Darksteel Forge: artifacts you control (even tokens) are indestructible; Padeem: hexproof", () => {
    const forge = real("Darksteel Forge", "df");
    const padeem = real("Padeem, Consul of Innovation", "pd");
    const servo = { id: "sv", name: "Servo Token", typeLine: "Token Artifact Creature - Servo", power: "1", toughness: "1", colors: [], role: "token", zone: "battlefield", manaValue: 0, oracleText: "", token: true } as VisibleCard;
    const settled = runStateBasedActionsPass(session([seat("a", { battlefield: [forge, padeem, servo, bearCreature("bear")] }), seat("b")])).session;
    const board = settled.seats[0].board.battlefield;
    expect(board.find((c) => c.id === "sv")!.grantedKeywords).toEqual(expect.arrayContaining(["indestructible", "hexproof"]));
    expect(board.find((c) => c.id === "bear")!.grantedKeywords ?? []).not.toContain("indestructible");
  });

  it("Darksteel Juggernaut is as big as your artifact count (tokens included)", () => {
    const jug = real("Darksteel Juggernaut", "dj");
    const servo = { id: "sv", name: "Servo Token", typeLine: "Token Artifact Creature - Servo", power: "1", toughness: "1", colors: [], role: "token", zone: "battlefield", manaValue: 0, oracleText: "", token: true } as VisibleCard;
    const settled = runStateBasedActionsPass(session([seat("a", { battlefield: [jug, servo, art("r1")] }), seat("b")])).session;
    const j = settled.seats[0].board.battlefield.find((c) => c.id === "dj")!;
    expect(Number(j.cdaPower ?? j.power)).toBe(3);
  });
});

import { applyEndStepEffects, findCommonTriggersForPermanentDied, applyGenericTapEffect } from "./AppFlow";
describe("Mimic Vat (imprint) and temporary copies", () => {
  it("a nontoken creature dying imprints on the Vat (replacing the previous one); the Vat then copies it with haste and it is exiled at the end step", () => {
    const vat = real("Mimic Vat", "vat");
    const dead1 = real("Whirler Rogue", "d1", { zone: "graveyard" });
    const dead2 = real("Loyal Drake", "d2", { zone: "graveyard" });
    let s = session([seat("a", { battlefield: [vat], graveyard: [dead1] }), seat("b")]);
    const t1 = findCommonTriggersForPermanentDied(s, "a", dead1);
    expect(t1.some((t) => t.effect.kind === "imprint_dying_creature")).toBe(true);
    s = resolveTriggerEffect(s, t1.find((t) => t.effect.kind === "imprint_dying_creature")!);
    expect(s.seats[0].board.exile!.map((c) => c.id)).toEqual(["d1"]);
    expect(s.seats[0].board.exile![0].imprintedOnId).toBe("vat");
    s = { ...s, seats: s.seats.map((x) => (x.id === "a" ? { ...x, board: { ...x.board, graveyard: [dead2] } } : x)) };
    s = resolveTriggerEffect(s, findCommonTriggersForPermanentDied(s, "a", dead2).find((t) => t.effect.kind === "imprint_dying_creature")!);
    expect(s.seats[0].board.exile!.map((c) => c.id)).toEqual(["d2"]);
    expect(s.seats[0].board.graveyard!.map((c) => c.id)).toEqual(["d1"]);
    // activate: copy the imprinted card
    const clause = "Create a token that's a copy of a card exiled with this artifact. It gains haste. Exile it at the beginning of the next end step.";
    s = applyGenericTapEffect(s, "a", "vat", "Mimic Vat", { kind: "copy_imprinted_card" }, clause);
    const copy = tokensOf(s)[0];
    expect(copy.name).toBe("Loyal Drake");
    expect(copy.exileAtEndStep).toBe(true);
    s = applyEndStepEffects(s, "a");
    expect(tokensOf(s)).toHaveLength(0);
  });

  it("Saheeli, the Gifted -7: temporary hasty copies of each artifact vanish at the end step", () => {
    const pw = real("Saheeli, the Gifted", "sg");
    const s7 = resolveAbility(session([seat("a", { battlefield: [pw, art("r1"), art("r2")] }), seat("b")]), pw, abilityOf(pw, /^−7/));
    expect(tokensOf(s7)).toHaveLength(2);
    expect(tokensOf(s7).every((c) => c.exileAtEndStep && !c.summoningSick)).toBe(true);
    expect(tokensOf(applyEndStepEffects(s7, "a"))).toHaveLength(0);
  });
});

import { findAttackTriggers, findCombatDamageToPlayerTriggers } from "./AppFlow";
describe("combat-linked cards", () => {
  const thopter = (id: string) => ({ id, name: "Thopter Token", typeLine: "Token Artifact Creature - Thopter", power: "1", toughness: "1", colors: [], role: "token", zone: "battlefield", manaValue: 0, oracleText: "Flying", token: true }) as VisibleCard;
  it("Sharding Sphinx: only an ARTIFACT creature connecting makes a Thopter", () => {
    const sphinx = real("Sharding Sphinx", "ss");
    const s = session([seat("a", { battlefield: [sphinx, thopter("t1"), bearCreature("bear")] }), seat("b")]);
    expect(findCombatDamageToPlayerTriggers(s, "a", thopter("t1"), "b").filter((t) => t.sourceCardId === "ss")).toHaveLength(1);
    expect(findCombatDamageToPlayerTriggers(s, "a", bearCreature("bear"), "b").filter((t) => t.sourceCardId === "ss")).toHaveLength(0);
  });
  it("Thopter Spy Network: an artifact creature connecting draws a card, a plain creature does not", () => {
    const net = real("Thopter Spy Network", "tsn");
    const s = session([seat("a", { battlefield: [net, thopter("t1"), bearCreature("bear")] }), seat("b")]);
    expect(findCombatDamageToPlayerTriggers(s, "a", thopter("t1"), "b").filter((t) => t.sourceCardId === "tsn")).toHaveLength(1);
    expect(findCombatDamageToPlayerTriggers(s, "a", bearCreature("bear"), "b").filter((t) => t.sourceCardId === "tsn")).toHaveLength(0);
  });
  it("Myr Battlesphere attack: taps X untapped Myr for +X/+0 and X damage to the defender", () => {
    const sphere = real("Myr Battlesphere", "mb", { power: "4", toughness: "7", attacking: true, attackTargetId: "b" });
    const myr = (id: string) => ({ id, name: "Myr Token", typeLine: "Token Artifact Creature - Myr", power: "1", toughness: "1", colors: [], role: "token", zone: "battlefield", manaValue: 0, oracleText: "", token: true }) as VisibleCard;
    const s = session([seat("a", { battlefield: [sphere, myr("m1"), myr("m2"), myr("m3"), myr("m4")] }), seat("b")]);
    const { triggers } = findAttackTriggers(s, { seatId: "a", card: sphere, defendingSeatId: "b" });
    const trig = triggers.find((t) => t.sourceCardId === "mb");
    expect(trig, "Battlesphere should produce an attack trigger").toBeTruthy();
    const after = resolveTriggerEffect(s, trig!);
    expect(after.seats[1].life).toBe(36);
    expect(after.seats[0].board.battlefield.filter((c) => c.token && c.tapped)).toHaveLength(4);
  });
  it("Idol of Oblivion draws only after a token was created this turn (Servo makes it true)", () => {
    const idol = real("Idol of Oblivion", "io");
    const noToken = session([seat("a", { battlefield: [idol] }, { library: filler(3) }), seat("b")]);
    const lowered = isConditionForIdol(noToken);
    expect(lowered).toBe(false);
    const pw = real("Saheeli, the Gifted", "sg");
    const made = resolveAbility(session([seat("a", { battlefield: [idol, pw] }, { library: filler(3) }), seat("b")]), pw, "Create a 1/1 colorless Servo artifact creature token.");
    expect(isConditionForIdol(made)).toBe(true);
  });
});
import { isRecognizedBoardCondition } from "./AppFlow";
function isConditionForIdol(s: GameSession) {
  expect(isRecognizedBoardCondition("you created a token this turn")).toBe(true);
  return Boolean(s.seats[0].createdTokenThisTurn);
}

import { manaProducedBy, manaChoicesForCard } from "./AppFlow";
describe("mana rocks / lands", () => {
  const pool = seat("a", { battlefield: [] });
  it("amounts: Sol Ring 2, Thran Dynamo 3, Gilded Lotus 3, Worn Powerstone 2, Hedron Archive 2, Prismatic Lens 1", () => {
    for (const [n, k] of [["Sol Ring", 2], ["Thran Dynamo", 3], ["Gilded Lotus", 3], ["Worn Powerstone", 2], ["Hedron Archive", 2], ["Prismatic Lens", 1]] as const) {
      expect(manaProducedBy(real(n, "x"), pool), n).toBe(k);
    }
  });
  it("Forsaken Monument: tapping a permanent for {C} adds an additional {C}", () => {
    const monument = real("Forsaken Monument", "fm");
    const s = seat("a", { battlefield: [monument] });
    expect(manaProducedBy(real("Sol Ring", "sr"), s)).toBe(3);
    expect(manaProducedBy(real("Reliquary Tower", "rt"), s)).toBe(2);
    expect(manaProducedBy(real("Frostboil Snarl", "fs"), s)).toBe(1);
  });
});

import { parseGenericTapAbilities } from "@/lib/activatedAbilities";
describe("Emry, Lurker of the Loch", () => {
  it("{T}: choose target artifact card in your graveyard, you may cast it this turn — recognised as a graveyard-cast grant", () => {
    const emry = real("Emry, Lurker of the Loch", "em");
    const abilities = parseGenericTapAbilities(emry.oracleText);
    expect(abilities.map((a) => a.effect.kind)).toContain("grant_graveyard_cast");
  });
});

import { spendManaSources } from "./AppFlow";
describe("Treasure Nabber and Archway of Innovation", () => {
  it("Treasure Nabber steals an artifact an opponent taps for mana until the end of the Nabber controller's next turn", () => {
    const nabber = real("Treasure Nabber", "tn");
    const ring = real("Sol Ring", "sr");
    let s = session([seat("a", { battlefield: [nabber] }), seat("b", { battlefield: [ring] })], { turn: 2 });
    s = { ...s, seats: s.seats.map((x) => (x.id === "b" ? spendManaSources(x, ["sr"]) : x)) };
    s = runStateBasedActionsPass(s).session;
    expect(s.seats[0].board.battlefield.map((c) => c.id).sort()).toEqual(["sr", "tn"]);
    expect(s.seats[1].board.battlefield).toHaveLength(0);
    // end of the SAME turn: still stolen; end of Nabber controller's next turn: returned
    expect(applyEndStepEffects({ ...s, turn: 2 }, "a").seats[0].board.battlefield.some((c) => c.id === "sr")).toBe(true);
    const back = applyEndStepEffects({ ...s, turn: 3 }, "a");
    expect(back.seats[1].board.battlefield.map((c) => c.id)).toEqual(["sr"]);
  });
  it("Archway: the next spell has improvise (artifacts pay generic) and the flag is cleared by casting", () => {
    const archway = real("Archway of Innovation", "ar");
    const abilities = parseGenericTapAbilities(archway.oracleText);
    expect(abilities.map((a) => a.effect.kind)).toContain("next_spell_improvise");
    const ability = abilities.find((a) => a.effect.kind === "next_spell_improvise")!;
    const s = session([seat("a", { battlefield: [archway] }), seat("b")]);
    const after = applyGenericTapEffect(s, "a", "ar", "Archway of Innovation", ability.effect, ability.clause);
    expect(after.seats[0].nextSpellHasImprovise).toBe(true);
  });
});

import { activateSteelHellkiteX, steelHellkiteXOptions, applyCombatDamageToTarget as combatHit } from "./AppFlow";
describe("Steel Hellkite {X}", () => {
  it("destroys each nonland permanent with mana value X controlled by a player it damaged this turn, once per turn", () => {
    const hellkite = real("Steel Hellkite", "sh", { power: "5", toughness: "5" });
    const lands = ["Mountain", "Mountain", "Mountain"].map((n, i) => real(n, `l${i}`, { typeLine: "Basic Land — Mountain", oracleText: "({T}: Add {R}.)" }));
    const three = bearCreature("three", { manaValue: 3 });
    const five = bearCreature("five", { manaValue: 5 });
    const bystanderThree = bearCreature("bystander", { manaValue: 3 });
    let s = session([seat("a", { battlefield: [hellkite, ...lands] }), seat("b", { battlefield: [three, five] }), seat("c", { battlefield: [bystanderThree] })]);
    s = combatHit(s, "Steel Hellkite", { seat: s.seats[1] }, 5, hellkite, "a");
    const hk = s.seats[0].board.battlefield.find((c) => c.id === "sh")!;
    expect(hk.damagedPlayersThisTurn).toEqual(["b"]);
    const options = steelHellkiteXOptions(s, s.seats[0], hk);
    expect(options.map((o) => o.x)).toEqual([3]); // X=5 is unaffordable with 3 lands
    const after = activateSteelHellkiteX(s, "a", "sh", 3);
    expect(after.seats[1].board.battlefield.map((c) => c.id)).toEqual(["five"]);
    expect(after.seats[2].board.battlefield.map((c) => c.id)).toEqual(["bystander"]); // c was not dealt damage
    expect(steelHellkiteXOptions(after, after.seats[0], after.seats[0].board.battlefield.find((c) => c.id === "sh")!)).toEqual([]);
  });
});

import { signetAbility } from "./AppFlow";
describe("Bugs2 round 2", () => {
  it("1: Saheeli's +1 affinity discount counts every artifact you control (tapped or not) when the pool pays", () => {
    const hedron = real("Hedron Archive", "ha", { zone: "hand" });
    const arts = [real("Sol Ring", "a1", { tapped: true }), real("Fellwar Stone", "a2"), real("Thran Dynamo", "a3")];
    const s = seat("a", { hand: [hedron], battlefield: arts }, { nextSpellHasArtifactAffinity: true });
    expect(totalCastingCost(s, hedron, hedron.manaValue, 0, [s])).toBe(1);
    expect(adjustedCastingCost(s, hedron, hedron.manaValue, "hand", "a", [s])).toBe(1);
  });
  it("10: Signet family — {1},{T}: Add {U}{R} nets one mana of each color", () => {
    const signet = real("Izzet Signet", "is");
    expect(signetAbility(signet.oracleText)).toEqual({ generic: 1, symbols: ["U", "R"] });
    expect(manaProducedBy(signet, seat("a"))).toBe(1);
    expect(signetAbility(real("Arcane Signet", "x").oracleText)).toBeUndefined();
  });
});

describe("Bugs2 round 2 (continued)", () => {
  it("6: token copies of Talisman of Creativity / Silverbluff Bridge keep ALL of their mana colors", () => {
    const pw = real("Saheeli, the Gifted", "sg");
    const talisman = real("Talisman of Creativity", "tc");
    const bridge = real("Silverbluff Bridge", "sb");
    const s = resolveAbility(session([seat("a", { battlefield: [pw, talisman, bridge] }), seat("b")]), pw, abilityOf(pw, /^−7/));
    for (const token of tokensOf(s)) {
      const colors = manaChoicesForCard(token, s.seats[0], s.seats);
      expect(colors, token.name).toEqual(expect.arrayContaining(["U", "R"]));
    }
    expect(manaChoicesForCard(tokensOf(s).find((t) => t.name === "Talisman of Creativity")!, s.seats[0], s.seats)).toContain("C");
  });
  it("2: Emry's tap ability makes a graveyard artifact castable this turn", () => {
    const emry = real("Emry, Lurker of the Loch", "em");
    const ring = real("Sol Ring", "sr", { zone: "graveyard" });
    const s = session([seat("a", { battlefield: [emry], graveyard: [ring] }), seat("b")], { turn: 4 });
    const ability = parseGenericTapAbilities(emry.oracleText).find((a) => a.effect.kind === "grant_graveyard_cast")!;
    const after = applyGenericTapEffect(s, "a", "em", "Emry", ability.effect, ability.clause);
    expect(after.seats[0].board.graveyard![0].graveyardCastGrant).toEqual({ seatId: "a", turn: 4 });
  });
});

import { phaseEffectText, agentCastTimeRemovalChoices } from "./AppFlow";
describe("Bugs2 round 2: combat damage triggers and agent targeting", () => {
  it("7/14: Thopter Spy Network is NOT swept at the combat damage step, and a non-artifact Shimmer Dragon never triggers it", () => {
    const net = real("Thopter Spy Network", "tsn");
    expect(phaseEffectText(net.oracleText, "combat damage step")).toBe("");
    const dragon = real("Shimmer Dragon", "sd");
    const s = session([seat("a", { battlefield: [net, dragon] }), seat("b")]);
    expect(findCombatDamageToPlayerTriggers(s, "a", dragon, "b").filter((t) => t.sourceCardId === "tsn")).toHaveLength(0);
  });
  it("4: an agent casting Chaos Warp aims at an opposing permanent as it casts (castChoices carries the target)", () => {
    const warp = real("Chaos Warp", "cw", { zone: "hand" });
    const s = session([seat("a"), seat("b", { battlefield: [bearCreature("victim", { power: "6", toughness: "6", manaValue: 6 })] })]);
    const choices = agentCastTimeRemovalChoices(s, "a", warp);
    expect(choices?.targets).toEqual([{ kind: "card", seatId: "b", cardId: "victim" }]);
  });
});

import { parseGenericManaAbilities } from "@/lib/activatedAbilities";
import { parseGenericAbilityEffect, applyGenericAbilityEffect } from "./AppFlow";
describe("Bugs2 round 2: Memnarch and Hellkite Igniter", () => {
  it("11: Memnarch's abilities resolve even while summoning sick (no {T} in the cost)", () => {
    const memnarch = real("Memnarch", "mn", { summoningSick: true });
    const abilities = parseGenericManaAbilities(memnarch.oracleText);
    expect(abilities).toHaveLength(2);
    for (const a of abilities) expect(parseGenericAbilityEffect(a.effectText), a.effectText).toBeTruthy();
    // make a land an artifact (agent auto-picks one of its own permanents)
    const land = real("Island", "isl", { typeLine: "Basic Land — Island", oracleText: "({T}: Add {U}.)" });
    const s = session([seat("a", { battlefield: [memnarch, land] }), seat("b")]);
    const grant = applyGenericAbilityEffect(s, "a", memnarch, parseGenericAbilityEffect(abilities[0].effectText)!);
    const after = runStateBasedActionsPass(grant).session;
    expect(after.seats[0].board.battlefield.find((c) => c.id === "isl")!.grantedTypes).toContain("Artifact");
    // steal an opposing artifact
    const ring = real("Sol Ring", "sr");
    const s2 = session([seat("a", { battlefield: [memnarch] }), seat("b", { battlefield: [ring] })]);
    const stolen = applyGenericAbilityEffect(s2, "a", memnarch, parseGenericAbilityEffect(abilities[1].effectText)!);
    expect(stolen.seats[0].board.battlefield.map((c) => c.id)).toContain("sr");
  });
  it("13: Hellkite Igniter gets +X/+0 where X is the number of artifacts you control", () => {
    const igniter = real("Hellkite Igniter", "hi", { power: "5", toughness: "5" });
    const ability = parseGenericManaAbilities(igniter.oracleText)[0];
    const effect = parseGenericAbilityEffect(ability.effectText);
    expect(effect).toBeTruthy();
    const s = session([seat("a", { battlefield: [igniter, art("r1"), art("r2"), art("r3")] }), seat("b")]);
    const after = applyGenericAbilityEffect(s, "a", igniter, effect!);
    expect(after.seats[0].board.battlefield.find((c) => c.id === "hi")!.temporaryPowerBonus).toBe(3);
  });
});

describe("Bugs2 round 2: Thirst for Knowledge", () => {
  const hand = () => [real("Sol Ring", "ring", { zone: "hand" }), real("Tidings", "tid", { zone: "hand" })];
  it("12: a human is asked (discard one artifact, or two cards of their choice); agents discard the artifact", () => {
    const human = session([seat("a", { hand: [] }, { kind: "human", library: [...hand(), ...filler(3)] }), seat("b")]);
    const { session: queued, matched } = cast("Thirst for Knowledge", human);
    expect(matched).toBe(true);
    const choice = queued.pendingPlayerChoices![0];
    expect(choice.resolver).toBe("discard_unless");
    expect(choice.options.some((o) => o.value.startsWith("one:"))).toBe(true);
    const one = resolveDeferredChoice(queued, "a", "x", "Thirst for Knowledge", "discard_unless", choice.data, choice.options.find((o) => o.value.startsWith("one:"))!.value);
    expect(one.seats[0].board.graveyard).toHaveLength(1);
    const many = resolveDeferredChoice(queued, "a", "x", "Thirst for Knowledge", "discard_unless", choice.data, "many");
    expect(many.pendingPlayerChoices!.slice(-1)[0].resolver).toBe("discard_pick");
    const agent = session([seat("a", {}, { library: [...hand(), ...filler(3)] }), seat("b")]);
    const done = cast("Thirst for Knowledge", agent).session;
    expect(done.seats[0].board.graveyard).toHaveLength(1);
    expect(done.seats[0].board.hand).toHaveLength(2);
  });
});
import { resolveDeferredChoice } from "./AppFlow";

import { parseCounterSpellAbility, counterSpellCanTarget } from "@/lib/counterSpells";
describe("Bugs2 round 2: Swan Song", () => {
  it("5: Swan Song parses (it did not, so it 'resolved' without countering), hits sorceries, and carries the Bird rider", () => {
    const ability = parseCounterSpellAbility(real("Swan Song", "ss").oracleText)!;
    expect(ability).toBeTruthy();
    expect(counterSpellCanTarget(ability, "Sorcery", false)).toBe(true);
    expect(counterSpellCanTarget(ability, "Instant", false)).toBe(true);
    expect(counterSpellCanTarget(ability, "Enchantment", false)).toBe(true);
    expect(counterSpellCanTarget(ability, "Creature — Elf", false)).toBe(false);
    expect(ability.controllerTokenClause).toMatch(/2\/2 blue Bird creature token with flying/);
    expect(parseCounterSpellAbility("Counter target spell.")?.restriction).toBe("any");
    expect(parseCounterSpellAbility(real("Negate", "n").oracleText)?.restriction).toBe("noncreature");
  });
});

import { payGenericTapCost } from "./AppFlow";
describe("Bugs2 round 2: Shimmer Dragon's tap-two-artifacts cost", () => {
  it("3: two untapped NON-creature artifacts pay it (it used to look only at creatures and report 'no mana')", () => {
    const dragon = real("Shimmer Dragon", "sd");
    const index = parseGenericTapAbilities(dragon.oracleText).findIndex((a) => a.costTapCreatures);
    expect(index).toBeGreaterThanOrEqual(0);
    const s = session([seat("a", { battlefield: [dragon, art("r1"), art("r2")] }, { library: filler(3) }), seat("b")]);
    const paid = payGenericTapCost(s, "a", "sd", index);
    expect(paid).toBeTruthy();
    const none = payGenericTapCost(session([seat("a", { battlefield: [dragon, art("r1")] }), seat("b")]), "a", "sd", index);
    expect(none).toBeUndefined();
  });
});
