import { NextResponse } from "next/server";
import { deleteSavedGame, getSavedGame } from "@/lib/saveStore";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshot = getSavedGame(id);
  if (!snapshot) {
    return NextResponse.json({ status: "error", error: `No saved game with id ${id}.` }, { status: 404 });
  }
  return NextResponse.json(snapshot);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteSavedGame(id);
  return NextResponse.json({ status: "deleted", id });
}
