# src/lib/multiplayer - relay for friends-joining multiplayer

Host-browser-authoritative: the host's browser runs the engine; the Next server just relays.

* `protocol.ts` - message unions (host commands, guest commands, host/guest stream events), size/rate limits, `HubError`.
* `hub.ts` - `MultiplayerHub`: rooms (6-char code), host token, guest slots (`guest-1`, ...; the host maps them to game seats later),
  last snapshot per slot (replayed on (re)subscribe), intent forwarding with 64 KB / 30-per-second limits, kick, closeRoom, 6 h idle expiry.
* `routeUtil.ts` - thin-route helpers; `app/api/mp/*` routes: `rooms` (POST create), `rooms/[code]/join`, `stream` (SSE GET, `?token=`),
  `publish`, `intent`, `kick`, `close` (POST, `Authorization: Bearer`).
* `apiGuard.ts` + root `middleware.ts` - block non-`/api/mp` API routes for non-loopback Host headers (spoofable; friends-only).
  `MP_ALLOW_REMOTE_API=1` turns the guard off.

Flow: host `POST /rooms` -> opens `stream` with hostToken -> guest `POST /rooms/CODE/join` -> opens `stream` with seatToken ->
host sees `guest_joined`, publishes snapshots -> guest `POST /intent` -> host stream receives `intent`.
Debug UI: `/mp/debug` (not linked). Other files here (`view.ts`, `randomUuidPolyfill.ts`) are separate client-side helpers.
