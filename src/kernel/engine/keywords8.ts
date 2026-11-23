// Keywords the engine implements by SYNTHESISING the abilities the rules text stands for (kernel step 8).
// A printed `keyword: {name}` ability, or a keyword granted by a static effect (grantKeyword in layers.ts), brings the abilities below along.
// Their ids start with "kw:" so core.moveObject remembers them in `leftWith` (a creature that dies with a granted undying still triggers).

import type { Ability } from "../schema";

const dies = (name: string, counter: "+1/+1" | "-1/-1", text: string): Ability => ({
  id: `kw:${name}`, kind: "triggered", text,
  // interveningIf "if it had no <counter> counters on it": last-known information (query.ts matches / countersLeft)
  trigger: { event: "dies", subject: "self", interveningIf: { not: { check: "matches", obj: "event_object", filter: { hasCounter: counter } } } },
  steps: [{ kind: "move_card_zone", target: "event_object", moveFrom: "graveyard", moveTo: "battlefield", withCounters: { kind: counter, count: 1 } }]
} as unknown as Ability);

const RULES: Record<string, (param?: unknown) => Ability[]> = {
  undying: () => [dies("undying", "+1/+1", "Undying (When this creature dies, if it had no +1/+1 counters on it, return it to the battlefield under its owner's control with a +1/+1 counter on it.)")],
  // Devour N (CR 702.82): as it enters, sacrifice any number of other creatures; it enters with N +1/+1 counters for each
  devour: (param) => [{
    id: "kw:devour", kind: "replacement", text: `Devour ${String(param ?? 1)} (As this creature enters, you may sacrifice any number of creatures. This creature enters with that many +1/+1 counters on it.)`,
    replacement: { event: "would_enter", subject: "self", result: { mode: "also", steps: [
      { kind: "choose", id: "dv", who: "you", from: { types: ["creature"], controller: "you", another: true }, anyNumber: true, saveAs: "devoured", prompt: { title: "Devour", instruction: "Choose any number of other creatures you control to sacrifice." } },
      { kind: "sacrifice_permanent", target: "devoured" },
      { kind: "add_counters", on: "self", counterKind: "+1/+1", amount: { math: "*", args: [Number(param ?? 1), { ref: "step_result", step: "dv" }] } }
    ] } }
  } as unknown as Ability],
  // Riot (CR 702.136): as it enters, choose a +1/+1 counter or haste (a chosen haste is read back by layers.computeChars0)
  riot: () => [{
    id: "kw:riot", kind: "replacement", text: "Riot (This creature enters with your choice of a +1/+1 counter or haste.)",
    replacement: { event: "would_enter", subject: "self", result: { mode: "also", steps: [
      { kind: "choose", choice: "mode", options: ["+1/+1 counter", "haste"], remember: true, who: "you", prompt: { title: "Riot", instruction: "Choose one: a +1/+1 counter or haste." } },
      { kind: "add_counters", on: "self", counterKind: "+1/+1", amount: 1, condition: { when: "on_resolution", if: { check: "chosen_is", kind: "mode", value: "+1/+1 counter" } } }
    ] } }
  } as unknown as Ability],
  // Ward (a GRANTED "ward {2}": a printed ward is drafted as this same trigger)
  ward: (param) => [{
    id: "kw:ward", kind: "triggered", text: `Ward ${String(param ?? "")}`, keyword: { name: "ward", param: String(param ?? "") },
    trigger: { event: "becomes_target", subject: "self" },
    steps: [{ kind: "counter_spell", target: "event_object", unlessPay: { payer: "that_player", cost: [{ mana: String(param ?? "{1}") }] } }]
  } as unknown as Ability],
  // Station (CR 702.184): tap another creature you control: put charge counters equal to its power on this permanent, only as a sorcery. The tapped creature's power is read as `sacrificed` (resolve.payAbilityCosts records the tapped creature of a station cost there)
  station: () => [{
    id: "kw:station", kind: "activated", text: "Station (Tap another creature you control: Put charge counters equal to its power on this permanent. Station only as a sorcery.)", keyword: { name: "station" },
    costs: [{ tapOther: { types: ["creature"], controller: "you" }, count: 1 }], timing: { speed: "sorcery" },
    steps: [{ kind: "add_counters", on: "self", counterKind: "charge", amount: { ref: "stat", of: "sacrificed", stat: "power" } }]
  } as unknown as Ability],
  persist: () => [dies("persist", "-1/-1", "Persist (When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield under its owner's control with a -1/-1 counter on it.)")]
};

/** Keywords whose abilities are synthesised here (support.ts treats them as implemented). */
export const SYNTHESISED_KEYWORDS: ReadonlySet<string> = new Set(Object.keys(RULES));

/** The extra abilities a keyword stands for (empty for keywords the engine reads directly). */
export function keywordExtras(name: string, param?: unknown): Ability[] {
  const l = name.toLowerCase();
  if (RULES[l]) return RULES[l](param);
  const sp = l.indexOf(" "); // a granted keyword with its parameter in the name: "ward {2}"
  return sp > 0 && RULES[l.slice(0, sp)] ? RULES[l.slice(0, sp)](name.slice(sp + 1)) : [];
}

/** `abilities` plus the synthesised abilities of the keywords among them (no duplicates). */
export function withKeywordExtras(abilities: Ability[]): Ability[] {
  let out = abilities;
  for (const a of abilities) {
    if (a.kind !== "keyword") continue;
    const kn = typeof a.keyword === "string" ? a.keyword : a.keyword?.name;
    for (const x of kn ? keywordExtras(kn, typeof a.keyword === "object" ? a.keyword?.param : undefined) : []) if (!out.some((y) => y.id === x.id)) out = [...out, x];
  }
  return out;
}
