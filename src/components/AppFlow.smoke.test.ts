// Smoke test: server-renders <AppFlow/> (no DOM needed - react-dom/server) and checks the setup screen shows.
// Effects don't run under renderToString, so this exercises component construction, every hook call and the setup-screen JSX only.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createSession } from "@/lib/sessionStore";
import { AppFlow } from "./AppFlow";

describe("AppFlow smoke", () => {
  it("renders the setup screen without throwing", async () => {
    const session = await createSession();
    const html = renderToString(createElement(AppFlow, { initialSession: session, ollama: { ok: true, message: "ok" } }));
    expect(html).toContain("Deck Building");
    expect(html).toContain("PLAY");
  });
});
