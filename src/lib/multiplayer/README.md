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

## M3: host publisher + spectator guest

* `snapshot.ts` - `buildSnapshot(input, SPECTATOR_VIEWER, rev)` (pure): the host's game as a spectator may see it; `MpSnapshot` v1; no private data
  (hands stubbed, no libraries/decks/prompts). `view.ts` gained `SPECTATOR_VIEWER` (a viewer owning no seat).
* `connectionState.ts` - pure reducers for host/guest connection state, `PublishGate` (skip unchanged, increasing rev), `reconnectDelayMs`.
  `hostStatusStore.ts` carries host state to `MpHostPanel`. `intentProxy.ts` - guest->host intent seam (M3 read-only, M4 wires POST /api/mp/intent).
* UI: `components/game/useMpHost.ts`, `components/MpHostPanel.tsx`, `components/hooks/useMpGuest.ts`, `components/RemoteTable.tsx`,
  `app/mp/host/page.tsx`, `app/mp/join/page.tsx`.

Try it: build and start as usual (`npm run build`, `npm start`, port 3000; or `NEXT_DIST_DIR=.next-other npx next dev -p 3101` beside a running server).
Host: open `http://localhost:3000/mp/host` (must be localhost so the guarded API routes work), start a game; the panel shows the room code.
Friend (Hamachi): `http://<host-hamachi-ip>:3000/mp/join`, enter the code and a name; they watch the table live, read-only.
