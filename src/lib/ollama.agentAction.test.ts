import { afterEach, describe, expect, it, vi } from "vitest";
import { requestAgentAction } from "./ollama";

// Regression: an unbounded free-text "reason" made some mulligan decisions run to the 40s timeout
// (then fall back to the heuristic anyway). The request must carry a token cap and string length caps.
describe("requestAgentAction request caps", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubOllama() {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ message: { content: JSON.stringify({ actionType: "keep_hand", legalActionId: "keep-hand", targetIds: [], reason: "ok", fallbackAction: "pass_priority" }) } })
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("caps generated tokens and free-text lengths", async () => {
    const fetchMock = stubOllama();
    await requestAgentAction({ model: "m", system: "s", prompt: "p", baseUrl: "http://x" });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.options.num_predict).toBe(500);
    expect(body.format.properties.reason.maxLength).toBeGreaterThan(0);
    expect(body.format.properties.deliberation.maxLength).toBeGreaterThan(0);
  });

  it("allows a larger budget when deliberation is required", async () => {
    const fetchMock = stubOllama();
    await requestAgentAction({ model: "m", system: "s", prompt: "p", baseUrl: "http://x", requireDeliberation: true });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.options.num_predict).toBe(1500);
  });
});
