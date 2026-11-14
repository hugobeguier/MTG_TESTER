// Structural sharing: returns `next`, except that every sub-object/array whose CONTENT equals the one in `prev` is replaced by the
// `prev` reference. The state-based-action pass rebuilds every seat, board and battlefield array on every update even when nothing
// changed; running its output through this restores the old references, so React effects keyed on `session.seats` (and memoized
// children) stop re-firing for no-op passes. Pure and value-preserving: the result is always deeply equal to `next`.

const MAX_DEPTH = 8;

function isPlain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function shareStructure<T>(prev: T, next: T, depth = 0): T {
  if (Object.is(prev, next)) return prev;
  if (depth > MAX_DEPTH) return next;
  if (Array.isArray(prev) && Array.isArray(next)) {
    // Cards (and other id-keyed records) may have been reordered or have had an entry added/removed, so match by id when present.
    const prevById = new Map<unknown, unknown>();
    const keyed = next.length > 0 && next.every((item) => isPlain(item) && typeof item.id === "string");
    if (keyed) for (const item of prev) if (isPlain(item) && typeof item.id === "string") prevById.set(item.id, item);
    let same = prev.length === next.length;
    const out = next.map((item, index) => {
      const counterpart = keyed ? prevById.get((item as { id: string }).id) : prev[index];
      const shared = counterpart === undefined ? item : shareStructure(counterpart, item, depth + 1);
      if (shared !== prev[index]) same = false;
      return shared;
    });
    return (same ? prev : out) as T;
  }
  if (isPlain(prev) && isPlain(next)) {
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    let same = prevKeys.length === nextKeys.length;
    const out: Record<string, unknown> = {};
    for (const key of nextKeys) {
      if (!(key in prev)) {
        same = false;
        out[key] = next[key];
        continue;
      }
      const shared = shareStructure(prev[key], next[key], depth + 1);
      if (shared !== prev[key]) same = false;
      out[key] = shared;
    }
    return (same ? prev : out) as T;
  }
  return next;
}

// Session-level variant: only the seats tree (the part the SBA pass churns, and the part effects/render keys watch) is compared deeply.
// The other top-level fields are carried over by reference, so a long `events` log is never walked.
export function shareSessionSeats<S extends { seats: unknown }>(prev: S, next: S): S {
  if (prev === next) return prev;
  const seats = shareStructure(prev.seats, next.seats);
  const nextKeys = Object.keys(next) as Array<keyof S>;
  const sameTop = nextKeys.length === Object.keys(prev).length && nextKeys.every((key) => (key === "seats" ? seats === prev.seats : Object.is(prev[key], next[key])));
  if (sameTop) return prev;
  return seats === next.seats ? next : { ...next, seats };
}
