export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSalon, closeSalon, excludeMember } from "@/lib/salonStore";
import { getWorkBySalonId } from "@/lib/workStore";

// Cached at the edge, matching /api/works /api/status /api/salon (Sept 2026
// cost audit) -- also lets HomeLiveActivity.tsx fetch the Agora's recent
// messages for the homepage widget without an uncached full-detail read on
// every page load. A live chat feel still comes from SalonClient's own
// client-side 30-min poll of GET .../messages?since=..., which is unaffected.
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" };

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const salon = await getSalon(params.id);
  if (!salon) return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  const work = await getWorkBySalonId(params.id);
  const workOutcome = work ? (work.state === "PUBLISHED" ? "published" : work.state === "REJECTED" ? "rejected" : "active") : null;
  return NextResponse.json({ salon: { ...salon, workOutcome } }, { headers: CACHE_HEADERS });
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
