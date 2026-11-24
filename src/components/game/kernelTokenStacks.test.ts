// Token stacks through the controller: the table shows ONE card per group of identical tokens, and the intents (attack N of M, target a stack, tap / activate one)
// map the stack's card back to its members.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "./kernelController";
import { DEFAULT_STOP_SETTINGS } from "@/lib/priorityStops";
import type { VisibleCard } from "@/lib/types";
import type { TokenDef } from "@/kernel/engine/types";

const SQUIRREL: TokenDef = { name: "Squirrel", types: ["creature"], subtypes: ["squirrel"], colors: ["green"], power: 1, toughness: 1, keywords: [] };
function settle(c: KernelGameController, max = 200): void { let n = 0; while (n < max && c.needsStep() && c.step()) n++; }

function game(tokens: number, opts: { sick?: number } = {}) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 10; i++) { t.give("p1", "Swamp", "library"); t.give("p2", "Swamp", "library"); }
  const ids: string[] = [];
  for (let i = 0; i < tokens; i++) ids.push(t.give("p1", "Gravecrawler", "battlefield"));
  const objects = { ...t.state.objects };
  for (const id of ids) objects[id] = { ...objects[id], cardName: "Squirrel", token: SQUIRREL };
  t.state = { ...t.state, objects };
  const ks = KernelSession.fromState(t.state, { ctx, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } });
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0, stops: DEFAULT_STOP_SETTINGS });
  return { ks, c, ids };
}
const mine = (c: KernelGameController): VisibleCard[] => c.table().session.seats.find((s) => s.id === "p1")!.board.battlefield;

describe("token stacks on the kernel table", () => {
  it("shows identical tokens as one card with a count", () => {
    const { c } = game(5);
    const cards = mine(c).filter((x) => x.token);
    expect(cards).toHaveLength(1);
    expect(cards[0].stackCount).toBe(5);
    expect(c.stackMembers(cards[0].id)).toHaveLength(5);
  });
  it("attacks with N of M tokens from the stack: the rest stay behind as their own stack", () => {
    const { c } = game(5);
    for (let i = 0; i < 8 && c.declaration()?.kind !== "attackers"; i++) { c.advanceTurn(); settle(c); }
    expect(c.declaration()?.kind).toBe("attackers");
    const rep = mine(c).find((x) => x.token)!;
    c.inspectCard(rep);
    expect(c.combatProps().inspectedStack).toMatchObject({ count: 5 });
    c.setStackChosen(3);
    const target = (c.combatProps().humanAttackTargets as Array<{ targetId: string }>)[0].targetId;
    c.declareAttack(rep.id, target);
    const stacks = mine(c).filter((x) => x.token).map((x) => `${x.stackCount ?? 1}${x.attacking ? "A" : ""}`).sort();
    expect(stacks).toEqual(["2", "3A"]);
    // the attacking three are the first three by id
    const members = c.stackMembers(rep.id);
    const att = mine(c).find((x) => x.attacking)!;
    expect(att.stackIds).toEqual(members.slice(0, 3));
    // taking two of them back out of the attack
    c.inspectCard(att);
    c.setStackChosen(2);
    c.declareAttack(att.id, "");
    expect(mine(c).filter((x) => x.token).map((x) => `${x.stackCount ?? 1}${x.attacking ? "A" : ""}`).sort()).toEqual(["1A", "4"]);
  });
  it("moves a dragged stack as one", () => {
    const { c } = game(3);
    const rep = mine(c).find((x) => x.token)!;
    c.moveBattlefieldCard("p1", rep.id, { x: 1, z: 2 });
    expect(mine(c).find((x) => x.token)!.battlefieldPosition).toEqual({ x: 1, z: 2 });
  });
});

describe("targeting a stack", () => {
  it("a stack is one highlighted card; clicking it picks one token at a time", () => {
    const t = mini(["p1", "p2"], { phase: "precombat_main" });
    for (let i = 0; i < 8; i++) { t.give("p1", "Swamp", "library"); t.give("p2", "Swamp", "library"); }
    t.give("p1", "Swamp", "battlefield"); t.give("p1", "Swamp", "battlefield");
    const spell = t.give("p1", "Go for the Throat", "hand");
    const ids = [1, 2, 3].map(() => t.give("p2", "Undead Augur", "battlefield"));
    const objects = { ...t.state.objects };
    for (const id of ids) objects[id] = { ...objects[id], cardName: "Squirrel", token: SQUIRREL };
    t.state = { ...t.state, objects };
    const ks = KernelSession.fromState(t.state, { ctx, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } });
    const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
    c.playCard("p1", spell);
    const bp = c.boardPick()!;
    expect(bp.legalCardIds).toHaveLength(1);
    const rep = bp.legalCardIds[0];
    bp.onToggleCard(rep);
    expect(c.boardPick()!.selectedCardIds).toEqual([rep]);
    const stack = c.table().session.seats.find((s) => s.id === "p2")!.board.battlefield.find((x) => x.id === rep)!;
    expect(stack.stackSelected).toBe(1);
    expect(stack.stackCount).toBe(3);
  });
});
