// Variable-colour mana sources (Command Tower, Arcane Signet, Thriving lands, Talismans, ...) in the player-chosen payment flow, with the real Aminatou packs:
// clicking them while a payment is open must not ask "say which color", the suggestion (auto-pay) must handle them, several at once must cover W + U + B.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "./kernelController";

function game(opts: { casts?: number; battlefield: string[] }) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 4; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
  const cmd = t.give("p1", "Aminatou, the Fateshifter", "battlefield");
  t.state.objects[cmd].isCommander = true; t.state.objects[cmd].zone = "command";
  t.state.battlefield = t.state.battlefield.filter((i) => i !== cmd); t.state.players[0].command.push(cmd); t.state.players[0].commanderCasts[cmd] = opts.casts ?? 0;
  t.state.players[0].colorIdentity = ["W", "U", "B"] as never;
  const src = opts.battlefield.map((n) => t.give("p1", n, "battlefield"));
  const ks = KernelSession.fromState(t.state, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } } as never);
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0 });
  return { ks, c, cmd, src };
}
const notes = (c: KernelGameController): string[] => c.table().session.events.map((e) => e.message);

describe("any-colour sources while paying (Aminatou, W U B)", () => {
  it("clicking Command Tower in the banner picks the colour the cost still needs", () => {
    const { ks, c, src } = game({ battlefield: ["Command Tower", "Island", "Swamp"] });
    c.castCommander("p1");
    c.boardPick()!.onToggleCard(src[1]); c.boardPick()!.onToggleCard(src[2]);
    c.boardPick()!.onToggleCard(src[0]); // {W} is what is missing
    expect(notes(c).join("|")).not.toContain("say which color");
    expect(ks.state.pending).toBeNull();
    expect(ks.state.stack).toHaveLength(1);
  });
  it("three Command Towers: W, U and B (never the same colour three times)", () => {
    const { ks, c, src } = game({ battlefield: ["Command Tower", "Command Tower", "Command Tower"] });
    c.castCommander("p1");
    for (const s of src) c.boardPick()?.onToggleCard(s);
    expect(ks.state.stack).toHaveLength(1);
  });
  it("commander tax: generic + coloured, two Towers + Signet + two basics", () => {
    const { ks, c, src } = game({ casts: 1, battlefield: ["Command Tower", "Arcane Signet", "Command Tower", "Plains", "Island"] });
    c.castCommander("p1");
    expect(c.boardPick()!.instruction).toContain("{2}{W}{U}{B}");
    for (const s of src) c.boardPick()?.onToggleCard(s);
    expect(notes(c).join("|")).not.toContain("say which color");
    expect(ks.state.pending).toBeNull();
    expect(ks.state.stack).toHaveLength(1);
  });
  it("auto-pay (suggest) with a Command Tower that is needed", () => {
    const { ks, c } = game({ battlefield: ["Command Tower", "Island", "Swamp"] });
    c.castCommander("p1");
    c.boardPick()!.onConfirm();
    c.boardPick()!.onConfirm();
    expect(ks.state.pending).toBeNull();
    expect(ks.state.stack).toHaveLength(1);
  });
  it("auto-pay (suggest) with the colour choice already made beforehand (Tower tapped for W)", () => {
    const { ks, c, src } = game({ battlefield: ["Command Tower", "Island", "Swamp"] });
    c.tapForMana("p1", src[0]); // asks the colour
    expect(ks.state.pending?.kind).toBe("choose_color");
    ks.dispatch("p1", { type: "answerDecision", player: "p1", decisionId: ks.state.pending!.id, choice: { ids: ["W"] } });
    c.castCommander("p1");
    c.boardPick()!.onConfirm(); c.boardPick()?.onConfirm();
    expect(ks.state.stack).toHaveLength(1);
  });
});

/** every drafted card (all decks) that has a mana ability: it must be usable while paying (or refuse for its own, stated reason) and never fail with "say which color" */
function draftedManaSources(): string[] {
  const out = new Set<string>();
  const root = "data/kernel-drafts";
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    const idx = `${root}/${d.name}/_index.json`;
    if (!d.isDirectory() || !fs.existsSync(idx)) continue;
    for (const c of JSON.parse(fs.readFileSync(idx, "utf8")).cards as Array<{ slug: string; name: string }>) {
      const f = `${root}/${d.name}/${c.slug}.json`;
      if (!fs.existsSync(f)) continue;
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      if ((j.abilities ?? []).some((a: { kind: string; costs?: unknown[] }) => a.kind === "mana" && !JSON.stringify(a.costs ?? []).match(/mana|tapOther/))) out.add(c.name);
    }
  }
  return [...out].sort();
}

describe("sweep: every drafted mana source in the payment banner", () => {
  const names = draftedManaSources();
  it("finds the sources", () => { expect(names).toContain("Command Tower"); expect(names).toContain("Thriving Heath"); });
  it.each(names)("%s", (name) => {
    const def = ctx.cards(name);
    if (!def) return;
    const { ks, c, src } = game({ casts: 1, battlefield: [name, "Plains", "Island", "Swamp", "Island"] });
    c.castCommander("p1");
    if (ks.state.pending?.kind !== "pay_mana") return; // refused at once (cannot pay): fine
    c.boardPick()!.onToggleCard(src[0]);
    for (const m of notes(c)) expect(m, name).not.toContain("say which color");
    // and the suggestion path
    const g = game({ casts: 1, battlefield: [name, "Plains", "Island", "Swamp", "Island"] });
    g.c.castCommander("p1");
    if (g.ks.state.pending?.kind !== "pay_mana") return;
    g.c.boardPick()!.onConfirm();
    g.c.boardPick()?.onConfirm();
    for (const m of notes(g.c)) expect(m, name).not.toContain("say which color");
  });
});
