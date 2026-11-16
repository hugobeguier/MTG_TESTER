import { z } from "zod";
import { bearerToken, hub, parseBody, respond } from "@/lib/multiplayer/routeUtil";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1).max(100),
  args: z.array(z.unknown()).default([]),
  clientSeq: z.number().int().nonnegative()
});

export async function POST(req: Request) {
  return respond(async () => {
    const token = bearerToken(req);
    const b = await parseBody(req, Body);
    hub().intent(token, b.name, b.args, b.clientSeq);
  });
}
