import { getOrCreateSession } from "@/lib/sessionStore";
import { checkOllama } from "@/lib/ollama";
import { AppFlow } from "@/components/AppFlow";
import { MpHostPanel } from "@/components/MpHostPanel";

export const dynamic = "force-dynamic";

// The normal game, plus a multiplayer host publisher (components/game/useMpHost.ts) and its room-code panel. Open it via http://localhost:PORT/mp/host.
export default async function MpHostPage() {
  const [session, ollama] = await Promise.all([getOrCreateSession(), checkOllama()]);

  return (
    <>
      <AppFlow initialSession={session} ollama={ollama} multiplayerHost />
      <MpHostPanel />
    </>
  );
}
