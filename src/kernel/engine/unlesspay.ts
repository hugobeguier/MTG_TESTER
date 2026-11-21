// `unlessPay` on any step: "<step> unless <payer> pays <cost>" (Mana Tithe, Esper Sentinel, Mystic Remora...). A payer who cannot pay is not
// asked; one who can is asked yes/no (auto-tapping their mana sources) and the step is skipped when they pay. Costs supported: mana
// (with {X} from `unlessPay.x`) and life. Imported by steps.ts.

import type { Cost, Prompt, Step } from "../schema";
import { label, parseManaCost, player, Reject, type Run } from "./core";
import { evalQuantity, resolvePlayers } from "./query";
import { costCandidates, costCount, costOptions, payChoiceCost, type ChoiceCost } from "./costs";
import { autoTapFor, payFromPool, totalPotentialMana } from "./mana";
import { changeLife, decide, type AskSpec, type StepResult } from "./steps";
import type { Choice, Env, PlayerId } from "./types";

export interface UnlessPay { payer: string; cost: Cost[]; x?: unknown; prompt?: Prompt }

export function unlessPaySupported(u: UnlessPay): boolean {
  return u.cost.length > 0 && u.cost.every((c) => ("mana" in c && !/[\/P]/.test(c.mana.replace(/\{X\}/g, ""))) || ("life" in c && typeof c.life === "number") || ("discard" in c && c.discard !== "self"));
}

function manaNeeded(r: Run, u: UnlessPay, env: Env): { cost: ReturnType<typeof parseManaCost>; x: number } {
  const x = u.x === undefined ? 0 : evalQuantity(r, u.x as never, env);
  const total = parseManaCost("");
  for (const c of u.cost) if ("mana" in c) {
    const p = parseManaCost(c.mana);
    total.generic += p.generic; total.mv += p.mv; total.x += p.x;
    for (const [k, n] of Object.entries(p.colored)) total.colored[k] = (total.colored[k] ?? 0) + n;
  }
  return { cost: total, x };
}

function lifeNeeded(u: UnlessPay): number { return u.cost.reduce((n, c) => n + ("life" in c ? Number(c.life) : 0), 0); }

const discardCost = (u: UnlessPay): Extract<Cost, { discard: unknown }> | undefined => u.cost.find((c): c is Extract<Cost, { discard: unknown }> => "discard" in c);

function canPay(r: Run, payer: PlayerId, u: UnlessPay, env: Env): boolean {
  const dc = discardCost(u);
  if (dc && costCandidates(r, dc as ChoiceCost, { player: payer, source: env.source }).length < costCount(r, dc as ChoiceCost, { player: payer, source: env.source })) return false;
  const { cost, x } = manaNeeded(r, u, env);
  if (cost.mv + cost.x * x > totalPotentialMana(r, payer)) return false;
  return player(r, payer).life >= lifeNeeded(u);
}

export function unlessHandler(r: Run, env: Env, step: Step, answer: Choice | undefined): StepResult {
  const u = step.pay as UnlessPay;
  const inner = step.inner as Step;
  const payer = resolvePlayers(r, u.payer as never, env)[0];
  if (!payer || !canPay(r, payer, u, env)) return { push: [inner] };
  const spec: AskSpec = {
    kind: "pay_unless", player: payer,
    prompt: u.prompt ?? { title: `${label(r, env.source)}: pay or not`, instruction: "Do you want to pay? If you don't, the effect happens." },
    options: [{ id: "yes", label: "Pay" }, { id: "no", label: "Don't pay" }], min: 1, max: 1
  };
  const d = decide(spec, answer);
  if ("ask" in d) return d;
  if (!d.yes) return { push: [inner] };
  const { cost, x } = manaNeeded(r, u, env);
  if (cost.mv + cost.x * x > 0 || cost.x > 0) {
    if (!(payFromPool(r, payer, cost, x) || (autoTapFor(r, payer, cost, x) && payFromPool(r, payer, cost, x)))) throw new Reject("cannot_pay", "cannot pay");
  }
  const life = lifeNeeded(u);
  if (life > 0) changeLife(r, env, payer, -life);
  const dc = discardCost(u);
  if (dc) return { push: [{ kind: "__unless_discard" as never, player: payer, cost: dc, prompt: u.prompt } as Step] };
  return "done";
}

/** The card(s) discarded as the payment of an "unless ... discards" cost: asked when there is a real choice. */
export function unlessDiscardHandler(r: Run, env: Env, step: Step, answer: Choice | undefined): StepResult {
  const c = step.cost as ChoiceCost, payer = String(step.player);
  const cx = { player: payer, source: env.source };
  const cands = costCandidates(r, c, cx), n = costCount(r, c, cx);
  let ids = cands;
  if (cands.length > n) {
    const spec: AskSpec = { kind: "choose_cards", player: payer, prompt: { title: `${label(r, env.source)}: choose what to discard`, instruction: `Choose ${n} card${n === 1 ? "" : "s"} to discard.` }, options: costOptions(r, cands), min: n, max: n };
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    ids = d.ids;
  }
  payChoiceCost(r, c, ids, cx);
  return "done";
}
