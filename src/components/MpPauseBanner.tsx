// Host-side notice while the game is paused for disconnected friends (see useMpHost: ctx.mpPausedFor). Friends see the same text in RemoteTable.
export function MpPauseBanner({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div role="status" style={{ position: "fixed", top: 8, right: 12, zIndex: 9000, background: "rgba(120,60,10,0.95)", color: "#eee", padding: "4px 10px", borderRadius: 6 }}>
      Waiting for {names.join(", ")} to reconnect - the game is paused
    </div>
  );
}
