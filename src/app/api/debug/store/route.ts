export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getDebugInfo } from "@/lib/salonStore";
import { USE_NEON } from "@/lib/db";

function maskUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.hostname;
  } catch {
    return url.slice(0, 12) + "…";
  }
}

export async function GET() {
  const info = await getDebugInfo();

  const neonVarUsed =
    process.env.NEON_DB_ANA_POSTGRES_URL ? "NEON_DB_ANA_POSTGRES_URL" :
    process.env.NEON_DB_ANA_DATABASE_URL ? "NEON_DB_ANA_DATABASE_URL" :
    process.env.NEON_DB_ANA ? "NEON_DB_ANA" : null;

  return NextResponse.json(
    {
      ...info,
      neonConfigured: USE_NEON,
      neonVarUsed,
      baseRpcUrl:        maskUrl(process.env.BASE_RPC_URL),
      baseRpcConfigured: !!process.env.BASE_RPC_URL,
      relayerAddressEnv: process.env.RELAYER_ADDRESS ?? null,
      vercelEnv:         process.env.VERCEL_ENV ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
