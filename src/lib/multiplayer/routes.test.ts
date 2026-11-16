import { describe, expect, it } from "vitest";
import { POST as createRoom } from "../../../app/api/mp/rooms/route";
import { POST as joinRoom } from "../../../app/api/mp/rooms/[code]/join/route";
import { GET as stream } from "../../../app/api/mp/stream/route";
import { POST as publish } from "../../../app/api/mp/publish/route";
import { POST as intent } from "../../../app/api/mp/intent/route";
import { POST as kick } from "../../../app/api/mp/kick/route";
import { POST as close } from "../../../app/api/mp/close/route";

const post = (url: string, body: unknown, token?: string) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });

async function readUntil(res: Response, pred: (text: string) => boolean) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  for (let i = 0; i < 20 && !pred(text); i++) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
  }
  return { text, reader };
}

describe("/api/mp routes", () => {
  it("full flow: create, join, stream, intent, publish, kick, close", async () => {
    const created = await (await createRoom(post("/api/mp/rooms", { maxGuests: 2 }))).json();
    expect(created.roomCode).toHaveLength(6);

    const joinRes = await joinRoom(post("/x", { displayName: "Ann" }), {
      params: Promise.resolve({ code: created.roomCode })
    });
    const joined = await joinRes.json();
    expect(joined.seatId).toBe("guest-1");

    const hostAbort = new AbortController();
    const hostRes = await stream(
      new Request(`http://localhost/api/mp/stream?token=${created.hostToken}`, { signal: hostAbort.signal })
    );
    expect(hostRes.headers.get("content-type")).toBe("text/event-stream");
    expect(hostRes.headers.get("cache-control")).toContain("no-transform");
    const hostRead = await readUntil(hostRes, (t) => t.includes("host_ready"));
    expect(hostRead.text).toContain("host_ready");

    const guestAbort = new AbortController();
    const guestRes = await stream(
      new Request(`http://localhost/api/mp/stream?token=${joined.seatToken}`, { signal: guestAbort.signal })
    );
    const guestRead = await readUntil(guestRes, (t) => t.includes("welcome"));
    expect(guestRead.text).toContain('"type":"welcome"');

    expect((await intent(post("/api/mp/intent", { name: "go", args: [1], clientSeq: 1 }, joined.seatToken))).status).toBe(200);
    const hostMore = await readUntil({ body: { getReader: () => hostRead.reader } } as unknown as Response, (t) => t.includes('"intent"'));
    expect(hostMore.text).toContain('"fromSeatId":"guest-1"');

    expect((await publish(post("/api/mp/publish", { toSeatId: "all", snapshot: { a: 1 }, rev: 1 }, created.hostToken))).status).toBe(200);
    const snap = await readUntil({ body: { getReader: () => guestRead.reader } } as unknown as Response, (t) => t.includes("snapshot"));
    expect(snap.text).toContain('"rev":1');

    // auth + validation errors
    expect((await publish(post("/api/mp/publish", { toSeatId: "all", snapshot: {}, rev: 1 }, joined.seatToken))).status).toBe(401);
    expect((await publish(post("/api/mp/publish", { nope: true }, created.hostToken))).status).toBe(400);
    expect((await intent(post("/api/mp/intent", { name: "go", clientSeq: 2 }))).status).toBe(401);
    expect((await stream(new Request("http://localhost/api/mp/stream?token=bad"))).status).toBe(401);

    expect((await kick(post("/api/mp/kick", { seatId: "guest-1" }, created.hostToken))).status).toBe(200);
    expect((await close(post("/api/mp/close", {}, created.hostToken))).status).toBe(200);
    expect((await close(post("/api/mp/close", {}, created.hostToken))).status).toBe(401);
    hostAbort.abort();
    guestAbort.abort();
  });

  it("join returns 404 for an unknown room", async () => {
    const res = await joinRoom(post("/x", { displayName: "Ann" }), { params: Promise.resolve({ code: "ZZZZZZ" }) });
    expect(res.status).toBe(404);
  });
});
