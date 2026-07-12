import { readFile } from "node:fs/promises";
import path from "node:path";

const KNOWLEDGE_FILES = [
  "docs/agents/system.md",
  "docs/mtg/commander-rules.md",
  "docs/mtg/bracket-3-policy.md",
  "docs/mtg/deckbuilding-heuristics.md",
  "docs/mtg/gameplay-heuristics.md",
  "docs/evals/scoring.md"
];

export async function loadKnowledgePack() {
  const root = process.cwd();
  const chunks = await Promise.all(
    KNOWLEDGE_FILES.map(async (relativePath) => {
      try {
        const body = await readFile(path.join(root, relativePath), "utf8");
        return `# ${relativePath}\n${body}`;
      } catch {
        return "";
      }
    })
  );
  return chunks.filter(Boolean).join("\n\n---\n\n");
}
