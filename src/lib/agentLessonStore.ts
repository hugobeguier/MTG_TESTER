import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentLesson } from "./agentLessons";

// Server-side persistence for the lessons the human teaches the agents: one JSON file next to the card data, kept out of git (data/*.json).
const LESSON_FILE = path.join(process.cwd(), "data", "agent-lessons.json");

export async function readLessons(): Promise<AgentLesson[]> {
  try {
    const parsed = JSON.parse(await readFile(LESSON_FILE, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as AgentLesson[]) : [];
  } catch {
    return [];
  }
}

async function writeLessons(lessons: AgentLesson[]) {
  await mkdir(path.dirname(LESSON_FILE), { recursive: true });
  await writeFile(LESSON_FILE, JSON.stringify(lessons, null, 2), "utf8");
}

export async function addLesson(lesson: Omit<AgentLesson, "id" | "createdAt">): Promise<AgentLesson> {
  const saved: AgentLesson = { ...lesson, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  await writeLessons([...(await readLessons()), saved]);
  return saved;
}

export async function deleteLesson(id: string): Promise<void> {
  await writeLessons((await readLessons()).filter((lesson) => lesson.id !== id));
}
