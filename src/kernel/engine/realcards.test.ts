// Real drafted cards that use the new families in the shapes the drafts really have (checks the engine against the JSON, not just
// against hand-written cards).

import { describe, expect, it } from "vitest";
import { cardUnsupported } from "./support";
import { fam, sorcery } from "./famkit";
import { lookup } from "./testkit";

describe("real drafts", () => {
  it("Path to Exile: the exiled creature's controller (not the caster) is asked 'may search', then chooses the basic land, it enters tapped under their control", () => {
    expect(cardUnsupported(lookup("Path to Exile")!).all).toEqual([]);
    const t = fam();
    t.give("p1", "Plains", "battlefield");
    const victim = t.give("p2", "Fill A", "battlefield");
    t.give("p2", "Forest", "library"); t.give("p2", "Fill B", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Path to Exile", "hand"), targets: { t1: [victim] } });
    let res = t.resolveTop();
    expect(t.obj(victim).zone).toBe("exile");
    expect(res.pending).toMatchObject({ kind: "choose_yes_no", player: "p2" });
    res = t.answer(res, { yes: true });
    expect(res.pending).toMatchObject({ kind: "choose_cards", player: "p2" });
    expect(res.pending!.options.map((o) => o.label)).toEqual(["Forest"]);
    t.answer(res, { ids: [res.pending!.options[0].id] });
    const land = t.state.battlefield.map((id) => t.obj(id)).find((o) => o.cardName === "Forest")!;
    expect(land).toMatchObject({ controller: "p2", tapped: true });
  });

  it("Path to Exile: declining the search leaves the library alone", () => {
    const t = fam();
    t.give("p1", "Plains", "battlefield");
    const victim = t.give("p2", "Fill A", "battlefield"); t.give("p2", "Forest", "library");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Path to Exile", "hand"), targets: { t1: [victim] } });
    const res = t.resolveTop();
    t.answer(res, { yes: false });
    expect(t.p("p2").library).toHaveLength(1);
  });

  it("Mulch: look at four... puts every land of the looked-at cards into hand (what: looked_cards with a filter)", () => {
    expect(cardUnsupported(lookup("Mulch")!).all).toEqual([]);
    const t = fam();
    t.lands("p1", "Forest", 2);
    for (const n of ["Fill A", "Forest", "Fill B", "Island", "Fill C"]) t.give("p1", n, "library", { top: false });
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Mulch", "hand") });
    t.resolveTop();
    expect(t.p("p1").hand.map((id) => t.obj(id).cardName).sort()).toEqual(["Forest", "Island"]);
    expect(t.p("p1").graveyard.map((id) => t.obj(id).cardName).sort()).toEqual(["Fill A", "Fill B", "Mulch"]);
  });

  it("Command Beacon: puts your commander from the command zone into your hand (zone form without a count)", () => {
    expect(cardUnsupported(lookup("Command Beacon")!).all).toEqual([]);
    const t = fam();
    const cmd = t.give("p1", "Fill A", "hand"); t.state.objects[cmd].isCommander = true; t.state.objects[cmd].zone = "command"; t.p("p1").hand.splice(0, 1); t.p("p1").command.push(cmd);
    const beacon = t.give("p1", "Command Beacon", "battlefield");
    const ab = lookup("Command Beacon")!.kernel.abilities.find((a) => a.kind === "activated")!;
    t.ok({ type: "activateAbility", player: "p1", sourceId: beacon, abilityId: ab.id });
    t.resolveTop();
    expect(t.obj(cmd).zone).toBe("hand");
  });

  it("Orzhov Basilica: choose a land you control and return it (it may return itself)", () => {
    expect(cardUnsupported(lookup("Orzhov Basilica")!).all).toEqual([]);
  });

  it("grant_effect with a filter and who (Flawless Maneuver shape): creatures you control gain indestructible until end of turn", () => {
    const spell = sorcery("Spell", "{W}", [{ kind: "grant_effect", who: "you", filter: { types: ["creature"], controller: "you" }, modify: [{ grant: "indestructible" }], duration: "until_end_of_turn" } as never]);
    expect(cardUnsupported(spell).all).toEqual([]);
    const t = fam({ Spell: spell });
    t.give("p1", "Plains", "battlefield");
    const mine = t.give("p1", "Fill A", "battlefield"); const theirs = t.give("p2", "Fill B", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Spell", "hand") });
    t.resolveTop();
    expect(t.state.effects.map((e) => e.objectId)).toEqual([mine]);
    expect(t.state.effects.some((e) => e.objectId === theirs)).toBe(false);
  });

  it("a player-scoped grant (no filter, no target) is refused statically", () => {
    expect(cardUnsupported(sorcery("Odd", "{W}", [{ kind: "grant_effect", who: "you", modify: [{ grant: "hexproof" }], duration: "until_end_of_turn" } as never])).all).toContain("field:grant_effect.who");
  });

  it("every card of the drafts that is reported fully supported can at least be analysed without throwing (guard against silent drift)", () => {
    for (const n of ["Deadly Brew", "Orzhov Basilica", "Mulch", "Path to Exile"]) expect(() => cardUnsupported(lookup(n)!)).not.toThrow();
  });
});
