// A permanent that lost all abilities (Utter Insignificance) must stop applying EVERYTHING its abilities generated:
// replacement effects, statics, activated / mana abilities, keywords. Real drafts; see layers.ts effective abilities.
import { describe, expect, it } from "vitest";
import { abilitiesOf, chars } from "./core";
import { runOf, game } from "./testcards";
import type { Table } from "./testcards";
import type { ObjId } from "./types";

const finish = (t: Table) => { while (t.state.stack.length) t.resolveTop(); };
const cast = (t: Table, who: string, id: ObjId, targets?: Record<string, string[]>) => t.ok({ type: "castSpell", player: who, cardId: id, targets });
const tokens = (t: Table) => t.state.battlefield.map((id) => t.obj(id)).filter((o) => o.token).map((o) => o.token!.name).sort();
const view = (t: Table, id: ObjId) => chars(runOf(t.state), id);

function enchant(t: Table, target: ObjId) {
  t.lands("p1", "Island", 2);
  const aura = t.give("p1", "Utter Insignificance", "hand");
  cast(t, "p1", aura, { t1: [target] }); finish(t);
  expect(t.obj(aura).attachedTo).toBe(target);
  return aura;
}

describe("stripped permanents (Utter Insignificance)", () => {
  it("Chatterfang: no extra Squirrel while enchanted, no sacrifice ability, 1/1; everything returns when the Aura leaves", () => {
    const t = game();
    const chatter = t.give("p1", "Chatterfang, Squirrel General", "battlefield");
    t.lands("p1", "Mountain", 3);
    t.give("p1", "Swamp", "battlefield");
    expect(abilitiesOf(runOf(t.state), t.obj(chatter)).some((a) => a.kind === "replacement")).toBe(true);
    const aura = enchant(t, chatter);
    expect(view(t, chatter)).toMatchObject({ power: 1, toughness: 1 });
    expect(abilitiesOf(runOf(t.state), t.obj(chatter))).toEqual([]);
    cast(t, "p1", t.give("p1", "Treasure Maker", "hand")); finish(t);
    expect(tokens(t)).toEqual(["Treasure"]);
    const sac = t.do({ type: "activateAbility", player: "p1", sourceId: chatter, abilityId: "a3" });
    expect(sac.error).toBeTruthy();
    // the Aura's own activated ability still works for the Aura
    t.lands("p1", "Mountain", 0);
    // Aura leaves
    t.lands("p1", "Plains", 1);
    cast(t, "p1", t.give("p1", "Disenchant", "hand"), { t1: [aura] }); finish(t);
    expect(t.obj(aura).zone).toBe("graveyard");
    expect(view(t, chatter)).toMatchObject({ power: 3, toughness: 3 });
    t.lands("p1", "Mountain", 1);
    cast(t, "p1", t.give("p1", "Treasure Maker", "hand")); finish(t);
    expect(tokens(t)).toEqual(["Squirrel", "Treasure", "Treasure"]);
  });

  it("Academy Manufactor stripped: a Treasure stays a Treasure", () => {
    const t = game();
    const manu = t.give("p1", "Academy Manufactor", "battlefield");
    t.lands("p1", "Mountain", 3);
    enchant(t, manu);
    cast(t, "p1", t.give("p1", "Treasure Maker", "hand")); finish(t);
    expect(tokens(t)).toEqual(["Treasure"]);
  });
});
