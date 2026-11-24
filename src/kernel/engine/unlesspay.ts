// `unlessPay` on any step: "<step> unless <payer> pays <cost>" (Mana Tithe, Esper Sentinel, Mystic Remora...). A payer who cannot pay is not
// asked; one who can is asked yes/no (auto-tapping their mana sources) and the step is skipped when they pay. Costs supported: mana
// (with {X} from `unlessPay.x`) and life. Imported by steps.ts.

import type { Cost, Prompt, Step } from "../schema";
import { emit, label, parseManaCost, player, Reject, type Run } from "./core";
import { evalQuantity, resolvePlayers } from "./query";
import { costCandidates, costCount, costOptions, payChoiceCost, type ChoiceCost } from "./costs";
import { autoTapFor, costString, isManualPayer, payFromPool, poolCovers, totalPotentialMana } from "./mana";
import { paySpec } from "./payspec";
import { invalidateIndex } from "./layers";
import { changeLife, decide, type AskSpec, type StepResult } from "./steps";
import type { Choice, Env, PlayerId } from "./types";

/** `inverse`: "you may pay <cost>; if you do, <step>" (the step runs only when paid) instead of "<step> unless <payer> pays" */
export interface UnlessPay { payer: string; cost: Cost[]; x?: unknown; prompt?: Prompt; inverse?: boolean }

export function unlessPaySupported(u: UnlessPay): boolean {
  return u.cost.length > 0 && u.cost.every((c) => ("mana" in c && !/[\/P]/.test(c.mana.replace(/\{X\}/g, ""))) || ("life" in c && typeof c.life === "number") || ("discard" in c && c.discard !== "self") || ("sacrifice" in c && c.sacrifice !== "self") || ("tapOther" in c) || ("returnToHand" in c && c.returnToHand !== "self"));
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

/** the choice cost of an "unless" payment: discard / sacrifice / tap / return a card or permanent of the payer's choice */
const discardCost = (u: UnlessPay): Extract<Cost, { discard: unknown }> | undefined => u.cost.find((c): c is Extract<Cost, { discard: unknown }> => "discard" in c || "sacrifice" in c || "tapOther" in c || "returnToHand" in c);

function canPay(r: Run, payer: PlayerId, u: UnlessPay, env: Env): boolean {
  const dc = discardCost(u);
  if (dc && costCandidates(r, dc as ChoiceCost, { player: payer, source: env.source }).length < costCount(r, dc as ChoiceCost, { player: payer, source: env.source })) return false;
  const { cost, x } = manaNeeded(r, u, env);
  if (cost.mv + cost.x * x > totalPotentialMana(r, payer)) return false;
  return player(r, payer).life >= lifeNeeded(u);
}

/** The step remembers (on the step object itself, which lives in the running frame) that its payer chose to pay and is tapping sources. */
type PayState = Step & { __paying?: boolean; __n?: number };

/**
 * Paying by hand: undefined = the pool covers the cost (pay now), `{ ask }` = the payer taps sources (a `pay_mana` question, re-asked after every tap until
 * the pool covers it), "declined" = the payer cancelled (the "unless" effect happens / the "may pay" effect does not).
 */
function payByHand(r: Run, env: Env, payer: PlayerId, cost: ReturnType<typeof parseManaCost>, x: number, step: Step, answer: Choice | undefined): { ask: AskSpec } | "declined" | undefined {
  const st = step as PayState;
  if (answer?.payWith?.length && !poolCovers(r, payer, cost, x)) autoTapFor(r, payer, cost, x, answer.payWith); // the confirmed suggestion: tap exactly those sources
  if (poolCovers(r, payer, cost, x)) { st.__paying = false; return undefined; }
  const spec = paySpec(r, payer, { need: cost, x, life: 0, parts: [{ label: "Cost", cost: costString(cost, x) }], ctx: { spent: [] }, what: `Pay for ${label(r, env.source)}` });
  st.__paying = true;
  const d = decide(spec, answer);
  if ("ask" in d) return d;
  if (d.ids[0] === "cancel") { st.__paying = false; return "declined"; }
  return { ask: spec }; // "Pay" while the pool is still short: the question stays open
}

/** stack log: the outcome of an "unless <payer> pays" / "you may pay" clause, in words the log can print (cost text, who, what happened) */
function logUnless(r: Run, env: Env, payer: PlayerId | undefined, u: UnlessPay, outcome: "paid" | "declined" | "cannot"): void {
  const x = u.x === undefined ? 0 : evalQuantity(r, u.x as never, env);
  const cost = u.cost.map((c) => ("mana" in c ? c.mana.replace(/\{X\}/g, `{${x}}`) : "life" in c ? `${String(c.life)} life` : Object.keys(c)[0])).join(" + ");
  emit(r, { type: "unless_pay", source: env.source, ...(payer ? { payer } : {}), cost, outcome, inverse: !!u.inverse });
}

export function unlessHandler(r: Run, env: Env, step: Step, answer: Choice | undefined): StepResult {
  const u = step.pay as UnlessPay;
  const inner = step.inner as Step;
  const payer = resolvePlayers(r, u.payer as never, env)[0];
  const anyC = u.cost.find((c) => "mana" in c && (c as { anyAmount?: boolean }).anyAmount) as { mana: string } | undefined;
  if (anyC && payer && u.inverse) return payAnyAmount(r, env, payer, anyC.mana, u, inner, answer, step);
  const resumed = !!(step as PayState).__paying; // the payer said "pay" and is tapping sources (paying by hand)
  if (!resumed) {
    if (!payer || !canPay(r, payer, u, env)) { logUnless(r, env, payer, u, "cannot"); return u.inverse ? "done" : { push: [inner] }; }
    const spec: AskSpec = {
      kind: "pay_unless", player: payer,
      prompt: u.prompt ?? { title: `${label(r, env.source)}: pay or not`, instruction: u.inverse ? "Do you want to pay? If you do, the effect happens." : "Do you want to pay? If you don't, the effect happens." },
      options: [{ id: "yes", label: "Pay" }, { id: "no", label: "Don't pay" }], min: 1, max: 1
    };
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    if (!d.yes) { logUnless(r, env, payer, u, "declined"); return u.inverse ? "done" : { push: [inner] }; }
    answer = undefined;
  }
  if (!payer) return u.inverse ? "done" : { push: [inner] };
  const { cost, x } = manaNeeded(r, u, env);
  if (cost.mv + cost.x * x > 0 || cost.x > 0) {
    if (isManualPayer(r, payer)) {
      const w = payByHand(r, env, payer, cost, x, step, answer);
      if (w === "declined") { logUnless(r, env, payer, u, "declined"); return u.inverse ? "done" : { push: [inner] }; }
      if (w) return w;
      if (!payFromPool(r, payer, cost, x)) throw new Reject("cannot_pay", "cannot pay");
    } else if (!(payFromPool(r, payer, cost, x) || (autoTapFor(r, payer, cost, x) && payFromPool(r, payer, cost, x)))) throw new Reject("cannot_pay", "cannot pay");
  }
  const life = lifeNeeded(u);
  if (life > 0) changeLife(r, env, payer, -life);
  logUnless(r, env, payer, u, "paid");
  const dc = discardCost(u);
  if (dc) return { push: [{ kind: "__unless_discard" as never, player: payer, cost: dc, prompt: u.prompt } as Step, ...(u.inverse ? [inner] : [])] };
  return u.inverse ? { push: [inner] } : "done";
}

/** "You may pay any amount of {R}. When you do, ...": choose how many (0 = none), pay that many, then the inner step runs with X = that amount. */
function payAnyAmount(r: Run, env: Env, payer: PlayerId, sym: string, u: UnlessPay, inner: Step, answer: Choice | undefined, step: Step): StepResult {
  const one = parseManaCost(sym);
  const affordable = (n: number): boolean => {
    const cost = parseManaCost(sym.repeat(n));
    const snap = structuredClone(r.s), nEv = r.events.length;
    try { return payFromPool(r, payer, cost, 0) || (autoTapFor(r, payer, cost, 0) && payFromPool(r, payer, cost, 0)); } finally { r.s = snap; r.events.length = nEv; invalidateIndex(r); }
  };
  let max = 0;
  for (let n = Math.min(totalPotentialMana(r, payer), 50); n >= 1; n--) if (affordable(n)) { max = n; break; }
  if (max <= 0 || one.mv === 0) return "done";
  const spec: AskSpec = { kind: "choose_number", player: payer, prompt: u.prompt ?? { title: `${label(r, env.source)}: pay any amount`, instruction: `Choose how many ${sym} to pay (0 to pay nothing).` }, options: [], min: 0, max, numeric: true };
  const st = step as PayState;
  let n: number;
  if (st.__paying && st.__n) n = st.__n; // resumed: the amount was chosen, the payer is tapping sources
  else {
    const d = decide(spec, answer);
    if ("ask" in d) return d;
    n = d.number ?? 0;
    answer = undefined;
  }
  if (n <= 0) return "done";
  const cost = parseManaCost(sym.repeat(n));
  if (isManualPayer(r, payer)) {
    st.__n = n;
    const w = payByHand(r, env, payer, cost, 0, step, answer);
    if (w === "declined") return "done";
    if (w) return w;
    if (!payFromPool(r, payer, cost, 0)) throw new Reject("cannot_pay", "cannot pay");
  } else if (!(payFromPool(r, payer, cost, 0) || (autoTapFor(r, payer, cost, 0) && payFromPool(r, payer, cost, 0)))) throw new Reject("cannot_pay", "cannot pay");
  env.x = n;
  return { push: [inner] };
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
