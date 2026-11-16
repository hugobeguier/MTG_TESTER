import { z } from "zod";
import { DEFAULT_MAX_GUESTS } from "@/lib/multiplayer/protocol";
import { hub, parseBody, respond } from "@/lib/multiplayer/routeUtil";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  hostName: z.string().min(1).max(40).default("Host"),
  maxGuests: z.number().int().min(1).max(7).default(DEFAULT_MAX_GUESTS)
});

export async function POST(req: Request) {
  return respond(async () => {
    const b = await parseBody(req, Body);
    return hub().createRoom(b.hostName, b.maxGuests);
  });
}
