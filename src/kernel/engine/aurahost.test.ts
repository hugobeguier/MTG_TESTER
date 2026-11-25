import { describe, expect, it } from "vitest";
import { G, base, lands, toUpkeep, type Answerer } from "./aminatoukit";
import type { ObjId } from "./types";
import { NeedAsk, moveObject, type Run } from "./core";
import { copiableDef } from "./copy";
import { createToken } from "./steps";
import { ctx } from "../integration/testgame";

const run = (g: G): Run => ({ s: structuredClone(g.s), events: [], defs: ctx.cards, scanned: 0 } as never);

// An Aura that enters without being cast chooses what it enchants as it enters (aurahost.ts, CR 303.4f / 707.9).
function setup(creatures: string[], opts: { replication?: boolean } = {}) {
  const m = base();
  if (opts.replication !== false) m.give("p1", "Extravagant Replication", "battlefield");
  const cs = creatures.map((n) => m.give("p1", n, "battlefield"));
  const aura = m.give("p1", "Vanishing", "battlefield");
  const st = m.state; st.objects[aura].attachedTo = cs[0]; st.objects[aura].attachedToTs = st.objects[cs[0]].timestamp;
  return { m, cs, aura };
}
const targetAura = (aura: ObjId, then?: Answerer): Answerer => (p, g) => (p.kind === "choose_targets" ? { ids: [aura] } : then?.(p, g));
const hosts = (g: G, name: string) => g.bf(name).map((i) => g.obj(i)).filter((o) => o.token && o.attachedTo).map((o) => g.obj(o.attachedTo!).id);

describe("Aura entering without being cast", () => {
  it("Extravagant Replication copies an attached Aura: one legal creature (auto-attached, no prompt)", () => {
    const { m, cs, aura } = setup(["Ledger Shredder"]);
    const g = new G(m);
    toUpkeep(g, "p1", targetAura(aura)); g.drive(targetAura(aura));
    const copies = g.bf("Vanishing").filter((i) => g.obj(i).token);
    expect(copies, g.log().join("\n")).toHaveLength(1);
    expect(g.obj(copies[0]).attachedTo).toBe(cs[0]);
    expect(g.asked).not.toContain("choose_option");
  });
  it("several creatures: the controller chooses; the copy enchants the chosen one", () => {
    const { m, cs, aura } = setup(["Ledger Shredder", "Esper Sentinel"]);
    const g = new G(m);
    const seen: string[] = [];
    const ans: Answerer = (p) => { if (p.kind === "choose_targets") return { ids: [aura] }; if (p.kind === "choose_option") { seen.push(p.prompt.title); return { ids: [cs[1]] }; } return undefined; };
    toUpkeep(g, "p1", ans); g.drive(ans);
    const copies = g.bf("Vanishing").filter((i) => g.obj(i).token);
    expect(copies, g.log().join("\n")).toHaveLength(1);
    expect(g.obj(copies[0]).attachedTo).toBe(cs[1]);
    expect(g.obj(aura).attachedTo).toBe(cs[0]); // the original is untouched
    expect(seen[0]).toMatch(/Vanishing: what does it enchant/);
  });
  it("the copy is its own object with Vanishing's abilities (U U: enchanted creature phases out)", () => {
    const { m, cs, aura } = setup(["Ledger Shredder", "Esper Sentinel"]);
    lands(m, "p1", "Island", "Island");
    const g = new G(m);
    const ans: Answerer = (p) => (p.kind === "choose_targets" ? { ids: [aura] } : p.kind === "choose_option" ? { ids: [cs[1]] } : undefined);
    toUpkeep(g, "p1", ans); g.drive(ans);
    const copy = g.bf("Vanishing").find((i) => g.obj(i).token)!;
    const c = g.chars(copy);
    expect(c.abilities.some((a) => a.keyword?.name === "enchant")).toBe(true);
    const act = c.abilities.find((a) => a.kind === "activated")!;
    expect(act).toBeTruthy();
    expect(copy).not.toBe(aura);
    g.act("p1", copy, act.id);
    const phased = (g.s.phased ?? []).map((x) => x.id);
    expect(phased, g.log().join(" ")).toContain(cs[1]);
    expect(phased).not.toContain(cs[0]);
  });
  it("nothing legal to enchant: a token copy ceases to exist and the log says why", () => {
    const m = base(); const cr = m.give("p1", "Ledger Shredder", "battlefield"); const aura = m.give("p1", "Vanishing", "battlefield");
    const g = new G(m);
    const r = run(g);
    const def = copiableDef(r, g.s.objects[aura]);
    r.s.battlefield = r.s.battlefield.filter((x) => x !== cr); r.s.objects[cr].zone = "graveyard"; // no creature left
    const made: string[] = [];
    createToken(r, "p1", def, false, made);
    expect(made).toHaveLength(0);
    expect(Object.values(r.s.objects).filter((o) => o.token && o.cardName === "Vanishing")).toHaveLength(0);
    expect(r.events.some((e) => (e as { type: string }).type === "aura_no_host")).toBe(true);
    void ctx;
  });
  it("an Aura card entering from the graveyard: one creature = auto, two = asks, none = stays in the graveyard", () => {
    const mk = (n: number) => { const m = base(); const cs = Array.from({ length: n }, () => m.give("p2", "Esper Sentinel", "battlefield")); const a = m.give("p1", "Vanishing", "graveyard"); return { g: new G(m), cs, a }; };
    { const { g, cs, a } = mk(1); const r = run(g); moveObject(r, a, "battlefield", { controller: "p1" }); expect(r.s.objects[a].zone).toBe("battlefield"); expect(r.s.objects[a].attachedTo).toBe(cs[0]); }
    { const { g, a } = mk(2); const r = run(g); expect(() => moveObject(r, a, "battlefield", { controller: "p1" })).toThrow(NeedAsk); }
    { const { g, cs, a } = mk(2); const r = run(g); r.answers = [{ ids: [cs[1]] }]; moveObject(r, a, "battlefield", { controller: "p1" }); expect(r.s.objects[a].attachedTo).toBe(cs[1]); }
    { const { g, a } = mk(0); const r = run(g); moveObject(r, a, "battlefield", { controller: "p1" }); expect(r.s.objects[a].zone).toBe("graveyard"); expect(r.events.some((e) => (e as { type: string }).type === "aura_no_host")).toBe(true); }
  });
});
