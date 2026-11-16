// General damage prevention (src/lib/damagePrevention.ts + AppFlow's applyDamagePrevention choke point), driven with real catalog text.
import { describe, expect, it } from "vitest";
import { addDamageShieldsFromSpec, applyCombatDamageToTarget, applyRemovalEffect, applySpellDamagePrevention, applyTargetedPumpEffect, findCommonTriggersForPermanentEntered, parseTargetedPump, resolveCombatDamage, resolveTriggerEffect } from "./AppFlow";
import { describeDamageShields, parseDamagePrevention } from "@/lib/damagePrevention";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const bear = (id: string, extra: Partial<VisibleCard> = {}) =>
  ({ id, name: `Bear ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", summoningSick: false, ...extra }) as VisibleCard;
function seat(id: string, battlefield: VisibleCard[], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return {
    id, name: id, kind: "agent", life: 40, commanderDamage: {},
    zones: { library: 0, hand: 0, battlefield: battlefield.length, graveyard: 0, exile: 0, command: 0 },
    board: { hand: [], battlefield, graveyard: [] }, deck: { colors: ["W", "U", "B", "R", "G"] }, ...extra
  } as PlayerSeat;
}
function session(seats: PlayerSeat[], extra: Partial<GameSession> = {}): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "declare blockers step", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [], ...extra };
}
const find = (s: GameSession, seatId: string, cardId: string) => s.seats.find((x) => x.id === seatId)!.board.battlefield.find((c) => c.id === cardId);
const life = (s: GameSession, seatId: string) => s.seats.find((x) => x.id === seatId)!.life;
const bolt = (s: GameSession, target: Parameters<typeof applyRemovalEffect>[6], amount = 3) =>
  applyRemovalEffect(s, "o", "Lightning Bolt", real("Lightning Bolt", "lb", { zone: "hand" }), { kind: "damage", amount, targetType: "any" } as never, undefined, target);
const prevented = (s: GameSession) => s.events.some((e) => /prevented/i.test(e.message));

describe("parseDamagePrevention templates", () => {
  it("reads the common shapes", () => {
    expect(parseDamagePrevention("Prevent all damage that would be dealt to you this turn.")).toMatchObject({ scope: "you", combatOnly: false });
    expect(parseDamagePrevention("Prevent all combat damage that would be dealt to you this turn.")).toMatchObject({ scope: "you", combatOnly: true });
    expect(parseDamagePrevention("Prevent the next 3 damage that would be dealt to target creature this turn.")).toMatchObject({ scope: "target", amount: 3 });
    expect(parseDamagePrevention("Prevent the next 2 damage that would be dealt to any target this turn.")).toMatchObject({ scope: "target", amount: 2, allowsPlayer: true });
    expect(parseDamagePrevention("Prevent all damage that would be dealt to creatures you control this turn.")).toMatchObject({ scope: "controlled_creatures" });
    expect(parseDamagePrevention("Prevent all damage target creature would deal this turn.")).toMatchObject({ scope: "source_target" });
    expect(parseDamagePrevention("Prevent all combat damage that would be dealt by target creature this turn.")).toMatchObject({ scope: "source_target", combatOnly: true });
    expect(parseDamagePrevention("Prevent all combat damage that would be dealt this turn.")).toBeUndefined();
  });
});

describe("shields at the damage choke points", () => {
  const me = () => seat("a", [bear("mine")]);
  const foe = () => seat("o", [bear("atk", { power: "3", toughness: "3", attacking: true, attackTargetId: "a" })]);
  const withShield = (spec: string, target?: Parameters<typeof addDamageShieldsFromSpec>[4], extra: Partial<GameSession> = {}) =>
    addDamageShieldsFromSpec(session([me(), foe()], extra), "a", { id: "src", name: "Shield" }, parseDamagePrevention(spec)!, target);

  it("'prevent all damage to you': combat and burn both bounce, and prevented commander damage is not counted", () => {
    const s = withShield("Prevent all damage that would be dealt to you this turn.");
    const swung = resolveCombatDamage(s, "o");
    expect(life(swung, "a")).toBe(40);
    expect(prevented(swung)).toBe(true);
    const burned = bolt(s, { kind: "player", seatId: "a" });
    expect(life(burned, "a")).toBe(40);
    const cmdr = applyCombatDamageToTarget(s, "Cmdr", { seat: s.seats[0] }, 5, bear("cmdr", { commander: true }), "o");
    expect(life(cmdr, "a")).toBe(40);
    expect(cmdr.seats[0].commanderDamage.cmdr).toBeUndefined();
  });

  it("combat-only shields let burn through", () => {
    const s = withShield("Prevent all combat damage that would be dealt to you this turn.");
    expect(life(resolveCombatDamage(s, "o"), "a")).toBe(40);
    expect(life(bolt(s, { kind: "player", seatId: "a" }), "a")).toBe(37);
  });

  it("'prevent the next N damage' depletes and lets the excess through, and lifelink only gains what is dealt", () => {
    const s = withShield("Prevent the next 2 damage that would be dealt to you this turn.");
    const hit = applyCombatDamageToTarget(s, "Lifelinker", { seat: s.seats[0] }, 5, bear("ll", { oracleText: "Lifelink" }), "o");
    expect(life(hit, "a")).toBe(37);
    expect(life(hit, "o")).toBe(43);
    expect(hit.damageShields ?? []).toHaveLength(0);
    const again = applyCombatDamageToTarget(hit, "x", { seat: hit.seats[0] }, 1, undefined, "o", "noncombat");
    expect(life(again, "a")).toBe(36);
  });

  it("two shields stack", () => {
    const s = addDamageShieldsFromSpec(withShield("Prevent the next 2 damage that would be dealt to you this turn."), "a", { id: "s2", name: "Second" }, parseDamagePrevention("Prevent the next 2 damage that would be dealt to you this turn.")!);
    expect(life(applyCombatDamageToTarget(s, "x", { seat: s.seats[0] }, 5, undefined, "o", "noncombat"), "a")).toBe(39);
  });

  it("shields expire when the turn changes", () => {
    const s = withShield("Prevent all damage that would be dealt to you this turn.");
    expect(life(applyCombatDamageToTarget({ ...s, turn: 2 }, "x", { seat: s.seats[0] }, 3, undefined, "o", "noncombat"), "a")).toBe(37);
  });

  it("'prevent the next 3 damage to target creature': burn on that creature is reduced, others are unaffected", () => {
    const s = withShield("Prevent the next 3 damage that would be dealt to target creature this turn.", { kind: "card", seatId: "a", cardId: "mine" });
    const hit = bolt(s, { kind: "card", seatId: "a", cardId: "mine" }, 3);
    expect(find(hit, "a", "mine")).toBeDefined();
    expect(prevented(hit)).toBe(true);
    const other = session([seat("a", [bear("mine"), bear("other")]), foe()], { damageShields: s.damageShields });
    expect(find(bolt(other, { kind: "card", seatId: "a", cardId: "other" }), "a", "other")).toBeUndefined();
  });

  it("'creatures you control' shields creatures in combat (blocker survives a 3-power attacker)", () => {
    const s = withShield("Prevent all damage that would be dealt to creatures you control this turn.");
    const blocker = bear("mine", { blocking: true, blockingTargetId: "atk" });
    const attackerHit = { ...s, seats: [{ ...s.seats[0], board: { ...s.seats[0].board, battlefield: [blocker] } }, s.seats[1]] };
    const after = resolveCombatDamage(attackerHit, "o");
    expect(find(after, "a", "mine")).toBeDefined();
    expect(prevented(after)).toBe(true);
  });

  it("'prevent all damage target creature would deal': the attacker deals nothing to the player", () => {
    const s = withShield("Prevent all damage target creature would deal this turn.", { kind: "card", seatId: "o", cardId: "atk" });
    expect(life(resolveCombatDamage(s, "o"), "a")).toBe(40);
    expect(life(applyCombatDamageToTarget(s, "x", { seat: s.seats[0] }, 2, bear("other"), "o"), "a")).toBe(38);
  });
});

describe("the cards", () => {
  it("Inkshield: prevents combat damage to you and makes one 2/1 Inkling per point prevented", () => {
    const spell = real("Inkshield", "ik", { zone: "hand" as const });
    const base = session([seat("a", []), seat("o", [bear("atk", { power: "3", toughness: "3", attacking: true, attackTargetId: "a" })])]);
    const shielded = applySpellDamagePrevention(base, "a", spell, undefined, ["W", "B"]);
    const swing = resolveCombatDamage(shielded, "o");
    expect(life(swing, "a")).toBe(40);
    const inklings = swing.seats[0].board.battlefield.filter((c) => c.name.includes("Inkling"));
    expect(inklings).toHaveLength(3);
    expect(inklings.every((c) => c.power === "2" && c.toughness === "1")).toBe(true);
    // Burn is not combat damage.
    expect(life(bolt(shielded, { kind: "player", seatId: "a" }), "a")).toBe(37);
  });

  it("Inkshield with two attackers makes a token per point from each, and trample overflow over a shielded blocker is still prevented only if it hits the player", () => {
    const spell = real("Inkshield", "ik", { zone: "hand" as const });
    const base = session([seat("a", []), seat("o", [bear("a1", { power: "2", attacking: true, attackTargetId: "a" }), bear("a2", { power: "4", toughness: "4", attacking: true, attackTargetId: "a" })])]);
    const swing = resolveCombatDamage(applySpellDamagePrevention(base, "a", spell, undefined, []), "o");
    expect(swing.seats[0].board.battlefield.filter((c) => c.name.includes("Inkling"))).toHaveLength(6);
  });

  it("Batwing Brume: {W} prevents combat damage, {B} drains one life per attacking creature, both do both, neither does nothing", () => {
    const brume = real("Batwing Brume", "bb", { zone: "hand" as const });
    const base = session([seat("a", []), seat("o", [bear("atk", { power: "3", attacking: true, attackTargetId: "a" }), bear("atk2", { attacking: true, attackTargetId: "a" })])]);
    const w = applySpellDamagePrevention(base, "a", brume, undefined, ["W"]);
    expect(w.combatDamagePrevented?.turn).toBe(1);
    expect(life(w, "o")).toBe(40);
    expect(life(resolveCombatDamage(w, "o"), "a")).toBe(40);
    const b = applySpellDamagePrevention(base, "a", brume, undefined, ["B"]);
    expect(b.combatDamagePrevented).toBeUndefined();
    expect(life(b, "o")).toBe(38);
    expect(life(b, "a")).toBe(40);
    const both = applySpellDamagePrevention(base, "a", brume, undefined, ["W", "B"]);
    expect(both.combatDamagePrevented?.turn).toBe(1);
    expect(life(both, "o")).toBe(38);
    const neither = applySpellDamagePrevention(base, "a", brume, undefined, []);
    expect(neither.combatDamagePrevented).toBeUndefined();
    expect(life(neither, "o")).toBe(40);
  });

  it("Enshrouding Mist: +1/+1, all damage to it prevented (burn and combat), and it untaps if renowned", () => {
    const mist = real("Enshrouding Mist", "em", { zone: "hand" as const });
    const pump = parseTargetedPump(mist.oracleText)!;
    expect(pump).toMatchObject({ power: 1, toughness: 1 });
    const s = session([seat("a", [bear("mine", { renowned: true, tapped: true })]), seat("o", [bear("atk", { power: "5", toughness: "5", attacking: true, attackTargetId: "a" })])]);
    const after = applyTargetedPumpEffect(s, "a", mist, pump, { kind: "card", seatId: "a", cardId: "mine" });
    expect(find(after, "a", "mine")!.temporaryPowerBonus).toBe(1);
    expect(find(after, "a", "mine")!.tapped).toBe(false);
    expect(find(bolt(after, { kind: "card", seatId: "a", cardId: "mine" }, 9), "a", "mine")).toBeDefined();
    const blocking = { ...after, seats: [{ ...after.seats[0], board: { ...after.seats[0].board, battlefield: [{ ...find(after, "a", "mine")!, blocking: true, blockingTargetId: "atk" }] } }, after.seats[1]] };
    expect(find(resolveCombatDamage(blocking, "o"), "a", "mine")).toBeDefined();
    // Shield is on that creature only, and not for a non-renowned one's untap.
    const plain = applyTargetedPumpEffect(session([seat("a", [bear("mine", { tapped: true })]), seat("o", [])]), "a", mist, pump, { kind: "card", seatId: "a", cardId: "mine" });
    expect(find(plain, "a", "mine")!.tapped).toBe(true);
  });

  it("Selfless Squire: its enters trigger shields you, and each prevented point becomes a +1/+1 counter", () => {
    const squire = real("Selfless Squire", "sq");
    const s = session([seat("a", [squire]), seat("o", [bear("atk", { power: "4", toughness: "4", attacking: true, attackTargetId: "a" })])]);
    const triggers = findCommonTriggersForPermanentEntered(s, "a", squire);
    expect(triggers).toHaveLength(1);
    const shielded = resolveTriggerEffect(s, triggers[0]);
    const swing = resolveCombatDamage(shielded, "o");
    expect(life(swing, "a")).toBe(40);
    const counters = find(swing, "a", "sq")!.counters?.find((c) => c.kind === "+1/+1");
    expect(counters?.count).toBe(4);
    // Burn is prevented too ("all damage"), also feeding the Squire.
    const burned = bolt(shielded, { kind: "player", seatId: "a" });
    expect(life(burned, "a")).toBe(40);
    expect(find(burned, "a", "sq")!.counters?.find((c) => c.kind === "+1/+1")?.count).toBe(3);
  });

  it("Seraph of the Sword: combat damage to it is prevented (as blocker and as attacker) but burn is not", () => {
    const seraph = real("Seraph of the Sword", "sw", { blocking: true, blockingTargetId: "atk" });
    const s = session([seat("a", [seraph]), seat("o", [bear("atk", { power: "9", toughness: "9", attacking: true, attackTargetId: "a" })])]);
    const after = resolveCombatDamage(s, "o");
    expect(find(after, "a", "sw")).toBeDefined();
    expect(prevented(after)).toBe(true);
    const burned = bolt(session([seat("a", [real("Seraph of the Sword", "sw")]), seat("o", [])]), { kind: "card", seatId: "a", cardId: "sw" }, 3);
    expect(find(burned, "a", "sw")).toBeUndefined();
  });

  it("agents see live shields in their summary", () => {
    const s = addDamageShieldsFromSpec(session([seat("a", []), seat("o", [])]), "a", { id: "x", name: "Inkshield" }, parseDamagePrevention("Prevent all combat damage that would be dealt to you this turn.")!);
    expect(describeDamageShields(s)).toEqual(["Inkshield: prevents all combat damage to a this turn."]);
  });
});
