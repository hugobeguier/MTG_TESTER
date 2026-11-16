import { z } from "zod";
import { hub, parseBody, respond } from "@/lib/multiplayer/routeUtil";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  displayName: z.string().min(1).max(40),
  // Present when reconnecting: resumes the same guest slot.
  seatToken: z.string().min(1).max(200).optional()
});

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return respond(async () => {
    const { code } = await ctx.params;
    const b = await parseBody(req, Body);
    return hub().join(code, b.displayName, b.seatToken);
  });
}
