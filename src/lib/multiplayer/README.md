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

## M4 stage 2: lobby

* `lobby.ts` (+ test) - pure: lobby intents (`lobby_take_seat`, `lobby_leave_seat`, `lobby_set_deck`; zod whitelist + size clamps), seat claim/release,
  `lobbyBlockers` (PLAY readiness), `buildLobbyMessage` (per-guest `LobbyMessage` v1), guest-side remembered decks.
* Host: `components/game/useMpLobby.ts` (called by `useMpHost`) publishes lobby messages and applies guest intents to the setup configs; decks go
  through the same `buildDeck` as the setup form. `components/LobbyHostPanel.tsx` (Kick / Free seat) on the setup screen.
* Guest: `useMpGuest.sendIntent` -> `POST /api/mp/intent`; `components/LobbyScreen.tsx` (take/leave seat, host deck list, own saved decks, new deck).
* Flow: host sets a seat to "Open for a friend" -> friend joins with the room code -> lobby -> takes seat + chooses deck -> host PLAY enabled when all
  friend seats are taken and valid. After Play friends are still spectators.

## M4 stage 3: per-seat snapshots + opening hand

* `snapshot.ts` v2: `buildSnapshot(input, viewer)` where viewer is `SPECTATOR_VIEWER` or a seat id. A seated friend's snapshot has `mySeatId`, their own hand face-up
  as the table's only `human`, `myManaPool`, and (during the mulligan step) `mulligan {kept, returnCardIds, returnRequired}`; every other seat's hand/library/deck/prompt
  stays hidden (`seatSnapshot.test.ts` is the leak test). `useMpHost` publishes one snapshot per connected guest slot (own `PublishGate` each; slot -> seat via `seatMap.ts`),
  a guest without a seat is a spectator.
* `mulliganGate.ts` - pure: which human seats are undecided, "last to keep" (that keep starts the game), London-mulligan return count.
* `intentDispatch.ts` - pure: `IntentQueue` (in order, drops duplicate/old `clientSeq` per slot) + `dispatchIntent(registry, event, seatOfSlot)` (whitelist, zod args,
  seat check, acting seat forced to the sender's seat). Host glue + the registry: `components/game/mpIntents.ts` (one queued intent per React commit, because handlers
  close over render-time state). `intentProxy.ts` `ACTING_GUEST_INTENTS` must match that registry (stage 3: `onKeepHand`, `onMulligan`, `onToggleMulliganReturnCard`).
* Mulligans run in parallel: host handlers take an optional seat id; the game goes to "playing" when the last human seat keeps. A friend's leylines are auto-played (not asked yet).
* `RemoteTable` for a seated friend passes `guestReadOnly` to `ThreeGameTable` (hand selectable/inspectable, all action controls off).

## M4 stage 4: friends play their seat

* `remoteSeatPolicy.ts` + `seatStops.ts`: `remoteSeatsCanAct = true`; a remote seat is asked for priority by the SAME rules/defaults as the host (stack response, attacked, own main phases / declare attackers, ...) using ITS OWN
  `PriorityStopSettings` (`priorityStopSettings.bySeat[seatId]`, kept in game context `seatStops`; friend toggles Full Control / Stop Next / the grid through the `settings` intents; sent back as `snapshot.myStops`).
  No legal response = never waited on. `dragOverlay.ts`: friend-side optimistic card drag (only the drop is sent). `publishTiming.ts`: 40 ms lead / 120 ms min interval publish; snapshots carry no `seat.deck`.
* `intentSpecs.ts` (pure, shared): every wire intent = zod args + `when` (which game state allows it) + `seatArgs` (must equal the sender's seat). `intentProxy.ts` (guest) takes
  arity from it; `components/game/mpIntents.ts` (host) builds the registry from it and maps each name to the host handler (handlers take a seat id; one intent per React commit).
  Each processed intent is acked (`MpSnapshot.ack`: clientSeq + error text) and RemoteTable shows refusals as a toast.
* `seatPrompts.ts` (pure): per-seat prompts (rule/block/mana/library-look/search boxes, hand hints, attack targets, stack notes) in `MpSnapshot.prompts` for the viewer's seat only
  (leak test in `seatSnapshot.test.ts`). `viewerText.ts` rewrites the host's "You ..." log lines for guests.
* Disconnect: a seated friend whose slot is not connected pauses the game (`ctx.mpPausedFor`; useGameEffects treats the stage as "paused"; intents refused; banner on both sides).
* Host-only controls are hidden for friends (`guestActing`); Save is hidden in /mp/host.
