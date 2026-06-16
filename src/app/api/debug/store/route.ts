export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getDebugInfo } from "@/lib/salonStore";

export async function GET() {
  const info = await getDebugInfo();
  const neonConfigured = !!process.env.NEON_DB_ANA;
  const neonConnStr    = process.env.NEON_DB_ANA
    ? process.env.NEON_DB_ANA.replace(/:[^:@]+@/, ":***@") // mask password
    : null;

  return NextResponse.json(
    { ...info, neonConfigured, neonConnStr },
    { headers: { "Cache-Control": "no-store" } },
  );
}
