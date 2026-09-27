export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { closeSalon, excludeMember } from "@/lib/salonStore";
import { readPublicSnapshot } from "@/lib/publicSnapshot";

// Reads ONLY the durable public snapshot (see @/lib/publicSnapshot) --
// replaces the previous direct Neon read (getSalon(), 5 queries/call, no
// cache), which combined with the homepage widget calling this route
// directly was the first-found (but not the only, see /api/ana-art/feed)
// cause of Neon's compute never sleeping.
//
// Freshness model, per the porteur's explicit direction: this route must
// NEVER return a stale-empty 200 the way the old direct-Neon read
// theoretically could on a transient error. There are three distinct cases:
//   1. No snapshot exists at all yet (Blob storage empty/unreachable) → 503.
//   2. The salon id genuinely doesn't exist (not in the snapshot's own
//      salon list) → 404, same as before.
//   3. The salon EXISTS in the list but its detail failed to build during
//      the last snapshot refresh (a per-salon fault, see buildSalons() in
//      publicSnapshot.ts) → 503, NOT a fake-empty 200 for a salon that
//      actually has messages.
// generatedAt/messageCount/lastMessageAt are included so a caller can judge
// staleness itself rather than assuming the response is instant-fresh.
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" };

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const snapshot = await readPublicSnapshot();
  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const exists = snapshot.salons.list.some(s => s.id === params.id);
  if (!exists) return NextResponse.json({ error: "Salon not found" }, { status: 404 });

  const detail = snapshot.salons.detail[params.id];
  if (!detail) {
    return NextResponse.json(
      { error: "Salon detail temporarily unavailable — try again after the next snapshot refresh" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json({
    salon: detail,
    generatedAt:   snapshot.generatedAt,
    messageCount:  detail.messageCount,
    lastMessageAt: detail.lastMessageAt,
  }, { headers: CACHE_HEADERS });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: { action?: string; byTokenId?: number; targetTokenId?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { action, byTokenId, targetTokenId } = body;

  if (action === "close") {
    if (!byTokenId) return NextResponse.json({ error: "byTokenId required" }, { status: 400 });
    const result = await closeSalon(params.id, byTokenId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  if (action === "exclude") {
    if (!byTokenId || !targetTokenId) {
      return NextResponse.json({ error: "byTokenId and targetTokenId required" }, { status: 400 });
    }
    const result = await excludeMember(params.id, targetTokenId, byTokenId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 403 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
