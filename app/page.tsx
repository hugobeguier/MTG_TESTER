import { getOrCreateSession } from "@/lib/sessionStore";
import { checkOllama } from "@/lib/ollama";
import { AppFlow } from "@/components/AppFlow";

export default async function Home() {
  const [session, ollama] = await Promise.all([getOrCreateSession(), checkOllama()]);

  return <AppFlow initialSession={session} ollama={ollama} />;
}
