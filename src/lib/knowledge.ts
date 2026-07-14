import { readFile } from "node:fs/promises";
import path from "node:path";

const SYSTEM_CONTRACT = "docs/agents/system.md";
const COMMANDER_RULES = "docs/mtg/commander-rules.md";
const GAMEPLAY_HEURISTICS = "docs/mtg/gameplay-heuristics.md";
const BRACKET_POLICY = "docs/mtg/bracket-3-policy.md";
const DECKBUILDING_HEURISTICS = "docs/mtg/deckbuilding-heuristics.md";

const DEFAULT_KNOWLEDGE_FILES = [SYSTEM_CONTRACT, COMMANDER_RULES, GAMEPLAY_HEURISTICS];

const KNOWLEDGE_FILES_BY_PURPOSE: Record<string, string[]> = {
  opening_hand_mulligan: [SYSTEM_CONTRACT, COMMANDER_RULES],
  main_phase: [SYSTEM_CONTRACT, COMMANDER_RULES, GAMEPLAY_HEURISTICS],
  declare_attackers: [SYSTEM_CONTRACT, COMMANDER_RULES, GAMEPLAY_HEURISTICS],
  priority_response: [SYSTEM_CONTRACT, COMMANDER_RULES, GAMEPLAY_HEURISTICS],
  declare_blockers: [SYSTEM_CONTRACT, COMMANDER_RULES, GAMEPLAY_HEURISTICS],
  deckbuilding: [SYSTEM_CONTRACT, COMMANDER_RULES, BRACKET_POLICY, DECKBUILDING_HEURISTICS]
};

// Static doc files read once per server process and reused across every agent decision request.
const fileCache = new Map<string, string>();

async function loadFile(relativePath: string): Promise<string> {
  const cached = fileCache.get(relativePath);
  if (cached !== undefined) return cached;
  const root = process.cwd();
  let chunk: string;
  try {
    const body = await readFile(path.join(root, relativePath), "utf8");
    chunk = `# ${relativePath}\n${body}`;
  } catch {
    chunk = "";
  }
  fileCache.set(relativePath, chunk);
  return chunk;
}

export function knowledgeFilesForPurpose(purpose: string | undefined): string[] {
  if (purpose && KNOWLEDGE_FILES_BY_PURPOSE[purpose]) return KNOWLEDGE_FILES_BY_PURPOSE[purpose];
  return DEFAULT_KNOWLEDGE_FILES;
}

export async function loadKnowledgePack(files: string[] = DEFAULT_KNOWLEDGE_FILES) {
  const chunks = await Promise.all(files.map(loadFile));
  return chunks.filter(Boolean).join("\n\n---\n\n");
}
