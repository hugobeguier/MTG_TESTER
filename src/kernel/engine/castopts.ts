// Cast options (kernel step 5): kicker, flashback, escape, "cast from a zone", alternative costs, additional costs, gift,
// escalate. Casting is an OPTION STAGE in front of the usual choices (CR 601.2): the caster picks HOW to cast (normal /
// one replacing option), then which optional extras to add (kicker, gift, optional additional costs); mandatory additional
// costs are added automatically; modes, targets, X and the costs that need a choice follow in resolve.ts. The total mana
// cost is base (or the replacing option's cost) + the extras' mana + escalate per extra mode + taxes - reductions.
// The options really paid are remembered on the cast (`CastInfo.paid`: the option ids AND their kinds), which is what the
// predicates `kicked`, `paid_additional_cost` and `cast_with` read.

import type { CastOption, Cost, Step } from "../schema";
import { continueHooks, continuing, defOf, faceMeta, label, opponentsOf, type Run } from "./core";
import { evalPredicate } from "./query";
import { permissionOptions, permissionOwner } from "./durable";
import type { CastInfo, Draft, GameObject, PlayerId } from "./types";

/** Kinds the engine implements. Miracle / overload / madness / convoke / evoke remain unsupported. */
export const SUPPORTED_OPTION_KINDS: ReadonlySet<string> = new Set(["additional", "alternative", "kicker", "flashback", "escape", "cast_from_zone", "gift", "escalate", "miracle", "evoke"]);
/** Kinds that decide HOW the card is cast (at most one of them, or the normal way). */
const BASE_KINDS = new Set(["alternative", "flashback", "escape", "cast_from_zone", "miracle", "evoke"]);

export function castOptionsOf(r: Run, o: GameObject, permSnap?: CastOption[]): CastOption[] {
  if (o.token) return [];
  const all = [...(defOf(r, o)!.kernel.castOptions ?? []), ...(permSnap ?? permissionOptions(r, o))]; // + "you may cast it" permissions granted by permission_to_play
  // continue mode: an option whose kind / cost / effect the engine cannot run is not offered (never silently free); reportCast says so
  const blocked = continueHooks.optionBlocked;
  return blocked && continuing(r) ? all.filter((c) => !blocked(r, c)) : all;
}

/** What a cast option needs that the engine lacks (reported through support.ts). */
export function castOptionUnsupported(c: CastOption): string[] {
  const out: string[] = [];
  if (!SUPPORTED_OPTION_KINDS.has(c.kind)) out.push(`cast_option:${c.kind}`);
  if (c.when && !(c.kind === "miracle" && c.when.event === "drawn" && c.when.firstThisTurn)) out.push(`cast_option:${c.kind}.when`);
  if (c.effects?.replaceSteps || c.effects?.ifPaid) out.push(`cast_option:${c.kind}.effects`);
  if (c.kind === "gift" && !c.effects?.addSteps?.length && c.gift !== undefined && c.cost.length) out.push("cast_option:gift.cost");
  return out;
}

const originOk = (c: CastOption, origin: string): boolean => c.from === origin || (c.from === "hand" && origin === "command");

function condOk(r: Run, c: CastOption, pid: PlayerId, card: GameObject): boolean {
  if (c.kind === "miracle" && !r.castingMiracle) return false; // only while the miracle trigger resolves
  return !c.condition || evalPredicate(r, c.condition, { controller: pid, source: card.id });
}

/** The ways this card can be cast from `origin` right now: `null` = the normal way, otherwise a replacing / zone option. */
export function baseChoices(r: Run, card: GameObject, pid: PlayerId, origin: string, permSnap?: CastOption[]): Array<CastOption | null> {
  const out: Array<CastOption | null> = [];
  if ((origin === "hand" || origin === "command") && card.owner === pid) out.push(null);
  for (const c of castOptionsOf(r, card, permSnap)) {
    if (!BASE_KINDS.has(c.kind) || !originOk(c, origin)) continue;
    const perm = c.id.startsWith("perm:");
    if (perm && permissionOwner(r, c.id) !== pid) continue;
    if (!perm && card.owner !== pid) continue; // someone else's card can only be cast through a permission
    if (c.kind === "cast_from_zone" && c.from === "hand" && !perm) continue; // adds nothing: the normal way already casts from hand
    if (condOk(r, c, pid, card)) out.push(c);
  }
  return out;
}

/** Optional extras the caster may add (kicker, gift, optional additional cost, escalate); mandatory additional costs are returned by `mandatoryExtras`. */
export function optionalExtras(r: Run, card: GameObject, pid: PlayerId, origin: string): CastOption[] {
  return castOptionsOf(r, card).filter((c) => !BASE_KINDS.has(c.kind) && (c.kind === "kicker" || c.kind === "gift" || c.kind === "additional") && c.optional && originOk(c, origin) && condOk(r, c, pid, card));
}
export function mandatoryExtras(r: Run, card: GameObject, pid: PlayerId, origin: string): CastOption[] {
  return castOptionsOf(r, card).filter((c) => !BASE_KINDS.has(c.kind) && (c.kind === "escalate" || (c.kind === "additional" && !c.optional)) && originOk(c, origin) && condOk(r, c, pid, card));
}

const costText = (cs: Cost[]): string => cs.map((c) => ("mana" in c ? c.mana : "life" in c ? "pay life" : "sacrifice" in c ? "sacrifice" : "discard" in c ? "discard" : "exileFrom" in c ? "exile cards" : "tapOther" in c ? "tap creatures" : "")).filter(Boolean).join(" + ");

export function optionLabel(c: CastOption | null, r?: Run, card?: GameObject): string {
  if (c === null) return "Cast normally";
  const cost = costText(c.cost);
  const nm = c.kind === "cast_from_zone" ? `Cast from your ${c.from}` : c.kind[0].toUpperCase() + c.kind.slice(1);
  void r; void card;
  return cost ? `${nm} (${cost})` : nm;
}

/** The option ids and kinds recorded as paid ("kicked" reads kind kicker, "was cast with escape" reads kind escape). */
export function paidTags(opts: CastOption[]): string[] {
  const tags: string[] = [];
  for (const c of opts) for (const t of [c.id, c.kind]) if (!tags.includes(t)) tags.push(t);
  return tags;
}

/** The options a draft has selected (base option + extras + mandatory extras), in a stable order. */
export function selectedOptions(r: Run, d: Draft): CastOption[] {
  if (d.kind !== "spell" || !d.castChosen) return [];
  const card = r.s.objects[d.sourceId];
  const all = castOptionsOf(r, card, d.permSnap);
  return d.castChosen.map((id) => all.find((c) => c.id === id)).filter((c): c is CastOption => !!c);
}

export const mana = (cs: Cost[]): string[] => cs.filter((c): c is { mana: string } & Cost => "mana" in c).map((c) => (c as { mana: string }).mana);
export const nonMana = (cs: Cost[]): Cost[] => cs.filter((c) => !("mana" in c));

/** The spell's mana cost STRING for this draft: base (or the replacing option's) + extras + escalate per additional mode. */
export function spellManaString(r: Run, d: Draft): string {
  const card = r.s.objects[d.sourceId];
  const def = defOf(r, card)!;
  const sel = selectedOptions(r, d);
  const replaced = sel.some((c) => BASE_KINDS.has(c.kind) && c.replacesManaCost);
  let s = replaced ? "" : (faceMeta(def, card).manaCost ?? "");
  for (const c of sel) {
    const once = mana(c.cost).join("");
    // escalate: paid once for each mode chosen beyond the first (not at all for a single mode)
    s += c.kind === "escalate" || c.perExtraMode ? once.repeat(Math.max(0, (d.modeIds?.length ?? 1) - 1)) : once;
  }
  return s;
}

/** Non-mana costs of the selected options, in a stable order (their indices key `Draft.costChoices`). */
export function spellExtraCosts(r: Run, d: Draft): Cost[] {
  return selectedOptions(r, d).flatMap((c) => nonMana(c.cost));
}

/** Gift / evoke style steps added to the spell's first part when the option was chosen. */
export function addedSteps(r: Run, d: Draft): Step[] {
  return selectedOptions(r, d).filter((c) => c.kind !== "evoke").flatMap((c) => c.effects?.addSteps ?? []);
}

export function castTags(d: Draft, r: Run): string[] { return paidTags(selectedOptions(r, d)); }

export function opponentChoices(r: Run, pid: PlayerId): Array<{ id: string; label: string }> {
  return opponentsOf(r, pid).map((p) => ({ id: p.id, label: label(r, p.id) }));
}

export type { CastInfo };
