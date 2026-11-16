import { bearerToken, hub, respond } from "@/lib/multiplayer/routeUtil";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  return respond(async () => {
    hub().closeRoom(bearerToken(req));
  });
}
