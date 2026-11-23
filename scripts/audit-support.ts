// Audits the SUPPORT CHECK itself (src/kernel/engine/support.ts). `npm run kernel:audit-support`
// For every unique drafted card of every deck:
//   1. SCHEMA: parse with CardSchema and report every key / value the schema silently drops or rewrites (unknown fields are invisible to support.ts).
//   2. HANDLER: every step kind used (at any depth) has an interpreter handler and every field used is in that handler's field list.
//   3. RUNTIME PROBE: every distinct step of a card the static check calls supported is actually RUN in a small table (cast as a spell with
//      material in every zone). A step that the static check accepts but that the interpreter then refuses with Unsupported is a LENIENT-CHECK BUG
//      (this is how "repeat_for_each repeatCount=<other value>" style holes show up). Missing targets / saved lists are not Unsupported and are ignored.
// Exit code 1 when anything is found.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { CardSchema, type Ability, type Card, type Step } from "../src/kernel/schema";
import { cardUnsupported, stepNeedsShallow } from "../src/kernel/engine/support";
import { META_FIELDS, STEP_FIELDS, SUPPORTED_ENGINE_STEP_KINDS } from "../src/kernel/engine/steps";
import { generatePrompts } from "../src/kernel/prompts";
import { famCards, mk } from "../src/kernel/engine/famkit";
import { game } from "../src/kernel/engine/testcards";

const root = path.join("data", "kernel-drafts");
const decks = readdirSync(root).filter((d) => statSync(path.join(root, d)).isDirectory() && existsSync(path.join(root, d, "_index.json"))).sort();
const cards = new Map<string, { name: string; decks: string[]; card: Card }>();
for (const d of decks) {
  const ix = JSON.parse(readFileSync(path.join(root, d, "_index.json"), "utf8")) as { cards: Array<{ slug: string; name: string }> };
  for (const e of ix.cards) {
    const hit = cards.get(e.slug);
    if (hit) { hit.decks.push(d); continue; }
    cards.set(e.slug, { name: e.name, decks: [d], card: JSON.parse(readFileSync(path.join(root, d, `${e.slug}.json`), "utf8")) as Card });
  }
}
const problems: string[] = [];
const bad = (cat: string, card: string, msg: string) => problems.push(`[${cat}] ${card}: ${msg}`);

// ---- 1. schema: what does parsing lose?
function lost(a: unknown, b: unknown, p: string, out: string[]): void {
  if (Array.isArray(a)) { a.forEach((x, i) => lost(x, (b as unknown[] | undefined)?.[i], `${p}[${i}]`, out)); return; }
  if (a && typeof a === "object") {
    const bo = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(a)) { if (!(k in bo)) out.push(`${p}.${k}`); else lost(v, bo[k], `${p}.${k}`, out); }
  } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${p} (value ${JSON.stringify(a)} -> ${JSON.stringify(b)})`);
}
for (const [, c] of cards) {
  const r = CardSchema.safeParse(c.card);
  if (!r.success) { bad("schema", c.name, r.error.issues[0]?.message ?? "invalid"); continue; }
  const out: string[] = []; lost(c.card, r.data, "", out);
  if (out.length) bad("schema-dropped", c.name, out.slice(0, 6).join("; "));
}

// ---- walk every step at every depth
type Where = { ability: Ability; step: Step };
function* stepsOf(card: Card): Generator<Where> {
  function* walk(a: Ability, ss: Step[] | undefined): Generator<Where> {
    for (const s of ss ?? []) {
      yield { ability: a, step: s };
      yield* walk(a, s.then); yield* walk(a, s.else); yield* walk(a, s.steps);
      for (const t of (s.tokenAbilities as Ability[] | undefined) ?? []) yield* abil(t);
      for (const t of ((s.emblem as { abilities?: Ability[] } | undefined)?.abilities) ?? []) yield* abil(t);
    }
  }
  function* abil(a: Ability): Generator<Where> {
    yield* walk(a, a.steps);
    for (const o of a.modes?.options ?? []) yield* walk(a, o.steps);
    const res = a.replacement?.result as { steps?: Step[] } | undefined;
    yield* walk(a, res?.steps);
    for (const m of (a.static?.modify ?? []) as Array<Record<string, unknown>>) if (m.grantAbility) yield* abil(m.grantAbility as Ability);
  }
  for (const a of card.abilities) yield* abil(a);
  for (const c of card.castOptions ?? []) yield* walk({ id: "cast", kind: "spell_effect" } as Ability, c.effects?.addSteps);
}

// ---- 2. handler exists + fields known
const distinct = new Map<string, { step: Step; ability: Ability; cards: Set<string> }>();
for (const [, c] of cards) {
  const sup = cardUnsupported({ name: c.name, types: [], kernel: c.card });
  for (const w of stepsOf(c.card)) {
    const s = w.step;
    if (!sup.ok) continue;
    if (!SUPPORTED_ENGINE_STEP_KINDS.has(s.kind)) bad("handler", c.name, `static check passed but step kind ${s.kind} has no handler`);
    else for (const k of Object.keys(s)) if (!META_FIELDS.includes(k) && !STEP_FIELDS[s.kind].includes(k) && !["then", "else", "if"].includes(k)) bad("handler", c.name, `static check passed but ${s.kind}.${k} is not a handled field`);
    if (stepNeedsShallow(s).length) continue;
    const key = JSON.stringify(s, (k, v) => (k === "prompt" || k === "src" || k === "srcs" || k === "id" ? undefined : v));
    const e = distinct.get(key) ?? { step: s, ability: w.ability, cards: new Set<string>() };
    e.cards.add(c.name); distinct.set(key, e);
  }
}

function savers(a: Ability): Array<Step & { saveAs?: string }> {
  const out: Array<Step & { saveAs?: string }> = [];
  const walk = (ss: Step[] | undefined) => { for (const s of ss ?? []) { if (typeof (s as { saveAs?: unknown }).saveAs === "string") out.push(s); walk(s.then); walk(s.else); walk(s.steps); } };
  walk(a.steps); for (const o of a.modes?.options ?? []) walk(o.steps);
  return out;
}

// ---- 3. runtime probe
const NOISE = /_missing|no player target chosen|left no numeric result|ref:found|field:move_card_zone.what=|predicate:paid_additional_cost|step_result|opponent_multiplayer|evaluated on something|no color was chosen|no direction was chosen|decision_in_mana/;
let probed = 0;
for (const { step, ability, cards: names } of distinct.values()) {
  const inner = JSON.parse(JSON.stringify(step)) as Step;
  // a step that reads a name an EARLIER step of the same ability saved (saveAs: "exiled") is probed after that saving step; a name nobody saves stays an unsupported ref
  const pre: Step[] = [];
  for (const k of ["what", "target", "on", "source"]) {
    const v = (step as Record<string, unknown>)[k];
    const saver = typeof v === "string" ? savers(ability).find((x) => x.saveAs === v) : undefined;
    if (saver && !pre.some((p) => p.saveAs === saver.saveAs)) pre.push(JSON.parse(JSON.stringify(saver)) as Step);
  }
  const ab = { id: "a1", kind: "spell_effect", text: "probe", steps: [...pre, inner], ...(ability.targets?.length ? { targets: ability.targets } : {}) } as Ability;
  const def = mk("Audit Probe", { manaCost: "{U}", types: ["sorcery"] }, [ab]);
  const t = game({ extra: { ...famCards, "Audit Probe": def } });
  try {
    for (const p of ["p1", "p2"] as const) {
      for (let i = 0; i < 8; i++) t.give(p, i % 2 ? "Fill A" : "Fill B", "library");
      for (let i = 0; i < 3; i++) { t.give(p, "Fill C", "battlefield"); t.give(p, "Fill D", "graveyard"); t.give(p, "Fill E", "hand"); t.give(p, "Fill Land", "battlefield"); }
    }
    t.give("p1", "Island", "battlefield");
    t.ok({ type: "castSpell", player: "p1", cardId: t.give("p1", "Audit Probe", "hand") });
    probed++;
    t.resolveTop();
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (/nsupported/.test(msg) && !NOISE.test(msg)) bad("lenient-check", [...names].slice(0, 3).join(", "), `${step.kind}: ${msg.slice(0, 200)} :: ${JSON.stringify(step).slice(0, 220)}`);
  }
}
void generatePrompts;
console.log(`${cards.size} unique cards, ${decks.length} decks, ${distinct.size} distinct supported steps probed (${probed} cast)`);
if (problems.length) { console.log(problems.join("\n")); console.log(`\n${problems.length} problem(s)`); process.exit(1); }
console.log("support audit: clean");
