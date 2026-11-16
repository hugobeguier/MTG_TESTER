// Owns the human's priority-stop preferences (src/lib/priorityStops.ts): state seeded with the hardcoded defaults, a mount effect that swaps in what
// persisted on a prior visit (SSR-safe), and the updater that also persists. AppFlow passes the settings to the stack/priority logic and the table.
import { useEffect, useState } from "react";
import { DEFAULT_STOP_SETTINGS, type PriorityStopSettings } from "@/lib/priorityStops";
import { loadPriorityStopSettings, savePriorityStopSettings } from "@/lib/agentRuntime";

export function usePriorityStopSettings() {
  // The human's priority-stop preferences (src/lib/priorityStops.ts) — starts at the hardcoded
  // defaults (matches server-rendered markup) and is swapped for whatever persisted on a prior visit
  // once the mount effect below runs, same SSR-safety shape as loadRuleWorkflowCacheOnce.
  const [priorityStopSettings, setPriorityStopSettingsState] = useState<PriorityStopSettings>(DEFAULT_STOP_SETTINGS);
  useEffect(() => {
    setPriorityStopSettingsState(loadPriorityStopSettings());
  }, []);
  function updatePriorityStopSettings(updater: (prev: PriorityStopSettings) => PriorityStopSettings) {
    setPriorityStopSettingsState((prev) => {
      const next = updater(prev);
      savePriorityStopSettings(next);
      return next;
    });
  }
  return { priorityStopSettings, updatePriorityStopSettings };
}
