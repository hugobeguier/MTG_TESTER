import { readFileSync } from "node:fs";
// Rooms in kernel mode (CR 709.5): the door that is CAST is unlocked, the other stays locked; the unlock special action names, charges and unlocks the door it says;
// the view sent to the table (unlockedFaceIndices) and the padlock overlay agree with the door names; a Room that enters any other way has both doors locked.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "./kernelController";
import { roomDoorViews } from "@/lib/roomDoors";
import { paymentOf } from "./kernelPayment";
import { debugPlaceCard } from "@/kernel/engine/setup";
import { dl } from "@/kernel/integration/testgame";
import { buildPack } from "@/kernel/integration/nodePack";
import { packKit } from "@/kernel/integration/cardPack";

// the real pack display (faces with their names, costs and type lines) is what the table renders from
const kit = packKit([JSON.parse(readFileSync("public/kernel-packs/aminatou.json", "utf8"))]);
const S = { ctx: { cards: kit.lookup, db: kit.db }, display: kit.display, seats: { p1: { kind: "human" as const }, p2: { kind: "agent" as const } } };

function game(o: { hand?: string[]; board?: string[]; graveyard?: string[]; lands: number }) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 6; i++) { t.give("p1", "Plains", "library"); t.give("p2", "Plains", "library"); }
  for (let i = 0; i < o.lands; i++) t.give("p1", "Plains", "battlefield");
  const hand = (o.hand ?? []).map((n) => t.give("p1", n, "hand"));
  const board = (o.board ?? []).map((n) => t.give("p1", n, "battlefield"));
  const grave = (o.graveyard ?? []).map((n) => t.give("p1", n, "graveyard"));
  const ks = KernelSession.fromState(t.state, S);
  ks.state.config.manualPay = ["p1"];
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  return { ks, c, hand, board, grave };
}
const room = (c: KernelGameController) => c.table().session.seats.find((s) => s.id === "p1")!.board.battlefield.find((x) => /Arcade|Parlor/.test(x.name) || x.faces?.some((f) => /Arcade/.test(f.name)))!;
const doors = (c: KernelGameController) => roomDoorViews(room(c))!.map((d) => `${d.name}:${d.locked ? "locked" : "open"}`);
const pay = (c: KernelGameController) => { for (let i = 0; i < 3 && c.paying(); i++) c.boardPick()?.onConfirm(); };

describe("Secret Arcade // Dusty Parlor", () => {
  it("(a) cast Dusty Parlor from hand: the Parlor door is unlocked and the Arcade door locked; the table agrees", () => {
    const { ks, c, hand } = game({ hand: ["Secret Arcade"], lands: 3 });
    const act = c.cardActions(hand[0]).concat([]);
    c.playCardFace("p1", hand[0], 1);
    pay(c);
    for (let i = 0; i < 4 && ks.state.stack.length; i++) { c.passPriority(); for (let k = 0; k < 20 && c.needsStep(); k++) c.step(); }
    expect(ks.state.battlefield.map((id) => ks.state.objects[id].unlocked)).toContainEqual(["Dusty Parlor"]);
    expect(doors(c)).toEqual(["Secret Arcade:locked", "Dusty Parlor:open"]);
    void act;
  });
  it("(a) cast Secret Arcade from hand: the Arcade door is unlocked, the Parlor locked", () => {
    const { ks, c, hand } = game({ hand: ["Secret Arcade"], lands: 5 });
    c.playCardFace("p1", hand[0], 0);
    pay(c);
    for (let i = 0; i < 4 && ks.state.stack.length; i++) { c.passPriority(); for (let k = 0; k < 20 && c.needsStep(); k++) c.step(); }
    expect(doors(c)).toEqual(["Secret Arcade:open", "Dusty Parlor:locked"]);
  });
  it("(b) the unlock action for the other door names it, charges ITS cost and unlocks THAT door", () => {
    const t = mini(["p1", "p2"], { phase: "precombat_main" });
    for (let i = 0; i < 5; i++) t.give("p1", "Plains", "battlefield");
    const id = t.give("p1", "Secret Arcade", "battlefield");
    t.state.objects[id].unlocked = ["Dusty Parlor"];
    const ks = KernelSession.fromState(t.state, S);
    ks.state.config.manualPay = ["p1"];
    const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
    expect(doors(c)).toEqual(["Secret Arcade:locked", "Dusty Parlor:open"]);
    const acts = c.cardActions(c.table().session.seats[0].board.battlefield.find((x) => x.name !== "Plains")!.id);
    const unlock = acts.filter((a) => /^Unlock the/.test(a.label));
    expect(unlock.map((a) => a.label)).toEqual(["Unlock the Secret Arcade door of Secret Arcade ({4}{W})"]);
    expect(c.doOption(unlock[0].id)).toBe(true);
    const model = paymentOf(ks.state, "p1");
    expect(model?.title).toMatch(/Secret Arcade door/);
    expect(model?.instruction ?? "").toMatch(/\{4\}\{W\}|4.*W|5/);
    pay(c);
    expect(ks.state.objects[id].unlocked?.sort()).toEqual(["Dusty Parlor", "Secret Arcade"]);
    expect(ks.state.battlefield.filter((b) => ks.state.objects[b].tapped)).toHaveLength(5);
    expect(doors(c)).toEqual(["Secret Arcade:open", "Dusty Parlor:open"]);
  });
  it("(b) unlocking the Dusty Parlor door when only the Arcade is open charges {2}{W}", () => {
    const t = mini(["p1", "p2"], { phase: "precombat_main" });
    for (let i = 0; i < 3; i++) t.give("p1", "Plains", "battlefield");
    const id = t.give("p1", "Secret Arcade", "battlefield");
    t.state.objects[id].unlocked = ["Secret Arcade"];
    const ks = KernelSession.fromState(t.state, S);
    ks.state.config.manualPay = ["p1"];
    const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
    const unlock = c.cardActions(c.table().session.seats[0].board.battlefield.find((x) => x.name !== "Plains")!.id).filter((a) => /^Unlock the/.test(a.label));
    expect(unlock.map((a) => a.label)).toEqual(["Unlock the Dusty Parlor door of Secret Arcade ({2}{W})"]);
    c.doOption(unlock[0].id); pay(c);
    expect(ks.state.objects[id].unlocked?.sort()).toEqual(["Dusty Parlor", "Secret Arcade"]);
  });
  it("(c) a Room that enters from the graveyard has both doors locked", () => {
    const t = mini(["p1", "p2"], { phase: "precombat_main" });
    const g = t.give("p1", "Secret Arcade", "graveyard");
    // enter the battlefield by a non-cast route
    const st = debugPlaceCard(t.state, dl.lookup, "p1", "Secret Arcade", "battlefield").state;
    void g;
    const ks = KernelSession.fromState(st, S);
    const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
    expect(doors(c)).toEqual(["Secret Arcade:locked", "Dusty Parlor:locked"]);
  });
});

describe("casting a Room with plenty of mana (both halves affordable)", () => {
  it("the Dusty Parlor button charges {2}{W} (3 lands tapped) and unlocks the Parlor door", () => {
    const { ks, c, hand } = game({ hand: ["Secret Arcade"], lands: 7 });
    c.playCardFace("p1", hand[0], 1);
    const m = paymentOf(ks.state, "p1");
    expect(m?.title ?? "").toMatch(/Dusty Parlor/);
    pay(c);
    expect(ks.state.battlefield.filter((id) => ks.state.objects[id].tapped)).toHaveLength(3);
    for (let i = 0; i < 4 && ks.state.stack.length; i++) { c.passPriority(); for (let k = 0; k < 20 && c.needsStep(); k++) c.step(); }
    expect(doors(c)).toEqual(["Secret Arcade:locked", "Dusty Parlor:open"]);
  });
  it("the plain cast button does not silently pick a half; the card actions list both halves", () => {
    const { ks, c, hand } = game({ hand: ["Secret Arcade"], lands: 7 });
    c.playCard("p1", hand[0]);
    const m = paymentOf(ks.state, "p1");
    expect(m).toBeUndefined();
    expect(ks.state.pending).toBeNull();
    expect(c.cardActions(hand[0]).map((a) => a.label)).toEqual(expect.arrayContaining(["Cast Secret Arcade", "Cast Dusty Parlor"]));
  });
});
