import { NextResponse } from "next/server";
import { getOrCreateSession } from "@/lib/sessionStore";

export async function GET() {
  const session = await getOrCreateSession();
  return NextResponse.json(session.seats.map((seat) => ({ seatId: seat.id, deck: seat.deck ?? null })));
}
