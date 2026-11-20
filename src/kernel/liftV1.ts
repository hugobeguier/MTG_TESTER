// Adapter: v1 parsed_cards abilities (src/lib/cardParser.ts AbilitySchema) -> schema v2.
// Pure, read-time, lossless: v1 steps are carried verbatim (v2 steps are a superset), free-text
// conditions become `{unsupported}` predicates so lifted rows can never validate as approved.

import type { Ability, Card, Cost, EventName, ObjectFilter, Phase, Step, TargetSpec } from "./schema";

export interface V1Step { kind: string; [k: string]: unknown }
export interface V1Ability {
  kind: "triggered" | "activated" | "static" | "keyword" | "spell_effect";
  triggerEvent?: string;
  condition?: string;
  cost?: string;
  text?: string;
  steps?: V1Step[];
  declined?: boolean;
  optional?: boolean;
}

const TRIGGER_MAP: Record<string, { event: EventName; step?: Phase }> = {
  etb: { event: "etb" },
  dies: { event: "dies" },
  attacks: { event: "attack" },
  upkeep: { event: "begin_step", step: "upkeep" },
  end_step: { event: "begin_step", step: "end_step" },
  beginning_of_combat: { event: "begin_step", step: "beginning_of_combat" },
  combat_damage_to_player: { event: "deals_combat_damage_to_player" },
  cast: { event: "cast" },
  other: { event: "unspecified" }
};

// v1 step kinds that carry a targetType-style field, and which field.
const TARGET_FIELD: Record<string, string> = {
  destroy_target: "targetType", exile_target: "targetType", bounce_target: "targetType",
  tap_target: "targetType", untap_target: "targetType", pump_target: "targetType",
  damage_target: "damageTargetType"
};

function filterForTargetType(tt: string): ObjectFilter {
  if (tt === "permanent") return {};
  if (tt === "nonland_permanent") return { notTypes: ["land"] };
  return { types: [tt] };
}

function costAtom(part: string): Cost {
  const p = part.trim();
  if (/^(\{[^}]+\})+$/.test(p) && !/\{T\}|\{Q\}/i.test(p)) return { mana: p };
  if (/^\{T\}$/i.test(p)) return { tap: "self" };
  return { unsupported: p };
}

export function liftCostString(cost: string): Cost[] | undefined {
  const s = cost.trim();
  if (!s) return undefined;
  return s.split(/,\s*/).filter(Boolean).map(costAtom);
}

export function liftV1Ability(a: V1Ability, index: number): Ability {
  const text = a.text ?? "";
  const isMana = a.kind === "activated" && /\badd \{/i.test(text);
  const out: Ability = {
    id: `a${index + 1}`,
    kind: isMana ? "mana" : a.kind,
    text,
    legacy: {
      ...(a.condition ? { condition: a.condition } : {}),
      ...(a.cost ? { cost: a.cost } : {}),
      ...(a.triggerEvent ? { triggerEvent: a.triggerEvent } : {})
    }
  };
  if (!Object.keys(out.legacy!).length) delete out.legacy;
  if (a.declined) out.declined = true;
  if (a.optional) out.optional = true;

  if (a.condition?.trim()) {
    out.conditions = [{ when: "on_resolution", if: { unsupported: a.condition.trim() } }];
  }
  const costs = a.cost ? liftCostString(a.cost) : undefined;
  if (costs) out.costs = costs;
  if (a.kind === "triggered" && a.triggerEvent) out.trigger = { ...(TRIGGER_MAP[a.triggerEvent] ?? { event: "unspecified" as const }) };

  // steps verbatim, synthesizing targets[] from targetType fields
  const targets: TargetSpec[] = [];
  const steps: Step[] = (a.steps ?? []).map((s) => {
    const step = { ...s } as Step;
    const field = TARGET_FIELD[s.kind];
    const tt = field ? (s[field] as string | undefined) : undefined;
    if (tt) {
      const id = `t${targets.length + 1}`;
      const what = s.kind === "damage_target" ? (tt === "player" ? "player" : tt === "any" ? "any" : "object") : "object";
      targets.push({
        id, what,
        ...(what === "object" ? { filter: s.kind === "damage_target" ? { types: ["creature"] } : filterForTargetType(tt) } : {}),
        count: { min: 1, max: 1 }
      });
      step.target = id;
    }
    return step;
  });
  if (targets.length) out.targets = targets;
  if (steps.length) out.steps = steps;
  return out;
}

export function liftV1Card(abilities: V1Ability[]): Card {
  return {
    schemaVersion: 2,
    abilities: abilities.map(liftV1Ability),
    review: { status: "draft" }
  };
}
