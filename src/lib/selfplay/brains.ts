// Milestone 2 of the self-play plan built heuristicBrain; milestone 3 adds ollamaBrain below. Only
// heuristicBrain is imported by scripts/self-play.ts's default run, so `npm run selfplay` without
// `--ollama` still never depends on a running dev server or a live Ollama instance.
import { fallbackAction, scoreLegalActions, type ScoringContext } from "@/lib/actionScoring";
import type { LegalAgentAction } from "@/components/AppFlow";
import type { AgentAction } from "@/lib/types";

// What the orchestrator hands a brain at every decision point. Deliberately the same shape
// ollamaBrain will eventually take (purpose/legalActions/context map straight onto the fields the
// live /api/agents/action route already accepts) so swapping brains later doesn't touch the
// orchestrator's call sites.
export interface BrainRequest {
  seatId: string;
  seatName: string;
  purpose: string;
  legalActions: LegalAgentAction[];
  context: ScoringContext;
}

export interface BrainDecision {
  action: AgentAction;
  // Mirrors /api/agents/action's own `source` field (ollama/invalid/fallback) so the self-play
  // runner's per-seat decision-count breakdown means the same thing whether the seat behind it is
  // heuristicBrain (always "heuristic" here) or, from milestone 3 on, ollamaBrain.
  source: "heuristic" | "ollama" | "invalid" | "fallback";
}

export type Brain = (request: BrainRequest) => Promise<BrainDecision>;

// No LLM at all: score every legal action with the exact same deterministic scorer the live route
// falls back to (src/lib/actionScoring.ts), and always take the top-scored one. This is intentionally
// identical to what the live game does whenever Ollama is unavailable — heuristicBrain vs
// heuristicBrain is "the deterministic fallback playing itself," which is exactly the fast, no-network
// rules-engine fuzzer this milestone is for.
export const heuristicBrain: Brain = async (request) => {
  const scored = scoreLegalActions(request.legalActions, request.context);
  if (scored.length === 0) {
    throw new Error(`heuristicBrain got zero legal actions for seat ${request.seatId} (${request.purpose}) — the enumerator should always offer at least a pass/end_turn action.`);
  }
  const picked = fallbackAction(scored, `heuristic: top-scored action for ${request.purpose}`);
  return {
    source: "heuristic",
    action: {
      actionType: picked.actionType,
      legalActionId: picked.legalActionId,
      targetIds: picked.targetIds,
      cardId: picked.cardId,
      reason: picked.reason,
      fallbackAction: picked.fallbackAction
    }
  };
};

// Same base URL convention as scripts/agent-bench.mjs (AGENT_BENCH_BASE_URL) — a separate env var
// name since this is a different tool with its own default, but the same "point it at whichever dev
// server is already running" escape hatch.
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
// Same request timeout AppFlow.tsx's own requestAgentDecision uses for the identical fetch
// (AGENT_REQUEST_TIMEOUT_MS, AppFlow.tsx:936) — kept in sync deliberately rather than picking an
// independent number, since this is meant to exercise the exact same call the live game makes.
const OLLAMA_REQUEST_TIMEOUT_MS = 45000;

interface AgentActionResponse {
  source: "ollama" | "fallback" | "invalid";
  message?: string;
  action?: AgentAction;
}

// POSTs to the live /api/agents/action route — the same endpoint, same request shape, and same
// response contract (source: ollama/invalid/fallback) AppFlow.tsx's own requestAgentDecision uses
// in-game (AppFlow.tsx:2186), so the real system prompt, knowledge pack, and schema validation are
// all exercised, matching agent-bench.mjs's own "don't mock the decision path" philosophy. Requires
// the dev server (npm run dev) reachable at baseUrl and, for a real (non-fallback) decision, Ollama
// itself reachable — same requirements agent-bench.mjs already documents.
export function ollamaBrain(baseUrl: string = process.env.SELFPLAY_BASE_URL ?? DEFAULT_BASE_URL): Brain {
  return async (request) => {
    // Same "skip the network round trip when there's no real decision to make" shortcut
    // requestAgentDecision itself uses (AppFlow.tsx:2190) — a forced single legal action (e.g. only
    // pass_priority is legal) needs no judgment call, agent or heuristic. Tagged "ollama" rather than
    // a new source kind: this is a genuine, correct agent decision, not a fallback/invalid response,
    // and the live game treats it identically (no fallback event is ever logged for this case).
    if (request.legalActions.length === 1) {
      const only = request.legalActions[0];
      return {
        source: "ollama",
        action: {
          actionType: only.actionType,
          legalActionId: only.id,
          targetIds: only.targetIds,
          cardId: only.cardId,
          reason: "Only legal action available.",
          fallbackAction: only.actionType === "end_turn" ? "end_turn" : "pass_priority"
        }
      };
    }

    let body: AgentActionResponse;
    try {
      const response = await fetch(`${baseUrl}/api/agents/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(OLLAMA_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          agentName: request.seatName,
          seatName: request.seatName,
          context: request.context,
          legalActions: request.legalActions
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from /api/agents/action`);
      body = (await response.json()) as AgentActionResponse;
    } catch (error) {
      // The dev server itself is unreachable (not just Ollama behind it, which the route's own
      // try/catch already turns into a "fallback" response with source: "fallback") — score locally
      // with the exact same deterministic scorer the route falls back to, so a self-play run can
      // still report a meaningful result (and an accurate silent-fallback rate) instead of crashing
      // outright when the dev server isn't up.
      const scored = scoreLegalActions(request.legalActions, request.context);
      const picked = fallbackAction(scored, `dev server unreachable: ${error instanceof Error ? error.message : "unknown error"}`);
      return {
        source: "fallback",
        action: {
          actionType: picked.actionType,
          legalActionId: picked.legalActionId,
          targetIds: picked.targetIds,
          cardId: picked.cardId,
          reason: picked.reason,
          fallbackAction: picked.fallbackAction
        }
      };
    }

    if (!body.action) {
      // Should be unreachable (the route always sets `action` on every response branch), but decline
      // rather than guess if the response shape ever changes underneath this.
      const scored = scoreLegalActions(request.legalActions, request.context);
      const picked = fallbackAction(scored, "malformed /api/agents/action response (no action); using fallback.");
      return {
        source: "invalid",
        action: {
          actionType: picked.actionType,
          legalActionId: picked.legalActionId,
          targetIds: picked.targetIds,
          cardId: picked.cardId,
          reason: picked.reason,
          fallbackAction: picked.fallbackAction
        }
      };
    }

    return { source: body.source, action: body.action };
  };
}
