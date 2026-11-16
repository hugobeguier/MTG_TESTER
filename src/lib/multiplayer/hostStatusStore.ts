// Tiny external store that carries the host hook's state to MpHostPanel, which lives next to AppFlow on the host page (not inside it),
// so AppFlow needs no JSX for multiplayer. Works with useSyncExternalStore.
import { initialHostState, type HostState } from "./connectionState";

let current: HostState = initialHostState;
const listeners = new Set<() => void>();

export const hostStatusStore = {
  get: () => current,
  getServer: () => initialHostState,
  set(next: HostState) {
    current = next;
    for (const listener of [...listeners]) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
};
