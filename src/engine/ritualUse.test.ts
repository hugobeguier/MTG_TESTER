// Item 1 of the playtest ("the AI played Dark Ritual and the mana went up in flames"). Real Oracle text from the catalog; engine tests only.
import { describe, expect, it } from "vitest";
import { bear, real, seat, session } from "@/components/AppFlow.batch3Abilities.test";
import { legalMainPhaseActions, legalPriorityActions } from "@/engine/legalActions";
import { chooseManaSourcesOrFloating, emptyManaPool } from "@/engine/mana";
import { isPureRitual, ritualYield, wouldRitualBeUsed } from "@/engine/ritualUse";
import type { PendingAction } from "@/engine/types";
import type { PlayerSeat, VisibleCard } from "@/lib/types";

const hand = (cards: VisibleCard[]) => ({ hand: cards, battlefield: [] as VisibleCard[], graveyard: [] as VisibleCard[] });
function agent(handCards: VisibleCard[], lands: VisibleCard[], extra: Partial<PlayerSeat> = {}): PlayerSeat {
  return seat("a", lands, { kind: "agent", board: { ...hand(handCards), battlefield: lands }, ...extra } as Partial<PlayerSeat>);
}
const castIds = (s: PlayerSeat, game = session([s])) => legalMainPhaseActions(s, true, "a", 6, new Set(), game).filter((action) => action.actionType === "cast_spell").map((action) => action.cardId);

describe("ritualYield recognises pure mana rituals", () => {
  it("Dark Ritual is {B}{B}{B}; Seething Song, Pyretic and Desperate Ritual, Rite of Flame too; Culling Ritual and a creature are not", () => {
    expect(ritualYield(real("Dark Ritual", "x"))).toMatchObject({ B: 3 });
    expect(ritualYield(real("Seething Song", "x"))).toMatchObject({ R: 5 });
    expect(ritualYield(real("Pyretic Ritual", "x"))).toMatchObject({ R: 3 });
    expect(ritualYield(real("Desperate Ritual", "x"))).toMatchObject({ R: 3 });
    expect(ritualYield(real("Rite of Flame", "x"))).toMatchObject({ R: 2 });
    expect(isPureRitual(real("Culling Ritual", "x"))).toBe(false);
    expect(isPureRitual(real("Vampire Nighthawk", "x"))).toBe(false);
  });
});

describe("an agent is only offered Dark Ritual when the mana would be spent", () => {
  it("nothing else in hand: Dark Ritual is NOT offered (main phase and as a response)", () => {
    const s = agent([real("Dark Ritual", "dr")], [real("Swamp", "sw")]);
    expect(wouldRitualBeUsed(session([s]), s, s.board.hand[0], "a")).toBe(false);
    expect(castIds(s)).toEqual([]);
    const stackSpell = { id: "st", type: "spell", actorSeatId: "b", cardId: "c", cardName: "Opposing Spell", cardTypeLine: "Sorcery" } as PendingAction;
    const game = session([s, seat("b", [])]);
    expect(legalPriorityActions(s, stackSpell, "b", game).some((action) => action.cardId === "dr")).toBe(false);
  });
  it("a {1}{B}{B} spell is castable only with the ritual's {B}{B}{B}: Dark Ritual IS offered, and the bare one-land seat cannot cast the spell without it", () => {
    const s = agent([real("Dark Ritual", "dr"), real("Vampire Nighthawk", "nh")], [real("Swamp", "sw")]);
    expect(wouldRitualBeUsed(session([s]), s, s.board.hand[0], "a")).toBe(true);
    expect(castIds(s)).toEqual(["dr"]);
  });
  it("after the ritual resolves the floating {B}{B}{B} pays for the spell (pool first, no land needed)", () => {
    const nighthawk = real("Vampire Nighthawk", "nh");
    const floating = { ...emptyManaPool(), B: 3 };
    const s = agent([nighthawk], [], { floatingMana: floating });
    expect(castIds(s)).toEqual(["nh"]);
    const paid = chooseManaSourcesOrFloating(s, nighthawk, 3, undefined, [s]);
    expect(paid.ok && paid.floating && paid.remaining).toMatchObject({ B: 0 });
  });
  it("only a spell the pool can really pay counts: a green spell does not justify Dark Ritual", () => {
    const s = agent([real("Dark Ritual", "dr"), real("Rampant Growth", "rg")], [real("Swamp", "sw")]);
    expect(wouldRitualBeUsed(session([s]), s, s.board.hand[0], "a")).toBe(false);
  });
  it("a human seat is never filtered", () => {
    const s = seat("a", [real("Swamp", "sw")], { board: { ...hand([real("Dark Ritual", "dr")]), battlefield: [real("Swamp", "sw")] } });
    expect(castIds(s)).toEqual(["dr"]);
  });
  it("a creature in hand that the ritual cannot pay for does not count either (no mana left over for it)", () => {
    const s = agent([real("Dark Ritual", "dr"), bear("b", { manaValue: 5, manaCost: "{4}{B}", typeLine: "Creature - Bear", role: "creature" } as never)], [real("Swamp", "sw")]);
    expect(wouldRitualBeUsed(session([s]), s, s.board.hand[0], "a")).toBe(false);
  });
});
