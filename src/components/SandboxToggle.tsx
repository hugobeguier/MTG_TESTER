// Host-only switch for the manual test tools (Draw / Search Library / life +- / move cards between zones / counters) in a multiplayer game.
// Off by default; while on, every friend sees a "sandbox mode" banner (RemoteTable). Friends never get the tools either way.
export function SandboxToggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <label role="status" style={{ position: "fixed", top: 8, left: 12, zIndex: 9000, background: on ? "rgba(140,30,30,0.95)" : "rgba(30,30,30,0.85)", color: "#eee", padding: "4px 10px", borderRadius: 6, fontSize: 12 }}>
      <input type="checkbox" checked={on} onChange={(event) => onChange(event.target.checked)} /> Sandbox mode (host test tools{on ? ": ON, friends can see this" : ""})
    </label>
  );
}
