import { describe, expect, it } from "vitest";
import { createRejectionLedger, decideWithGate, pickFallback, validateProposal, MAX_DECISION_REJECTIONS } from "./moveLegality";
import type { LegalAgentAction } from "@/components/AppFlow";

const act = (id: string, actionType: LegalAgentAction["actionType"], label = id): LegalAgentAction => ({ id, actionType, targetIds: [], label });
const cast = act("cast:a", "cast_spell", "cast A");
const land = act("play-land:l", "play_land", "play land");
const pass = act("pass-phase", "pass_priority", "pass this phase");

describe("validateProposal", () => {
  it("accepts a currently legal id", () => {
    const verdict = validateProposal("cast:a", [cast, pass]);
    expect(verdict.legal).toBe(true);
  });
  it("rejects a hallucinated / stale id with a reason", () => {
    const verdict = validateProposal("cast:gone", [cast, pass]);
    expect(verdict).toMatchObject({ legal: false, code: "stale" });
  });
  it("rejects a missing id and an already-rejected id", () => {
    expect(validateProposal(undefined, [cast])).toMatchObject({ legal: false, code: "unknown_action" });
    expect(validateProposal("cast:a", [cast], new Set(["cast:a"]))).toMatchObject({ legal: false, code: "excluded" });
  });
});

describe("rejection ledger", () => {
  it("excludes rejected ids, writes prompt notes and reports exhaustion at the cap", () => {
    const ledger = createRejectionLedger(2);
    ledger.reject(cast, "no legal target");
    expect(ledger.excluded.has("cast:a")).toBe(true);
    expect(ledger.notesForPrompt()[0]).toContain("no legal target");
    expect(ledger.exhausted()).toBe(false);
    ledger.reject(land, "land drop used");
    expect(ledger.exhausted()).toBe(true);
  });
});

describe("pickFallback", () => {
  it("prefers real plays over passing, skips excluded ones, and passes when nothing else remains", () => {
    expect(pickFallback([pass, land, cast], new Set())?.id).toBe("cast:a");
    expect(pickFallback([pass, land, cast], new Set(["cast:a"]))?.id).toBe("play-land:l");
    expect(pickFallback([pass, land, cast], new Set(["cast:a", "play-land:l"]))?.id).toBe("pass-phase");
    expect(pickFallback([pass, land, cast], new Set(), true)?.id).toBe("pass-phase");
    expect(pickFallback([cast], new Set(["cast:a"]))).toBeUndefined();
  });
});

describe("decideWithGate", () => {
  it("rejects a stale proposal, re-asks without it, and accepts the next legal answer", async () => {
    let live = [cast, land, pass];
    const asked: string[][] = [];
    const rejected: string[] = [];
    const result = await decideWithGate({
      regenerate: () => live,
      ask: async (options) => {
        asked.push(options.map((item) => item.id));
        // The first answer names a card that was played in the meantime (state changed while the model was thinking).
        if (asked.length === 1) {
          live = [land, pass];
          return { legalActionId: "cast:a" };
        }
        return { legalActionId: "play-land:l" };
      },
      onReject: (rejection) => rejected.push(`${rejection.label}`)
    });
    expect(result.action?.id).toBe("play-land:l");
    expect(result.source).toBe("proposal");
    expect(rejected).toEqual(["cast A"]);
    expect(asked[1]).not.toContain("cast:a");
  });

  it("engine-level rejection (check) excludes the action and the seat decides again", async () => {
    const result = await decideWithGate({
      regenerate: () => [cast, land, pass],
      ask: async (options) => ({ legalActionId: options[0].id }),
      check: (candidate) => (candidate.id === "cast:a" ? { legal: false, reason: "no legal target", code: "illegal" } : { legal: true })
    });
    expect(result.action?.id).toBe("play-land:l");
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toBe("no legal target");
  });

  it("never loops forever: a model that keeps naming the same bad id ends in the deterministic fallback after a bounded number of asks", async () => {
    let asks = 0;
    const result = await decideWithGate({
      regenerate: () => [cast, land, pass],
      ask: async () => {
        asks += 1;
        return { legalActionId: "cast:a" };
      },
      check: (candidate) => (candidate.id === "cast:a" ? { legal: false, reason: "cannot pay", code: "illegal" } : { legal: true })
    });
    expect(asks).toBeLessThanOrEqual(MAX_DECISION_REJECTIONS + 1);
    expect(result.action?.id).toBe("play-land:l");
    expect(result.source).toBe("fallback");
  });

  it("when everything is rejected the answer is pass, and when nothing is legal at all it is no action", async () => {
    const allBad = await decideWithGate({
      regenerate: () => [cast, pass],
      ask: async (options) => ({ legalActionId: options[0].id }),
      check: (candidate) => (candidate.actionType === "cast_spell" ? { legal: false, reason: "x", code: "illegal" } : { legal: true })
    });
    expect(allBad.action?.id).toBe("pass-phase");
    const nothing = await decideWithGate({ regenerate: () => [], ask: async () => undefined });
    expect(nothing.action).toBeUndefined();
    expect(nothing.source).toBe("none");
  });

  it("an LLM that returns nothing usable falls back immediately without rejections", async () => {
    const result = await decideWithGate({ regenerate: () => [land, pass], ask: async () => undefined });
    expect(result.action?.id).toBe("play-land:l");
    expect(result.rejections).toHaveLength(0);
  });

  it("combat declarations fall back to declaring nothing", async () => {
    const attack = act("attack:x", "attack", "attack with X");
    const noAttack = act("no-attacks", "pass_priority", "declare no attackers");
    const result = await decideWithGate({
      regenerate: () => [attack, noAttack],
      ask: async () => ({ legalActionId: "attack:x" }),
      check: (candidate) => (candidate.id === "attack:x" ? { legal: false, reason: "tapped", code: "illegal" } : { legal: true }),
      preferPass: true
    });
    expect(result.action?.id).toBe("no-attacks");
  });
});
