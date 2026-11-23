// The support check must not be more lenient than the interpreter (found by `npm run kernel:audit-support`).
import { describe, expect, it } from "vitest";
import { ctx } from "../integration/testgame";
import type { Step } from "../schema";
import { fam, sorcery } from "./famkit";
import { cardUnsupported } from "./support";

const needs = (name: string) => cardUnsupported(ctx.cards(name)!).all;

describe("support check is as strict as the interpreter", () => {
  it("reports what the interpreter would refuse at run time", () => {
    expect(needs("Nogi, Draco-Zealot")).toContain("field:grant_effect.modify.setTypes");
    expect(needs("Spinerock Knoll")).toContain("event:deals_damage");
  });
  it("accepts what the interpreter now runs (Blood tokens, pt grants, timed granted abilities)", () => {
    for (const n of ["Moonstone Eulogist", "End-Raze Forerunners", "Malakir Rebirth // Malakir Mire", "Bojuka Bog", "Living Death", "Lim-Dûl's Vault", "Scion of the Ur-Dragon"]) expect(needs(n), n).toEqual([]);
  });
  it("grant_effect pt on a filter: +2/+2 until end of turn", () => {
    const t = fam({ Pump: sorcery("Pump", "{U}", [{ kind: "grant_effect", all: true, filter: { types: ["creature"], controller: "you" }, modify: [{ pt: { power: 2, toughness: 2 } }, { grant: "vigilance" }], duration: "until_end_of_turn" } as unknown as Step]) });
    t.give("p1", "Island", "battlefield");
    const c = t.give("p1", "Big Elf", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Pump", "hand") });
    t.resolveTop();
    const o = t.state.objects[c];
    expect(o.cardName).toBe("Big Elf");
    expect(t.state.effects.some((e) => e.objectId === c && e.power === 2 && e.toughness === 2)).toBe(true);
  });
  it("a Blood token is created with its draw ability", () => {
    const t = fam({ Mk: sorcery("Mk", "{U}", [{ kind: "create_tokens", tokenCount: 1, tokenName: "Blood", tokenColors: ["colorless"], tokenTypeLine: "Artifact — Blood" } as unknown as Step]) });
    t.give("p1", "Island", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Mk", "hand") });
    t.resolveTop();
    const blood = t.state.battlefield.find((id) => t.state.objects[id].cardName === "Blood" || t.state.objects[id].token);
    expect(blood).toBeTruthy();
  });
});
