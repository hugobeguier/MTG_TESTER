// SWEEP over every drafted card (data/kernel-drafts/**): an activated, non-loyalty, non-mana ability that has NO timing restriction is instant speed. For each one
// the kernel's offer must not depend on the window: whatever is offered in the owner's precombat main phase (empty stack) is offered, identically, in the owner's
// beginning of combat, the opponent's upkeep and with an opposing spell on the stack, and the controller's activation path (inspector button / glowing source click)
// must act on each offered ability instead of refusing it. Also: ability text that says "Activate only ..." must carry a timing restriction in the draft.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ctx, mini } from "@/kernel/integration/testgame";
import { KernelSession } from "@/kernel/integration/kernelSession";
import { KernelGameController } from "./kernelController";
import { DEFAULT_STOP_SETTINGS } from "@/lib/priorityStops";
import type { PlayerId } from "@/kernel/engine/types";
import type { Ability } from "@/kernel/schema";

const root = path.resolve(process.cwd(), "data/kernel-drafts");
const names = new Set<string>();
for (const d of fs.readdirSync(root, { withFileTypes: true })) {
  const ix = path.join(root, d.name, "_index.json");
  if (d.isDirectory() && fs.existsSync(ix)) for (const e of JSON.parse(fs.readFileSync(ix, "utf8")).cards as Array<{ name: string }>) names.add(e.name);
}
const abilitiesOf = (n: string): Ability[] => ((ctx.cards(n) as unknown as { kernel?: { abilities?: Ability[] } } | undefined)?.kernel?.abilities ?? []);
const isLoyalty = (a: Ability) => (a.costs ?? []).some((c) => "loyalty" in c);
// Equip is sorcery speed by rule (CR 702.6a); an Aura dropped on the battlefield unattached is put into the graveyard by state-based actions at once, so its abilities cannot be compared
const unrestricted = (a: Ability) => a.kind === "activated" && !/^Equip\b/.test(a.text) && !isLoyalty(a) && (a.zone === undefined || a.zone === "battlefield") && (!a.timing || ((!a.timing.speed || a.timing.speed === "instant" || a.timing.speed === "default") && !a.timing.only?.length && !a.timing.window));
const isAura = (n: string) => !!(ctx.cards(n)?.subtypes ?? []).includes("Aura");
const subjects = [...names].filter((n) => !isAura(n) && abilitiesOf(n).some(unrestricted)).sort();

type Win = { active: PlayerId; phase: string; spell?: boolean };
const WINDOWS: Record<string, Win> = {
  main: { active: "p1", phase: "precombat_main" },
  ownCombat: { active: "p1", phase: "beginning_of_combat" },
  oppUpkeep: { active: "p2", phase: "upkeep" },
  response: { active: "p2", phase: "precombat_main", spell: true }
};

function build(name: string, w: Win) {
  const t = mini(["p1", "p2"], { phase: "precombat_main" });
  for (let i = 0; i < 4; i++) { t.give("p1", "Island", "library"); t.give("p2", "Island", "library"); }
  const card = t.give("p1", name, "battlefield");
  for (const l of ["Plains", "Island", "Swamp", "Mountain", "Forest"]) for (let i = 0; i < 2; i++) t.give("p1", l, "battlefield");
  t.give("p1", "Grizzly Bears", "battlefield"); t.give("p2", "Grizzly Bears", "battlefield");
  t.give("p1", "Grizzly Bears", "graveyard"); t.give("p1", "Lightning Bolt", "hand");
  const bolt = w.spell ? t.give("p2", "Lightning Bolt", "hand") : undefined;
  if (bolt) t.give("p2", "Mountain", "battlefield");
  t.state = { ...t.state, turn: { ...t.state.turn, active: w.active, phase: w.phase as never }, priority: bolt ? "p2" : "p1", passes: [] };
  const ks = KernelSession.fromState(t.state, { ctx, display: (() => undefined) as never, seats: { p1: { kind: "human" }, p2: { kind: "agent" } } } as never);
  if (bolt) {
    const cast = ks.legal("p2").find((a) => a.kind === "castSpell" && a.objectId === bolt && a.action);
    if (cast?.action) { ks.dispatch("p2", cast.action); const p = ks.state.pending as never as { id: string; options?: Array<{ id: string }> } | null; if (p) ks.dispatch("p2", { type: "answerDecision", player: "p2", decisionId: p.id, choice: { ids: [p.options?.[0]?.id ?? "p1"] } } as never); }
    ks.state.priority = "p1"; ks.state.passes = [];
  }
  const c = new KernelGameController(ks, { human: "p1", pace: () => 0, stops: DEFAULT_STOP_SETTINGS });
  return { ks, c, card };
}
const offered = (ks: KernelSession, card: string) => ks.legal("p1").filter((a) => a.kind === "activateAbility" && a.objectId === card && !a.isMana && a.action && !/: Equip\b/.test(a.label)).map((a) => a.label).sort();

describe("instant-speed sweep over all drafted activated abilities", () => {
  it("has a meaningful subject list", () => { expect(subjects.length).toBeGreaterThan(100); });
  it("no 'Activate only ...' ability text is missing its timing restriction", () => {
    const bad: string[] = [];
    for (const n of names) for (const a of abilitiesOf(n)) if (a.kind === "activated" && /\bactivate (this ability )?only\b/i.test(a.text) && !a.timing) bad.push(`${n}: ${a.text.slice(0, 80)}`);
    expect(bad).toEqual([]);
  });
  it("what is offered in the main phase is offered in every other window, and the controller activates it", () => {
    const problems: string[] = []; let withOffer = 0;
    for (const name of subjects) {
      const base = build(name, WINDOWS.main);
      const ref = offered(base.ks, base.card);
      if (ref.length) withOffer++;
      for (const [wn, w] of Object.entries(WINDOWS)) {
        if (wn === "main") continue;
        let g: ReturnType<typeof build>;
        try { g = build(name, w); } catch (e) { problems.push(`${name} @${wn}: setup failed ${(e as Error).message}`); continue; }
        const got = offered(g.ks, g.card);
        const missing = ref.filter((l) => !got.includes(l));
        if (missing.length) problems.push(`${name} @${wn}: not offered: ${missing.join(" | ").slice(0, 100)}`);
        if (got.length && g.ks.state.priority === "p1") {
          const v0 = g.ks.version;
          g.c.activateAbility("p1", g.card, 0);
          if (g.ks.version === v0 && !g.ks.state.pending) problems.push(`${name} @${wn}: controller refused an offered ability`);
        }
      }
    }
    expect(withOffer).toBeGreaterThan(50);
    expect(problems).toEqual([]);
  }, 300000);
});
