import { NextResponse } from "next/server";
import { createSession, getOrCreateSession } from "@/lib/sessionStore";

export async function GET() {
  return NextResponse.json(await getOrCreateSession());
}

export async function POST() {
  await createSession();
  return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
}
