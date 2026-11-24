// GET-only dev check: are public/kernel-packs older than data/kernel-drafts? The browser asks before a kernel game (see src/components/game/kernelPacks.ts). Off in production.
import { NextResponse } from "next/server";
import { stalePacks, STALE_MESSAGE } from "@/kernel/integration/draftHash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ stale: [] });
  try {
    const stale = stalePacks();
    if (stale.length) console.warn(`[kernel] ${STALE_MESSAGE} (${stale.map((s) => s.slug).join(", ")})`);
    return NextResponse.json({ stale, message: stale.length ? STALE_MESSAGE : undefined });
  } catch {
    return NextResponse.json({ stale: [] });
  }
}
