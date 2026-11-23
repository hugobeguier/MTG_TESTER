// Scion of the Ur-Dragon (real draft): {2}: search for a Dragon, put it into the graveyard, Scion becomes a copy of it until end of turn (layer-1 copy).
import { describe, expect, it } from "vitest";
import { ctx, mini } from "../integration/testgame";
import { cardUnsupported } from "./support";

describe("Scion of the Ur-Dragon", () => {
  it("is supported and its draft uses copyOf", () => {
    expect(cardUnsupported(ctx.cards("Scion of the Ur-Dragon")!).all).toEqual([]);
  });
  it("becomes a copy of the chosen Dragon until end of turn, keeping its identity; reverts at cleanup", () => {
    const t = mini();
    t.give("p1", "Island", "battlefield"); t.give("p1", "Island", "battlefield");
    const scion = t.give("p1", "Scion of the Ur-Dragon", "battlefield");
    t.give("p1", "Swamp", "library");
    const dragon = t.give("p1", "Ancient Copper Dragon", "library", { top: true });
    const ab = ctx.cards("Scion of the Ur-Dragon")!.kernel.abilities.find((a) => a.kind === "activated")!;
    t.ok({ type: "activateAbility", player: "p1", sourceId: scion, abilityId: ab.id } as never);
    t.settle();
    for (let i = 0; i < 6 && t.state.pending; i++) { const p = t.state.pending!; t.answer(p.kind === "choose_cards" ? { ids: [p.options.find((o) => o.id === dragon)?.id ?? p.options[0].id] } : p.kind === "choose_yes_no" ? { yes: true } : { ids: [] }); t.settle(); }
    const o = t.state.objects[scion];
    expect(o.zone).toBe("battlefield");
    expect(o.cardName).toBe("Scion of the Ur-Dragon");
    expect(o.copyDef).toMatchObject({ name: "Ancient Copper Dragon", power: 6, toughness: 5 });
    expect(o.copyDef!.subtypes).toContain("Dragon");
    expect(o.copyUntilEot).toBe(true); // reverted at cleanup (resolve.ts)
    expect(t.state.objects[dragon].zone).toBe("graveyard");
  });
});
