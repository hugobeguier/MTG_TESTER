import { sseResponse } from "@/lib/multiplayer/routeUtil";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// EventSource cannot set headers, so the token travels in the query string here only.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  return sseResponse(req, token);
}
