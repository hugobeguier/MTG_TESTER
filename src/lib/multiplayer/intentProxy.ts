// Guest -> host intents. The table's `on*` props are id-only callbacks, so a guest can forward them as {name, args}. `send` is the guest's POST to
// /api/mp/intent (the host maps `name` back to its handler); a spectator gets a read-only sender that only records attempts.
import { GUEST_INTENT_NAMES, intentArity } from "./intentSpecs";

export type IntentSender = (name: string, args: unknown[]) => void;

/** M3 sender: ignores everything (spectators cannot act). Keeps the last few attempts for debugging. */
export function createReadOnlySender(log: Array<{ name: string; args: unknown[] }> = []): IntentSender {
  return (name, args) => {
    log.push({ name, args });
    if (log.length > 20) log.shift();
  };
}

/**
 * Table callback props (and a few wire-only names) a seated guest may use: exactly the host's whitelist (intentSpecs.ts INTENT_SPECS, the single source
 * for names, arg schemas and the states each is allowed in). A name missing there is refused by the host.
 */
export const ACTING_GUEST_INTENTS = GUEST_INTENT_NAMES;

const idOf = (value: unknown): unknown => (typeof value === "object" && value !== null ? (value as { id?: unknown }).id : value);

/**
 * The table hands some callbacks whole objects (a VisibleCard) or the click event; the wire only carries what the host's schema declares (ids), so the host
 * never reads card data a guest made up and the intent stays tiny. Callbacks not listed here are cut to the schema's arity (extra args like an event are dropped).
 */
export const INTENT_ARG_ENCODERS: Record<string, (args: unknown[]) => unknown[]> = {
  onToggleMulliganReturnCard: ([card]) => [idOf(card)]
};

export function encodeIntentArgs(name: string, args: unknown[]): unknown[] {
  const custom = INTENT_ARG_ENCODERS[name];
  if (custom) return custom(args);
  const arity = intentArity(name);
  // A trailing undefined survives JSON as null (the host reads it back as undefined); keep the array exactly as long as the schema.
  return Array.from({ length: arity }, (_, index) => args[index]);
}

/** Builds `{onFoo: (...args) => send("onFoo", args)}` for the given callback names. */
export function createIntentHandlers(send: IntentSender, names: readonly string[] = ACTING_GUEST_INTENTS): Record<string, (...args: unknown[]) => void> {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  for (const name of names) handlers[name] = (...args: unknown[]) => send(name, encodeIntentArgs(name, args));
  return handlers;
}

/** The handlers RemoteTable passes for a viewer: none for a spectator (read-only), the proxy for an acting guest. */
export function handlersFor(role: "spectator" | "player", send: IntentSender) {
  return role === "player" ? createIntentHandlers(send) : {};
}
