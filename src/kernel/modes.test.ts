import { describe, expect, it } from "vitest";
import { computeImplementation } from "./capabilities";
import { generatePrompts } from "./prompts";
import { CardSchema, type Card, type Modes } from "./schema";
import { validateCard } from "./validator";

const prep = (card: Card, name: string) => computeImplementation(generatePrompts(card, name));
const codes = (card: Card, oracle: string, name: string) => validateCard(prep(card, name), oracle, name).issues.filter((i) => i.severity === "error").map((i) => i.code);
const opt = (id: string, text: string) => ({ id, text, steps: [{ kind: "scry" as const, amount: 1 }] });
const modal = (text: string, modes: Partial<Modes> & { choose: Modes["choose"] }, n = 3): Card => ({
  schemaVersion: 2, review: { status: "draft" },
  abilities: [{ id: "a1", kind: "spell_effect", text, modes: { distinct: true, options: Array.from({ length: n }, (_, i) => opt(`m${i + 1}`, `Scry 1.`)), ...modes } }]
});
const body = "\n• Scry 1.\n• Scry 1.\n• Scry 1.";

describe("modal spells: generic min/max/repeatable", () => {
  it.each([
    ["Choose one —", { min: 1, max: 1 }],
    ["Choose one or both —", { min: 1, max: 2 }],
    ["Choose one or more —", { min: 1, max: 3 }],
    ["Choose two —", { min: 2, max: 2 }],
    ["Choose three —", { min: 3, max: 3 }],
    ["Choose up to two —", { min: 0, max: 2 }]
  ])("%s", (head, choose) => {
    const text = head + body;
    expect(codes(modal(text, { choose }), text, "Qwertyuiop")).toEqual([]);
    const wrong = { min: choose.min === 1 ? 2 : 1, max: choose.max === 1 ? 2 : 1 };
    expect(codes(modal(text, { choose: wrong }), text, "Qwertyuiop")).toContain("MODE_MISMATCH");
  });
  it("'choose two target creature cards' is a target phrase, not a modal header", () => {
    const text = "Choose two target creature cards in your graveyard. Scry 1.";
    expect(codes(modal(text, { choose: { min: 1, max: 1 } }), text, "Qwertyuiop")).not.toContain("MODE_MISMATCH");
  });
  it("repeatable: 'You may choose the same mode more than once'", () => {
    const text = "Choose three. You may choose the same mode more than once." + body;
    const good = modal(text, { choose: { min: 3, max: 3 }, distinct: false, repeatable: true });
    expect(CardSchema.safeParse(good).success).toBe(true);
    expect(codes(good, text, "Qwertyuiop")).toEqual([]);
    expect(codes(modal(text, { choose: { min: 3, max: 3 }, distinct: true }), text, "Qwertyuiop")).toContain("MODE_MISMATCH");
    const plain = "Choose three —" + body;
    expect(codes(modal(plain, { choose: { min: 3, max: 3 }, distinct: false, repeatable: true }), plain, "Qwertyuiop")).toContain("MODE_MISMATCH");
  });
  it("prompts say it clearly", () => {
    const c = prep(modal("x", { choose: { min: 3, max: 3 }, distinct: false, repeatable: true }), "Zzz");
    expect(c.abilities[0].modes!.prompt!.instruction).toBe("Choose three modes. You may choose the same mode more than once.");
    expect(prep(modal("x", { choose: { min: 1, max: 2 } }), "Zzz").abilities[0].modes!.prompt!.instruction).toBe("Choose one or both modes.");
    expect(c.abilities[0].needs).toContain("modes:repeatable");
  });
});

describe("fight_pairs (Ezuri's Predation)", () => {
  it("gets a pairing prompt and is a need", () => {
    const c = prep({ schemaVersion: 2, review: { status: "draft" }, abilities: [{ id: "a1", kind: "spell_effect", text: "x", steps: [{ kind: "fight_pairs", fighters: "created", against: { types: ["creature"], controller: "opponent" }, pairing: "controller_chooses" }] }] }, "Ezuri's Predation");
    expect(c.abilities[0].steps![0].prompt!.instruction).toContain("Choose which");
    expect(c.abilities[0].needs).toContain("step:fight_pairs");
  });
});
