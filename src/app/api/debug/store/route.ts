export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getDebugInfo } from "@/lib/salonStore";

/** GET /api/debug/store — inspect the current state of the in-memory store and file backup */
export async function GET() {
  const info = getDebugInfo();
  return NextResponse.json(info, {
    headers: { "Cache-Control": "no-store" },
  });
}
