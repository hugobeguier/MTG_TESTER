import { z } from "zod";
import type { InterpretedEffect } from "./types";

const AttackTaxOllamaSchema = z.object({
  isAttackTax: z.boolean(),
  amountPerAttacker: z.number().int().min(0).max(20).optional(),
  appliesTo: z.enum(["controller", "planeswalkers", "both"]).optional()
});

// Cheap pre-filter so we don't run the parser (or call Ollama) for the vast majority of
// permanents that obviously have nothing to do with attack restrictions.
export function looksLikeAttackTaxCandidate(oracleText: string): boolean {
  const text = oracleText.toLowerCase();
  return text.includes("attack") && (text.includes("pay") || text.includes("can't attack") || text.includes("cant attack"));
}

// Matches the exact templated text Wizards uses for this family of cards (Propaganda, Ghostly
// Prison, Sphere of Safety, Grand Melee, etc.), including the "{X}, where X is the number of
// <type> you control" variant so the tax stays accurate as the board changes instead of being
// cached as a stale number from whenever the permanent entered.
export function deterministicAttackTax(sourceCardId: string, sourceCardName: string, oracleText: string): InterpretedEffect | undefined {
  const text = oracleText.toLowerCase();
  const appliesTo: InterpretedEffect["appliesTo"] = text.includes("planeswalker") ? "both" : "controller";

  const dynamicMatch = text.match(
    /creatures can'?t attack you(?: or (?:a |planeswalkers? )?you control)? unless their controller pays \{x\} for each[^,.]*, where x is the number of ([a-z]+?)s? you control/
  );
  if (dynamicMatch && dynamicMatch[1] === "enchantment") {
    return {
      kind: "attack_tax",
      amountPerAttacker: 0,
      formula: "enchantment_count",
      appliesTo,
      sourceCardId,
      sourceCardName,
      interpretedBy: "deterministic"
    };
  }

  const fixedMatch = text.match(/creatures can'?t attack you(?: or (?:a |planeswalkers? )?you control)? unless their controller pays \{(\d+)\} for each/);
  if (fixedMatch) {
    return {
      kind: "attack_tax",
      amountPerAttacker: Number.parseInt(fixedMatch[1], 10),
      appliesTo,
      sourceCardId,
      sourceCardName,
      interpretedBy: "deterministic"
    };
  }

  return undefined;
}

export async function requestAttackTaxInterpretation(
  sourceCardId: string,
  sourceCardName: string,
  oracleText: string,
  baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"
): Promise<InterpretedEffect | undefined> {
  const model = process.env.OLLAMA_RULES_MODEL ?? process.env.OLLAMA_MODEL ?? "llama3.2";
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: {
        type: "object",
        properties: {
          isAttackTax: { type: "boolean" },
          amountPerAttacker: { type: "number" },
          appliesTo: { type: "string", enum: ["controller", "planeswalkers", "both"] }
        },
        required: ["isAttackTax"]
      },
      messages: [
        {
          role: "system",
          content:
            "You are an MTG rules classifier. Return JSON only. Determine whether the given card's oracle text imposes a mana tax opponents must pay to attack its controller or their planeswalkers (Propaganda-style effects: 'creatures can't attack you unless their controller pays {N} for each creature attacking'). If yes, set isAttackTax true, amountPerAttacker to the flat generic mana amount required per attacking creature (use 0 if the amount is variable/depends on board state you cannot determine), and appliesTo to 'controller', 'planeswalkers', or 'both'. If there is no such tax, set isAttackTax false and omit the other fields."
        },
        { role: "user", content: JSON.stringify({ name: sourceCardName, oracleText }) }
      ]
    })
  });

  if (!response.ok) throw new Error(`Ollama static-effect request failed with HTTP ${response.status}.`);

  const body = await response.json();
  const content = body.message?.content;
  if (typeof content !== "string") throw new Error("Ollama response did not include message.content.");

  const parsed = AttackTaxOllamaSchema.parse(JSON.parse(content));
  if (!parsed.isAttackTax) return undefined;

  return {
    kind: "attack_tax",
    amountPerAttacker: parsed.amountPerAttacker ?? 0,
    appliesTo: parsed.appliesTo ?? "controller",
    sourceCardId,
    sourceCardName,
    interpretedBy: "ollama"
  };
}

export function effectiveAttackTaxAmount(effect: InterpretedEffect, enchantmentCount: number): number {
  if (effect.formula === "enchantment_count") return enchantmentCount;
  return effect.amountPerAttacker;
}

// Deterministic-first, Ollama-fallback, mirroring requestRuleWorkflow in rulesAdvisor.ts. Skips
// the Ollama round-trip entirely for permanents whose text obviously isn't an attack tax.
export async function requestAttackTaxWorkflow(
  sourceCardId: string,
  sourceCardName: string,
  oracleText: string,
  baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"
): Promise<{ source: "deterministic" | "ollama"; effect: InterpretedEffect | undefined }> {
  const deterministic = deterministicAttackTax(sourceCardId, sourceCardName, oracleText);
  if (deterministic) return { source: "deterministic", effect: deterministic };
  if (!looksLikeAttackTaxCandidate(oracleText)) return { source: "deterministic", effect: undefined };

  const effect = await requestAttackTaxInterpretation(sourceCardId, sourceCardName, oracleText, baseUrl);
  return { source: "ollama", effect };
}
