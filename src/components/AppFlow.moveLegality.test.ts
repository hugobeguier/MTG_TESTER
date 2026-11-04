// The central legality gate (checkMoveLegal + src/lib/moveLegality.ts): an illegal move, or one the engine cannot perform, is refused with a reason and
// changes nothing; legal moves (including legal-but-pointless ones) are still accepted. One test per class of illegal / silent-no-op action.
import { describe, expect, it } from "vitest";
import { checkMoveLegal, legalAttackActions, legalMainPhaseActions, type LegalAgentAction } from "./AppFlow";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

function card(overrides: Partial<VisibleCard> & Pick<VisibleCard, "id" | "name" | "typeLine">): VisibleCard {
  return { oracleText: "", manaValue: 0, colors: [], role: "permanent", zone: "battlefield", ...overrides };
}
function seat(overrides: Partial<PlayerSeat> & Pick<PlayerSeat, "id" | "name" | "kind">): PlayerSeat {
  return { life: 40, commanderDamage: {}, zones: { library: 0, hand: 0, battlefield: 0, graveyard: 0, exile: 0, command: 0 }, board: { hand: [], battlefield: [] }, ...overrides };
}
function session(seats: PlayerSeat[], phase = "precombat main phase"): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase, turn: 3, activePlayerId: seats[0].id, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] } as GameSession;
}

const plains = (id: string) => card({ id, name: "Plains", typeLine: "Basic Land — Plains" });
const island = (id: string) => card({ id, name: "Island", typeLine: "Basic Land — Island" });
const swords = card({ id: "swords", name: "Swords to Plowshares", typeLine: "Instant", manaCost: "{W}", manaValue: 1, zone: "hand", oracleText: "Exile target creature. Its controller gains life equal to its power." });
const wrath = card({ id: "wrath", name: "Wrath of God", typeLine: "Sorcery", manaCost: "{2}{W}{W}", manaValue: 4, zone: "hand", oracleText: "Destroy all creatures. They can't be regenerated." });
const divination = card({ id: "div", name: "Divination", typeLine: "Sorcery", manaCost: "{2}{U}", manaValue: 3, zone: "hand", oracleText: "Draw two cards." });
const bear = (id: string, extra: Partial<VisibleCard> = {}) => card({ id, name: "Grizzly Bears", typeLine: "Creature — Bear", power: "2", toughness: "2", ...extra });

type Setup = { hand?: VisibleCard[]; battlefield?: VisibleCard[]; oppBattlefield?: VisibleCard[]; kind?: "agent" | "human"; phase?: string };
function setup(opts: Setup) {
  const me = seat({ id: "me", name: "Me", kind: opts.kind ?? "agent", board: { hand: opts.hand ?? [], battlefield: opts.battlefield ?? [] } });
  const opp = seat({ id: "opp", name: "Opp", kind: "agent", board: { hand: [], battlefield: opts.oppBattlefield ?? [] } });
  return session([me, opp], opts.phase);
}
function agentCtx(s: GameSession, overrides: Partial<Parameters<typeof checkMoveLegal>[3]> = {}) {
  const me = s.seats[0];
  const fresh = legalMainPhaseActions(me, false, "me", s.turn, new Set(), s);
  return { mode: "agent" as const, hasPlayedLand: false, activeSeatId: "me", stackEmpty: true, fresh, ...overrides };
}
const castAction = (cardId: string, label = "cast"): LegalAgentAction => ({ id: `cast:${cardId}`, actionType: "cast_spell", cardId, targetIds: [], label });
const landAction = (cardId: string): LegalAgentAction => ({ id: `play-land:${cardId}`, actionType: "play_land", cardId, targetIds: [], label: "play land" });

function expectRejected(result: ReturnType<typeof checkMoveLegal>, fragment: RegExp) {
  expect(result.legal).toBe(false);
  if (!result.legal) expect(result.reason).toMatch(fragment);
}

describe("checkMoveLegal: rejected moves leave the state untouched", () => {
  it("never mutates the session (mana, hand, battlefield, stack-visible state)", () => {
    const s = setup({ hand: [swords], battlefield: [plains("p1")] });
    const before = JSON.stringify(s);
    expectRejected(checkMoveLegal(s, "me", castAction("swords"), agentCtx(s)), /no legal target/i);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("targeted spell with no legal target cannot be cast", () => {
    const s = setup({ hand: [swords], battlefield: [plains("p1")] });
    expectRejected(checkMoveLegal(s, "me", castAction("swords"), agentCtx(s)), /no legal target/i);
    // the human is held to the same rule
    expectRejected(checkMoveLegal(s, "me", castAction("swords"), { mode: "human", hasPlayedLand: false, activeSeatId: "me", stackEmpty: true }), /no legal target/i);
  });

  it("the same spell IS legal once a target exists", () => {
    const s = setup({ hand: [swords], battlefield: [plains("p1")], oppBattlefield: [bear("b1")] });
    expect(checkMoveLegal(s, "me", castAction("swords"), agentCtx(s)).legal).toBe(true);
  });

  it("cost that cannot be paid: wrong colour of mana", () => {
    const s = setup({ hand: [swords], battlefield: [island("i1")], oppBattlefield: [bear("b1")] });
    expectRejected(checkMoveLegal(s, "me", castAction("swords"), agentCtx(s)), /cannot be paid/i);
  });

  it("cost that cannot be paid: not enough mana", () => {
    const s = setup({ hand: [wrath], battlefield: [plains("p1"), plains("p2")], oppBattlefield: [bear("b1")] });
    expectRejected(checkMoveLegal(s, "me", castAction("wrath"), agentCtx(s)), /cannot be paid/i);
  });

  it("sorcery-speed spell in another player's turn, outside a main phase, or with something on the stack", () => {
    const lands = [plains("p1"), plains("p2"), plains("p3"), plains("p4")];
    const s = setup({ hand: [wrath], battlefield: lands, oppBattlefield: [bear("b1")] });
    expectRejected(checkMoveLegal(s, "me", castAction("wrath"), agentCtx(s, { activeSeatId: "opp" })), /own main phase/i);
    expectRejected(checkMoveLegal(setup({ hand: [wrath], battlefield: lands, phase: "declare attackers step" }), "me", castAction("wrath"), { mode: "human", hasPlayedLand: false, activeSeatId: "me", stackEmpty: true }), /own main phase/i);
    expectRejected(checkMoveLegal(s, "me", castAction("wrath"), agentCtx(s, { stackEmpty: false })), /own main phase|empty stack/i);
  });

  it("an instant may be cast outside the main phase (not over-restricted)", () => {
    const s = setup({ hand: [swords], battlefield: [plains("p1")], oppBattlefield: [bear("b1")], phase: "declare attackers step" });
    const fresh = legalMainPhaseActions(s.seats[0], false, "opp", s.turn, new Set(), s);
    expect(checkMoveLegal(s, "me", castAction("swords"), { mode: "human", hasPlayedLand: false, activeSeatId: "opp", stackEmpty: true, fresh }).legal).toBe(true);
  });

  it("second land drop, and land play outside the own main phase", () => {
    const s = setup({ hand: [plains("pl")] });
    expect(checkMoveLegal(s, "me", landAction("pl"), agentCtx(s)).legal).toBe(true);
    expectRejected(checkMoveLegal(s, "me", landAction("pl"), agentCtx(s, { hasPlayedLand: true })), /land drop/i);
    expectRejected(checkMoveLegal(s, "me", landAction("pl"), agentCtx(s, { activeSeatId: "opp" })), /own main phase/i);
    expectRejected(checkMoveLegal(s, "me", landAction("pl"), agentCtx(s, { stackEmpty: false })), /empty stack/i);
  });

  it("stale ids: a card that already left the hand (double-cast / already played) is refused", () => {
    const s = setup({ hand: [], battlefield: [plains("p1"), plains("p2"), plains("p3")] });
    expectRejected(checkMoveLegal(s, "me", castAction("div"), agentCtx(s)), /not in the hand/i);
    expectRejected(checkMoveLegal(s, "me", landAction("pl"), agentCtx(s)), /not in the hand/i);
  });

  it("responding when the stack is empty, and responding with a sorcery", () => {
    const s = setup({ hand: [swords, wrath], battlefield: [plains("p1"), plains("p2"), plains("p3"), plains("p4")], oppBattlefield: [bear("b1")] });
    const respond = (cardId: string): LegalAgentAction => ({ id: `respond:${cardId}`, actionType: "cast_spell", cardId, targetIds: ["x"], label: "respond" });
    expectRejected(checkMoveLegal(s, "me", respond("swords"), { mode: "human", hasPlayedLand: true, activeSeatId: "opp", stackEmpty: true }), /nothing on the stack/i);
    expectRejected(checkMoveLegal(s, "me", respond("wrath"), { mode: "human", hasPlayedLand: true, activeSeatId: "opp", stackEmpty: false }), /not an instant/i);
    expect(checkMoveLegal(s, "me", respond("swords"), { mode: "human", hasPlayedLand: true, activeSeatId: "opp", stackEmpty: false }).legal).toBe(true);
  });

  it("an extra cost that cannot be paid: discard with nothing else in hand, sacrifice with no creature", () => {
    const discardSpell = card({ id: "ds", name: "Windfall Test", typeLine: "Sorcery", manaCost: "{1}", manaValue: 1, zone: "hand", oracleText: "As an additional cost to cast this spell, discard a card.\nDraw two cards." });
    const alone = setup({ hand: [discardSpell], battlefield: [plains("p1")] });
    expectRejected(checkMoveLegal(alone, "me", castAction("ds"), agentCtx(alone)), /sacrifice or discard|cannot be paid/i);
    const withFodder = setup({ hand: [discardSpell, plains("x")], battlefield: [plains("p1")] });
    expect(checkMoveLegal(withFodder, "me", castAction("ds"), agentCtx(withFodder)).legal).toBe(true);
    const rites = card({ id: "vr", name: "Village Rites", typeLine: "Instant", manaCost: "{B}", manaValue: 1, zone: "hand", oracleText: "As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards." });
    const swamp = card({ id: "sw", name: "Swamp", typeLine: "Basic Land — Swamp" });
    const noCreature = setup({ hand: [rites], battlefield: [swamp] });
    expectRejected(checkMoveLegal(noCreature, "me", castAction("vr"), agentCtx(noCreature)), /sacrifice or discard|cannot be paid/i);
    const withCreature = setup({ hand: [rites], battlefield: [swamp, bear("b")] });
    expect(checkMoveLegal(withCreature, "me", castAction("vr"), agentCtx(withCreature)).legal).toBe(true);
  });

  it("unsupported spell text: refused for an agent, still allowed for a human (manual review)", () => {
    const brume = card({ id: "bb", name: "Batwing Brume", typeLine: "Instant", manaCost: "{1}{W}", manaValue: 2, zone: "hand", oracleText: "Prevent all combat damage that would be dealt this turn if {W} was spent to cast this spell. Prevent all combat damage that would be dealt this turn if {B} was spent to cast this spell." });
    const agent = setup({ hand: [brume], battlefield: [plains("p1"), plains("p2")] });
    expectRejected(checkMoveLegal(agent, "me", castAction("bb"), agentCtx(agent)), /cannot carry out/i);
    const human = setup({ hand: [brume], battlefield: [plains("p1"), plains("p2")], kind: "human" });
    expect(checkMoveLegal(human, "me", castAction("bb"), { mode: "human", hasPlayedLand: false, activeSeatId: "me", stackEmpty: true }).legal).toBe(true);
  });

  it("activated ability whose source is gone, and a tap ability that is summoning sick / tapped (not offered, so refused for an agent)", () => {
    const bauble = card({ id: "seer", name: "Viscera Seer", typeLine: "Creature — Vampire Wizard", power: "1", toughness: "1", oracleText: "Sacrifice a creature: Scry 1.", summoningSick: true });
    const s = setup({ battlefield: [bauble, bear("b")] });
    const gone: LegalAgentAction = { id: "activate-sacrifice:missing:0", actionType: "activate_ability", abilityKind: "generic_sacrifice", abilityIndex: 0, cardId: "missing", targetIds: [], label: "activate" };
    expectRejected(checkMoveLegal(s, "me", gone, agentCtx(s)), /no longer/i);
    const fake: LegalAgentAction = { id: "activate-generic-tap:seer:0", actionType: "activate_ability", abilityKind: "generic_tap", abilityIndex: 0, cardId: "seer", targetIds: [], label: "activate Viscera Seer" };
    expectRejected(checkMoveLegal(s, "me", fake, agentCtx(s)), /cannot be paid|tapped|summoning/i);
  });

  it("sorcery-speed abilities (loyalty, equip) are refused outside the own main phase", () => {
    const walker = card({ id: "pw", name: "Test Walker", typeLine: "Legendary Planeswalker", counters: [{ kind: "loyalty", count: 4 }], oracleText: "+1: Draw a card." });
    const s = setup({ battlefield: [walker] });
    const loyalty: LegalAgentAction = { id: "activate-loyalty:pw:0", actionType: "activate_ability", abilityKind: "loyalty_ability", cardId: "pw", loyaltyCost: 1, targetIds: [], label: "activate" };
    expectRejected(checkMoveLegal(s, "me", loyalty, agentCtx(s, { activeSeatId: "opp" })), /own main phase/i);
  });

  it("attack: summoning-sick, tapped, or missing creature is refused; a ready creature is accepted", () => {
    const sick = bear("sick", { summoningSick: true });
    const tapped = bear("tap", { tapped: true });
    const ready = bear("ready");
    const s = setup({ battlefield: [sick, tapped, ready] });
    const attackWith = (cardId: string): LegalAgentAction => ({ id: `attack:${cardId}:opp`, actionType: "attack", cardId, targetIds: ["opp"], label: `attack with ${cardId}` });
    const fresh = legalAttackActions(s.seats[0], [s.seats[1]]);
    const ctx = { mode: "agent" as const, hasPlayedLand: true, activeSeatId: "me", stackEmpty: true, fresh };
    expectRejected(checkMoveLegal(s, "me", attackWith("sick"), ctx), /summoning|cannot attack/i);
    expectRejected(checkMoveLegal(s, "me", attackWith("tap"), ctx), /tapped/i);
    expectRejected(checkMoveLegal(s, "me", attackWith("ghost"), ctx), /no longer/i);
    const offered = fresh.find((item) => item.actionType === "attack" && item.cardId === "ready");
    expect(offered).toBeDefined();
    expect(checkMoveLegal(s, "me", offered!, ctx).legal).toBe(true);
  });

  it("legal-but-pointless plays are NOT blocked by the gate (play guards own that): wrath with no creatures, draw with an empty library", () => {
    const lands = [plains("p1"), plains("p2"), plains("p3"), plains("p4")];
    const emptyBoard = setup({ hand: [wrath], battlefield: lands });
    expect(checkMoveLegal(emptyBoard, "me", castAction("wrath"), agentCtx(emptyBoard)).legal).toBe(true);
    const noLibrary = setup({ hand: [divination], battlefield: [island("i1"), island("i2"), island("i3")] });
    expect(noLibrary.seats[0].library ?? []).toHaveLength(0);
    expect(checkMoveLegal(noLibrary, "me", castAction("div"), agentCtx(noLibrary)).legal).toBe(true);
  });

  it("every action the generator offers passes the gate (no false rejections)", () => {
    const s = setup({ hand: [swords, wrath, divination, plains("pl")], battlefield: [plains("p1"), plains("p2"), plains("p3"), island("i1"), bear("b")], oppBattlefield: [bear("ob")] });
    const ctx = agentCtx(s);
    for (const action of ctx.fresh) {
      expect(checkMoveLegal(s, "me", action, ctx), action.label).toEqual({ legal: true });
    }
  });
});
