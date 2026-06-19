export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getDebugInfo } from "@/lib/salonStore";
import { USE_NEON, kvGet, getNeonHost } from "@/lib/db";

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

  // Bypass workStore.ts entirely — read the raw "work-store" row straight from
  // Neon to see exactly what's there, independent of any application logic.
  let rawWorkStore: { titles: Array<{ id: string; title: string; state: string }>; rawLength: number } | { error: string } | null = null;
  try {
    const raw = await kvGet("work-store");
    if (raw) {
      const parsed = JSON.parse(raw) as { works?: Record<string, { title?: string; state?: string }> };
      const works = parsed.works ?? {};
      rawWorkStore = {
        rawLength: raw.length,
        titles: Object.entries(works).map(([id, w]) => ({ id, title: w.title ?? "?", state: w.state ?? "?" })),
      };
    } else {
      rawWorkStore = { error: "kvGet('work-store') returned null/empty" };
    }
  } catch (e) {
    rawWorkStore = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(
    {
      ...info,
      neonConfigured: USE_NEON,
      neonVarUsed,
      neonHost: getNeonHost(),
      baseRpcUrl:        maskUrl(process.env.BASE_RPC_URL),
      baseRpcConfigured: !!process.env.BASE_RPC_URL,
      relayerAddressEnv: process.env.RELAYER_ADDRESS ?? null,
      vercelEnv:         process.env.VERCEL_ENV ?? null,
      rawWorkStore,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
