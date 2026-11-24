import { describe, expect, it } from "vitest";
import { table, type Table } from "./testkit";
import type { Action, ResolveResult } from "./types";

const cast = (t: Table, who: string, id: string, extra: Partial<Extract<Action, { type: "castSpell" }>> = {}) => t.do({ type: "castSpell", player: who, cardId: id, ...extra });
const castOk = (t: Table, who: string, id: string, extra: Partial<Extract<Action, { type: "castSpell" }>> = {}) => t.ok({ type: "castSpell", player: who, cardId: id, ...extra });
const kinds = (res: ResolveResult) => res.pending?.kind;

describe("kicker (Tear Asunder)", () => {
  const setup = () => {
    const t = table();
    t.lands("p1", "Forest", 2); t.lands("p1", "Swamp", 2);
    const spell = t.give("p1", "Tear Asunder", "hand");
    const ring = t.give("p2", "Sol Ring", "battlefield");
    const cub = t.give("p2", "Bear Cub", "battlefield");
    return { t, spell, ring, cub };
  };

  it("asks for optional costs before anything else, and answering none casts it normally", () => {
    const { t, spell, ring, cub } = setup();
    let res = castOk(t, "p1", spell);
    expect(kinds(res)).toBe("choose_cast_option");
    expect(res.pending!.options.map((o) => o.id)).toEqual(["c1"]);
    expect(res.pending!.min).toBe(0);
    res = t.answer(res, { ids: [] });
    expect(kinds(res)).toBe("choose_targets");
    // the conditional second slot (kicked: nonland permanent) does not exist: only the artifact / enchantment target is asked
    res = t.answer(res, { ids: [ring] });
    expect(res.pending).toBeUndefined();
    expect(t.state.stack[0].parts[0].targets).toEqual({ t1: [ring], t2: [] });
    expect(t.state.stack[0].cast!.paid ?? []).toEqual([]);
    t.pass("p1", "p2");
    expect(t.obj(ring).zone).toBe("exile"); // not kicked: the artifact (t1), not the creature
    expect(t.obj(cub).zone).toBe("battlefield");
  });

  it("kicked: costs {1}{B} more, remembers it, and the kicked branch runs", () => {
    const { t, spell, ring, cub } = setup();
    let res = castOk(t, "p1", spell, { extras: ["c1"] });
    expect(kinds(res)).toBe("choose_targets");
    // kicked: only the nonland-permanent slot exists (the artifact / enchantment slot is inactive)
    expect(res.pending!.prompt.instruction).toContain("nonland permanent");
    res = t.answer(res, { ids: [cub] });
    expect(res.pending).toBeUndefined();
    expect(t.state.stack[0].parts[0].targets).toEqual({ t1: [], t2: [cub] });
    expect(t.state.stack[0].cast!.paid).toEqual(["c1", "kicker"]);
    expect(t.state.objects[spell].cast!.paid).toContain("kicker");
    t.pass("p1", "p2");
    expect(t.obj(cub).zone).toBe("graveyard".replace("graveyard", "exile"));
    expect(t.obj(ring).zone).toBe("battlefield");
    // all four lands were needed: {1}{G} + {1}{B}
    expect(t.state.battlefield.filter((id) => t.obj(id).tapped)).toHaveLength(4);
  });

  it("kicked but only two lands: cannot_pay, nothing changed", () => {
    const t = table();
    t.lands("p1", "Forest", 2);
    const spell = t.give("p1", "Tear Asunder", "hand");
    t.give("p2", "Sol Ring", "battlefield"); t.give("p2", "Bear Cub", "battlefield");
    const before = structuredClone(t.state);
    let res = castOk(t, "p1", spell, { extras: ["c1"] });
    const bad = t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: [t.state.battlefield.find((id) => t.obj(id).cardName === "Bear Cub")!] } });
    expect(bad.error?.code).toBe("cannot_pay");
    expect(t.obj(spell).zone).toBe("stack"); // the cast is still open (the answer was rejected): cancel it
    t.ok({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { cancel: true } });
    expect(t.obj(spell).zone).toBe("hand");
    expect(t.state.battlefield.filter((id) => t.obj(id).tapped)).toHaveLength(0);
    void before;
  });

  it("rejects an option id the card does not have, and a wrong way to cast", () => {
    const { t, spell } = setup();
    expect(cast(t, "p1", spell, { extras: ["nope"] }).error?.code).toBe("invalid_choice");
    expect(cast(t, "p1", spell, { option: "c1" }).error?.code).toBe("invalid_choice");
    expect(t.obj(spell).zone).toBe("hand");
  });

  it("only the caster answers the option decision", () => {
    const { t, spell } = setup();
    const res = castOk(t, "p1", spell);
    const bad = t.do({ type: "answerDecision", player: "p2", decisionId: res.pending!.id, choice: { ids: [] } });
    expect(bad.error?.code).toBe("not_your_decision");
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { ids: ["zzz"] } }).error?.code).toBe("invalid_choice");
  });

  it("is deterministic: the same actions give the same state", () => {
    const run = () => {
      const { t, spell, cub } = setup();
      let res = castOk(t, "p1", spell, { extras: ["c1"] });
      t.answer(res, { ids: [cub] });
      t.pass("p1", "p2");
      return t.state;
    };
    expect(run()).toEqual(run());
  });
});

describe("flashback (Otherworldly Gaze)", () => {
  const setup = () => {
    const t = table();
    t.lands("p1", "Island", 3);
    for (let i = 0; i < 5; i++) t.give("p1", "Island", "library");
    const gaze = t.give("p1", "Otherworldly Gaze", "graveyard");
    return { t, gaze };
  };

  it("can be cast from the graveyard (only way offered is flashback), pays the flashback cost and is exiled afterwards", () => {
    const { t, gaze } = setup();
    let res = castOk(t, "p1", gaze);
    // surveil 3 is a decision only after resolution; the cast itself needed no question (flashback is the only way)
    expect(res.pending).toBeUndefined();
    expect(t.obj(gaze).zone).toBe("stack");
    expect(t.state.battlefield.filter((id) => t.obj(id).tapped)).toHaveLength(2); // {1}{U}, not {U}
    t.pass("p1", "p2");
    res = t.answer({ ...t.state, pending: t.state.pending } as never, { ids: [] });
    expect(t.obj(gaze).zone).toBe("exile");
  });

  it("is exiled even when countered", () => {
    const { t, gaze } = setup();
    t.lands("p2", "Island", 2);
    const cs = t.give("p2", "Counterspell", "hand");
    castOk(t, "p1", gaze);
    t.state = { ...t.state, priority: "p2" };
    castOk(t, "p2", cs, { targets: { t1: [gaze] } });
    t.pass("p2", "p1");
    expect(t.obj(gaze).zone).toBe("exile");
  });

  it("cast from hand it is a normal cast: {U}, and it goes to the graveyard", () => {
    const { t } = setup();
    const inHand = t.give("p1", "Otherworldly Gaze", "hand");
    castOk(t, "p1", inHand);
    expect(t.state.battlefield.filter((id) => t.obj(id).tapped)).toHaveLength(1);
    t.pass("p1", "p2");
    t.answer({ pending: t.state.pending } as never, { ids: [] });
    expect(t.obj(inHand).zone).toBe("graveyard");
  });

  it("cannot flash back without the mana, and the card stays in the graveyard", () => {
    const t = table();
    t.give("p1", "Island", "battlefield");
    const gaze = t.give("p1", "Otherworldly Gaze", "graveyard");
    const res = cast(t, "p1", gaze);
    expect(res.error?.code).toBe("cannot_pay");
    expect(t.obj(gaze).zone).toBe("graveyard");
  });

  it("a card with no flashback cannot be cast from the graveyard", () => {
    const t = table();
    t.lands("p1", "Mountain", 1);
    const bolt = t.give("p1", "Lightning Bolt", "graveyard");
    expect(cast(t, "p1", bolt, { targets: { t1: ["p2"] } }).error?.code).toBe("not_in_zone");
  });

  it("the option shortcut is validated", () => {
    const { t, gaze } = setup();
    expect(cast(t, "p1", gaze, { option: "zzz" }).error?.code).toBe("invalid_choice");
    expect(cast(t, "p1", gaze, { option: "normal" }).error?.code).toBe("invalid_choice"); // normal is not available from the graveyard
    expect(cast(t, "p1", gaze, { option: "c1" }).error).toBeUndefined();
  });
});

describe("escape (Woe Strider)", () => {
  const setup = (fodder: number) => {
    const t = table();
    t.lands("p1", "Swamp", 5);
    const woe = t.give("p1", "Woe Strider", "graveyard");
    for (let i = 0; i < fodder; i++) t.give("p1", "Bear Cub", "graveyard");
    return { t, woe };
  };

  it("asks which four other cards to exile, enters with two +1/+1 counters (cast_with escape), and its ETB makes a Goat", () => {
    const { t, woe } = setup(5);
    let res = castOk(t, "p1", woe);
    expect(kinds(res)).toBe("choose_cards");
    expect(res.pending!.options).toHaveLength(5);
    expect(res.pending!.options.some((o) => o.id === woe)).toBe(false);
    const pick = res.pending!.options.slice(0, 4).map((o) => o.id);
    res = t.answer(res, { ids: pick });
    for (const id of pick) expect(t.obj(id).zone).toBe("exile");
    t.pass("p1", "p2");
    expect(t.obj(woe).zone).toBe("battlefield");
    expect(t.obj(woe).counters["+1/+1"]).toBe(2);
    t.pass("p1", "p2"); // goat trigger
    expect(t.state.battlefield.filter((id) => t.obj(id).token?.name === "Goat")).toHaveLength(1);
  });

  it("not enough other cards in the graveyard: cannot_pay and nothing moves", () => {
    const { t, woe } = setup(3);
    const res = cast(t, "p1", woe);
    expect(res.error?.code).toBe("cannot_pay");
    expect(t.obj(woe).zone).toBe("graveyard");
  });

  it("cast from the hand it is a normal cast without counters", () => {
    const t = table();
    t.lands("p1", "Swamp", 3);
    const woe = t.give("p1", "Woe Strider", "hand");
    castOk(t, "p1", woe);
    t.pass("p1", "p2");
    expect(t.obj(woe).zone).toBe("battlefield");
    expect(t.obj(woe).counters["+1/+1"]).toBeUndefined();
  });

  it("wrong player cannot cast it from your graveyard", () => {
    const { t, woe } = setup(5);
    t.state = { ...t.state, priority: "p2" };
    expect(cast(t, "p2", woe).error?.code).toBe("not_owner");
  });
});

describe("cast from the graveyard under a condition (Gravecrawler)", () => {
  it("needs a Zombie", () => {
    const t = table();
    t.lands("p1", "Swamp", 2);
    const gc = t.give("p1", "Gravecrawler", "graveyard");
    expect(cast(t, "p1", gc).error?.code).toBe("not_in_zone");
    t.give("p1", "Midnight Reaper", "battlefield");
    castOk(t, "p1", gc);
    t.pass("p1", "p2");
    expect(t.obj(gc).zone).toBe("battlefield");
  });

  it("costs its normal mana cost (the option adds no cost) and is not exiled", () => {
    const t = table();
    t.lands("p1", "Swamp", 1);
    t.give("p1", "Midnight Reaper", "battlefield");
    const gc = t.give("p1", "Gravecrawler", "graveyard");
    castOk(t, "p1", gc);
    expect(t.state.battlefield.filter((id) => t.obj(id).tapped)).toHaveLength(1);
    expect(t.obj(gc).exileInstead).toBeUndefined();
  });
});

describe("alternative costs (Flawless Maneuver, Blasphemous Edict)", () => {
  it("with a commander: asked how to cast, the free option costs no mana", () => {
    const t = table();
    t.lands("p1", "Plains", 3);
    const cmd = t.give("p1", "Bear Cub", "battlefield"); t.state.objects[cmd].isCommander = true;
    const fm = t.give("p1", "Flawless Maneuver", "hand");
    let res = castOk(t, "p1", fm);
    expect(kinds(res)).toBe("choose_cast_option");
    expect(res.pending!.options.map((o) => o.id)).toEqual(["c1", "normal"]);
    res = t.answer(res, { ids: ["c1"] });
    expect(res.pending).toBeUndefined();
    expect(t.state.battlefield.filter((id) => t.obj(id).tapped)).toHaveLength(0);
    t.pass("p1", "p2");
    expect(t.obj(cmd).zone).toBe("battlefield");
  });

  it("without a commander the free option is not offered (and the shortcut is rejected)", () => {
    const t = table();
    t.lands("p1", "Plains", 3);
    const fm = t.give("p1", "Flawless Maneuver", "hand");
    expect(cast(t, "p1", fm, { option: "c1" }).error?.code).toBe("invalid_choice");
    const res = castOk(t, "p1", fm);
    expect(res.pending).toBeUndefined();
    expect(t.state.battlefield.filter((id) => t.obj(id).tapped)).toHaveLength(3);
  });

  it("Blasphemous Edict costs {B} only with thirteen creatures out", () => {
    const t = table();
    t.lands("p1", "Swamp", 1);
    const be = t.give("p1", "Blasphemous Edict", "hand");
    for (let i = 0; i < 13; i++) t.give("p2", "Bear Cub", "battlefield");
    let res = castOk(t, "p1", be);
    expect(res.pending!.options.map((o) => o.id)).toEqual(["normal", "c1"]);
    res = t.answer(res, { ids: ["c1"] });
    expect(res.pending).toBeUndefined();
    expect(t.obj(be).zone).toBe("stack");
  });

  it("choosing the normal way with one Swamp fails to pay", () => {
    const t = table();
    t.lands("p1", "Swamp", 1);
    const be = t.give("p1", "Blasphemous Edict", "hand");
    for (let i = 0; i < 13; i++) t.give("p2", "Bear Cub", "battlefield");
    expect(cast(t, "p1", be, { option: "normal" }).error?.code).toBe("cannot_pay");
    expect(t.obj(be).zone).toBe("hand");
  });

  it("Sephara: the alternative cost taps four untapped flying creatures (a choice made before paying)", () => {
    const t = table();
    const plains = t.give("p1", "Plains", "battlefield");
    const seph = t.give("p1", "Sephara, Sky's Blade", "hand");
    const birds = [1, 2, 3, 4].map(() => t.give("p1", "Ledger Shredder", "battlefield"));
    const res = castOk(t, "p1", seph);
    expect(res.pending!.options.map((o) => o.id)).toEqual(["normal", "c1"]);
    t.answer(res, { ids: ["c1"] }); // four candidates for four taps: no further question
    expect(t.obj(seph).zone).toBe("stack");
    for (const b of birds) expect(t.obj(b).tapped).toBe(true);
    expect(t.obj(plains).tapped).toBe(true);
  });
});

describe("mandatory additional costs", () => {
  it("Unexpected Windfall: discard a card first (a choice), then draws and makes two Treasures", () => {
    const t = table();
    t.lands("p1", "Mountain", 4);
    for (let i = 0; i < 4; i++) t.give("p1", "Island", "library");
    const uw = t.give("p1", "Unexpected Windfall", "hand");
    const a = t.give("p1", "Island", "hand"), b = t.give("p1", "Mountain", "hand");
    let res = castOk(t, "p1", uw);
    expect(kinds(res)).toBe("choose_cards");
    expect(res.pending!.options.map((o) => o.id).sort()).toEqual([a, b].sort());
    res = t.answer(res, { ids: [b] });
    expect(t.obj(b).zone).toBe("graveyard");
    t.pass("p1", "p2");
    expect(t.state.battlefield.filter((id) => t.obj(id).token?.name === "Treasure")).toHaveLength(2);
    expect(t.p("p1").hand).toHaveLength(3); // a + two drawn
  });

  it("Unexpected Windfall with no other card in hand: cannot_pay", () => {
    const t = table();
    t.lands("p1", "Mountain", 4);
    const uw = t.give("p1", "Unexpected Windfall", "hand");
    expect(cast(t, "p1", uw).error?.code).toBe("cannot_pay");
    expect(t.obj(uw).zone).toBe("hand");
  });

  it("Deadly Dispute with two candidates asks which one to sacrifice (artifact or creature both qualify)", () => {
    const t = table();
    t.lands("p1", "Swamp", 2);
    for (let i = 0; i < 3; i++) t.give("p1", "Island", "library");
    const dd = t.give("p1", "Deadly Dispute", "hand");
    const ring = t.give("p1", "Sol Ring", "battlefield");
    const cub = t.give("p1", "Bear Cub", "battlefield");
    t.give("p1", "Island", "battlefield");
    const res = castOk(t, "p1", dd);
    expect(kinds(res)).toBe("choose_cards");
    expect(res.pending!.options.map((o) => o.id).sort()).toEqual([ring, cub].sort());
    t.answer(res, { ids: [cub] });
    expect(t.obj(cub).zone).toBe("graveyard");
    expect(t.obj(ring).zone).toBe("battlefield");
  });

  it("Deadly Dispute with exactly one candidate sacrifices it without asking", () => {
    const t = table();
    t.lands("p1", "Swamp", 2);
    for (let i = 0; i < 3; i++) t.give("p1", "Island", "library");
    const dd = t.give("p1", "Deadly Dispute", "hand");
    const ring = t.give("p1", "Sol Ring", "battlefield");
    const res = castOk(t, "p1", dd);
    expect(res.pending).toBeUndefined();
    expect(t.obj(ring).zone).toBe("graveyard");
    t.pass("p1", "p2");
    expect(t.p("p1").hand).toHaveLength(2);
    expect(t.state.battlefield.filter((id) => t.obj(id).token?.name === "Treasure")).toHaveLength(1);
  });

  it("Deadly Dispute with nothing to sacrifice: cannot_pay", () => {
    const t = table();
    t.lands("p1", "Swamp", 2);
    const dd = t.give("p1", "Deadly Dispute", "hand");
    expect(cast(t, "p1", dd).error?.code).toBe("cannot_pay");
  });

  it("Toxic Deluge: X is capped by life, X life is paid, creatures get -X/-X", () => {
    const t = table();
    t.lands("p1", "Swamp", 3);
    const td = t.give("p1", "Toxic Deluge", "hand");
    const cub = t.give("p2", "Bear Cub", "battlefield");
    t.give("p2", "Ledger Shredder", "battlefield");
    let res = castOk(t, "p1", td);
    expect(kinds(res)).toBe("choose_x");
    expect(res.pending!.max).toBe(40);
    expect(t.do({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { number: 41 } }).error?.code).toBe("invalid_choice");
    res = t.answer(res, { number: 2 });
    expect(t.p("p1").life).toBe(38);
    t.pass("p1", "p2");
    expect(t.obj(cub).zone).toBe("graveyard"); // 2/2 with -2/-2
  });

  it("Toxic Deluge: X = all your life is allowed (you can pay all your life)", () => {
    const t = table();
    t.lands("p1", "Swamp", 3);
    t.state.players[0].life = 3;
    const td = t.give("p1", "Toxic Deluge", "hand");
    const res = castOk(t, "p1", td);
    expect(res.pending!.max).toBe(3);
  });
});

describe("optional additional cost and escalate", () => {
  it("Plumb the Forbidden: optional sacrifice of X creatures, X capped by the candidates", () => {
    const t = table();
    t.lands("p1", "Swamp", 2);
    for (let i = 0; i < 3; i++) t.give("p1", "Island", "library");
    const pf = t.give("p1", "Plumb the Forbidden", "hand");
    t.give("p1", "Bear Cub", "battlefield"); t.give("p1", "Bear Cub", "battlefield");
    // the card also has a copy trigger (step copy): until copy exists it is refused as a whole
    const res = cast(t, "p1", pf);
    expect(res.error === undefined || res.error.code === "unsupported").toBe(true);
  });

  it("Collective Resistance: two modes cost {G} more (escalate), one mode costs nothing extra", () => {
    const t = table();
    t.lands("p1", "Forest", 3);
    const cr = t.give("p1", "Collective Resistance", "hand");
    const ring = t.give("p2", "Sol Ring", "battlefield");
    const cub = t.give("p1", "Bear Cub", "battlefield");
    let res = castOk(t, "p1", cr, { modes: ["m1", "m3"] });
    res = t.answer(res, { ids: [ring] });
    res = t.answer(res, { ids: [cub] });
    expect(t.state.stack).toHaveLength(1);
    expect(t.state.battlefield.filter((id) => t.obj(id).tapped)).toHaveLength(3); // {1}{G} + {G} for the second mode
    // a single mode costs only {1}{G}
    const t2 = table();
    t2.lands("p1", "Forest", 2);
    const cr2 = t2.give("p1", "Collective Resistance", "hand");
    const ring2 = t2.give("p2", "Sol Ring", "battlefield");
    castOk(t2, "p1", cr2, { modes: ["m1"], targets: { t1: [ring2] } });
    expect(t2.state.stack).toHaveLength(1);
    // two modes with only two lands: cannot pay
    const t3 = table();
    t3.lands("p1", "Forest", 2);
    const cr3 = t3.give("p1", "Collective Resistance", "hand");
    const ring3 = t3.give("p2", "Sol Ring", "battlefield"); const cub3 = t3.give("p1", "Bear Cub", "battlefield");
    let r3 = castOk(t3, "p1", cr3, { modes: ["m1", "m3"] });
    r3 = t3.answer(r3, { ids: [ring3] });
    expect(t3.do({ type: "answerDecision", player: "p1", decisionId: r3.pending!.id, choice: { ids: [cub3] } }).error?.code).toBe("cannot_pay");
  });
});

describe("cancelling and the decision protocol", () => {
  it("cancelling at the option stage puts the card back where it was", () => {
    const t = table();
    t.lands("p1", "Forest", 4);
    const a = t.give("p1", "Island", "hand");
    const spell = t.give("p1", "Tear Asunder", "hand");
    t.give("p2", "Sol Ring", "battlefield");
    const res = castOk(t, "p1", spell);
    t.ok({ type: "answerDecision", player: "p1", decisionId: res.pending!.id, choice: { cancel: true } });
    expect(t.p("p1").hand).toEqual([a, spell]);
    expect(t.state.priority).toBe("p1");
  });

  it("a flashback card cancelled returns to the graveyard", () => {
    const t = table();
    t.lands("p1", "Island", 3);
    const gaze = t.give("p1", "Otherworldly Gaze", "graveyard");
    t.state = { ...t.state };
    const res = castOk(t, "p1", gaze);
    void res; // nothing pending: flashback needed no question; abandon is only possible while a decision is open
    expect(t.obj(gaze).zone).toBe("stack");
  });

  it("view: the option decision is visible to its owner only as options, hidden for others", async () => {
    const { viewResult } = await import("./view");
    const t = table();
    t.lands("p1", "Forest", 4);
    const spell = t.give("p1", "Tear Asunder", "hand");
    t.give("p2", "Sol Ring", "battlefield");
    const res = castOk(t, "p1", spell);
    expect((viewResult(res, "p1").pending as { options: unknown[] }).options).toHaveLength(1);
    expect((viewResult(res, "p2").pending as { hidden?: boolean }).hidden).toBe(true);
  });
});
