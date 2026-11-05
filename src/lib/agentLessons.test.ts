import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAgentChatSystemPrompt, formatDecisionForChat, formatLessonsForPrompt, lessonsForAgent, mentionedSeatNames, summarizeSituation, type AgentLesson } from "./agentLessons";

const lesson = (overrides: Partial<AgentLesson>): AgentLesson => ({
  id: "1",
  createdAt: "2026-10-08T10:00:00.000Z",
  agentName: "Malik",
  purpose: "main_phase",
  situation: "Turn 5, main phase.",
  chose: "cast Ghalta",
  advice: "Attack first, then cast creatures after combat.",
  ...overrides
});

describe("agent lessons", () => {
  it("summarises the board the agent was looking at", () => {
    const text = summarizeSituation({
      purpose: "main_phase",
      phase: "precombat main phase",
      turn: 5,
      you: { name: "Malik", life: 31, hand: [{ name: "Sol Ring" }], battlefield: [{ name: "Hulking Raptor", power: "5", toughness: "5", tapped: true }] },
      opponents: [{ name: "Sable", life: 40, battlefield: [{ name: "Serra Angel", power: "4", toughness: "4" }] }]
    });
    expect(text).toContain("Turn 5, precombat main phase");
    expect(text).toContain("Hand: Sol Ring");
    expect(text).toContain("Hulking Raptor 5/5 (tapped)");
    expect(text).toContain("Sable: 40 life");
  });

  it("puts lessons for the same kind of decision first, newest first, and limits them", () => {
    const lessons = [lesson({ id: "a", purpose: "declare_attackers", advice: "ATTACK ADVICE", createdAt: "2026-10-09T00:00:00.000Z" }), lesson({ id: "b", advice: "OLD MAIN" }), lesson({ id: "c", advice: "NEW MAIN", createdAt: "2026-10-09T00:00:00.000Z" })];
    const text = formatLessonsForPrompt(lessons, "main_phase", 2)!;
    expect(text.indexOf("NEW MAIN")).toBeLessThan(text.indexOf("OLD MAIN"));
    expect(text).not.toContain("ATTACK ADVICE");
    expect(formatLessonsForPrompt([], "main_phase")).toBeUndefined();
  });

  it("shows the chosen option and its score to the chat", () => {
    const text = formatDecisionForChat({
      purpose: "main_phase",
      situation: "Turn 5",
      options: [
        { id: "x", label: "cast Ghalta", score: 12 },
        { id: "y", label: "attack", score: 4, reasons: ["no blockers"] }
      ],
      chosenId: "x",
      chosenLabel: "cast Ghalta",
      reason: "biggest threat"
    });
    expect(text).toContain("cast Ghalta (heuristic score 12)  <- CHOSEN");
    expect(text).toContain("attack (heuristic score 4): no blockers");
  });
});

describe("lesson storage and routes", () => {
  const original = process.cwd();
  let dir: string | undefined;
  afterEach(() => {
    process.chdir(original);
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
    vi.resetModules();
  });

  it("saves lessons to disk, lists them and deletes them", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "lessons-"));
    process.chdir(dir);
    vi.resetModules();
    const store = await import("./agentLessonStore");
    expect(await store.readLessons()).toEqual([]);
    const saved = await store.addLesson({ agentName: "Malik", purpose: "main_phase", situation: "s", chose: "c", advice: "do this instead" });
    expect((await store.readLessons()).map((entry) => entry.advice)).toEqual(["do this instead"]);
    // A fresh process (module reload) still sees it: it really is on disk.
    vi.resetModules();
    const reloaded = await import("./agentLessonStore");
    expect((await reloaded.readLessons())[0].id).toBe(saved.id);
    await reloaded.deleteLesson(saved.id);
    expect(await reloaded.readLessons()).toEqual([]);
  });
});

describe("card texts for the agent chat", () => {
  it("attaches the exact Oracle text of the cards a question mentions, longest name first", async () => {
    const { cardTextsMentioned } = await import("./agentLessons");
    const cards = [
      { name: "Swords to Plowshares", typeLine: "Instant", oracleText: "Exile target creature. Its controller gains life equal to its power." },
      { name: "Umbral Collar Zealot", typeLine: "Creature — Zombie", oracleText: "Sacrifice another creature or artifact: Surveil 1." },
      { name: "Plains", typeLine: "Basic Land", oracleText: "" }
    ];
    const text = cardTextsMentioned("Why did you use Swords to Plowshares on the Umbral Collar Zealot?", cards);
    expect(text).toContain("Its controller gains life equal to its power");
    expect(text).toContain("Sacrifice another creature or artifact");
    expect(text).not.toContain("Plains");
    expect(cardTextsMentioned("nothing relevant here", cards)).toBe("");
  });
});

describe("agent chat prompt is pinned to the selected seat", () => {
  const base = { seatName: "Malik", otherSeatNames: ["Veyra", "Human"], decisionText: "The decision being discussed:\nDeathbonnet Hulk attacked.", eventsText: "- [Veyra] Veyra has no creatures to block with." };
  it("names the other players, tags log lines and says only the selected seat answers", () => {
    const prompt = buildAgentChatSystemPrompt(base);
    expect(prompt).toContain("You are Malik");
    expect(prompt).toContain("The other players are: Veyra, Human");
    expect(prompt).toContain("only lines tagged [Malik] are yours");
    expect(prompt).toContain("- [Veyra] Veyra has no creatures to block with.");
    expect(prompt).not.toContain("You are Veyra");
  });
  it("adds an extra pin when the human mentions another seat", () => {
    expect(mentionedSeatNames("I was talking about Malik not Veyra", ["Malik", "Veyra", "Human"])).toEqual(["Malik", "Veyra"]);
    const prompt = buildAgentChatSystemPrompt({ ...base, humanMessages: ["I was talking about Malik not Veyra"] });
    expect(prompt).toContain("mention Malik, Veyra");
    expect(buildAgentChatSystemPrompt({ ...base, humanMessages: ["why?"] })).not.toContain("messages mention");
  });
  it("only that agent's saved lessons reach its chat", () => {
    const lessons = [lesson({ id: "m", agentName: "Malik" }), lesson({ id: "v", agentName: "Veyra" })];
    expect(lessonsForAgent(lessons, "Malik").map((l) => l.id)).toEqual(["m"]);
  });
});
