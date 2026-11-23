// Kernel step 10 (d): per-player decisions (Braids), station (Susur Secundi) and the rest.
import { describe, expect, it } from "vitest";
import { instant, mk } from "./famkit";
import { cardUnsupported } from "./support";
import { realDef, realTable } from "./testdb";

describe("Braids, Arisen Nightmare: each opponent answers for themselves", () => {
  it("an opponent who sacrifices is spared; one who does not loses 2 life and Braids' controller draws", () => {
    expect(cardUnsupported(realDef("Braids, Arisen Nightmare")!).all).toEqual([]);
    const art = mk("Gadget", { manaCost: "{1}", types: ["artifact"] }, []);
    const t = realTable(["p1", "p2", "p3"], { Gadget: art });
    t.give("p1", "Braids, Arisen Nightmare", "battlefield");
    const mine = t.give("p1", "Gadget", "battlefield"), g2 = t.give("p2", "Gadget", "battlefield"), g3 = t.give("p3", "Gadget", "battlefield");
    for (let i = 0; i < 3; i++) t.give("p1", "Island", "library");
    const handBefore = t.p("p1").hand.length;
    for (let i = 0; i < 12 && String(t.state.turn.phase) !== "end_step"; i++) t.ok({ type: "advancePhase", player: "p1" });
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      const p = t.state.pending as never as { kind: string; player: string; id: string; options: Array<{ id: string }>; min: number } | null;
      if (p) {
        seen.push(`${p.kind}:${p.player}`);
        const choice = p.kind === "choose_yes_no" ? { yes: true } : p.player === "p2" ? { ids: [g2] } : p.player === "p3" ? { ids: [] } : { ids: [mine] };
        t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice }); continue;
      }
      if (t.state.stack.length || t.state.triggerQueue.length) { t.ok({ type: "passPriority", player: t.state.priority! }); continue; }
      break;
    }
    expect(seen).toContain("choose_cards:p2"); expect(seen).toContain("choose_cards:p3");
    expect(t.obj(mine).zone).toBe("graveyard");
    expect(t.obj(g2).zone).toBe("graveyard");
    expect(t.obj(g3).zone).toBe("battlefield");
    expect(t.p("p2").life).toBe(40);
    expect(t.p("p3").life).toBe(38);
    expect(t.p("p1").hand.length).toBe(handBefore + 1);
  });
});

describe("Susur Secundi, Void Altar: station", () => {
  it("tapping another creature puts charge counters equal to its power; the 12+ ability needs 12", () => {
    expect(cardUnsupported(realDef("Susur Secundi, Void Altar")!).all).toEqual([]);
    const t = realTable(["p1", "p2"], { Ogre: mk("Ogre", { manaCost: "{1}", types: ["creature"], power: 5, toughness: 5 }, []) });
    const s = t.give("p1", "Susur Secundi, Void Altar", "battlefield");
    const o = t.give("p1", "Ogre", "battlefield"); t.obj(o).controlledSince = t.state.clock; // summoning sick: tapping it as a cost is still allowed
    t.ok({ type: "activateAbility", player: "p1", sourceId: s, abilityId: "kw:station", costChoices: { 0: [o] } } as never);
    for (let i = 0; i < 6 && (t.state.pending || t.state.stack.length); i++) { const p = t.state.pending as never as { player: string; id: string; options: Array<{ id: string }> } | null; if (p) t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: { ids: [o] } }); else t.ok({ type: "passPriority", player: t.state.priority! }); }
    expect(t.obj(o).tapped).toBe(true);
    expect(t.obj(s).counters.charge).toBe(5);
    expect(t.do({ type: "activateAbility", player: "p1", sourceId: s, abilityId: "a4" }).error).toBeTruthy(); // fewer than 12
  });
});

describe("Call the Spirit Dragons: one counter per color, win with five Dragons", () => {
  const dr = (n: string, cost: string) => mk(n, { manaCost: cost, types: ["creature"], subtypes: ["Dragon"], power: 1, toughness: 1 }, []);
  const cards = { DW: dr("DW", "{W}"), DU: dr("DU", "{U}"), DB: dr("DB", "{B}"), DR: dr("DR", "{R}"), DG: dr("DG", "{G}") };
  const run = (names: string[]) => {
    const t = realTable(["p1", "p2"], cards);
    for (let i = 0; i < 10; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
    t.give("p1", "Call the Spirit Dragons", "battlefield");
    const ids = names.map((n) => t.give("p1", n, "battlefield"));
    for (let i = 0; i < 40 && !(t.state.turn.number === 3 && String(t.state.turn.phase) === "upkeep" && !t.state.stack.length && !t.state.triggerQueue.length && !t.state.pending); i++) {
      const p = t.state.pending as never as { kind: string; player: string; id: string; options: Array<{ id: string }>; min: number } | null;
      if (p) { t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: p.kind === "choose_yes_no" ? { yes: true } : { ids: p.options.slice(0, p.min).map((o) => o.id) } }); continue; }
      if (t.state.stack.length || t.state.triggerQueue.length) { t.ok({ type: "passPriority", player: t.state.priority! }); continue; }
      t.ok({ type: "advancePhase", player: t.state.turn.active });
      if (t.state.turn.number === 3 && String(t.state.turn.phase) === "upkeep" && (t.state.stack.length || t.state.triggerQueue.length)) continue;
    }
    return { t, ids };
  };
  it("is supported; each Dragon gets a counter, and five different Dragons win the game", () => {
    expect(cardUnsupported(realDef("Call the Spirit Dragons")!).all).toEqual([]);
    const { t, ids } = run(["DW", "DU", "DB", "DR", "DG"]);
    for (const id of ids) expect(t.obj(id).counters["+1/+1"]).toBe(1);
    expect(t.state.gameOver?.winner).toBe("p1");
  });
  it("with only four colors nobody wins", () => {
    const { t, ids } = run(["DW", "DU", "DB", "DR"]);
    for (const id of ids) expect(t.obj(id).counters["+1/+1"]).toBe(1);
    expect(t.state.gameOver).toBeFalsy();
  });
});

import { table } from "./testkit";
describe("loneSurvivorCannotWin", () => {
  const nowin = mk("No Win Idol", { manaCost: "{1}", types: ["artifact"] }, [{ id: "s1", kind: "static", text: "You can't win the game.", static: { affects: "you", modify: [{ grant: "can't win the game" }] } } as never]);
  const run = (mode?: "draw" | "continue") => {
    const t = table(["p1", "p2"], { extra: { "No Win Idol": nowin, "Big Drain": instant("Big Drain", "{R}", [{ kind: "life_change", who: "each_opponent", lose: true, amount: 40 } as never]) }, config: { loneSurvivorCannotWin: mode } as never });
    t.give("p1", "No Win Idol", "battlefield");
    t.give("p1", "Mountain", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Big Drain", "hand") });
    for (let i = 0; i < 6 && t.state.stack.length; i++) t.ok({ type: "passPriority", player: t.state.priority! });
    return t;
  };
  it("'draw' (the default): the lone survivor who cannot win ends the game as a draw", () => {
    for (const mode of [undefined, "draw" as const]) { const t = run(mode); expect(t.state.gameOver).toMatchObject({ draw: true }); }
  });
  it("'continue': the real rule, the game goes on", () => {
    const t = run("continue");
    expect(t.state.gameOver).toBeFalsy();
    expect(t.p("p2").hasLost).toBe(true);
  });
});

import { legalActions } from "./legal";
import { realDef as rd, realTable as rtbl, testDb as tdb } from "./testdb";
describe("special actions in legalActions: turnFaceUp, castPrepared", () => {
  const lctx = { cards: (n: string) => rd(n), db: tdb() } as never;
  it("a face-down morph lists turnFaceUp (no stack) and a prepared permanent lists castPrepared", () => {
    const t = rtbl(["p1", "p2"]);
    for (let i = 0; i < 4; i++) t.give("p1", "Swamp", "battlefield");
    const card = t.give("p1", "Grim Haruspex", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: card, option: "morph" }); t.resolveTop();
    expect(legalActions(t.state, "p1", lctx).some((a) => a.kind === "turnFaceUp" && a.objectId === card)).toBe(true);
    t.ok({ type: "turnFaceUp", player: "p1", objectId: card });
    expect(t.state.stack.length).toBe(0);
    expect(t.state.priority).toBe("p1"); // the player keeps priority
    expect(legalActions(t.state, "p1", lctx).some((a) => a.kind === "turnFaceUp")).toBe(false);
    const u = rtbl(["p1", "p2"]); const pf = u.give("p1", "Eccentric Pestfinder // Turn Stones", "battlefield");
    for (let i = 0; i < 4; i++) { u.give("p1", "Forest", "battlefield"); u.give("p1", "Swamp", "battlefield"); }
    u.obj(pf).prepared = true;
    expect(legalActions(u.state, "p1", lctx).some((a) => a.kind === "castPrepared" && a.objectId === pf)).toBe(true);
    const res = u.ok({ type: "castPrepared", player: "p1", objectId: pf });
    expect(res.events.some((e) => e.type === "cast")).toBe(true); // a real cast: cast triggers see it
  });
});

import { sorcery } from "./famkit";
import { drain } from "./step10kit";
describe("Twilight Diviner: a token copy of ONE of the creatures that entered from a graveyard", () => {
  it("the controller chooses which one when several entered together", () => {
    expect(cardUnsupported(realDef("Twilight Diviner")!).all).toEqual([]);
    const cards = { "Big Ogre": mk("Big Ogre", { manaCost: "{4}", types: ["creature"], power: 4, toughness: 4 }, []), "Tiny Elf": mk("Tiny Elf", { manaCost: "{1}", types: ["creature"], subtypes: ["Elf"], power: 1, toughness: 1 }, []),
      "Raise Them": sorcery("Raise Them", "{B}", [{ kind: "reanimate", all: true, filter: { types: ["creature"], owner: "you" } } as never]) };
    const t = realTable(["p1", "p2"], cards);
    t.give("p1", "Twilight Diviner", "battlefield");
    const ogre = t.give("p1", "Big Ogre", "graveyard"), elf = t.give("p1", "Tiny Elf", "graveyard");
    t.give("p1", "Swamp", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Raise Them", "hand") });
    let asked = false;
    drain(t, (p) => { if (p.kind === "choose_cards" && p.options.some((o) => o.id === elf) && p.options.some((o) => o.id === ogre)) { asked = true; return { ids: [elf] }; } return undefined; });
    expect(asked).toBe(true);
    const tokens = t.state.battlefield.map((id) => t.obj(id)).filter((o) => o.token);
    expect(tokens.map((o) => o.token!.name)).toEqual(["Tiny Elf"]);
  });
});

describe("Sunken Palace: copies abilities too, and the copy may get new targets", () => {
  const big = (n: string) => mk(n, { manaCost: "{1}", types: ["creature"], power: 1, toughness: 9 }, []);
  const prep = (extra: Record<string, unknown>) => {
    const t = realTable(["p1", "p2"], { "Big A": big("Big A"), "Big B": big("Big B"), "Zap Two": instant("Zap Two", "{U}", [{ kind: "damage_target", target: "t1", amount: 2 } as never], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }]), ...extra } as never);
    const pal = t.give("p1", "Sunken Palace", "battlefield");
    t.give("p1", "Island", "battlefield"); t.give("p1", "Island", "battlefield");
    for (let i = 0; i < 7; i++) t.give("p1", "Island", "graveyard");
    const a = realDef("Sunken Palace")!.kernel.abilities.filter((x) => x.kind === "mana")[1];
    t.ok({ type: "activateAbility", player: "p1", sourceId: pal, abilityId: a.id, color: "U" } as never);
    drain(t);
    return t;
  };
  it("a spell copy: the copy's controller picks a new target", () => {
    const t = prep({});
    const A = t.give("p2", "Big A", "battlefield"), B = t.give("p2", "Big B", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Zap Two", "hand"), targets: { t1: [A] } });
    let asked = false;
    drain(t, (p) => { if (p.kind === "choose_yes_no") return { yes: true }; if (p.kind === "choose_targets") { asked = true; return { ids: [B] }; } return undefined; });
    expect(asked).toBe(true);
    expect(t.obj(A).damage).toBe(2); // the original
    expect(t.obj(B).damage).toBe(2); // the copy
  });
  it("an ability copy: an activated ability paid with the mana is copied", () => {
    const pinger = mk("Pinger", { manaCost: "{1}", types: ["artifact"] }, [{ id: "a1", kind: "activated", text: "{U}: ping", costs: [{ mana: "{U}" }], targets: [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }], steps: [{ kind: "damage_target", target: "t1", amount: 3 }] } as never]);
    const t = prep({ Pinger: pinger });
    const A = t.give("p2", "Big A", "battlefield"), B = t.give("p2", "Big B", "battlefield"), pg = t.give("p1", "Pinger", "battlefield");
    t.ok({ type: "activateAbility", player: "p1", sourceId: pg, abilityId: "a1", targets: { t1: [A] } } as never);
    drain(t, (p) => { if (p.kind === "choose_yes_no") return { yes: true }; if (p.kind === "choose_targets") return { ids: [B] }; return undefined; });
    expect(t.obj(A).damage).toBe(3); expect(t.obj(B).damage).toBe(3);
  });
});

describe("Master of Ceremonies: each opponent chooses for themselves (a decision addressed to each)", () => {
  it("every opponent is asked, privately, and their own pick decides what they and Master's controller get", () => {
    expect(cardUnsupported(realDef("Master of Ceremonies")!).all).toEqual([]);
    const t = table(["p1", "p2", "p3"], { db: tdb(), extra: new Proxy({}, { get: (_t, n) => (typeof n === "string" ? rd(n) : undefined) }) as never });
    t.give("p1", "Master of Ceremonies", "battlefield");
    for (const p of ["p1", "p2", "p3"]) for (let i = 0; i < 14; i++) t.give(p, "Island", "library");
    const asked: string[] = [];
    for (let i = 0; i < 80; i++) {
      const p = t.state.pending as never as { kind: string; player: string; id: string; options: Array<{ id: string }> } | null;
      if (p) { asked.push(p.player); t.ok({ type: "answerDecision", player: p.player, decisionId: p.id, choice: { ids: [p.player === "p2" ? "money" : "secrets"] } }); continue; }
      if (t.state.stack.length || t.state.triggerQueue.length) { t.ok({ type: "passPriority", player: t.state.priority! }); continue; }
      if (t.state.turn.number < 4 || (t.state.turn.number === 4 && !asked.length && String(t.state.turn.phase) !== "upkeep")) { t.ok({ type: "advancePhase", player: t.state.turn.active }); continue; }
      break;
    }
    expect(asked).toEqual(["p2", "p3"]);
    const treasures = (pl: string) => t.state.battlefield.filter((id) => t.obj(id).token?.name === "Treasure" && t.obj(id).controller === pl).length;
    expect(treasures("p2")).toBe(1);
    expect(treasures("p3")).toBe(0);
    expect(t.p("p3").hand.length).toBe(t.p("p2").hand.length + 1); // p3 (secrets) drew an extra card on top of its normal draw; p2 (money) did not
  });
});
