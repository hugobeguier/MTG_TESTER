// Human targeting audit: targets are chosen as a spell is cast / an ability goes on the stack (rule 601.2c), with only legal candidates offered.
// Representative real cards per pattern; see docs/agents/system.md "Human targeting prompts" for the list of patterns that do not fit this prompt.
import { describe, expect, it } from "vitest";
import { loadCardCatalog, lookupCard } from "@/lib/cardCatalog";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";
import { castStructure, nextCastPrompt, resolveTriggerEffect, agentCastTimeRemovalChoices } from "./AppFlow";

const catalog = loadCardCatalog();
function real(name: string, id: string, extra: Partial<VisibleCard> = {}): VisibleCard {
  const found = lookupCard(catalog, name) as (Partial<VisibleCard> & { name: string }) | undefined;
  if (!found) throw new Error(`catalog is missing ${name}`);
  return { manaValue: 0, colors: [], role: "permanent", zone: "battlefield", typeLine: "", oracleText: "", ...found, id, summoningSick: false, ...extra } as VisibleCard;
}
const creature = (id: string, extra: Partial<VisibleCard> = {}) => ({ id, name: `Creature ${id}`, typeLine: "Creature — Bear", power: "2", toughness: "2", colors: ["G"], role: "creature", zone: "battlefield", manaValue: 2, oracleText: "", ...extra }) as VisibleCard;
function seat(id: string, kind: "human" | "agent", board: Partial<PlayerSeat["board"]> = {}): PlayerSeat {
  const b = { hand: [], battlefield: [], graveyard: [], exile: [], ...board };
  return { id, name: id, kind, life: 40, commanderDamage: {}, zones: { library: 0, hand: b.hand.length, battlefield: b.battlefield.length, graveyard: b.graveyard.length, exile: 0, command: 0 }, board: b } as PlayerSeat;
}
function session(seats: PlayerSeat[]): GameSession {
  return { id: "t", createdAt: "", status: "playing", phase: "precombat main phase", turn: 1, xmage: { enabled: false, status: "not_configured", message: "" }, seats, events: [] };
}
const world = (mine: VisibleCard[] = [creature("m1")], theirs: VisibleCard[] = [creature("o1"), creature("o2")], myGraveyard: VisibleCard[] = [], theirGraveyard: VisibleCard[] = []) =>
  session([seat("a", "human", { battlefield: mine, graveyard: myGraveyard }), seat("b", "agent", { battlefield: theirs, graveyard: theirGraveyard })]);
const prompt = (s: GameSession, name: string, x?: number) => nextCastPrompt(s, "a", real(name, "spell", { zone: "hand" }), x, { targets: [] });
type Options = { options: Array<{ target: { kind: string; cardId?: string; seatId: string } }>; prompt: string };

describe("cast-time target prompts (human)", () => {
  it("single-target removal prompts with every legal creature, hexproof/shroud filtered out", () => {
    const hexproof = creature("hex", { oracleText: "Hexproof" });
    const p = prompt(world([creature("m1")], [creature("o1"), hexproof]), "Murder") as unknown as Options;
    expect((p as { kind?: string }).kind).toBe("target");
    const ids = p.options.map((o) => o.target.cardId);
    expect(ids).toContain("o1");
    expect(ids).not.toContain("hex");
  });
  it("a single legal candidate still prompts (the human chose to cast it)", () => {
    const p = prompt(world([], [creature("only")]), "Swords to Plowshares") as unknown as Options;
    expect((p as { kind?: string }).kind).toBe("target");
    expect(p.options.length).toBeGreaterThanOrEqual(1);
  });
  it("'any target' burn offers players as well as creatures", () => {
    const p = prompt(world(), "Lightning Strike") as unknown as Options;
    expect(p.options.some((o) => o.target.kind === "player")).toBe(true);
    expect(p.options.some((o) => o.target.kind === "card")).toBe(true);
  });
  it("target player: Mind Rot offers an opponent", () => {
    expect(prompt(world(), "Mind Rot")?.kind).toBe("target");
  });
  it("modal spells ask the mode first, then that mode's target (Abrade)", () => {
    expect(prompt(world([creature("m1"), real("Sol Ring", "ring")], [creature("o1")]), "Abrade")?.kind).toBe("modes");
    const abrade = real("Abrade", "abrade", { zone: "hand" });
    expect(nextCastPrompt(world(), "a", abrade, undefined, { targets: [], modes: [0] })?.kind).toBe("target");
    // the artifact mode has nothing legal to aim at here, so it offers nothing instead of a bogus target
    expect(nextCastPrompt(world(), "a", abrade, undefined, { targets: [], modes: [1] })).toBeUndefined();
  });
  it("two-slot spells ask both targets in order (Bite Down: your creature, then theirs)", () => {
    const bite = real("Bite Down", "bite", { zone: "hand" });
    const first = nextCastPrompt(world(), "a", bite, undefined, { targets: [] }) as unknown as Options;
    expect(first.prompt).toMatch(/you control/);
    const second = nextCastPrompt(world(), "a", bite, undefined, { targets: [{ kind: "card", seatId: "a", cardId: "m1" }] }) as unknown as Options;
    expect(second.options.every((o) => o.target.seatId === "b")).toBe(true);
  });
  it("Chaos Warp offers permanents, Reanimate offers graveyard creatures from any graveyard, Raise Dead only yours", () => {
    expect(prompt(world(), "Chaos Warp")?.kind).toBe("target");
    const s = world([], [], [creature("mine-dead", { zone: "graveyard" })], [creature("theirs-dead", { zone: "graveyard" })]);
    const reanimate = prompt(s, "Reanimate") as unknown as Options;
    expect(reanimate.options.map((o) => o.target.cardId).sort()).toEqual(["mine-dead", "theirs-dead"]);
    const raise = prompt(s, "Raise Dead") as unknown as Options;
    expect(raise.options.map((o) => o.target.cardId)).toEqual(["mine-dead"]);
  });
  it("Auras target as they are cast: Pacifism offers creatures, 'Enchant creature you control' only your own", () => {
    expect(castStructure(real("Pacifism", "p", { zone: "hand" }))?.kind).toBe("aura");
    const p = prompt(world(), "Pacifism") as unknown as Options;
    expect(p.options.map((o) => o.target.cardId).sort()).toEqual(["m1", "o1", "o2"]);
    const ownAura = { ...real("Pacifism", "p2", { zone: "hand" }), oracleText: "Enchant creature you control\nEnchanted creature gets +1/+1." };
    const own = nextCastPrompt(world(), "a", ownAura, undefined, { targets: [] }) as unknown as Options;
    expect(own.options.map((o) => o.target.cardId)).toEqual(["m1"]);
  });
  it("an agent's targeted spell/aura names its target as it is cast (Chaos Warp, Pacifism)", () => {
    const s = session([seat("a", "agent"), seat("b", "human", { battlefield: [creature("victim", { power: "6", toughness: "6", manaValue: 6 })] })]);
    expect(agentCastTimeRemovalChoices(s, "a", real("Chaos Warp", "cw", { zone: "hand" }))?.targets).toHaveLength(1);
    expect(agentCastTimeRemovalChoices(s, "a", real("Pacifism", "pf", { zone: "hand" }))?.targets[0]).toMatchObject({ cardId: "victim" });
  });
});

describe("abilities and triggers name their target when they go on the stack", () => {
  const trigger = (source: VisibleCard, effect: object) => ({ id: "t", type: "trigger", actorSeatId: "a", controllerSeatId: "a", sourceCardId: source.id, sourceCardName: source.name, triggerKind: "common", effect, message: "" }) as never;
  it("Memnarch: a pre-chosen target (chosenOption) is used at resolution, with no second question", () => {
    const memnarch = real("Memnarch", "mn");
    const land = real("Island", "isl", { typeLine: "Basic Land — Island", oracleText: "({T}: Add {U}.)" });
    const s = session([seat("a", "human", { battlefield: [memnarch, land] }), seat("b", "agent")]);
    const after = resolveTriggerEffect(s, trigger(memnarch, { kind: "become_artifact_target", chosenOption: "isl" }));
    expect(after.pendingPlayerChoices).toBeUndefined();
    expect(after.seats[0].board.battlefield.find((c) => c.id === "isl")!.permanentlyArtifact).toBe(true);
    const ring = real("Sol Ring", "sr");
    const s2 = session([seat("a", "human", { battlefield: [memnarch] }), seat("b", "agent", { battlefield: [ring] })]);
    const stolen = resolveTriggerEffect(s2, trigger(memnarch, { kind: "gain_control_target_artifact", chosenOption: "sr" }));
    expect(stolen.seats[0].board.battlefield.map((c) => c.id)).toContain("sr");
  });
  it("Deathbringer Liege: the chosen tapped creature is destroyed", () => {
    const liege = real("Deathbringer Liege", "dl");
    const s = session([seat("a", "human", { battlefield: [liege] }), seat("b", "agent", { battlefield: [creature("t1", { tapped: true }), creature("t2", { tapped: true })] })]);
    const after = resolveTriggerEffect(s, trigger(liege, { kind: "destroy_tapped_creature", chosenOption: "t2" }));
    expect(after.seats[1].board.battlefield.map((c) => c.id)).toEqual(["t1"]);
  });
  it("Soul-Guide Lantern: the chosen graveyard card is exiled", () => {
    const lantern = real("Soul-Guide Lantern", "lan");
    const s = session([seat("a", "human", { battlefield: [lantern] }), seat("b", "agent", { graveyard: [creature("g1", { zone: "graveyard" }), creature("g2", { zone: "graveyard" })] })]);
    const after = resolveTriggerEffect(s, trigger(lantern, { kind: "exile_card_from_graveyard", chosenOption: "g2" }));
    expect(after.seats[1].board.graveyard!.map((c) => c.id)).toEqual(["g1"]);
    expect(after.seats[1].board.exile!.map((c) => c.id)).toEqual(["g2"]);
  });
});
