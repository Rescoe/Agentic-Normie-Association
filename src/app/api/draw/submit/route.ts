export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { verifyMemberRequest } from "@/lib/memberAuth";
import { analyzeReplay, MAX_AUTOMATION_RATIO, type ReplayEvent } from "@/lib/drawAntiNoise";
import { nextInDispatchRotation } from "@/lib/workStore";
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
}

/**
 * POST /api/draw/submit — a member submits a spontaneous hand-drawn pixel
 * piece (no ANAWork involved — burn memorials are a separate, fully
 * automated LLM creation, see memorialArt.ts). Stored as a standalone
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

  const { replayEvents, canvasW, canvasH, pixels } = body;
  if (!replayEvents || !canvasW || !canvasH || !pixels) {
    return NextResponse.json({ error: "Missing replayEvents/canvasW/canvasH/pixels" }, { status: 400 });
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
