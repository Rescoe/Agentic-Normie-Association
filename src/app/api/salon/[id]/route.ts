export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSalon, closeSalon, excludeMember } from "@/lib/salonStore";
import { getWorkBySalonId } from "@/lib/workStore";

// NOT cached (reverted 26/09/2026 — this specific caching attempt was a real
// regression, confirmed live): this is the route that actually renders a
// salon's conversation when someone opens it, including right after the
// orchestrator just posted new messages. A 30-min edge cache meant anyone
// opening the salon inside that window could see a stale snapshot — up to
// and including a fully empty "no exchange yet" for a salon that already has
// real messages — because a request made a moment BEFORE those messages
// existed got cached and kept being served regardless of what changed after.
// The list endpoint (/api/salon) keeps its 30-min cache for the sidebar
// preview, which is lower-stakes than the actual reading experience; this
// route needs to always reflect the real current state instead.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const salon = await getSalon(params.id);
  if (!salon) return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  const work = await getWorkBySalonId(params.id);
  const workOutcome = work ? (work.state === "PUBLISHED" ? "published" : work.state === "REJECTED" ? "rejected" : "active") : null;
  return NextResponse.json({ salon: { ...salon, workOutcome } });
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
