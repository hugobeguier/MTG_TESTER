// Item 4 of the playtest: Rootcast Apprenticeship ("Choose three. You may choose the same mode more than once.") and every "choose one or more" spell give a human a
// mode-set prompt, then per-mode target prompts in printed order, then resolve the chosen modes in printed order. Real Oracle text from the catalog; engine tests only.
import { describe, expect, it } from "vitest";
import { bear, real, seat, session } from "@/components/AppFlow.batch3Abilities.test";
import { agentCastTimeRemovalChoices, applyCastGenericModes, modeSetAnswer, nextCastPrompt } from "@/engine/castTargets";
import { parseGenericModalEffect } from "@/engine/effects";
import { applyTargetedEffect } from "@/engine/triggers";
import { parseTargetedEffect } from "@/lib/targetedEffects";
import { parseModalHeader } from "@/lib/oracleClauses";
import type { CastChoices } from "@/engine/types";
import type { GameSession, PlayerSeat, VisibleCard } from "@/lib/types";

const squirrelToken = (id: string) => bear(id, { token: true, name: "Squirrel", typeLine: "Token Creature - Squirrel", power: "1", toughness: "1" } as never);
const rootcast = () => real("Rootcast Apprenticeship", "rc", { zone: "hand" as const });
function world(extraA: VisibleCard[] = [], opponentBoard: VisibleCard[] = [], opponentKind: "human" | "agent" = "agent"): GameSession {
  return session([seat("a", [bear("cub"), ...extraA]), seat("b", opponentBoard, { kind: opponentKind } as Partial<PlayerSeat>)]);
}
const empty = (): CastChoices => ({ targets: [] });

describe("Rootcast Apprenticeship parses as four repeatable modes", () => {
  it("the header is 'choose three' with repeats and all four bullets become modes (copy-token, token-for-a-player and sacrifice included)", () => {
    const card = rootcast();
    expect(parseModalHeader(card.oracleText)).toMatchObject({ chooseCount: 3, repeatable: true });
    const modal = parseGenericModalEffect(card.oracleText, undefined)!;
    expect(modal.repeatable).toBe(true);
    expect(modal.modes.map((mode) => (mode.kind === "trigger" && mode.effect.kind === "targeted_effect" ? mode.effect.effect.verb.kind : mode.kind))).toEqual(["add_counters", "copy_token", "create_tokens", "sacrifice"]);
  });
});

describe("a human casting Rootcast Apprenticeship", () => {
  it("is asked for the mode set first: exactly three picks, repeats allowed, only modes with a legal target are listed", () => {
    const s = world([squirrelToken("sq")], [real("Sol Ring", "ring")]);
    const prompt = nextCastPrompt(s, "a", rootcast(), undefined, empty());
    expect(prompt).toMatchObject({ kind: "modeset", min: 3, max: 3, repeatable: true });
    expect(prompt?.options.map((option) => ("mode" in option ? option.mode : -1))).toEqual([0, 1, 2, 3]);
    // no token to copy and no opponent artifact: only counters and the Squirrel mode are offered
    const bare = nextCastPrompt(world(), "a", rootcast(), undefined, empty());
    expect(bare?.options.map((option) => ("mode" in option ? option.mode : -1))).toEqual([0, 2]);
  });
  it("then asks each chosen mode's target in printed order, even when only one candidate exists, and the same creature may be chosen twice", () => {
    const s = world([squirrelToken("sq")], [real("Sol Ring", "ring")]);
    const answers: CastChoices = { modes: [0, 0, 2], modesDone: true, targets: [] };
    const first = nextCastPrompt(s, "a", rootcast(), undefined, answers);
    expect(first?.kind).toBe("target");
    answers.targets.push({ kind: "card", seatId: "a", cardId: "cub" });
    const second = nextCastPrompt(s, "a", rootcast(), undefined, answers);
    expect(second?.kind).toBe("target");
    if (second?.kind === "target") expect(second.options.some((option) => option.target.kind === "card" && option.target.cardId === "cub")).toBe(true);
    answers.targets.push({ kind: "card", seatId: "a", cardId: "cub" });
    const third = nextCastPrompt(s, "a", rootcast(), undefined, answers);
    expect(third?.kind).toBe("target");
    if (third?.kind === "target") expect(third.options.every((option) => option.target.kind === "player")).toBe(true);
    answers.targets.push({ kind: "player", seatId: "a" });
    expect(nextCastPrompt(s, "a", rootcast(), undefined, answers)).toBeUndefined();
  });
  it("resolves the chosen modes in order: two +1/+1 counter modes stack, and the chosen player gets a Squirrel", () => {
    const s = world();
    const modal = parseGenericModalEffect(rootcast().oracleText, undefined)!;
    const after = applyCastGenericModes(s, "a", rootcast(), modal, { modes: [0, 0, 2], targets: [{ kind: "card", seatId: "a", cardId: "cub" }, { kind: "card", seatId: "a", cardId: "cub" }, { kind: "player", seatId: "b" }] } as CastChoices);
    const cub = after.seats[0].board.battlefield.find((card) => card.id === "cub")!;
    expect(cub.counters?.find((counter) => counter.kind === "+1/+1")?.count).toBe(4);
    expect(after.seats[1].board.battlefield.filter((card) => card.token && /Squirrel/.test(card.name))).toHaveLength(1);
  });
  it("modeSetAnswer: exactly three picks, positions must exist, order is the printed order", () => {
    const options = [{ mode: 0 }, { mode: 1 }, { mode: 2 }];
    const modeSet = { min: 3, max: 3, repeatable: true };
    expect(modeSetAnswer(modeSet, options, [2, 0, 0])).toEqual([0, 0, 2]);
    expect(modeSetAnswer(modeSet, options, [0, 0])).toBeUndefined();
    expect(modeSetAnswer(modeSet, options, [0, 0, 0, 0])).toBeUndefined();
    expect(modeSetAnswer(modeSet, options, [0, 0, 9])).toBeUndefined();
    expect(modeSetAnswer({ min: 1, max: 2, repeatable: false }, options, [1, 1])).toBeUndefined();
    expect(modeSetAnswer({ min: 1, max: 2, repeatable: false }, options, [])).toBeUndefined();
  });
});

describe("Rootcast Apprenticeship's new modes", () => {
  it("'Target opponent sacrifices a nontoken artifact': a human opponent with two chooses (picker queued), an agent gives up one and tokens are spared", () => {
    const effect = parseTargetedEffect("Target opponent sacrifices a nontoken artifact of their choice.")!;
    const source = rootcast();
    const human = world([], [real("Sol Ring", "ring"), real("Mind Stone", "ms")], "human");
    const queued = applyTargetedEffect(human, "a", source, effect, { kind: "player", seatId: "b" });
    expect(queued.pendingSacrificeChoices).toEqual([expect.objectContaining({ seatId: "b", typeFilter: "nontoken artifact", count: 1 })]);
    const agentWorld = world([], [real("Sol Ring", "ring"), { ...real("Sol Ring", "tr"), token: true } as VisibleCard], "agent");
    const done = applyTargetedEffect(agentWorld, "a", source, effect, { kind: "player", seatId: "b" });
    expect(done.seats[1].board.battlefield.map((card) => card.id)).toEqual(["tr"]);
  });
  it("'Create a token that's a copy of target token you control' copies the chosen token", () => {
    const effect = parseTargetedEffect("Create a token that's a copy of target token you control.")!;
    const s = world([squirrelToken("sq")]);
    const after = applyTargetedEffect(s, "a", rootcast(), effect, { kind: "card", seatId: "a", cardId: "sq" });
    expect(after.seats[0].board.battlefield.filter((card) => card.token)).toHaveLength(2);
  });
});

describe("an agent casting Rootcast Apprenticeship picks three modes automatically", () => {
  it("records three modes in printed order with a target for each (no prompt)", () => {
    const s = world([squirrelToken("sq")], [real("Sol Ring", "ring")]);
    const choices = agentCastTimeRemovalChoices(s, "a", rootcast())!;
    expect(choices.modes).toHaveLength(3);
    expect([...choices.modes!].sort((a, b) => a - b)).toEqual(choices.modes);
    expect(choices.targets).toHaveLength(3);
  });
});

describe("the other 'choose one or more' spells of the shipped decks", () => {
  it("Casualties of War and Saheeli's Artistry ask one checkbox prompt (at least one mode); Austere Command (choose two) keeps its sequential pick; Abrade (choose one) too", () => {
    const board = world([real("Sol Ring", "ring")], [real("Sol Ring", "ring2"), bear("opp"), real("Swamp", "sw")]);
    const casualties = nextCastPrompt(board, "a", real("Casualties of War", "cw", { zone: "hand" as const }), undefined, empty());
    expect(casualties).toMatchObject({ kind: "modeset", min: 1, repeatable: false });
    const artistry = nextCastPrompt(board, "a", real("Saheeli's Artistry", "sa", { zone: "hand" as const }), undefined, empty());
    expect(artistry).toMatchObject({ kind: "modeset", min: 1, max: 2 });
    expect(nextCastPrompt(board, "a", real("Austere Command", "ac", { zone: "hand" as const }), undefined, empty())?.kind).toBe("modes");
    expect(nextCastPrompt(board, "a", real("Abrade", "ab", { zone: "hand" as const }), undefined, empty())?.kind).toBe("modes");
  });
});
