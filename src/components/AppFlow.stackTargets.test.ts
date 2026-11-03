// Targets are recorded on the stack item as it is put on the stack (rule 601.2c), for agents too, and re-checked on resolution (rule 608.2b).
import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import { describeStackItem } from "@/lib/stackDescription";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { agentCastTimeRemovalChoices, applyCastRemoval, castStructure } from "./AppFlow";

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
const world = () => session([seat("agent", "agent", { battlefield: [creature("mine")] }), seat("human", "human", { battlefield: [creature("victim", { power: "5", toughness: "5" })] })]);

describe("stack items name their targets when put on the stack", () => {
  it("an agent's Fateful Absence (destroy + 'its controller investigates') targets the human's creature, never its own", () => {
    const absence = real("Fateful Absence", "fa", { zone: "hand" });
    const choices = agentCastTimeRemovalChoices(world(), "agent", absence);
    expect(choices?.targets).toEqual([{ kind: "card", seatId: "human", cardId: "victim" }]);
    const desc = describeStackItem(world(), { id: "s1", type: "spell", actorSeatId: "agent", cardId: "fa", cardName: "Fateful Absence", castChoices: choices, sourceCard: absence });
    expect(desc.targets.map((t) => t.label)).toEqual(["Creature victim"]);
    expect(desc.targetsPending).toBe(false);
    expect(desc.affectsPlayerSeatId).toBe("human");
  });
  it("'any target' burn records its aim at cast time (Lightning Bolt)", () => {
    const choices = agentCastTimeRemovalChoices(world(), "agent", real("Lightning Bolt", "lb", { zone: "hand" }));
    expect(choices?.targets).toHaveLength(1);
    expect(choices!.targets[0].seatId).toBe("human");
  });
  it("X damage uses the chosen X when picking its target (Fireball-style)", () => {
    const choices = agentCastTimeRemovalChoices(world(), "agent", real("Blaze", "bz", { zone: "hand" }), 5);
    expect(choices?.targets).toHaveLength(1);
  });
  it("a spell with no target in its text gets none (Wrath of God)", () => {
    expect(agentCastTimeRemovalChoices(world(), "agent", real("Wrath of God", "wr", { zone: "hand" }))).toBeUndefined();
  });
  it("a counterspell on the stack lists the spell it targets", () => {
    const s = world();
    const bolt = { id: "s1", type: "spell" as const, actorSeatId: "human", cardId: "lb", cardName: "Lightning Bolt" };
    const counter = { id: "s2", type: "spell" as const, actorSeatId: "agent", cardId: "cs", cardName: "Counterspell", counterTargetId: "s1", sourceCard: real("Counterspell", "cs") };
    const desc = describeStackItem(s, counter, [bolt, counter]);
    expect(desc.targets).toMatchObject([{ kind: "stack", label: "Lightning Bolt", seatId: "human" }]);
  });
  it("a creature-spell ETB trigger shows its recorded target", () => {
    const trigger = { id: "t1", type: "trigger" as const, actorSeatId: "agent", controllerSeatId: "agent", sourceCardName: "Ravenous Chupacabra", effect: { kind: "x", chosenOption: "c:human:victim" }, sourceCard: { typeLine: "Creature", oracleText: "When this enters, destroy target creature an opponent controls." } };
    expect(describeStackItem(world(), trigger).targets.map((t) => t.label)).toEqual(["Creature victim"]);
  });
  it("an Aura records the creature it enchants", () => {
    const pac = real("Pacifism", "pf", { zone: "hand" });
    expect(castStructure(pac)?.kind).toBe("aura");
    expect(agentCastTimeRemovalChoices(world(), "agent", pac)?.targets[0]).toMatchObject({ cardId: "victim" });
  });
});

describe("recorded targets are re-checked on resolution", () => {
  const absence = real("Fateful Absence", "fa", { zone: "hand" });
  const effect = castStructure(absence);
  it("target removed before resolution: the spell fizzles, nothing is destroyed and no Clue is made", () => {
    const s = world();
    s.seats[1].board.battlefield = [];
    if (effect?.kind !== "removal") throw new Error("expected removal");
    const after = applyCastRemoval(s, "agent", absence, effect.effect, undefined, { targets: [{ kind: "card", seatId: "human", cardId: "victim" }] });
    expect(after.seats[0].board.battlefield.map((c) => c.id)).toEqual(["mine"]);
    expect(after.seats.flatMap((x) => x.board.battlefield).some((c) => c.name === "Clue")).toBe(false);
    expect(after.events[0].message).toMatch(/no longer legal/);
  });
  it("target still legal: it is destroyed", () => {
    if (effect?.kind !== "removal") throw new Error("expected removal");
    const after = applyCastRemoval(world(), "agent", absence, effect.effect, undefined, { targets: [{ kind: "card", seatId: "human", cardId: "victim" }] });
    expect(after.seats[1].board.battlefield.some((c) => c.id === "victim")).toBe(false);
  });
  it("target gained hexproof before resolution: fizzles", () => {
    if (effect?.kind !== "removal") throw new Error("expected removal");
    const s = world();
    s.seats[1].board.battlefield = [creature("victim", { oracleText: "Hexproof" })];
    const after = applyCastRemoval(s, "agent", absence, effect.effect, undefined, { targets: [{ kind: "card", seatId: "human", cardId: "victim" }] });
    expect(after.seats[1].board.battlefield.some((c) => c.id === "victim")).toBe(true);
  });
});
