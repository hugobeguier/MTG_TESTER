// Show/hide state of the host's multiplayer UI (room-code overlay + lobby panel): one shared flag, remembered in localStorage (try/catch: private windows,
// blocked storage and SSR all fall back to "visible"), plus the pure rule for when the collapsed chip must warn about a problem.
import type { HostState } from "./connectionState";

export const PANEL_COLLAPSED_KEY = "mtg-mp-panel-collapsed";
export const PANEL_SHORTCUT_HINT = "Alt+M shows or hides the multiplayer panel";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const defaultStorage = (): StorageLike | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

export function readCollapsed(storage: StorageLike | undefined = defaultStorage()): boolean | undefined {
  try {
    const value = storage?.getItem(PANEL_COLLAPSED_KEY);
    return value === "1" ? true : value === "0" ? false : undefined;
  } catch {
    return undefined;
  }
}

export function writeCollapsed(collapsed: boolean, storage: StorageLike | undefined = defaultStorage()): void {
  try {
    storage?.setItem(PANEL_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* storage unavailable: the flag just is not remembered */
  }
}

/** Should the (possibly collapsed) panel show a red dot: a connection problem, a disconnected guest, or a game paused for someone. */
export function panelNeedsAttention(host: Pick<HostState, "status" | "guests" | "error">, pausedFor: readonly string[]): boolean {
  if (pausedFor.length > 0) return true;
  if (host.status === "error" || host.status === "reconnecting" || host.status === "closed" || host.error) return true;
  return host.guests.some((guest) => !guest.connected);
}

/** What the game does to the flag: collapse when a game starts, show again when back on the setup screen. */
export function collapsedAfterModeChange(previousMode: string | undefined, mode: string, current: boolean): boolean {
  if (mode === "game" && previousMode !== "game") return true;
  if (mode !== "game" && previousMode === "game") return false;
  return current;
}

let collapsed = false;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of [...listeners]) listener();
};

export const mpPanelStore = {
  get(): boolean {
    if (!loaded && typeof window !== "undefined") {
      loaded = true;
      collapsed = readCollapsed() ?? false;
    }
    return collapsed;
  },
  getServer: () => false,
  set(next: boolean) {
    loaded = true;
    if (next === collapsed) return;
    collapsed = next;
    writeCollapsed(next);
    emit();
  },
  toggle() {
    mpPanelStore.set(!mpPanelStore.get());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
};
