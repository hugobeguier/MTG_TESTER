import { z } from "zod";
import { bearerToken, hub, parseBody, respond } from "@/lib/multiplayer/routeUtil";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  toSeatId: z.string().min(1).max(64),
  snapshot: z.unknown(),
  rev: z.number().int().nonnegative()
});

export async function POST(req: Request) {
  return respond(async () => {
    const token = bearerToken(req);
    const b = await parseBody(req, Body);
    hub().publish(token, b.toSeatId, b.snapshot, b.rev);
  });
}
