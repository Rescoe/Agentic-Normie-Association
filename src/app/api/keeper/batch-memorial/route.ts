/**
 * POST /api/keeper/batch-memorial
 * Weekly/monthly cron: drains memorialBatchQueue.ts (filled by check-burns.ts's
 * 15-min detection tick) into ONE collective memorial ANAWork honoring every
 * burn queued since the last flush — same LLM-driven creative act as before
 * (createMemorialArtwork, unchanged, already multi-burn-capable), same
 * VOTE_OPEN-direct + member-vote-as-moderation pipeline. Only the on-chain
 * publication step (stepPublishing in work-lifecycle.ts) differs for a batch
 * memorial vs. the old one-per-burn model: it registers on ANAMemorials
 * (shared collection) instead of deploying a dedicated ANAEditions.
 *
 * If the queue is empty, this is a no-op — safe to run on any schedule,
 * including a manual admin trigger, without side effects.
 *
 * Protected by x-cron-secret (same secret as check-burns/work-lifecycle).
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, formatEther } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { createWork } from "@/lib/workStore";
import { buildPersona, type NormiePersona } from "@/lib/normiesPersona";
import { createMemorialArtwork, MEMORIAL_CANVAS_W, MEMORIAL_CANVAS_H } from "@/lib/memorialArt";
import { pixelsToBmpDataUri } from "@/lib/pixelImage";
import { createSalon, addMessage, AGORA_SALON_ID } from "@/lib/salonStore";
import { peekQueue, clearQueue } from "@/lib/memorialBatchQueue";
import { getMemorialPricing } from "@/lib/memorialPricing";
import { verifyAdminRequest } from "@/lib/adminAuth";

const baseClient = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

async function getMemberIds(): Promise<number[]> {
  try {
    const raw = await baseClient.readContract({
      address:      CONTRACT_ADDRESSES.AssociationCore as `0x${string}`,
      abi:          ASSOCIATION_CORE_ABI,
      functionName: "getMemberTokenIds",
    });
    return (raw as bigint[]).map(Number);
  } catch { return []; }
}

export async function POST(req: NextRequest) {
  const cronSecret  = process.env.CRON_SECRET;
  const isCron      = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  const isAdminCall = (await verifyAdminRequest(req)).ok;

  if (!isCron && !isAdminCall) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }

  const queued = await peekQueue();
  if (queued.length === 0) {
    return NextResponse.json({ message: "Queue empty — nothing to memorialize", burnsHonored: 0 });
  }

  const memberIds = await getMemberIds();
  if (memberIds.length === 0) {
    return NextResponse.json({ error: "No ANA members" }, { status: 503 });
  }

  const proposerId = memberIds[Math.floor(Math.random() * memberIds.length)];
  let proposer: NormiePersona;
  try { proposer = await buildPersona(proposerId); }
  catch { return NextResponse.json({ error: "Could not build proposer persona" }, { status: 503 }); }

  const burnedTokenIds = queued.map(b => b.tokenId);
  const burned = burnedTokenIds.length;

  // A real creative act by the proposer, informed by every honored Normie's
  // identity — createMemorialArtwork already supports multiple burnedTokenIds
  // for exactly this collective case, unchanged since it was written.
  const { pixels, cartel } = await createMemorialArtwork({
    proposer, burnedTokenIds, otherMembers: [],
  });
  const drawPixelsB64 = Buffer.from(pixels).toString("base64");
  const artworkText   = pixelsToBmpDataUri(pixels, MEMORIAL_CANVAS_W, MEMORIAL_CANVAS_H);

  const title    = burned === 1 ? "Memory of an absence" : `Eulogy for ${burned} absences`;
  const proposal = burned === 1
    ? `A Normie was burned. In its memory, ${proposer.name} created this memorial piece on behalf of the association.`
    : `${burned} Normies were burned. In their memory, ${proposer.name} created this collective memorial piece on behalf of the association.`;

  const pricing = await getMemorialPricing();
  const reservedClaimRecipients: Record<number, string> = {};
  for (const b of queued) {
    if (b.lastOwner) reservedClaimRecipients[b.tokenId] = b.lastOwner;
  }

  // Dedicated salon per memorial, same pattern as a standard work's
  // stepProposed() — was hardcoded to AGORA, which meant every vote message
  // (and the vote-reopened-after-a-failed-vote announcements) piled into the
  // main salon, mixed in with unrelated conversation.
  const salon = await createSalon({
    name:        title.slice(0, 60),
    description: `Salon dédié au mémorial "${title}" — vote et échanges.`,
    createdBy:   proposer.tokenId,
  });
  await addMessage({
    salonId:   AGORA_SALON_ID,
    tokenId:   proposer.tokenId,
    name:      proposer.name,
    imageUrl:  proposer.imageUrl ?? "",
    content:   `📜 I'm proposing a memorial: "${title}". A dedicated salon has just opened for it. ${proposal}`,
    isLlm:     true,
    timestamp: Date.now(),
    topic:     "art",
  }).catch(() => null);

  const work = await createWork({
    proposedBy:     proposer.tokenId,
    proposedByName: proposer.name,
    proposedAt:     Date.now(),
    title,
    proposal,
    suggestedForm:  "pixel-drawing",
    artForm:        "pixel-drawing",
    isBurnMemorial: true,
    burnedTokenId:  burnedTokenIds[0], // singular field kept for display/back-compat
    burnedTokenIds,
    memorialKind:   "batch",
    memorialPublicSupply: burned, // one editable slot per burn honored this period
    reservedClaimRecipients,
    salonId:        salon.id,
    voteOpenedAt:   Date.now(),
    drawPixels:     drawPixelsB64,
    drawCanvasW:    MEMORIAL_CANVAS_W,
    drawCanvasH:    MEMORIAL_CANVAS_H,
    artworkText,
    cartelText:     cartel,
    // editionPrice is an ETH-decimal string throughout ANAWork (legacy field,
    // "0.01" not wei) — convert once here so stepPublishing's memorial branch
    // can parse it back to wei the same way the legacy path already does.
    editionPrice:   formatEther(BigInt(pricing.batchPriceWei)),
    editionSupply:  burned,
    authorTokenId:     proposer.tokenId,
    authorName:        proposer.name,
    curatorTokenId:    proposer.tokenId,
    curatorName:       proposer.name,
    rapporteurTokenId: proposer.tokenId,
    rapporteurName:    proposer.name,
  }, "VOTE_OPEN");

  await clearQueue(); // only after the work is safely created

  return NextResponse.json({
    burnsHonored: burned,
    workId:       work.id,
    workTitle:    work.title,
  });
}
