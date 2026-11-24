// Controller-level tests of phase 5: click-to-pick on the board (the real targeted spell Go for the Throat), the shared selection state, the list fallback,
// castable hand-card hints, and the decision dialog's markup for pick / order / split.
import { payIfAsked } from "./kernelPaymentKit";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { buildPack } from "@/kernel/integration/nodePack";
import { packKit } from "@/kernel/integration/cardPack";
import { KernelGameController } from "./kernelController";
import { KernelDecisionDialog } from "@/components/KernelDecisionDialog";

const pack = JSON.parse(JSON.stringify(buildPack("wretched-ranks", { catalog: false })));
const kit = packKit([pack]);

function scripted() {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  t.give("p1", "Swamp", "hand"); t.give("p1", "Swamp", "battlefield"); t.give("p1", "Swamp", "battlefield");
  for (let i = 0; i < 8; i++) { t.give("p1", "Swamp", "library"); t.give("p2", "Swamp", "library"); }
  t.give("p1", "Go for the Throat", "hand");
  t.give("p1", "Gravecrawler", "battlefield");
  const victim = t.give("p2", "Undead Augur", "battlefield");
  const ks = KernelSession.fromState(t.state, { ctx, display: kit.display, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } });
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  const hand = (name: string) => ks.state.players[0].hand.find((id) => ks.state.objects[id].cardName === name)!;
  return { ks, c, victim, land: hand("Swamp"), spell: hand("Go for the Throat") };
}

describe("castable hand cards", () => {
  it("glows the spell and the land the kernel lists, and says nothing when the human cannot act", () => {
    const { c, land, spell } = scripted();
    const h = c.handHints();
    expect(h.castable).toContain(spell);
    expect(h.castable).toContain(land);
    c.playCard("p1", spell); // opens the target question: no priority to act with
    expect(c.handHints().castable).toEqual([]);
  });
  it("explains a card that is not castable (no land drop left)", () => {
    const { c, land } = scripted();
    c.playCard("p1", land);
    expect(c.handHints().castable).not.toContain(land);
  });
});

describe("click targets on the board", () => {
  it("offers the legal targets, toggles them, gates Confirm, and answers with the kernel's option id", () => {
    const { ks, c, victim, spell } = scripted();
    c.playCard("p1", spell);
    const d = c.table().decision!;
    const bp = c.boardPick()!;
    expect(bp).toBeDefined();
    // exactly the permanents the kernel listed
    const listed = ks.state.pending!.options.map((o) => o.id);
    expect(bp.legalCardIds.length + bp.legalSeatIds.length).toBe(listed.length);
    expect(bp.legalCardIds).toContain(victim);
    expect(bp.canConfirm).toBe(false);
    expect(bp.onCancel).toBeDefined(); // casting is cancellable
    expect(c.confirmPick(d.id)).toBe(false); // nothing picked: refused locally, nothing sent

    bp.onToggleCard(victim);
    const bp2 = c.boardPick()!;
    expect(bp2.selectedCardIds).toEqual([victim]);
    expect(bp2.canConfirm).toBe(true);
    bp2.onToggleCard(victim); // toggles off
    expect(c.boardPick()!.selectedCardIds).toEqual([]);
    bp2.onToggleCard("not-an-option"); // an id the kernel did not list is ignored
    expect(c.boardPick()!.selectedCardIds).toEqual([]);

    c.boardPick()!.onToggleCard(victim);
    c.boardPick()!.onConfirm();
    payIfAsked(c);
    expect(c.table().decision).toBeUndefined();
    expect(ks.state.stack).toHaveLength(1);
    expect(ks.state.stack[0].parts[0].targets).toBeDefined();
    expect(c.boardPick()).toBeUndefined();
  });

  it("falls back to the list on request and back, keeping one selection", () => {
    const { c, victim, spell } = scripted();
    c.playCard("p1", spell);
    const d = c.table().decision!;
    c.boardPick()!.onToggleCard(victim);
    c.boardPick()!.onList!();
    expect(c.boardPick()).toBeUndefined(); // dialog takes over
    c.showList(d.id, false);
    expect(c.boardPick()!.selectedCardIds).toEqual([victim]);
  });

  it("cancel answers the kernel and a new decision starts with a clean selection", () => {
    const { ks, c, victim, spell } = scripted();
    c.playCard("p1", spell);
    c.boardPick()!.onToggleCard(victim);
    c.boardPick()!.onCancel!();
    expect(ks.state.pending).toBeFalsy();
    c.playCard("p1", spell);
    expect(c.boardPick()!.selectedCardIds).toEqual([]);
  });
});

describe("dialog markup per decision type", () => {
  const base = { id: "d", kind: "choose_cards" as const, player: "p1", title: "Discard a card", instruction: "Pick one", options: [{ id: "#1", label: "Swamp" }, { id: "#2", label: "Island" }], min: 1, max: 1, cancellable: false, source: { card: "Mind Rot" } };
  const render = (d: object, extra: object = {}) => renderToStaticMarkup(createElement(KernelDecisionDialog, { decision: { ...base, ...d } as never, onAnswer: () => undefined, ...extra }));
  it("pick: shows the source card, options, hint and a disabled Confirm until enough are picked", () => {
    const html = render({});
    expect(html).toContain("Mind Rot");
    expect(html).toContain("Swamp");
    expect(html).toContain("Selected 0 (choose 1)");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Confirm/);
    expect(html).not.toContain("Cancel");
  });
  it("up-to pick offers None; a cancellable decision offers Cancel; board decisions offer the way back", () => {
    const html = render({ min: 0, max: 2, cancellable: true }, { onBoard: () => undefined });
    expect(html).toContain("None");
    expect(html).toContain("Cancel");
    expect(html).toContain("Pick on the board");
    expect(html).toContain("up to 2");
  });
  it("search with many options gets a filter", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `#${i}`, label: `Card ${i}` }));
    expect(render({ options: many, min: 0, max: 1 })).toContain("Filter by name");
  });
  it("X shows the affordable maximum; pay_unless says Pay / Don't pay; ordering has up / down", () => {
    expect(render({ kind: "choose_x", numeric: true, min: 0, max: 3 })).toContain("the most you can afford");
    const pay = render({ kind: "pay_unless", title: "Pay {2}?" });
    expect(pay).toContain("Don&#x27;t pay");
    expect(render({ kind: "order_triggers", min: 2, max: 2 })).toContain("move Swamp down");
    expect(render({ kind: "order_replacements", min: 1, max: 1 })).toContain("Make first");
  });
  it("damage split starts on the lethal assignment", () => {
    const html = render({ kind: "assign_damage", amounts: { total: 4, lethal: { "#1": 2, "#2": 2 }, trample: false } });
    expect(html).toContain("Assigned 4 of 4");
    expect(html).toContain("lethal 2");
  });
});
