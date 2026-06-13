export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSalon, closeSalon, excludeMember } from "@/lib/salonStore";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const salon = await getSalon(params.id);
  if (!salon) return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  return NextResponse.json({ salon });
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
