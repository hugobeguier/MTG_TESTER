import { NextResponse, type NextRequest } from "next/server";
import { isRemoteApiBlocked } from "./src/lib/multiplayer/apiGuard";

// Blocks non-multiplayer /api routes for non-loopback Host headers (see apiGuard.ts).
export function middleware(request: NextRequest) {
  const blocked = isRemoteApiBlocked(request.headers.get("host"), request.nextUrl.pathname, {
    MP_ALLOW_REMOTE_API: process.env.MP_ALLOW_REMOTE_API
  });
  if (blocked) {
    return NextResponse.json({ error: "This route is only available on the host machine" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
