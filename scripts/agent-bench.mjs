// Regression benchmark for agent decision quality — runs the fixed scenarios in
// bench/agent-scenarios.mjs against the REAL /api/agents/action endpoint (same code path AppFlow.tsx
// uses in-game: system prompt, knowledge pack, heuristic pre-scoring, schema validation, all of it)
// and reports how many land on the expected call. This exists because a model swap, quant change, or
// system-prompt edit has no other feedback loop today besides "play a game and see if it feels
// dumber" — see the "agent decision quality" conversation this came out of.
//
// Requires the dev server already running (npm run dev) and Ollama reachable, same as playing the
// game normally — this deliberately does NOT reimplement or mock the decision path, so it catches
// real regressions in the actual system prompt/model, not a stand-in for it.
//
// Usage:
//   node scripts/agent-bench.mjs
//   node scripts/agent-bench.mjs --filter=block          (id or category substring)
//   node scripts/agent-bench.mjs --verbose                (print reason/deliberation for every scenario)
//   AGENT_BENCH_BASE_URL=http://127.0.0.1:3001 node scripts/agent-bench.mjs

import { scenarios } from "../bench/agent-scenarios.mjs";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const filterArg = args.find((arg) => arg.startsWith("--filter="));
const filter = filterArg?.slice("--filter=".length).toLowerCase();
const baseUrl = process.env.AGENT_BENCH_BASE_URL ?? "http://127.0.0.1:3001";

const selected = filter
  ? scenarios.filter((scenario) => scenario.id.toLowerCase().includes(filter) || scenario.category.toLowerCase().includes(filter))
  : scenarios;

if (selected.length === 0) {
  console.error(`No scenarios matched --filter=${filter}`);
  process.exit(1);
}

const results = [];
for (const scenario of selected) {
  results.push(await runScenario(scenario));
}

const passed = results.filter((result) => result.status === "pass").length;
const errored = results.filter((result) => result.status === "error").length;

console.log("\n" + "-".repeat(60));
console.log(`${passed}/${results.length} passed${errored > 0 ? ` (${errored} could not run — is the dev server/Ollama up?)` : ""}`);
process.exitCode = errored === results.length ? 1 : 0;

async function runScenario(scenario) {
  let response;
  try {
    response = await fetch(`${baseUrl}/api/agents/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentName: scenario.agentName,
        seatName: scenario.seatName,
        context: scenario.context,
        legalActions: scenario.legalActions
      })
    });
  } catch (error) {
    report(scenario, "error", `request failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return { scenario, status: "error" };
  }

  if (!response.ok) {
    report(scenario, "error", `HTTP ${response.status}`);
    return { scenario, status: "error" };
  }

  const body = await response.json();
  const chosenId = body.action?.legalActionId;
  const pass = scenario.acceptableLegalActionIds.includes(chosenId);
  const chosenLabel = scenario.legalActions.find((action) => action.id === chosenId)?.label ?? chosenId ?? "(none)";

  report(scenario, pass ? "pass" : "fail", `chose "${chosenLabel}" (source: ${body.source})`, body.action);
  return { scenario, status: pass ? "pass" : "fail" };
}

function report(scenario, status, detail, action) {
  const icon = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "ERR ";
  console.log(`[${icon}] ${scenario.id} (${scenario.category}) — ${detail}`);
  if (status === "fail") {
    const expectedLabels = scenario.acceptableLegalActionIds
      .map((id) => scenario.legalActions.find((action) => action.id === id)?.label ?? id)
      .join(" or ");
    console.log(`       expected: "${expectedLabels}"`);
    console.log(`       why: ${scenario.description}`);
  }
  if (verbose && action) {
    if (action.reason) console.log(`       reason: ${action.reason}`);
    if (action.deliberation) console.log(`       deliberation: ${action.deliberation}`);
  }
}
