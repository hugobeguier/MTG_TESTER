// Debuff auras: "loses all abilities" (Utter Insignificance) and phasing (Vanishing) must be honoured by every ability scan (real Oracle text).
import { describe, expect, it } from "vitest";
import { legalAttackActions, resolveCombatDamage, canAttack, canBlock } from "@/engine/combat";
import { manaChoicesForCard } from "@/engine/mana";
import { targetableView } from "@/engine/castTargets";
import { findCommonTriggersForPermanentEntered } from "@/engine/triggers";
import { destroyAllTypesVictims } from "@/engine/abilities";
import { hasActiveAbilities } from "@/lib/effectivePermanent";
import { abilityOracleText } from "@/lib/typeGrants";
import { attachmentCombatBans } from "@/lib/attachments";
import { countMatchingPermanents } from "@/lib/characteristics";
import { runStateBasedActionsPass } from "@/engine/stateBased";
import { findCombatDamageToPlayerTriggers, findCommonTriggersForPermanentDied } from "@/engine/triggerFinders";
import { applyGenericAbilityEffect, parseGenericAbilityEffect, genericAbilityEffectHasLegalTarget } from "@/engine/abilities";
import { phaseOutPermanent } from "@/engine/phasing";
import { untapForSeat } from "@/engine/turnFlow";
import { effectivePower, effectiveToughness } from "@/lib/counters";
import { parseGenericManaAbilities } from "@/lib/activatedAbilities";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
function seat(id: string, battlefield: VisibleCard[], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return { id, name: id, kind: "agent", life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield, graveyard: [] }, ...extra };
}
function session(seats: PlayerSeat[]): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "combat damage", turn: 5, activePlayerId: seats[0].id, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] } as GameSession;
}
const settle = (s: GameSession) => runStateBasedActionsPass(s).session;
const onBoard = (s: GameSession, id: string) => s.seats.flatMap((x) => x.board.battlefield).find((c) => c.id === id)!;

describe("Utter Insignificance on Ancient Copper Dragon", () => {
  const build = (withAura: boolean) => {
    const dragon = real("Ancient Copper Dragon", "dragon", { attacking: true, attackTargetId: "b", summoningSick: false });
    const aura = real("Utter Insignificance", "ui", { attachedToId: "dragon", attachedToSeatId: "a", attachTimestamp: 1 });
    return settle(session([seat("a", withAura ? [dragon, aura] : [dragon]), seat("b", [])]));
  };
  it("is 1/1, has no flying and no combat-damage trigger", () => {
    const s = build(true);
    const d = onBoard(s, "dragon");
    expect(d.abilitiesStripped).toBe(true);
    expect(effectivePower(d)).toBe(1);
    expect(effectiveToughness(d)).toBe(1);
    expect(findCombatDamageToPlayerTriggers(s, "a", d, "b")).toHaveLength(0);
    const after = resolveCombatDamage(s, "a");
    expect(after.seats[1].life).toBe(39);
  });
  it("without the Aura the dragon still triggers; abilities return when the Aura leaves", () => {
    const plain = build(false);
    expect(findCombatDamageToPlayerTriggers(plain, "a", onBoard(plain, "dragon"), "b").length).toBeGreaterThan(0);
    const withAura = build(true);
    const gone = settle({ ...withAura, seats: withAura.seats.map((x) => ({ ...x, board: { ...x.board, battlefield: x.board.battlefield.filter((c) => c.id !== "ui") } })) });
    const d = onBoard(gone, "dragon");
    expect(d.abilitiesStripped).toBeFalsy();
    expect(effectivePower(d)).toBe(Number(d.power));
    expect(findCombatDamageToPlayerTriggers(gone, "a", d, "b").length).toBeGreaterThan(0);
  });
  it("keeps +1/+1 counters on top of the base 1/1", () => {
    const dragon = real("Ancient Copper Dragon", "dragon", { counters: [{ kind: "+1/+1", count: 2 }] } as Partial<VisibleCard>);
    const aura = real("Utter Insignificance", "ui", { attachedToId: "dragon", attachedToSeatId: "a", attachTimestamp: 1 });
    const d = onBoard(settle(session([seat("a", [dragon, aura])])), "dragon");
    expect(effectivePower(d)).toBe(3);
  });
  it("its own {2}{C} ability stays usable and exiles the creature", () => {
    const aura = real("Utter Insignificance", "ui", { attachedToId: "dragon", attachedToSeatId: "a" });
    const s = settle(session([seat("a", [real("Ancient Copper Dragon", "dragon"), aura]), seat("b", [])]));
    const [ability] = parseGenericManaAbilities(onBoard(s, "ui").oracleText);
    const effect = parseGenericAbilityEffect(ability.effectText)!;
    expect(genericAbilityEffectHasLegalTarget(s, "a", onBoard(s, "ui"), effect)).toBe(true);
    expect(applyGenericAbilityEffect(s, "a", onBoard(s, "ui"), effect).seats[0].board.exile?.map((c) => c.id)).toContain("dragon");
  });
});

describe("Vanishing on Meren", () => {
  const setup = () => {
    const meren = real("Meren of Clan Nel Toth", "meren", { attackTargetId: "b" });
    const vanishing = real("Vanishing", "van", { attachedToId: "meren", attachedToSeatId: "a", attachTimestamp: 1 });
    const bear = { id: "bear", name: "Bear", typeLine: "Creature — Bear", power: "2", toughness: "2", colors: [], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "" } as VisibleCard;
    return session([seat("a", [meren, vanishing, bear]), seat("b", [])]);
  };
  it("the activated ability parses and phases out Meren with the Aura", () => {
    const s = setup();
    const van = onBoard(s, "van");
    const [ability] = parseGenericManaAbilities(van.oracleText);
    expect(ability.effectText).toMatch(/phases out/i);
    const effect = parseGenericAbilityEffect(ability.effectText)!;
    expect(effect.kind).toBe("phase_out");
    expect(genericAbilityEffectHasLegalTarget(s, "a", van, effect)).toBe(true);
    const after = applyGenericAbilityEffect(s, "a", van, effect);
    expect(onBoard(after, "meren").phasedOut).toBe(true);
    expect(onBoard(after, "van").phasedOut).toBe(true);
    expect(genericAbilityEffectHasLegalTarget(after, "a", onBoard(after, "van"), effect)).toBe(false);
  });
  it("a phased-out Meren cannot attack, trigger or be targeted, and phases in on its controller's untap step", () => {
    const s = setup();
    const van = onBoard(s, "van");
    const out = phaseOutPermanent(s, "meren");
    expect(canAttack(onBoard(out, "meren"))).toBe(false);
    expect(legalAttackActions(out.seats[0], [out.seats[1]]).some((a) => JSON.stringify(a).includes("meren"))).toBe(false);
    expect(findCommonTriggersForPermanentDied(out, "a", onBoard(out, "bear"))).toHaveLength(0);
    const back = untapForSeat(out, "a");
    expect(onBoard(back, "meren").phasedOut).toBeFalsy();
    expect(onBoard(back, "van").phasedOut).toBeFalsy();
    expect(van).toBeDefined();
  });
});

describe("shared effective-permanent layer", () => {
  it("a stripped mana creature taps for nothing; a phased-out one too", () => {
    const elf = real("Llanowar Elves", "elf");
    const aura = real("Utter Insignificance", "ui", { attachedToId: "elf", attachedToSeatId: "a", attachTimestamp: 1 });
    const s = settle(session([seat("a", [elf, aura])]));
    expect(manaChoicesForCard(onBoard(s, "elf"), s.seats[0])).toEqual([]);
    expect(manaChoicesForCard(elf, seat("a", [elf]))).toEqual(["G"]);
    expect(manaChoicesForCard({ ...elf, phasedOut: true }, seat("a", [elf]))).toEqual([]);
  });
  it("hasActiveAbilities / abilityOracleText agree", () => {
    const c = { oracleText: "Flying" } as VisibleCard;
    expect(hasActiveAbilities(c)).toBe(true);
    expect(hasActiveAbilities({ ...c, abilitiesStripped: true })).toBe(false);
    expect(hasActiveAbilities({ ...c, phasedOut: true })).toBe(false);
    expect(abilityOracleText({ ...c, abilitiesStripped: true })).toBe("");
    expect(abilityOracleText({ ...c, phasedOut: true, grantedAbilityText: "x" })).toBe("");
  });
  it("a stripped creature's enters-watcher does not fire; a phased-out one neither", () => {
    const wat = real("Doomwake Giant", "giant");
    const aura = real("Utter Insignificance", "ui", { attachedToId: "giant", attachedToSeatId: "a", attachTimestamp: 1 });
    const ench = real("Always Watching", "aw", { zone: "battlefield" });
    const base = settle(session([seat("a", [wat, aura, ench]), seat("b", [])]));
    expect(findCommonTriggersForPermanentEntered(base, "a", onBoard(base, "aw")).some((t) => t.sourceCardId === "giant")).toBe(false);
    const plain = settle(session([seat("a", [real("Doomwake Giant", "giant"), ench]), seat("b", [])]));
    expect(findCommonTriggersForPermanentEntered(plain, "a", onBoard(plain, "aw")).some((t) => t.sourceCardId === "giant")).toBe(true);
    const phased = phaseOutPermanent(plain, "giant");
    expect(findCommonTriggersForPermanentEntered(phased, "a", onBoard(phased, "aw")).some((t) => t.sourceCardId === "giant")).toBe(false);
  });
  it("a phased-out creature is not a target candidate, not destroyed by sweepers, and is not counted", () => {
    const a = real("Meren of Clan Nel Toth", "meren");
    const s = phaseOutPermanent(session([seat("a", [a]), seat("b", [])]), "meren");
    expect(targetableView(s, "b", a).seats[0].board.battlefield).toHaveLength(0);
    expect(targetableView(s, "a", a).seats[0].board.battlefield).toHaveLength(0);
    expect(destroyAllTypesVictims(s, ["creatures"])).toHaveLength(0);
    expect(countMatchingPermanents(s.seats[0].board.battlefield, "creature")).toBe(0);
  });
  it("Pacifism-style Auras: the enchanted creature can't attack or block; it can again once the Aura is gone", () => {
    const bear = { id: "bear", name: "Bear", typeLine: "Creature — Bear", power: "2", toughness: "2", colors: [], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false } as VisibleCard;
    const pac = real("Pacifism", "pac", { attachedToId: "bear", attachedToSeatId: "b", attachTimestamp: 1 });
    const s = settle(session([seat("a", [bear]), seat("b", [pac])]));
    expect(attachmentCombatBans(pac.oracleText)).toEqual({ attack: true, block: true });
    expect(canAttack(onBoard(s, "bear"))).toBe(false);
    expect(canBlock(onBoard(s, "bear"))).toBe(false);
    const free = settle({ ...s, seats: s.seats.map((x) => ({ ...x, board: { ...x.board, battlefield: x.board.battlefield.filter((c) => c.id !== "pac") } })) });
    expect(canAttack(onBoard(free, "bear"))).toBe(true);
    expect(attachmentCombatBans("Enchanted creature gets +2/+2, has intimidate, and can't attack you or planeswalkers you control.")).toEqual({ attack: false, block: false });
  });
});
