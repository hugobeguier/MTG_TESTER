// Guest -> host intents. The table's `on*` props are id-only callbacks, so a guest can forward them as {name, args}. M3 is read-only: `send` only
// records/ignores. M4 swaps `send` for a POST to /api/mp/intent (the host maps `name` back to its handler) without touching RemoteTable.
export type IntentSender = (name: string, args: unknown[]) => void;

/** M3 sender: ignores everything (spectators cannot act). Keeps the last few attempts for debugging. */
export function createReadOnlySender(log: Array<{ name: string; args: unknown[] }> = []): IntentSender {
  return (name, args) => {
    log.push({ name, args });
    if (log.length > 20) log.shift();
  };
}

/**
 * Table callback props a seated guest may use. Must stay in step with the host's whitelist (components/game/mpIntents.ts buildMpIntentRegistry): a name
 * missing there is refused by the host. Stage 3 = the opening-hand step only; the spectator gets none (ThreeGameTable hides/disables controls without them).
 * Later stages add onPlayCard, onPassPriority, onDeclareAttack, ... here and in the host registry.
 */
export const ACTING_GUEST_INTENTS = ["onKeepHand", "onMulligan", "onToggleMulliganReturnCard"] as const;

/**
 * The table hands some callbacks whole objects (a VisibleCard); the wire only carries ids, so the host never reads card data a guest made up
 * (and the intent stays tiny). Callbacks not listed here are sent as they are.
 */
export const INTENT_ARG_ENCODERS: Record<string, (args: unknown[]) => unknown[]> = {
  onKeepHand: () => [], // the table passes the click event; never forward it
  onMulligan: () => [],
  onToggleMulliganReturnCard: ([card]) => [typeof card === "object" && card !== null ? (card as { id?: unknown }).id : card]
};

/** Builds `{onFoo: (...args) => send("onFoo", args)}` for the given callback names. */
export function createIntentHandlers(send: IntentSender, names: readonly string[] = ACTING_GUEST_INTENTS): Record<string, (...args: unknown[]) => void> {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  for (const name of names) handlers[name] = (...args: unknown[]) => send(name, INTENT_ARG_ENCODERS[name]?.(args) ?? args);
  return handlers;
}

/** The handlers RemoteTable passes for a viewer: none for a spectator (read-only), the proxy for an acting guest (M4). */
export function handlersFor(role: "spectator" | "player", send: IntentSender) {
  return role === "player" ? createIntentHandlers(send) : {};
}
