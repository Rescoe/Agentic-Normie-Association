export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyMemberRequest } from "@/lib/memberAuth";
import { getWork, updateWork } from "@/lib/workStore";

/**
 * POST /api/works/[id]/peer-review — human moderation gate for "pixel-drawing"
 * works (burn celebrations). Replaces the Curator LLM judgment for this
 * artForm: only the member assigned by rotation (work.peerReviewerTokenId,
 * set by stepValidating in work-lifecycle) may decide, and only once. The
 * decision is picked up by the next work-lifecycle tick, which advances the
 * work to PUBLISHING or REJECTED — this route only persists it.
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

  const work = await getWork(params.id);
  if (!work) return NextResponse.json({ error: "Work not found" }, { status: 404 });

  if (work.peerReviewerTokenId == null) {
    return NextResponse.json({ error: "No peer review pending for this work" }, { status: 409 });
  }
  if (auth.tokenId !== work.peerReviewerTokenId) {
    return NextResponse.json({ error: "You are not the assigned reviewer for this work" }, { status: 403 });
  }
  if (work.peerReviewDecision) {
    return NextResponse.json({ error: "This work has already been reviewed" }, { status: 409 });
  }

  await updateWork(work.id, {
    peerReviewDecision: body.decision,
    peerReviewNote:     body.note,
    peerReviewedAt:     Date.now(),
  });

  return NextResponse.json({ ok: true, workState: work.state });
}
