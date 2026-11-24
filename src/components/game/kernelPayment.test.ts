// Kernel mode, paying by hand: the payment banner (the board-pick banner) for the exact Aminatou case, Auto-pay (suggest) as a two-step confirmation that never
// sacrifices a Treasure, cancel, and a taxed attack declaration.
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { PREDEFINED_TOKEN_ABILITIES } from "@/kernel/engine/steps";
import { KernelGameController } from "./kernelController";

function aminatouGame(opts: { casts?: number; lands?: string[]; treasure?: boolean } = {}) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 4; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
  const cmd = t.give("p1", "Aminatou, the Fateshifter", "battlefield");
  t.state.objects[cmd].isCommander = true; t.state.objects[cmd].zone = "command";
  t.state.battlefield = t.state.battlefield.filter((i) => i !== cmd); t.state.players[0].command.push(cmd); t.state.players[0].commanderCasts[cmd] = opts.casts ?? 1;
  let treasure: string | undefined;
  if (opts.treasure !== false) {
    treasure = t.give("p1", "Sol Ring", "battlefield");
    t.state.objects[treasure].token = { name: "Treasure", types: ["artifact"], subtypes: ["Treasure"], colors: [], keywords: [], abilities: [PREDEFINED_TOKEN_ABILITIES.Treasure] } as never;
  }
  const lands = (opts.lands ?? ["Plains", "Island", "Swamp", "Island", "Swamp"]).map((n) => t.give("p1", n, "battlefield"));
  const ks = KernelSession.fromState(t.state, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } } as never);
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  return { ks, c, cmd, treasure, lands };
}

describe("the payment banner: Aminatou with commander tax", () => {
  it("base cost tapped by hand, the tax unpaid: a banner (no dialog), the Treasure untouched", () => {
    const { ks, c, cmd, treasure, lands } = aminatouGame();
    for (const l of lands.slice(0, 3)) c.tapForMana("p1", l);
    c.castCommander("p1");
    expect(ks.state.pending?.kind).toBe("pay_mana");
    expect(c.table().decision).toBeUndefined(); // not a modal
    const pick = c.boardPick()!;
    expect(pick.title).toBe("Cast Aminatou, the Fateshifter");
    expect(pick.instruction).toContain("{2}{W}{U}{B}");
    expect(pick.instruction).toContain("commander tax {2}");
    expect(pick.instruction).toContain("{2} more needed");
    expect(pick.legalCardIds).toEqual(expect.arrayContaining([lands[3], lands[4]]));
    expect(ks.state.objects[treasure!]?.zone).toBe("battlefield");
    expect(ks.state.objects[cmd].zone).not.toBe("battlefield");
    expect(c.paying()).toBe(true);
  });
  it("clicking two glowing lands pays the tax; the cast completes by itself", () => {
    const { ks, c, treasure, lands } = aminatouGame();
    for (const l of lands.slice(0, 3)) c.tapForMana("p1", l);
    c.castCommander("p1");
    c.boardPick()!.onToggleCard(lands[3]);
    expect(ks.state.pending?.kind).toBe("pay_mana");
    expect(c.boardPick()!.instruction).toContain("{1} more needed");
    c.boardPick()!.onToggleCard(lands[4]);
    expect(ks.state.pending).toBeNull();
    expect(ks.state.stack).toHaveLength(1);
    expect(ks.state.objects[treasure!]?.zone).toBe("battlefield");
    expect(c.paying()).toBe(false);
  });
  it("Auto-pay (suggest): the first press only shows the suggestion (no Treasure), the second taps exactly it", () => {
    const { ks, c, treasure, lands } = aminatouGame();
    c.castCommander("p1"); // nothing tapped by hand: {2}{W}{U}{B} = 5 mana
    const p0 = c.boardPick()!;
    expect(p0.confirmLabel).toBe("Auto-pay (suggest)");
    p0.onConfirm();
    expect(ks.state.pending?.kind).toBe("pay_mana"); // nothing was tapped yet
    expect(lands.some((l) => ks.state.objects[l].tapped)).toBe(false);
    const p1 = c.boardPick()!;
    expect(p1.selectedCardIds.slice().sort()).toEqual(lands.slice().sort());
    expect(p1.selectedCardIds).not.toContain(treasure);
    expect(p1.confirmLabel).toContain("Tap the suggested sources (5)");
    p1.onConfirm();
    expect(ks.state.pending).toBeNull();
    expect(ks.state.stack).toHaveLength(1);
    expect(ks.state.objects[treasure!]?.zone).toBe("battlefield");
  });
  it("with too little mana and only a Treasure: no suggestion, the Treasure is still not used", () => {
    const { ks, c, treasure, cmd } = aminatouGame({ lands: ["Plains", "Island"] });
    c.castCommander("p1");
    expect(ks.state.pending).toBeNull(); // 3 mana at most for a 5-mana cost: refused at once with the reason, nothing happened
    expect(ks.state.objects[cmd].zone).toBe("command");
    expect(ks.state.objects[treasure!]?.zone).toBe("battlefield");
    expect(c.table().session.events[0].message).toContain("cannot pay");
  });
  it("Cancel returns the commander and leaves the pool alone", () => {
    const { ks, c, cmd, lands } = aminatouGame();
    for (const l of lands.slice(0, 3)) c.tapForMana("p1", l);
    c.castCommander("p1");
    c.boardPick()!.onCancel!();
    expect(ks.state.pending).toBeNull();
    expect(ks.state.objects[cmd].zone).toBe("command");
    expect(ks.state.players[0].manaPool).toMatchObject({ W: 1, U: 1, B: 1 });
    expect(c.boardPick()).toBeUndefined();
  });
  it("taking a tap back while paying: clicking a tapped, unspent source untaps it", () => {
    const { ks, c, lands } = aminatouGame();
    for (const l of lands.slice(0, 3)) c.tapForMana("p1", l);
    c.castCommander("p1");
    c.boardPick()!.onToggleCard(lands[3]);
    c.boardPick()!.onToggleCard(lands[3]);
    expect(ks.state.objects[lands[3]].tapped).toBeFalsy();
    expect(c.boardPick()!.instruction).toContain("{2} more needed");
  });
});
