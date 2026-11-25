// Sweep over EVERY nonland permanent of the 13 drafted decks (data/kernel-drafts/*/_index.json, real draft JSON through the real draft lookup):
// the permanent is put on the battlefield under p1 (hosts for Auras / Equipment, loyalty / lore counters, Room doors, transformed faces ...) and
// p1's Extravagant Replication runs its REAL upkeep trigger on it ("create a token that's a copy of another target nonland permanent you control").
// Every prompt is answered with the first legal option. Asserted: a distinct token copy under p1's control with the same copiable characteristics,
// no `unresolved` event, no "No visible effect" log line, legend rule, ETB triggers of the copy, "enters with counters" parity with a normal
// entry, the copy's own abilities are offered, the original is untouched.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import * as fs2 from "node:fs";
import { G, base, rich, toUpkeep, type Answerer } from "./aminatoukit";
import { ctx } from "../integration/testgame";
import { NeedAsk, moveObject, baseChars, printedAbilities, type Run } from "./core";
import { auraCandidates, enchantSpec } from "./aurahost";
import { legalActions } from "./legal";
import type { GameEvent, ObjId } from "./types";

const root = path.join("data", "kernel-drafts");
export function permanentNames(): string[] {
  const out = new Set<string>();
  for (const d of readdirSync(root).filter((x) => statSync(path.join(root, x)).isDirectory() && existsSync(path.join(root, x, "_index.json"))))
    for (const e of (JSON.parse(readFileSync(path.join(root, d, "_index.json"), "utf8")) as { cards: Array<{ name: string }> }).cards) {
      const c = ctx.cards(e.name);
      if (!c) continue;
      const t = c.types;
      if (t.includes("land") || t.includes("instant") || t.includes("sorcery")) continue;
      if (!t.some((x) => ["creature", "artifact", "enchantment", "planeswalker", "battle"].includes(x))) continue;
      out.add(e.name);
    }
  return [...out];
}

const log0 = (g: G) => g.log();
const run = (g: G): Run => ({ s: structuredClone(g.s), events: [], defs: ctx.cards, scanned: 0 } as never);
/** the counters a card gets by entering the battlefield normally (null when entering asks a question) */
let refUnresolved = false;
function enterCounters(name: string): Record<string, number> | null {
  const m = base(); const id = m.give("p1", name, "hand"); const g = new G(m); const r = run(g);
  refUnresolved = false;
  try { moveObject(r, id, "battlefield", { controller: "p1" }); } catch (e) { if (e instanceof NeedAsk) return null; throw e; }
  refUnresolved = r.events.some((e) => (e as { type?: string }).type === "unresolved");
  return { ...(r.s.objects[id]?.counters ?? {}) };
}

type Res = { fails: string[]; notes: string[] };
export type Variant = { back?: boolean; keep?: "orig" | "token" };
export function sweepOne(name: string, o: Variant = {}): Res {
  const fails: string[] = [], notes: string[] = [];
  const def = ctx.cards(name)!;
  const m = base(); rich(m);
  m.give("p1", "Extravagant Replication", "battlefield");
  const host1 = m.give("p1", "Ledger Shredder", "battlefield"); m.give("p2", "Esper Sentinel", "battlefield");
  const X = m.give("p1", name, "battlefield");
  const st = m.state; const xo = st.objects[X];
  const ref = enterCounters(name);
  const normalEntryUnresolved = refUnresolved;
  if (ref) xo.counters = { ...ref };
  if (def.loyalty !== undefined) xo.counters = { ...xo.counters, loyalty: def.loyalty };
  if (def.subtypes?.includes("Saga")) xo.counters = { ...xo.counters, lore: 1 };
  if (def.layout === "room") xo.unlocked = [Object.keys(def.faces ?? {})[0] ?? name] as never;
  if (o.back) {
    const back = Object.keys(def.faces ?? {})[1]; if (!back) return { fails, notes: ["no back face"] };
    if (def.faces?.[back]?.types.includes("land")) return { fails, notes: ["back face is a land (not a legal target)"] };
    xo.face = back;
  }
  // an Aura / Equipment gets a legal host
  {
    const r = run(new G(m)); const spec = enchantSpec(r, X);
    if (spec) {
      const c = auraCandidates(r, r.s.objects[X], spec, "p1");
      const pick = c.find((x) => x.id !== X);
      if (!pick) return { fails, notes: ["aura with no legal host for the original"] };
      if (r.s.objects[pick.id]) { st.objects[X].attachedTo = pick.id; st.objects[X].attachedToTs = st.objects[pick.id].timestamp; } else st.objects[X].attachedPlayer = pick.id;
    } else if (def.subtypes?.includes("Equipment")) { xo.attachedTo = host1; xo.attachedToTs = st.objects[host1].timestamp; }
  }
  m.state.turn.active = "p2"; m.state.turn.phase = "end_step"; m.state.priority = "p2";
  const g = new G(m);
  const xname = g.chars(X).name;
  const legendary = (g.chars(X).supertypes ?? []).includes("legendary");
  const before = new Set(Object.keys(g.s.objects));
  const origKw = [...g.chars(X).keywords];
  const origPrinted = printedAbilities({ s: g.s, events: [], defs: ctx.cards, scanned: 0 } as never, g.obj(X)).map((a) => a.id + ":" + a.kind);
  const origBase = baseChars({ s: g.s, events: [], defs: ctx.cards, scanned: 0 } as never, g.obj(X));
  const titles: string[] = [];
  let xGone = false;
  const ans: Answerer = (p) => {
    titles.push(`${p.kind}:${p.prompt.title}`); if (process.env.DEBUGSW) console.log("PROMPT", p.kind, p.prompt.title, JSON.stringify(p.options.map((x) => x.label)));
    if (p.kind === "choose_targets" && /Extravagant Replication/.test(p.prompt.title)) { if (!p.options.some((x) => x.id === X)) xGone = true; return { ids: [p.options.some((x) => x.id === X) ? X : p.options[0].id] }; }
    if (p.max === 0 && !p.numeric) return { ids: [] };
    if (/^Legend rule/.test(p.prompt.title)) { const pickTok = o.keep === "token"; return { ids: [p.options.find((x) => /\(token\)/.test(x.label) === pickTok)!.id] }; }
    return undefined;
  };
  try { toUpkeep(g, "p1", ans); g.drive(ans); } catch (e) {
    if (/never reached upkeep/.test((e as Error).message) && legendary && o.keep === "token" && titles.filter((t) => /Legend rule/.test(t)).length > 5) return { fails, notes: ["the copy's enters trigger returns the original and the legend rule repeats forever (a real player stops by declining the may)"] }; fails.push(`threw: ${(e as Error).message.slice(0, 300)}${process.env.ONLY ? (e as Error).stack : ""}`); return { fails, notes }; }
  const erFizzled = log0(g).some((t) => /Extravagant Replication fizzles/.test(t));
  if (erFizzled && g.obj(X)?.zone !== "battlefield") return { fails, notes: ["the original left before the trigger resolved"] };
  if (xGone) return { fails, notes: ["the original left the battlefield before the trigger (its own upkeep ability / 0 toughness): not a copy question"] };
  if (titles.some((t) => /copy/i.test(t) && !/Extravagant Replication/.test(t))) return { fails, notes: ["copy replacement (Cursed Mirror): the copy becomes a copy of something else, correct"] };
  const created = g.events.filter((e: GameEvent) => (e as { type?: string }).type === "token_created").map((e) => (e as unknown as { id: ObjId }).id).filter((id) => !before.has(id));
  const rr = { s: g.s, events: [], defs: ctx.cards, scanned: 0 } as never as Run;
  const tokId = created.find((id) => g.obj(id) && baseChars(rr, g.obj(id)).name === xname && (!legendary || g.obj(id).zone === "battlefield" || o.keep !== "token"));
  const log = g.log();
  if (g.unresolved().length) (normalEntryUnresolved || NOT_COPY_SPECIFIC.has(name) ? notes : fails).push(`unresolved${normalEntryUnresolved || NOT_COPY_SPECIFIC.has(name) ? " (also when entering normally, not copy-specific)" : ""}: ${g.unresolved().join(" | ").slice(0, 400)}`);
  // "No visible effect" inside the resolution of Extravagant Replication's own trigger
  for (const grp of g.ks.stackLog("p1").groups) {
    const texts = grp.lines.map((l) => l.text);
    let inER = false;
    for (const t of texts) {
      if (/^Resolving/.test(t)) inER = /Extravagant Replication/.test(t);
      else if (inER && t.includes("No visible effect")) fails.push(`No visible effect in the copy's resolution: ${texts.join(" // ").slice(0, 500)}`);
    }
  }
  const other = g.noEffect().length; if (other) notes.push(`${other} "No visible effect" line(s) from other abilities`);
  const supText = g.events.filter((e) => /unsupported/i.test((e as { type?: string }).type ?? "")).map((e) => JSON.stringify(e).slice(0, 200));
  if (supText.length) fails.push(`unsupported: ${supText.join(" | ")}`);
  const nameCount = () => g.s.battlefield.filter((i) => g.obj(i).controller === "p1" && g.chars(i).name === xname).length;
  if (!created.length) { fails.push(`no token created. log: ${log.slice(-6).join(" / ").slice(0, 600)}`); return { fails, notes }; }
  const auraNoHost = created.some((id) => g.events.some((e) => (e as { type?: string }).type === "aura_no_host" && (e as { id?: string }).id === id));
  if (auraNoHost) { notes.push("aura copy had no legal host"); return { fails, notes }; }
  if (legendary) {
    if (nameCount() !== 1) fails.push(`legend rule: ${nameCount()} permanents named ${xname} under p1`);
    if (!titles.some((t) => /legend/i.test(t))) fails.push("legend rule asked no question");
    if (o.keep === "orig") {
      if (g.obj(X)?.zone !== "battlefield") fails.push("kept the original but it left the battlefield");
      return { fails, notes };
    }
    if (g.obj(X)?.zone === "battlefield") fails.push("kept the token but the original is still on the battlefield");
  }
  if (!tokId) { fails.push(`no token copy named ${xname} survived. log: ${log.slice(-6).join(" / ").slice(0, 600)}`); return { fails, notes }; }
  const tok = g.obj(tokId);
  const orig = g.obj(X);
  if (!legendary) {
    if (!orig || orig.zone !== "battlefield") fails.push(`original left the battlefield (${orig?.zone})`);
    if (orig && (orig.token || orig.copyDef)) fails.push("original became a token / copy");
  }
  if (tokId === X) fails.push("copy is the same object");
  if (tok.zone !== "battlefield") { fails.push(`token is in ${tok.zone}`); return { fails, notes }; }
  if (tok.controller !== "p1") fails.push(`token controlled by ${tok.controller}`);
  const cb = origBase, tb = baseChars(rr, tok);
  const cmp = (k: string, a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(`${k} differs: original ${JSON.stringify(a)} copy ${JSON.stringify(b)}`); };
  cmp("name", cb.name, tb.name); cmp("types", [...cb.types].sort(), [...tb.types].sort()); cmp("subtypes", [...cb.subtypes].sort(), [...tb.subtypes].sort());
  cmp("supertypes", [...cb.supertypes].sort(), [...tb.supertypes].sort()); cmp("colors", [...cb.colors].sort(), [...tb.colors].sort());
  cmp("P/T", [cb.power, cb.toughness], [tb.power, tb.toughness]);
  // the mana value of a copy of a back face is 0 (CR 707.8); the real DFC keeps its front face's value (202.3b)
  if (!o.back) cmp("mana value", cb.mv, tb.mv);
  cmp("abilities", origPrinted, printedAbilities(rr, tok).map((a) => a.id + ":" + a.kind));
  { const tk = g.chars(tokId).keywords; const miss = origKw.filter((k) => !tk.includes(k)); if (miss.length) fails.push(`keywords missing on the copy: ${miss.join(", ")}`); }
  // enters with counters (same as a normal entry)
  if (ref) {
    const got = Object.fromEntries(Object.entries(tok.counters ?? {}).filter(([, n]) => n > 0));
    const want = Object.fromEntries(Object.entries(ref).filter(([, n]) => n > 0));
    for (const [k, n] of Object.entries(want)) if ((got[k] ?? 0) < n) fails.push(`counter ${k}: want ${n} got ${got[k] ?? 0}`);
  } else notes.push("normal entry asks a question; counters not compared");
  if (def.loyalty !== undefined && !o.back && (tok.counters?.loyalty ?? 0) < def.loyalty) fails.push(`planeswalker copy has ${tok.counters?.loyalty ?? 0} loyalty, expected ${def.loyalty}`);
  if (def.subtypes?.includes("Saga") && (tok.counters?.lore ?? 0) < 1) fails.push("saga copy has no lore counter");
  // ETB triggers of the copy fire
  const etb = tb.abilities.filter((a) => a.kind === "triggered" && a.trigger?.event === "etb" && /self|"this"/.test(JSON.stringify(a.trigger.subject ?? "self")) && !a.trigger.interveningIf);
  if (etb.length) {
    const fired = g.events.filter((e) => ["trigger_on_stack", "trigger_fizzled", "trigger_removed", "trigger_not_triggered"].includes((e as { type?: string }).type ?? "") && (e as { source?: string }).source === tokId);
    if (!fired.length) fails.push(`ETB trigger(s) [${etb.map((a) => a.id).join(",")}] of the copy never went on the stack`);
  }
  // the copy's own abilities are offered when the original's are (a tapped copy / a summoning-sick creature copy cannot use {T} abilities)
  const acts = legalActions(g.s, "p1", ctx);
  const listed = (id: ObjId) => acts.filter((a) => (a as { objectId?: string }).objectId === id && a.kind === "activateAbility").map((a) => (a as { abilityId?: string }).abilityId!);
  const lo = new Set(listed(X)), lt = new Set(listed(tokId));
  if (!tok.tapped) for (const k of lo) if (!lt.has(k) && !(tb.types.includes("creature") && !tb.keywords.includes("haste"))) fails.push(`original offers ${k} but the copy does not`);
  // run one non-mana ability of the copy
  const nonMana = [...lt].find((k) => tb.abilities.find((a) => a.id === k)?.kind === "activated");
  if (nonMana) {
    // the same activation on the original (in a clone) tells a harness limitation from a copy bug
    let origAlso = false;
    if (g.obj(X)?.zone === "battlefield") { try { const g2 = new G({ state: structuredClone(g.s) } as never); g2.act("p1", X, nonMana, {}, ans); } catch { origAlso = true; } }
    try { g.act("p1", tokId, nonMana, {}, ans); } catch (e) { (origAlso ? notes : fails).push(`activating ${nonMana} on the copy${origAlso ? " (the original refuses the same way: harness answers)" : ""}: ${(e as Error).message.slice(0, 200)}`); }
    if (g.unresolved().length) fails.push(`unresolved after activating ${nonMana}: ${g.unresolved().join(" | ").slice(0, 300)}`);
  }
  return { fails, notes };
}

/** drafted cards whose unresolved event is a card-level gap (an unsupported predicate / capability in the card JSON), identical when the card is cast; not copy-specific */
const NOT_COPY_SPECIFIC = new Set(["Scrapshooter"]);
const names = process.env.ONLY ? (process.env.ONLY.startsWith("@") ? fs2.readFileSync(process.env.ONLY.slice(1), "utf8").split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean) : process.env.ONLY.split("|")) : permanentNames();
describe("Extravagant Replication copies every nonland permanent of the 13 decks", () => {
  it("enumerates a plausible number of permanents", () => { if (!process.env.ONLY) expect(names.length).toBeGreaterThan(400); });
  it("sweep", () => {
    const bad: string[] = [];
    for (const n of names) {
      const vs: Variant[] = [{}];
      if ((ctx.cards(n)!.supertypes ?? []).includes("legendary")) vs.splice(0, 1, { keep: "orig" }, { keep: "token" });
      if (ctx.cards(n)!.layout === "transform") for (const v of [...vs]) vs.push({ ...v, back: true });
      for (const v of vs) { const r = sweepOne(n, v); if (r.fails.length) bad.push(`${n} ${JSON.stringify(v)}: ${r.fails.join("; ")}`); }
    }
    if (bad.length) console.log(`FAILING (${bad.length}):\n` + bad.join("\n"));
    expect(bad).toEqual([]);
  }, 900000);
});
