export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getDebugInfo } from "@/lib/salonStore";

export async function GET() {
  const info = await getDebugInfo();
  return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
}
