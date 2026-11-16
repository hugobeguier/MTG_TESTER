// Module-level agent runtime plumbing used by AppFlow: request timeouts / pacing, model warm-up, the rule-workflow and
// primitive-plan caches (localStorage-backed), priority-stop settings persistence, advisor logging and the card-text pre-warm pass.
// Extracted verbatim from components/AppFlow.tsx; AppFlow.tsx re-exports the previously public symbols.

import { shouldConsultRulesAdvisor } from "@/engine/priority";
import { isLandCard } from "@/engine/shared";
import { type PendingAction } from "@/engine/types";
import { type PrimitiveActionPlan } from "@/lib/primitiveActionPlan";
import { DEFAULT_STOP_SETTINGS, type PriorityStopSettings } from "@/lib/priorityStops";
import { type RuleWorkflow } from "@/lib/rulesAdvisor";
import { type PlayerSeat, type VisibleCard } from "@/lib/types";

// TURN_PHASES itself now lives in src/lib/priorityStops.ts (imported above) — single source of
// truth shared with ThreeGameTable's PriorityStopsModal grid, see that module's own comment.

// Defense-in-depth: the server-side Ollama fetches (src/lib/ollama.ts, src/lib/rulesAdvisor.ts)
// already have their own shorter timeouts and fall back gracefully on expiry, so these client
// fetches should rarely fire — but if the route itself ever hangs (not just Ollama), this stops an
// unbounded `await fetch(...)` from skipping the calling function's `finally` block, which is what
// clears the "a decision is in flight" guard (agentDecisionRequests) that would otherwise lock a
// phase out of ever being retried.
export const AGENT_REQUEST_TIMEOUT_MS = 45000;

// The resolving "beat": how long a spell/ability/trigger stays visibly "Resolving…" on the stack once everyone has passed, before its effect is
// applied, so it can be read instead of flashing past. localStorage "mtg-stack-beat" is a multiplier (1 = default, 0 = off, 2 = twice as long).
export function stackBeatMs(action: PendingAction): number {
  if (action.type === "phase") return 0;
  let scale = 1;
  try {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("mtg-stack-beat") : null;
    const parsed = stored === null ? NaN : Number(stored);
    if (Number.isFinite(parsed) && parsed >= 0) scale = parsed;
  } catch {
    // storage unavailable: default beat
  }
  return Math.round((action.type === "spell" ? 1800 : 1200) * scale);
}

// In-memory cap on session.events (newest first). Generous: a full Commander game is a few thousand lines.
export const MAX_SESSION_EVENTS = 5000;

// Fixed "let the human watch" pauses between agent steps. They never affect a decision, only wall-clock time, so they scale by one
// setting: localStorage "mtg-agent-pace" = a multiplier (1 = the original pacing, 0 = instant). Default 0.3 keeps each step visible.
export function agentPaceMs(baseMs: number): number {
  let scale = 0.3;
  try {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("mtg-agent-pace") : null;
    const parsed = stored === null ? NaN : Number(stored);
    if (Number.isFinite(parsed) && parsed >= 0) scale = parsed;
  } catch {
    // storage unavailable: keep the default
  }
  return Math.round(baseMs * scale);
}

// Generous enough to cover Ollama's own OLLAMA_WARMUP_TIMEOUT_MS (120s) plus round-trip overhead —
// this fetch is meant to sit through whatever cold-load time the model needs, unlike
// AGENT_REQUEST_TIMEOUT_MS above which guards a real, time-boxed decision.
const AGENT_WARMUP_TIMEOUT_MS = 125000;

// Absorbs a seat's own Ollama model's cold-load time (see warmUpOllamaModel in lib/ollama.ts) before
// its first real decision request, which has a much tighter timeout. Best-effort and silent: a
// failed or slow warm-up just means the next real request pays the cold-load cost itself, exactly as
// it would without this call.
export async function warmUpAgentModel(agentName: string) {
  try {
    await fetch("/api/agents/warmup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(AGENT_WARMUP_TIMEOUT_MS),
      body: JSON.stringify({ agentName })
    });
  } catch {
    // Swallowed — see comment above.
  }
}

// A RuleWorkflow classification is a pure function of (event, the card's own oracle text) —
// deterministicRuleWorkflow only ever reads those two fields, and the Ollama fallback's
// classification is meant to be one too even though it's also handed board-state context (that
// context is for picking sensible warnings/targets, not for changing what kind of effect a fixed
// piece of oracle text fundamentally is). So a classification learned once from any real encounter
// (either seat, this game or an earlier one via the localStorage-backed persistence below) is safe
// to reuse for every later encounter of the exact same card+event shape — both to skip a repeat
// Ollama round-trip, and to let agentCardSnapshot surface a plain-English "what this does" summary
// to the playing agent's own decision-making instead of it having to re-guess from raw oracle text
// alone every single time (see consultRulesAdvisor/agentCardSnapshot below).
// Bump this suffix whenever deterministicRuleWorkflow's classification logic changes — a stale
// localStorage entry keyed by (event, oracleText) permanently shadows any later code fix for that
// exact card, since the cache is checked BEFORE the classifier ever runs again. Reproduced live:
// Kodama's Reach was misclassified once (an earlier bug, since fixed in deterministicRuleWorkflow),
// which cached a wrong/incomplete workflow under this key — the classifier fix alone did nothing
// for that browser afterward, since every later cast just replayed the stale cached value (in this
// case as silently as workflow "none"/no-op) instead of ever reclassifying. Bumped to v2 here to
// flush every entry accumulated before this and the last several rules-engine classification fixes.
// Bumped again to v3 for a structural fix, not just a one-off flush: a deterministic classification
// (result.source === "deterministic") is a cheap, synchronous, local pattern match with no real cost
// to redo — from v3 on, only a genuine "ollama"-sourced result (the actually expensive path) is ever
// written into this cache at all (see saveRuleWorkflowCache's call sites), so this exact bug class —
// a rulesAdvisor.ts fix shadowed forever by a stale pre-fix cache entry — can't recur. Reproduced
// live: Buried Alive's maxChoices fix (already correct in code) stayed invisible in an existing
// browser session because its "up to three" classification had been cached as "one" before the fix.
const RULE_WORKFLOW_CACHE_STORAGE_KEY = "mtg-rule-workflow-cache-v3";
export const ruleWorkflowCache = new Map<string, RuleWorkflow>();
let ruleWorkflowCacheLoaded = false;

// The human player's priority-stop preferences (src/lib/priorityStops.ts) — the second thing this
// app persists to localStorage, and the first real user preference of any kind. Read once on mount
// (see the loadRuleWorkflowCacheOnce comment above for why this can't happen at module init: no
// localStorage during SSR) and written on every change.
const PRIORITY_STOP_SETTINGS_STORAGE_KEY = "mtg-priority-stop-settings-v1";

export function loadPriorityStopSettings(): PriorityStopSettings {
  if (typeof window === "undefined") return DEFAULT_STOP_SETTINGS;
  try {
    const raw = window.localStorage.getItem(PRIORITY_STOP_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_STOP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PriorityStopSettings>;
    return {
      phaseStops: parsed.phaseStops ?? DEFAULT_STOP_SETTINGS.phaseStops,
      stopOnStackResponse: parsed.stopOnStackResponse ?? DEFAULT_STOP_SETTINGS.stopOnStackResponse,
      stopOnAttacked: parsed.stopOnAttacked ?? DEFAULT_STOP_SETTINGS.stopOnAttacked,
      stopOnTargeted: parsed.stopOnTargeted ?? DEFAULT_STOP_SETTINGS.stopOnTargeted,
      stopOnChoicePrompt: parsed.stopOnChoicePrompt ?? DEFAULT_STOP_SETTINGS.stopOnChoicePrompt,
      fullControl: false // never persist "full control" left on from a previous session
    };
  } catch {
    // Corrupt/incompatible cache from an older shape — safe to ignore, falls back to defaults same
    // as any other cache miss.
    return DEFAULT_STOP_SETTINGS;
  }
}

export function savePriorityStopSettings(settings: PriorityStopSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PRIORITY_STOP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full/unavailable (private browsing, quota, ...) — the in-memory setting still works
    // for the rest of this session, it just won't survive a reload.
  }
}

export function ruleWorkflowCacheKey(event: string, oracleText: string) {
  return `${event}::${oracleText}`;
}

// Sibling to ruleWorkflowCache above, same (event, oracleText) key shape, for the primitive-action
// planner instead of the rule-workflow advisor — deliberately in-memory only for now (no
// localStorage persistence, no prewarming) to keep this first pass small; ruleWorkflowCache's own
// persistence/prewarm machinery is a reasonable follow-up once this fallback has real usage data.
// usedXMageGrounding rides along with the cached plan (not just the plan alone) so a cache hit on a
// repeat of the same trigger within this session still reports accurately whether XMage grounding
// was involved in producing it — see xmageGrounding.ts / mtg-commander-engine-spec.md Phase 3a.
export const primitiveActionPlanCache = new Map<string, { plan: PrimitiveActionPlan; usedXMageGrounding: boolean }>();

export function loadRuleWorkflowCacheOnce() {
  if (ruleWorkflowCacheLoaded || typeof window === "undefined") return;
  ruleWorkflowCacheLoaded = true;
  try {
    const raw = window.localStorage.getItem(RULE_WORKFLOW_CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, RuleWorkflow>;
    for (const [key, value] of Object.entries(parsed)) ruleWorkflowCache.set(key, value);
  } catch {
    // Corrupt/incompatible cache from an older shape — safe to ignore, everything just
    // re-classifies as if the cache were empty, same as any other cache miss.
  }
}

export function saveRuleWorkflowCache(key: string, workflow: RuleWorkflow) {
  ruleWorkflowCache.set(key, workflow);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RULE_WORKFLOW_CACHE_STORAGE_KEY, JSON.stringify(Object.fromEntries(ruleWorkflowCache)));
  } catch {
    // Storage full/unavailable (private browsing, quota, ...) — the in-memory cache still works
    // for the rest of this session, it just won't survive a reload.
  }
}

// Every cached classification whose key matches this card's exact oracle text, regardless of which
// event it was originally learned from (an ETB trigger and a death trigger on the same card are
// cached under different keys but both describe the same physical card) — used by agentCardSnapshot
// to hand the playing agent's decision context a digest of what the rules advisor already
// established this card does, without needing a fresh consultation for every card it's holding.
export function cachedRuleSummariesForCard(oracleText: string): string[] {
  const suffix = `::${oracleText}`;
  const summaries: string[] = [];
  for (const [key, workflow] of ruleWorkflowCache) {
    if (!key.endsWith(suffix) || workflow.workflow === "none" || !workflow.summary) continue;
    summaries.push(workflow.summary);
  }
  return summaries;
}

const PREWARM_CONCURRENCY = 2;

async function runWithConcurrencyLimit<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await task(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Fire-and-forget, called once from startGame with every seat's full opening deck: classifies every
// unique card the rules advisor would ever plausibly need to look at, in the background, so the
// FIRST real encounter of a card during play already has a cached ruling too — not just the second-
// and-later ones consultRulesAdvisor's own cache check already covers. Never awaited by the caller;
// the game starts immediately and this just fills the cache in as it goes.
//
// Scoped to only the two event shapes the deterministic classifier's own eventRelevantOracleText
// meaningfully distinguishes: "land_played" for lands, "spell_resolved_to_battlefield" for every
// other permanent type. Bare Instants/Sorceries are deliberately skipped — their effects are read by
// parseRemovalEffect/parseZoneEffect/parseTargetedPump/parseMassPump directly at resolution time,
// never through consultRulesAdvisor, so there's no real gameplay path that would ever look up a
// cache entry keyed under either event for one; warming them would just be wasted requests. Death
// triggers and activated abilities aren't prewarmed either — a real, if incomplete, scope limit
// (the ETB shape this covers is what every rules-advisor bug found so far this session turned out
// to be), not an oversight.
// Diagnostic only: one entry per rules-advisor / primitive-planner consultation, so we can see which
// cards actually depend on the LLM paths (vs. the deterministic classifier) before deciding whether
// to remove them. Read it in the browser console via window.__advisorLog, or localStorage
// "mtg-advisor-log" (survives reloads, capped at 500 entries).
export function logAdvisorUse(entry: { path: string; source: string; card: string; event?: string; detail: string; oracleText?: string }) {
  const record = { at: new Date().toISOString(), ...entry };
  console.info("[advisor-log]", record);
  if (typeof window === "undefined") return;
  // Also appended to advisor-log.jsonl in the project root (via the dev server) so it can be reviewed
  // after a game. Skipped for deterministic hits, which are the engine working as intended.
  if (entry.source !== "deterministic" && typeof fetch === "function" && !process.env.VITEST) {
    void fetch("/api/rules/advisor-log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record) }).catch(() => {});
  }
  try {
    const w = window as unknown as { __advisorLog?: unknown[] };
    (w.__advisorLog ??= []).push(record);
    const stored = JSON.parse(window.localStorage.getItem("mtg-advisor-log") ?? "[]") as unknown[];
    stored.push(record);
    window.localStorage.setItem("mtg-advisor-log", JSON.stringify(stored.slice(-500)));
  } catch {
    // Logging must never affect gameplay.
  }
}

export async function prewarmRuleWorkflowCache(seats: PlayerSeat[]) {
  loadRuleWorkflowCacheOnce();
  const seen = new Set<string>();
  const candidates: Array<{ event: string; card: VisibleCard }> = [];
  for (const seat of seats) {
    const allCards = [...(seat.board.commander ? [seat.board.commander] : []), ...seat.board.hand, ...(seat.library ?? [])];
    for (const card of allCards) {
      if (!card.oracleText.trim()) continue;
      if (!isLandCard(card) && (card.typeLine.includes("Instant") || card.typeLine.includes("Sorcery"))) continue;
      const event = isLandCard(card) ? "land_played" : "spell_resolved_to_battlefield";
      const key = ruleWorkflowCacheKey(event, card.oracleText);
      if (seen.has(key) || ruleWorkflowCache.has(key) || !shouldConsultRulesAdvisor(event, card)) continue;
      seen.add(key);
      candidates.push({ event, card });
    }
  }
  if (candidates.length === 0) return;
  await runWithConcurrencyLimit(candidates, PREWARM_CONCURRENCY, async ({ event, card }) => {
    const key = ruleWorkflowCacheKey(event, card.oracleText);
    try {
      const response = await fetch("/api/rules/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(AGENT_REQUEST_TIMEOUT_MS),
        // "its controller" rather than a real seat name — this classification isn't tied to any
        // actual cast/trigger yet, and a real later encounter's own cache check (consultRulesAdvisor)
        // will only ever hit this same entry, never overwrite it with a seat-specific phrasing; the
        // generic wording reads fine either way ("Temple of Deceit instructs its controller to scry 1").
        body: JSON.stringify({ event, actorName: "its controller", sourceCard: card, battlefield: [], hand: [], graveyard: [], exile: [], libraryPreview: [] })
      });
      if (!response.ok) return;
      const result = (await response.json()) as { source: "deterministic" | "ollama" | "fallback"; workflow: RuleWorkflow };
      // Same "only cache genuine Ollama results" rule as consultRulesAdvisor's own save — a
      // deterministic classification costs nothing to redo, so there's no benefit to prewarming it
      // into the persistent cache, only the risk of it shadowing a later classifier fix.
      if (result.source === "ollama") saveRuleWorkflowCache(key, result.workflow);
    } catch {
      // Best-effort background warm-up — a failure here just means this card gets classified the
      // normal reactive way the first time it's actually played, same as before this existed.
    }
  });
}
