// Lessons the human gives the agents by chatting with them about a decision ("here is what I would have done"). They are saved on disk between
// sessions (agentLessonStore.ts) and fed back into the agents' prompt (app/api/agents/action/route.ts).

export interface DecisionOption {
  id: string;
  label: string;
  score: number;
  reasons?: string[];
}

// What an agent decided and what it was looking at, kept with its AgentReasoning so it can be discussed afterwards.
export interface DecisionRecord {
  purpose: string;
  turn?: number;
  phase?: string;
  situation: string;
  options: DecisionOption[];
  chosenId?: string;
  chosenLabel: string;
  reason: string;
  deliberation?: string;
}

export interface AgentLesson {
  id: string;
  createdAt: string;
  agentName: string;
  purpose: string;
  situation: string;
  chose: string;
  advice: string;
}

interface SnapshotCard {
  name?: string;
  power?: string;
  toughness?: string;
  tapped?: boolean;
}

interface SnapshotSeat {
  name?: string;
  life?: number;
  hand?: SnapshotCard[] | { count?: number };
  battlefield?: SnapshotCard[];
  availableMana?: unknown;
}

function cardList(cards: SnapshotCard[] | undefined, limit = 14): string {
  if (!cards || cards.length === 0) return "nothing";
  const shown = cards.slice(0, limit).map((card) => (card.power !== undefined && card.toughness !== undefined ? `${card.name} ${card.power}/${card.toughness}${card.tapped ? " (tapped)" : ""}` : `${card.name ?? "?"}${card.tapped ? " (tapped)" : ""}`));
  return shown.join(", ") + (cards.length > limit ? `, +${cards.length - limit} more` : "");
}

// A compact plain-text description of the decision context (the same object the agent was given).
export function summarizeSituation(context: unknown): string {
  if (typeof context !== "object" || context === null) return "";
  const ctx = context as { purpose?: string; phase?: string; turn?: number; you?: SnapshotSeat; opponents?: SnapshotSeat[] };
  const lines: string[] = [];
  lines.push(`Turn ${ctx.turn ?? "?"}, ${ctx.phase ?? "unknown phase"} (${ctx.purpose ?? "decision"}).`);
  if (ctx.you) {
    const hand = Array.isArray(ctx.you.hand) ? cardList(ctx.you.hand) : `${(ctx.you.hand as { count?: number } | undefined)?.count ?? 0} cards`;
    lines.push(`You (${ctx.you.name}): ${ctx.you.life} life. Hand: ${hand}. Battlefield: ${cardList(ctx.you.battlefield)}.`);
  }
  for (const opponent of ctx.opponents ?? []) {
    lines.push(`${opponent.name}: ${opponent.life} life. Battlefield: ${cardList(opponent.battlefield)}.`);
  }
  return lines.join("\n");
}

// The saved lessons worth showing the agent for this kind of decision: the same purpose first, newest first.
export function formatLessonsForPrompt(lessons: AgentLesson[], purpose: string | undefined, limit = 8): string | undefined {
  if (lessons.length === 0) return undefined;
  const ranked = [...lessons].sort((a, b) => Number(b.purpose === purpose) - Number(a.purpose === purpose) || b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  return [
    "Lessons from the human player, learned from earlier games. Follow them when a situation matches, unless something concrete on the board",
    "says otherwise; mention it in `reason` when one of them decides your action.",
    ...ranked.map((lesson, index) => `${index + 1}. Situation: ${lesson.situation.replace(/\s+/g, " ").slice(0, 400)} You did: ${lesson.chose}. The human says: ${lesson.advice.replace(/\s+/g, " ").slice(0, 500)}`)
  ].join("\n");
}

// The exact Oracle text of every card the conversation mentions, so an explanation can only quote what a card really does (a small model asked
// "why Swords on the Zealot?" invented "creates Dragon tokens" and said the caster gains the life). Longest names first so "Swords to Plowshares" is
// found as itself, and the list is capped.
export function cardTextsMentioned(text: string, cards: Array<{ name: string; typeLine?: string; oracleText?: string }>, limit = 10): string {
  const haystack = text.toLowerCase();
  const found: Array<{ name: string; typeLine?: string; oracleText?: string }> = [];
  const seen = new Set<string>();
  for (const card of [...cards].sort((a, b) => b.name.length - a.name.length)) {
    const name = card.name.split(" // ")[0].toLowerCase();
    if (name.length < 4 || seen.has(name) || !haystack.includes(name)) continue;
    seen.add(name);
    found.push(card);
    if (found.length >= limit) break;
  }
  if (found.length === 0) return "";
  return (
    "Exact Oracle text of the cards mentioned (the ONLY source of truth about what a card does - never attribute any other ability to a card):\n" +
    found.map((card) => `- ${card.name}${card.typeLine ? " (" + card.typeLine + ")" : ""}: ${(card.oracleText ?? "").replace(/\n/g, " / ")}`).join("\n")
  );
}

export function formatDecisionForChat(decision: DecisionRecord): string {
  const options = decision.options
    .slice(0, 8)
    .map((option) => `- ${option.label} (heuristic score ${option.score})${option.id === decision.chosenId ? "  <- CHOSEN" : ""}${option.reasons?.length ? ": " + option.reasons.slice(0, 2).join("; ") : ""}`)
    .join("\n");
  return [
    "The decision being discussed:",
    decision.situation,
    "Options you were choosing between (higher heuristic score = generally better):",
    options || "(not recorded)",
    `You chose: ${decision.chosenLabel}`,
    `Your stated reason: ${decision.reason || "(none)"}`,
    decision.deliberation ? `Your internal deliberation: ${decision.deliberation}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}
