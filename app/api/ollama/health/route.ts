import { NextResponse } from "next/server";
import { checkOllama } from "@/lib/ollama";

export async function GET() {
  return NextResponse.json(await checkOllama());
}
