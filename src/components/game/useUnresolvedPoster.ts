// Host/solo client only: sends each new "Couldn't resolve" record (session.unresolvedEffects) to the dev disk log, fire-and-forget, once per record.
// Guests never run the engine, so they never produce records; the route itself is dev-only and ignores anything malformed.
import { useEffect, useRef } from "react";
import { postUnresolved } from "@/lib/unresolvedLog";
import { type GameContext } from "./context";

export function useUnresolvedPoster(ctx: GameContext) {
  const posted = useRef(new Set<string>());
  const records = ctx.session.unresolvedEffects;
  useEffect(() => {
    if (!records) return;
    for (const record of records) {
      const key = `${record.gameId}|${record.key}`;
      if (posted.current.has(key)) continue;
      posted.current.add(key);
      const { key: _key, posted: _posted, ...payload } = record;
      postUnresolved(payload);
    }
  }, [records]);
}
