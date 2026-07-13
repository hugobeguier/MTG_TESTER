import { NextResponse } from "next/server";
import { getCatalogStatus } from "@/lib/cardCatalog";

export async function GET() {
  return NextResponse.json(getCatalogStatus());
}
