export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { verifyMemberRequest } from "@/lib/memberAuth";
import { analyzeReplay, MAX_AUTOMATION_RATIO, type ReplayEvent } from "@/lib/drawAntiNoise";
import { pixelsToBmpDataUri } from "@/lib/pixelImage";
import { getWork, updateWork, nextInDispatchRotation } from "@/lib/workStore";
import { createDrawing } from "@/lib/drawStore";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 15_000 }),
});

async function getMemberIds(): Promise<number[]> {
  try {
    const raw = await client.readContract({
      address: CONTRACT_ADDRESSES.AssociationCore as `0x${string}`,
      abi:     ASSOCIATION_CORE_ABI,
      functionName: "getMemberTokenIds",
    });
    return (raw as bigint[]).map(Number);
  } catch { return []; }
}

interface SubmitBody {
  replayEvents?: ReplayEvent[];
  canvasW?:      number;
  canvasH?:      number;
  pixels?:       string; // base64, raw grayscale bytes, canvasW*canvasH, 0-255
  mode?:         "spontaneous" | "celebration";
  workId?:       string;
}

/**
 * POST /api/draw/submit — a member submits a hand-drawn pixel piece.
 *
 * mode="celebration": ties the drawing to an existing burn-celebration
 * ANAWork (only its selected proposer may submit); picked up by
 * stepAwaitDrawSubmission on the next work-lifecycle tick.
 *
 * mode="spontaneous": no ANAWork at all — stored as a standalone
 * SpontaneousDrawing, reviewer assigned immediately by rotation. See
 * POST /api/draw/[id]/peer-review for the approval step that forwards it to
 * proof-of-draw.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyMemberRequest(req);
  if (!auth.ok || auth.tokenId == null) {
    return NextResponse.json({ error: auth.error ?? "Unauthorized" }, { status: 401 });
  }

  let body: SubmitBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { replayEvents, canvasW, canvasH, pixels, mode, workId } = body;
  if (!replayEvents || !canvasW || !canvasH || !pixels) {
    return NextResponse.json({ error: "Missing replayEvents/canvasW/canvasH/pixels" }, { status: 400 });
  }
  if (mode !== "spontaneous" && mode !== "celebration") {
    return NextResponse.json({ error: 'mode must be "spontaneous" or "celebration"' }, { status: 400 });
  }

  const analysis = analyzeReplay(replayEvents, canvasW, canvasH);
  if (analysis.automationRatio > MAX_AUTOMATION_RATIO) {
    return NextResponse.json({ rejected: true, reason: "automation_suspected", analysis }, { status: 400 });
  }

  let rawPixels: Buffer;
  try { rawPixels = Buffer.from(pixels, "base64"); }
  catch { return NextResponse.json({ error: "Invalid pixels encoding" }, { status: 400 }); }
  if (rawPixels.length !== canvasW * canvasH) {
    return NextResponse.json(
      { error: `pixels length ${rawPixels.length} does not match canvasW*canvasH (${canvasW * canvasH})` },
      { status: 400 },
    );
  }

  if (mode === "celebration") {
    if (!workId) return NextResponse.json({ error: "workId required for mode=celebration" }, { status: 400 });
    const work = await getWork(workId);
    if (!work) return NextResponse.json({ error: "Work not found" }, { status: 404 });
    if (work.artForm !== "pixel-drawing") {
      return NextResponse.json({ error: "This work is not a pixel-drawing celebration" }, { status: 409 });
    }
    if (work.proposedBy !== auth.tokenId) {
      return NextResponse.json({ error: "Only the selected proposer can draw this celebration" }, { status: 403 });
    }
    if (work.drawSubmissionId) {
      return NextResponse.json({ error: "This celebration already has a drawing submitted" }, { status: 409 });
    }

    const submissionId = `draw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const artworkText  = pixelsToBmpDataUri(new Uint8Array(rawPixels), canvasW, canvasH);

    await updateWork(work.id, {
      drawSubmissionId: submissionId,
      drawSubmittedBy:  auth.tokenId,
      drawSubmittedAt:  Date.now(),
      drawPixels:       pixels,
      drawCanvasW:      canvasW,
      drawCanvasH:      canvasH,
      artworkText,
    });

    return NextResponse.json({
      ok: true, submissionId, automationRatio: analysis.automationRatio, workState: work.state,
    });
  }

  // mode === "spontaneous"
  const memberIds = await getMemberIds();
  if (memberIds.length === 0) return NextResponse.json({ error: "No ANA members" }, { status: 503 });
  const reviewerId = await nextInDispatchRotation("reviewer", memberIds, [auth.tokenId]);

  const drawing = await createDrawing({
    submittedBy:     auth.tokenId,
    pixels,
    canvasW,
    canvasH,
    automationRatio: analysis.automationRatio,
    reviewerTokenId: reviewerId,
  });

  return NextResponse.json({
    ok: true, submissionId: drawing.id, automationRatio: analysis.automationRatio, reviewerTokenId: reviewerId,
  });
}
