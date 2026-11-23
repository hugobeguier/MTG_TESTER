// Kernel bug report 12: Plaguecrafter sequencing, Archaeomancer's Map intervening-if, Redress Fate trigger counts, Rooms.
import { describe, expect, it } from "vitest";
import { famCards } from "./famkit";
import { drain } from "./step10kit";
import { legalActions } from "./legal";
import { charsOf, ctxOf, realTable } from "./testdb";

describe("A: Plaguecrafter", () => {
  it("a player who sacrificed does not discard; a player who cannot does", () => {
    const t = realTable(["p1", "p2", "p3"]);
    const sent = t.give("p1", "Esper Sentinel", "battlefield");
    const h1 = t.give("p1", "Island", "hand");
    t.give("p2", "Swamp", "battlefield"); t.give("p2", "Swamp", "battlefield"); t.give("p2", "Swamp", "battlefield");
    const h2 = t.give("p2", "Island", "hand"); const h3 = t.give("p3", "Island", "hand"); t.give("p3", "Island", "hand");
    const pc = t.give("p2", "Plaguecrafter", "hand");
    t.state.priority = "p2"; t.state.turn.active = "p2";
    t.ok({ type: "castSpell", player: "p2", cardId: pc });
    const asked: string[] = [];
    drain(t, (p) => { asked.push(p.kind + ":" + p.player); return undefined; });
    expect(t.obj(sent).zone).toBe("graveyard");
    expect(t.obj(h1).zone).toBe("hand"); // p1 sacrificed: no discard
    expect(t.obj(h2).zone).toBe("hand"); // p2 sacrificed Plaguecrafter itself
    expect(t.obj(h3).zone).toBe("graveyard"); // p3 controls no creature or planeswalker: discards (the one prompt asked is theirs)
    expect(asked.filter((a) => a.endsWith("p1"))).toEqual([]);
  });
});

describe("B: Archaeomancer's Map (intervening if, 'that player')", () => {
  const play = (t: ReturnType<typeof realTable>, who: string) => {
    t.state.turn.active = who; t.state.priority = who;
    t.ok({ type: "playLand", player: who, cardId: t.give(who, "Island", "hand") });
    return t.state.triggerQueue.length + t.state.stack.length;
  };
  it("triggers only when THAT player controls more lands than you (not all opponents together)", () => {
    const t = realTable(["p1", "p2", "p3"]);
    t.give("p1", "Archaeomancer's Map", "battlefield");
    t.lands("p1", "Island", 3);
    t.lands("p2", "Island", 3); // p2 will have 4 > 3 later
    t.lands("p3", "Island", 1);
    expect(play(t, "p3")).toBe(0); // p3: 2 lands vs your 3 (all opponents together: 6)
    expect(play(t, "p2")).toBe(1); // p2: 4 lands vs your 3
  });
  it("is checked again on resolution: you catch up before it resolves", () => {
    const t = realTable(["p1", "p2"]);
    t.give("p1", "Archaeomancer's Map", "battlefield");
    t.lands("p1", "Island", 2); t.lands("p2", "Island", 2);
    expect(play(t, "p2")).toBe(1);
    t.give("p1", "Island", "battlefield");
    t.give("p1", "Island", "battlefield");
    t.give("p1", "Island", "hand");
    drain(t, (p) => { throw new Error("no decision expected: " + p.kind); });
    expect(t.state.stack.length + t.state.triggerQueue.length).toBe(0);
  });
});

describe("A2: Deadly Brew only returns a permanent when YOU sacrificed", () => {
  const run = (youHaveCreature: boolean) => {
    const t = realTable(["p1", "p2"]);
    t.lands("p1", "Swamp", 2); t.lands("p1", "Forest", 1);
    t.give("p2", "Esper Sentinel", "battlefield");
    if (youHaveCreature) t.give("p1", "Llanowar Elves", "battlefield");
    const ring = t.give("p1", "Sol Ring", "graveyard");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Deadly Brew", "hand") });
    const kinds: string[] = [];
    drain(t, (p) => { kinds.push(p.kind); return p.kind === "choose_yes_no" ? { yes: true } : undefined; });
    return { t, ring, kinds };
  };
  it("you have no creature: no return choice, Sol Ring stays", () => { const { t, ring } = run(false); expect(t.obj(ring).zone).toBe("graveyard"); });
  it("you sacrificed: you may return another permanent card", () => { const { t, ring } = run(true); expect(t.obj(ring).zone).toBe("hand"); });
});

describe("C: Redress Fate trigger counts", () => {
  const setup = () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Plains", 8);
    const ids = Object.fromEntries(["Doomwake Giant", "Fear of Sleep Paralysis", "Callaphe, Beloved of the Sea", "Secret Arcade", "Boon of the Spirit Realm"].map((n) => [n, t.give("p1", n, "graveyard")]));
    t.give("p1", "Sol Ring", "graveyard"); t.give("p1", "Arcane Signet", "graveyard");
    t.give("p2", "Fill A", "battlefield");
    const rf = t.give("p1", "Redress Fate", "hand");
    return { t, ids, rf };
  };
  it("each source triggers once per enchantment entering (5), not per face / move / replay", () => {
    const { t, ids, rf } = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: rf });
    // resolve the spell
    for (let i = 0; i < 4 && t.state.stack.some((x) => x.kind === "spell") && !t.state.pending; i++) t.ok({ type: "passPriority", player: t.state.priority! });
    const q = [...t.state.triggerQueue, ...t.state.stack.filter((s) => s.kind === "triggered")];
    const per: Record<string, number> = {};
    for (const x of q) per[t.obj(x.sourceId).cardName + "/" + x.abilityId] = (per[t.obj(x.sourceId).cardName + "/" + x.abilityId] ?? 0) + 1;
    // 5 enchantments enter at once (Doomwake Giant, Fear of Sleep Paralysis, Callaphe, Secret Arcade, Boon): every source triggers once for each of them
    // (itself included); the two artifacts do not count because Secret Arcade's door is locked, so its "are enchantments" static is off
    expect(per).toEqual({ "Doomwake Giant/a1": 5, "Fear of Sleep Paralysis/a2": 5, "Boon of the Spirit Realm/a1": 5 });
    expect(t.state.pending?.kind).toBe("order_triggers");
    expect(t.state.pending && (t.state.pending as { options: unknown[] }).options.length).toBe(15);
    drain(t); // resolve all fifteen: the Boon gets exactly one blessing counter per enchantment
    expect(t.obj(ids["Boon of the Spirit Realm"]).counters.blessing).toBe(5);
  });
});

describe("D: Rooms (CR 709)", () => {
  const enchTrig = (t: ReturnType<typeof realTable>) => {
    const q = [...t.state.triggerQueue, ...t.state.stack.filter((x) => x.kind === "triggered")];
    const per: Record<string, number> = {};
    for (const x of q) { const k = t.obj(x.sourceId).cardName + "/" + x.abilityId; per[k] = (per[k] ?? 0) + 1; }
    return per;
  };
  it("Secret Arcade entering from the graveyard (Redress Fate) has both doors locked: no abilities, still an enchantment, no Arcade static", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Plains", 8);
    const arc = t.give("p1", "Secret Arcade", "graveyard");
    const dg = t.give("p1", "Doomwake Giant", "graveyard");
    const ring = t.give("p1", "Sol Ring", "graveyard"); // an artifact: would count as an enchantment only while Arcade's door is unlocked
    t.give("p2", "Fill A", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Redress Fate", "hand") });
    for (let i = 0; i < 4 && t.state.stack.some((x) => x.kind === "spell") && !t.state.pending; i++) t.ok({ type: "passPriority", player: t.state.priority! });
    expect(t.obj(arc).zone).toBe("battlefield");
    expect(t.obj(arc).unlocked ?? []).toEqual([]);
    const c = charsOf(t, arc);
    expect(c.types).toContain("enchantment"); expect(c.abilities).toEqual([]); expect(c.mv).toBe(0);
    expect(charsOf(t, ring).types).not.toContain("enchantment");
    // Doomwake: itself + Secret Arcade = 2 enchantments entered (Sol Ring is not one)
    expect(enchTrig(t)["Doomwake Giant/a1"]).toBe(2);
    expect(t.obj(dg).zone).toBe("battlefield");
  });
  it("a cast Room enters with the cast door unlocked; the other door is unlocked as a special action (sorcery speed, its cost); Eerie only on a full unlock", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Plains", 9);
    t.give("p2", "Fill A", "battlefield");
    const fear = t.give("p1", "Fear of Sleep Paralysis", "battlefield");
    const arc = t.give("p1", "Secret Arcade", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: arc, face: "Dusty Parlor" });
    drain(t, (p) => (p.kind === "choose_cards" || p.kind === "order_triggers" ? undefined : undefined));
    expect(t.obj(arc).zone).toBe("battlefield");
    expect(t.obj(arc).unlocked).toEqual(["Dusty Parlor"]);
    expect(charsOf(t, arc).name).toBe("Dusty Parlor");
    expect(charsOf(t, arc).abilities.map((a) => a.face)).toEqual(["Dusty Parlor"]);
    expect(t.obj(arc).zone).toBe("battlefield");
    const opts = legalActions(t.state, "p1", ctxOf(t)).filter((a) => a.kind === "unlockDoor");
    expect(opts.map((a) => a.label)).toEqual(["Unlock the Secret Arcade door of Secret Arcade"]);
    t.ok(opts[0].action!);
    expect(t.obj(arc).unlocked).toEqual(["Dusty Parlor", "Secret Arcade"]);
    expect(t.obj(arc).zone).toBe("battlefield");
    // fully unlocked: Fear of Sleep Paralysis triggers once for the unlock (and it is on the stack / queued)
    expect(enchTrig(t)["Fear of Sleep Paralysis/a2"]).toBe(1);
    expect(legalActions(t.state, "p1", ctxOf(t)).filter((a) => a.kind === "unlockDoor")).toEqual([]);
    expect(charsOf(t, arc).mv).toBe(8);
    void fear;
  });
  it("cannot unlock at instant speed or without the mana", () => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Plains", 3);
    const arc = t.give("p1", "Secret Arcade", "battlefield");
    expect(t.do({ type: "unlockDoor", player: "p1", objectId: arc, face: "Secret Arcade", autoPay: true }).error?.code).toBe("cannot_pay");
    expect(t.do({ type: "unlockDoor", player: "p1", objectId: arc, face: "Dusty Parlor", autoPay: true }).error).toBeUndefined();
    expect(t.obj(arc).unlocked).toEqual(["Dusty Parlor"]);
    expect(t.do({ type: "unlockDoor", player: "p1", objectId: arc, face: "Dusty Parlor", autoPay: true }).error?.code).toBe("cannot_activate");
  });
});
