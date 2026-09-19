export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyMemberRequest } from "@/lib/memberAuth";
import { getDrawing, updateDrawing } from "@/lib/drawStore";

/**
 * POST /api/draw/[id]/peer-review — approval gate for a SpontaneousDrawing
 * (mode="spontaneous" submissions from /api/draw/submit — these never become
 * an ANAWork, see that route's doc comment). Doesn't push anywhere on
 * approval: proof-of-draw pulls approved drawings itself via
 * GET /api/ana-art/feed.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await verifyMemberRequest(req);
  if (!auth.ok || auth.tokenId == null) {
    return NextResponse.json({ error: auth.error ?? "Unauthorized" }, { status: 401 });
  }

  let body: { decision?: "approved" | "rejected"; note?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (body.decision !== "approved" && body.decision !== "rejected") {
    return NextResponse.json({ error: 'decision must be "approved" or "rejected"' }, { status: 400 });
  }

  const drawing = await getDrawing(params.id);
  if (!drawing) return NextResponse.json({ error: "Drawing not found" }, { status: 404 });
  if (auth.tokenId !== drawing.reviewerTokenId) {
    return NextResponse.json({ error: "You are not the assigned reviewer for this drawing" }, { status: 403 });
  }
  if (drawing.decision) {
    return NextResponse.json({ error: "This drawing has already been reviewed" }, { status: 409 });
  }

  await updateDrawing(drawing.id, {
    decision:     body.decision,
    decisionNote: body.note,
    decidedAt:    Date.now(),
  });

  return NextResponse.json({ ok: true });
}
