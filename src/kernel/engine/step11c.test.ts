// Kernel step 11 (c): Hazoret's Monument, Leyline Tyrant (pay any amount, reflexive target), Nogi (setTypes), Sarkhan (behold), Spinerock Knoll (damage this turn), The Elder Dragon War (read ahead), Tyrant's Familiar.
import { describe, expect, it } from "vitest";
import { famCards, filler, instant, mk } from "./famkit";
import { drain, toAttackers } from "./step10kit";
import { cardUnsupported } from "./support";
import { charsOf, realDef, realTable } from "./testdb";

const names = ["Hazoret's Monument", "Leyline Tyrant", "Nogi, Draco-Zealot", "Sarkhan, Dragon Ascendant", "Spinerock Knoll", "The Elder Dragon War", "Tyrant's Familiar"];
describe("step 11c: supported", () => { for (const n of names) it(n, () => { expect(cardUnsupported(realDef(n)!).all, n).toEqual([]); }); });

const dragon = (n: string) => mk(n, { manaCost: "{1}", types: ["creature"], subtypes: ["Dragon"], power: 2, toughness: 2 }, []);
const kill = instant("Kill It", "{B}", [{ kind: "destroy_target", target: "t1" }], [{ id: "t1", what: "object", filter: { types: ["creature"] }, count: { min: 1, max: 1 } }] as never);
const ready = (t: ReturnType<typeof realTable>, id: string) => { t.obj(id).controlledSince = -1; return id; };

describe("Hazoret's Monument: may discard, if you do draw", () => {
  const redBear = mk("Red Bear", { manaCost: "{1}{R}", colors: ["red"], types: ["creature"], power: 2, toughness: 2 }, []);
  const setup = () => {
    const t = realTable(["p1", "p2"], { "Red Bear": redBear });
    t.give("p1", "Hazoret's Monument", "battlefield"); t.give("p1", "Mountain", "battlefield");
    const lib = t.give("p1", "Island", "library"); const other = t.give("p1", "Plains", "hand");
    return { t, lib, other, bear: t.give("p1", "Red Bear", "hand") };
  };
  it("red creature spells cost {1} less; discarding draws", () => {
    const { t, lib, other, bear } = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: bear }); // {R} only: one Mountain
    drain(t, (p) => (p.kind === "choose_yes_no" ? { yes: true } : undefined));
    expect(t.obj(other).zone).toBe("graveyard");
    expect(t.obj(lib).zone).toBe("hand");
  });
  it("declining draws nothing", () => {
    const { t, lib, other, bear } = setup();
    t.ok({ type: "castSpell", player: "p1", cardId: bear });
    drain(t, (p) => (p.kind === "choose_yes_no" ? { yes: false } : undefined));
    expect(t.obj(other).zone).toBe("hand");
    expect(t.obj(lib).zone).toBe("library");
  });
  it("with an empty hand nothing is discarded, so nothing is drawn", () => {
    const { t, lib, other, bear } = setup();
    t.p("p1").hand = t.p("p1").hand.filter((x) => x !== other); t.obj(other).zone = "graveyard"; t.p("p1").graveyard.push(other);
    t.ok({ type: "castSpell", player: "p1", cardId: bear });
    drain(t, (p) => (p.kind === "choose_yes_no" ? { yes: true } : undefined));
    expect(t.obj(lib).zone).toBe("library");
  });
});

describe("Leyline Tyrant: pay any amount of {R} when it dies, then choose the target", () => {
  const killIt = (t: ReturnType<typeof realTable>, ty: string) => {
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Kill It", "hand") });
    if (t.state.pending) t.ok({ type: "answerDecision", player: "p1", decisionId: t.state.pending.id, choice: { ids: [ty] } });
  };
  it("pays N red mana and deals N damage to the chosen target", () => {
    const t = realTable(["p1", "p2"], { "Kill It": kill });
    const ty = t.give("p1", "Leyline Tyrant", "battlefield");
    t.lands("p1", "Mountain", 3); t.give("p1", "Swamp", "battlefield");
    killIt(t, ty);
    const seen: string[] = [];
    drain(t, (p) => { seen.push(p.kind); return p.kind === "choose_number" ? { number: 2 } : p.kind === "choose_targets" ? { ids: ["p2"] } : undefined; });
    expect(seen).toContain("choose_number");
    expect(seen).toContain("choose_targets");
    expect(t.p("p2").life).toBe(38);
  });
  it("paying 0 deals no damage and asks no target", () => {
    const t = realTable(["p1", "p2"], { "Kill It": kill });
    const ty = t.give("p1", "Leyline Tyrant", "battlefield");
    t.lands("p1", "Mountain", 2); t.give("p1", "Swamp", "battlefield");
    killIt(t, ty);
    const seen: string[] = [];
    drain(t, (p) => { seen.push(p.kind); return p.kind === "choose_number" ? { number: 0 } : undefined; });
    expect(seen).not.toContain("choose_targets");
    expect(t.p("p2").life).toBe(40);
  });
});

describe("Nogi, Draco-Zealot: becomes a Dragon 5/5 with flying", () => {
  it("with three Dragons it replaces its creature types", () => {
    const t = realTable(["p1", "p2"], { D1: dragon("D1") });
    const n = ready(t, t.give("p1", "Nogi, Draco-Zealot", "battlefield"));
    for (let i = 0; i < 3; i++) t.give("p1", "D1", "battlefield");
    toAttackers(t); t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: n, defender: "p2" }] }); drain(t);
    const c = charsOf(t, n);
    expect(c.subtypes).toEqual(["Dragon"]);
    expect(c.types).toContain("creature");
    expect(c.power).toBe(5); expect(c.toughness).toBe(5);
    expect(c.keywords).toContain("flying");
  });
  it("with fewer than three Dragons nothing happens", () => {
    const t = realTable(["p1", "p2"], { D1: dragon("D1") });
    const n = ready(t, t.give("p1", "Nogi, Draco-Zealot", "battlefield"));
    t.give("p1", "D1", "battlefield");
    toAttackers(t); t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: n, defender: "p2" }] }); drain(t);
    expect(charsOf(t, n).subtypes).toContain("Kobold");
  });
});

describe("Sarkhan, Dragon Ascendant: behold a Dragon", () => {
  const cast = (inHand: boolean, yes: boolean) => {
    const t = realTable(["p1", "p2"], { "Hand Dragon": dragon("Hand Dragon") });
    t.lands("p1", "Mountain", 2);
    if (inHand) t.give("p1", "Hand Dragon", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Sarkhan, Dragon Ascendant", "hand") });
    drain(t, (p) => (p.kind === "choose_yes_no" ? { yes } : undefined));
    return { t };
  };
  const treasures = (t: ReturnType<typeof realTable>) => Object.values(t.state.objects).filter((o) => o.cardName === "Treasure" && o.zone === "battlefield").length;
  it("revealing a Dragon card from hand makes a Treasure", () => { const { t } = cast(true, true); expect(treasures(t)).toBe(1); });
  it("declining makes none", () => { const { t } = cast(true, false); expect(treasures(t)).toBe(0); });
  it("with no Dragon there is nothing to behold", () => { const { t } = cast(false, true); expect(treasures(t)).toBe(0); });
  it("a Dragon entering adds a counter and makes Sarkhan a flying Dragon", () => {
    const { t } = cast(false, true);
    const sk = Object.values(t.state.objects).find((o) => o.cardName === "Sarkhan, Dragon Ascendant")!;
    t.give("p1", "Mountain", "battlefield");
    const d = t.give("p1", "Hand Dragon", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: d }); drain(t);
    expect(t.obj(sk.id).counters["+1/+1"]).toBe(1);
    expect(charsOf(t, sk.id).subtypes).toContain("Dragon");
    expect(charsOf(t, sk.id).keywords).toContain("flying");
  });
});

describe("Spinerock Knoll: free play when an opponent was dealt 7 or more damage this turn", () => {
  const setup = (damage: number) => {
    const t = realTable(["p1", "p2"], { Cheap: filler("Cheap", ["creature"], 2, 2) });
    const k = t.give("p1", "Spinerock Knoll", "hand");
    t.give("p1", "Cheap", "library", { top: true });
    t.ok({ type: "playLand", player: "p1", cardId: k });
    drain(t, (p) => (p.kind === "choose_cards" ? { ids: [p.options[0].id] } : undefined));
    t.obj(k).tapped = false;
    if (damage) t.state.turnLog.push({ type: "damage_to_player", player: "p2", amount: damage, ts: 1 });
    t.give("p1", "Mountain", "battlefield");
    return { t, k };
  };
  const act = (t: ReturnType<typeof realTable>, k: string) => { const r = t.do({ type: "activateAbility", player: "p1", sourceId: k, abilityId: "a4" } as never); expect(r.error, r.error?.message).toBeUndefined(); drain(t, (p) => (p.kind === "choose_yes_no" ? { yes: true } : undefined)); };
  it("plays it with 7 damage", () => { const { t, k } = setup(7); act(t, k); expect(Object.values(t.state.objects).some((o) => o.cardName === "Cheap" && o.zone === "battlefield")).toBe(true); });
  it("does not with 6", () => { const { t, k } = setup(6); act(t, k); expect(Object.values(t.state.objects).some((o) => o.cardName === "Cheap" && o.zone === "battlefield")).toBe(false); });
});

describe("The Elder Dragon War: read ahead", () => {
  const cast = (chapter: number, extra?: (t: ReturnType<typeof realTable>) => void) => {
    const t = realTable(["p1", "p2"], { ...famCards });
    t.lands("p1", "Mountain", 4); extra?.(t);
    const s = t.give("p1", "The Elder Dragon War", "hand");
    t.ok({ type: "castSpell", player: "p1", cardId: s });
    drain(t, (p) => (p.kind === "choose_number" ? { number: chapter } : undefined));
    return { t, s };
  };
  it("starting at chapter III makes the Dragon and skips I and II", () => {
    const { t, s } = cast(3, (tt) => { tt.give("p2", "Fill A", "battlefield"); });
    expect(Object.values(t.state.objects).some((o) => o.cardName === "Dragon" && o.zone === "battlefield")).toBe(true);
    expect(t.p("p2").life).toBe(40);
    expect(t.obj(s).zone).toBe("graveyard"); // sacrificed after the last chapter
  });
  it("starting at chapter I deals 2 to each creature and each opponent", () => {
    const { t, s } = cast(1, (tt) => { tt.give("p2", "Fill A", "battlefield"); });
    expect(t.p("p2").life).toBe(38);
    expect(Object.values(t.state.objects).filter((o) => o.cardName === "Fill A" && o.zone === "battlefield").length).toBe(0);
    expect(t.obj(s).zone).toBe("battlefield");
    expect(t.obj(s).counters.lore).toBe(1);
  });
});

describe("Tyrant's Familiar: lieutenant", () => {
  it("with your commander: +2/+2 and attacks deal 7 damage to a creature defending player controls", () => {
    const t = realTable(["p1", "p2"], { ...famCards, Victim: filler("Victim", ["creature"], 1, 1) });
    const f = ready(t, t.give("p1", "Tyrant's Familiar", "battlefield"));
    const base = charsOf(t, f).power!;
    const cmd = t.give("p1", "Fill A", "battlefield"); t.obj(cmd).isCommander = true;
    expect(charsOf(t, f).power).toBe(base + 2);
    const v = t.give("p2", "Victim", "battlefield");
    toAttackers(t); t.ok({ type: "declareAttackers", player: "p1", attackers: [{ id: f, defender: "p2" }] }); drain(t, (p) => (p.kind === "choose_targets" ? { ids: [v] } : undefined));
    expect(t.obj(v).zone).toBe("graveyard");
  });
});
