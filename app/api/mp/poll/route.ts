import { hub, respond } from "@/lib/multiplayer/routeUtil";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Polling fallback for guests whose event stream is blocked or buffered by something between the two machines.
// The token travels in the query string (like /api/mp/stream); `after` is the id of the last message the guest applied.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const token = params.get("token") ?? "";
  const after = Math.max(0, Number(params.get("after")) || 0);
  return respond(() => hub().poll(token, after));
}
