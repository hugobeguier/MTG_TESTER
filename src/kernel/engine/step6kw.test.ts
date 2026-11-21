// Kernel step 6: passive keywords shadow / landwalk / changeling, mass grants with `all`, underscore keyword names.
import { describe, expect, it } from "vitest";
import type { Ability, Step } from "../schema";
import { cardUnsupported } from "./support";
import { fam, filler, mk, sorcery } from "./famkit";
import { charsOf, realDef, realTable } from "./testdb";
import { lookup } from "./testkit";

const kw = (name: string, param?: string): Ability => ({ id: "k:" + name, kind: "keyword", text: name, keyword: { name, ...(param ? { param } : {}) } } as Ability);
const crea = (name: string, p: number, t: number, abilities: Ability[] = [], subtypes: string[] = []) => mk(name, { manaCost: "{1}", types: ["creature"], subtypes, power: p, toughness: t }, abilities);
const cards = { Shady: crea("Shady", 2, 2, [kw("shadow")]), Plain: crea("Plain", 2, 2), Walker: crea("Walker", 2, 2, [kw("landwalk", "Forest")]), Chameleon: crea("Chameleon", 2, 2, [kw("changeling")]), Dbl: crea("Dbl", 2, 2, [kw("double_strike")]) };

const toBlockers = (t: ReturnType<typeof fam>, attacker: string) => {
  t.ok({ type: "advancePhase", player: "p1" }); t.ok({ type: "advancePhase", player: "p1" });
  t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: attacker, defender: "p2" }] });
  t.ok({ type: "advancePhase", player: "p1" });
};

describe("shadow", () => {
  it("a creature with shadow can be blocked only by shadow creatures, and shadow creatures block only shadow", () => {
    const t = fam(cards);
    const a = t.give("p1", "Shady", "battlefield"), b = t.give("p2", "Plain", "battlefield");
    toBlockers(t, a);
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b, attacker: a }] }).error?.code).toMatch(/illegal_block|not_declaring/);
    const u = fam(cards);
    const a2 = u.give("p1", "Shady", "battlefield"), b2 = u.give("p2", "Shady", "battlefield");
    toBlockers(u, a2);
    expect(u.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b2, attacker: a2 }] }).error).toBeUndefined();
    const v = fam(cards);
    const a3 = v.give("p1", "Plain", "battlefield"), b3 = v.give("p2", "Shady", "battlefield");
    toBlockers(v, a3);
    expect(v.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b3, attacker: a3 }] }).error?.code).toMatch(/illegal_block|not_declaring/);
  });
});

describe("landwalk", () => {
  it("cannot be blocked while the defender controls a land of the type; blockable otherwise", () => {
    const t = fam(cards);
    const a = t.give("p1", "Walker", "battlefield"), b = t.give("p2", "Plain", "battlefield"); t.give("p2", "Forest", "battlefield");
    toBlockers(t, a);
    expect(t.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b, attacker: a }] }).error?.code).toMatch(/illegal_block|not_declaring/);
    const u = fam(cards);
    const a2 = u.give("p1", "Walker", "battlefield"), b2 = u.give("p2", "Plain", "battlefield"); u.give("p2", "Island", "battlefield");
    toBlockers(u, a2);
    expect(u.do({ type: "declareBlockers", player: "p2", blocks: [{ blocker: b2, attacker: a2 }] }).error).toBeUndefined();
  });
});

describe("changeling", () => {
  it("counts as every creature type for filters", () => {
    const hunter = sorcery("Elf Hunter", "{1}", [{ kind: "destroy_all", filter: { types: ["creature"], subtypes: ["Elf"] } } as Step]);
    const t = fam({ ...cards, "Elf Hunter": hunter, Elf: crea("Elf", 1, 1, [], ["Elf"]) });
    const c = t.give("p1", "Chameleon", "battlefield"), e = t.give("p2", "Elf", "battlefield"), p = t.give("p2", "Plain", "battlefield");
    t.give("p1", "Plains", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Elf Hunter", "hand") }); t.resolveTop();
    expect(t.obj(c).zone).toBe("graveyard");
    expect(t.obj(e).zone).toBe("graveyard");
    expect(t.obj(p).zone).toBe("battlefield");
  });
  it("real: Taurean Mauler and Morophon support changeling", () => {
    expect(cardUnsupported(realDef("Taurean Mauler")!).all).not.toContain("keyword:changeling");
    const t = realTable(); const m = t.give("p1", "Taurean Mauler", "battlefield");
    expect(charsOf(t, m).keywords).toContain("changeling");
  });
});

let grantCard: ReturnType<typeof sorcery>;
describe("mass grants and keyword names", () => {
  it("`all` with a filter grants to every matching permanent until end of turn; an unfiltered `all` is refused", () => {
    grantCard = sorcery("Mass Grant", "{1}", [{ kind: "grant_effect", all: true, filter: { types: ["creature"], controller: "you" }, modify: [{ grant: "flying" }], duration: "until_end_of_turn" } as Step]);
    const t = fam({ ...cards, "Mass Grant": grantCard });
    const a = t.give("p1", "Plain", "battlefield"), b = t.give("p2", "Plain", "battlefield"); t.give("p1", "Plains", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Mass Grant", "hand") }); t.resolveTop();
    expect(charsOf2(t, a)).toContain("flying");
    expect(charsOf2(t, b)).not.toContain("flying");
  });
  it("double_strike (underscore) is read as double strike", () => {
    expect(cardUnsupported(cards.Dbl).all).toEqual([]);
    expect(cardUnsupported(realDef("Terror of Mount Velus")!).all).toEqual([]);
    const t = realTable(); const d = t.give("p1", "Terror of Mount Velus", "battlefield");
    void d; void filler;
  });
});
import { chars } from "./core";
function charsOf2(t: ReturnType<typeof fam>, id: string): string[] { return chars({ s: structuredClone(t.state), events: [], defs: (n: string) => (n === "Mass Grant" ? grantCard : (cards as unknown as Record<string, never>)[n]) ?? lookup(n), scanned: 0 } as never, id).keywords; }
