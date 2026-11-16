// Host-only API guard. While hosting, the friends who reach this server over Hamachi must not be
// able to call the app's own API (decks, saves, LLM agents...). Only /api/mp/* is open to them.
// NOTE: this checks the Host header, which a hostile client can spoof. It is a friends-only
// measure, not security. Set MP_ALLOW_REMOTE_API=1 to disable it.

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function hostnameOf(hostHeader: string | null | undefined): string {
  const h = (hostHeader ?? "").trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end >= 0 ? h.slice(0, end + 1) : h;
  }
  return h.split(":")[0];
}

export function isRemoteApiBlocked(
  hostHeader: string | null | undefined,
  pathname: string,
  env: Record<string, string | undefined> = {}
): boolean {
  if (env.MP_ALLOW_REMOTE_API === "1") return false;
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return false;
  if (pathname === "/api/mp" || pathname.startsWith("/api/mp/")) return false;
  return !LOOPBACK.has(hostnameOf(hostHeader));
}
