export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { readPublicSnapshot } from "@/lib/publicSnapshot";

// Reads ONLY the durable public snapshot (Vercel Blob, refreshed by the
// orchestrator) -- never Neon/chain directly. See @/lib/publicSnapshot's
// header comment for why: this route used to read Neon+RPC on every call,
// which alone (across every public GET route combined) kept Neon's compute
// from ever seeing 5 minutes of genuine inactivity.
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" };

export async function GET() {
  const snapshot = await readPublicSnapshot();
  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({
    ...snapshot.status,
    updatedAt: snapshot.generatedAt,
  }, { headers: CACHE_HEADERS });
}
