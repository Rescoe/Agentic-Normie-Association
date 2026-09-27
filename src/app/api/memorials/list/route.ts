/**
 * GET /api/memorials/list — reads ONLY the durable public snapshot (see
 * @/lib/publicSnapshot). Previously fan-out RPC-read every memorial series
 * on chain, plus a Neon listWorks() call, on every request -- Footer.tsx
 * fetches this on every single page, site-wide.
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { readPublicSnapshot, type SnapshotMemorialItem } from "@/lib/publicSnapshot";

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" };

export type MemorialListItem = SnapshotMemorialItem;

export async function GET() {
  const snapshot = await readPublicSnapshot();
  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot unavailable", items: [] satisfies MemorialListItem[] }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({
    contractAddress: snapshot.memorials.contractAddress,
    milestoneStep:   snapshot.memorials.milestoneStep,
    items:           snapshot.memorials.items,
  }, { headers: CACHE_HEADERS });
}
