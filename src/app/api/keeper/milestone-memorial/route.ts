/**
 * POST /api/keeper/milestone-memorial
 *
 * Admin-only, manually triggered (no cron — this is meant to be rare and
 * deliberate, unlike check-burns/batch-memorial's regular schedule). Creates
 * ONE collective "grand monument" honoring every burn ANA has seen up to the
 * next 1,000-burn threshold that doesn't already have one — e.g. the first
 * call after 2,347 total burns creates the milestone-1 monument (marking the
 * first 1,000); a second call creates milestone-2 (the first 2,000); a third
 * would be refused until burn #3,000 is reached. One call = one milestone,
 * even when several are already available — lets the admin pace them through
 * the normal vote/publish pipeline instead of flooding it with several at
 * once.
 *
 * Same creative/pipeline shape as batch-memorial (LLM persona creates the
 * piece instantly, straight into VOTE_OPEN, member vote moderates it after
 * the fact) — createMemorialArtwork() is called with maximalComplexity so it
 * uses the full shape budget instead of favoring minimalism, and
 * totalHonoredOverride so the piece frames itself around the true milestone
 * count rather than the small representative sample of burnedTokenIds
 * actually fetched for prompt flavor (fetching/prompting with every one of
 * potentially thousands of real burns would be wasteful and pointless — the
 * LLM only ever uses up to 5 of them for identity texture regardless).
 *
 * Deliberately does NOT reserve a free claim per burned Normie's last owner
 * the way batch-memorial does — doing that for potentially thousands of
 * burns would mean thousands of addReservedClaims entries (chunked across
 * many relayer-paid transactions) for a single monument, which defeats the
 * point of this endpoint. publicSupply is a small fixed number instead,
 * purely so claiming/minting itself can still be exercised end to end.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, formatEther } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, ANA_MEMORIALS_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { createWork, listWorks } from "@/lib/workStore";
import { buildPersona, type NormiePersona } from "@/lib/normiesPersona";
import { createMemorialArtwork, MEMORIAL_CANVAS_W, MEMORIAL_CANVAS_H } from "@/lib/memorialArt";
import { pixelsToBmpDataUri } from "@/lib/pixelImage";
import { createSalon, addMessage, AGORA_SALON_ID } from "@/lib/salonStore";
import { getMemorialPricing } from "@/lib/memorialPricing";
import { verifyAdminRequest } from "@/lib/adminAuth";
import { getHistoryStats, getBurnedTokens } from "@/lib/normiesApi";
import { kvGet, kvSet } from "@/lib/db";

const SAMPLE_SIZE               = 6;  // representative burns fetched for persona flavor — not exhaustive
const MILESTONE_PUBLIC_SUPPLY   = 10; // fixed, small — this endpoint is about rendering, not distributing thousands of editions

const baseClient = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 15_000 }),
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

/**
 * Reads MILESTONE_STEP directly from the deployed contract instead of
 * hard-coding it here — this route used to have its own `const
 * MILESTONE_STEP = 1000`, silently disconnected from the contract's own
 * (now 100) value. Since 1000 is itself a multiple of 100 the on-chain check
 * never reverted, it just silently produced far fewer milestones than
 * intended — the exact bug that shipped a "Monument — 2,000 Normies" on a
 * contract meant to milestone every 100. Never hard-code this a third time.
 */
async function getContractMilestoneStep(): Promise<number> {
  const addr = process.env.ANA_MEMORIALS_ADDRESS as `0x${string}` | undefined;
  if (!addr) throw new Error("ANA_MEMORIALS_ADDRESS not set");
  const step = await baseClient.readContract({
    address: addr, abi: ANA_MEMORIALS_ABI, functionName: "MILESTONE_STEP",
  }) as bigint;
  return Number(step);
}

// ─── Burn-count baseline ────────────────────────────────────────────────────
// totalBurnedTokens (normies.art) is a fact about the real world — it never
// resets just because WE redeploy ANAMemorials. Without this, a fresh
// contract immediately "discovers" every milestone the whole collection's
// burn history has ever crossed (2,000+ already, as of 23/09) instead of
// starting the count over. The baseline is the real totalBurned value AT THE
// MOMENT of a deliberate reset (resetMilestoneBaseline below) — every
// milestone computation subtracts it, so "milestone 1" means "the first
// MILESTONE_STEP burns since we chose to start counting," not "burns 1..100
// of all time."
const BASELINE_KEY = "milestone-burn-baseline";

async function getMilestoneBaseline(): Promise<number> {
  const raw = await kvGet(BASELINE_KEY);
  return raw ? Number(raw) : 0;
}

export async function POST(req: NextRequest) {
  const isAdminCall = (await verifyAdminRequest(req)).ok;
  if (!isAdminCall) {
    return NextResponse.json({ error: "Unauthorized — signature admin requise" }, { status: 401 });
  }

  let totalBurned: number;
  try {
    const stats = await getHistoryStats();
    totalBurned = stats.totalBurnedTokens;
  } catch {
    return NextResponse.json({ error: "Impossible de lire le total des burns (api.normies.art)" }, { status: 502 });
  }

  // ── Reset action — sets the baseline to the CURRENT real total, so the
  //    next call counts milestones from zero. Does not create anything.
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if ((body as { resetBaseline?: boolean }).resetBaseline) {
    await kvSet(BASELINE_KEY, String(totalBurned));
    return NextResponse.json({ ok: true, baselineSet: totalBurned, message: "Compteur de milestones remis à zéro — le prochain palier sera compté à partir de maintenant." });
  }

  let MILESTONE_STEP: number;
  try {
    MILESTONE_STEP = await getContractMilestoneStep();
  } catch (e) {
    return NextResponse.json({ error: `Impossible de lire MILESTONE_STEP sur le contrat : ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }

  const baseline = await getMilestoneBaseline();
  const effectiveBurned = Math.max(0, totalBurned - baseline);

  const highestAvailableMilestone = Math.floor(effectiveBurned / MILESTONE_STEP);
  if (highestAvailableMilestone === 0) {
    return NextResponse.json(
      { error: `Aucun palier atteint — ${effectiveBurned}/${MILESTONE_STEP} burns depuis la remise à zéro (${totalBurned} au total, base ${baseline})` },
      { status: 409 },
    );
  }

  const existingMilestoneNumbers = (await listWorks())
    .filter(w => w.memorialKind === "milestone" && w.state !== "REJECTED")
    .map(w => w.memorialMilestoneNumber ?? 0);
  const alreadyCreated = existingMilestoneNumbers.length > 0 ? Math.max(...existingMilestoneNumbers) : 0;

  if (alreadyCreated >= highestAvailableMilestone) {
    return NextResponse.json(
      {
        error: `Pas de nouveau palier disponible — ${effectiveBurned} burns depuis la remise à zéro (${totalBurned} au total, base ${baseline}), dernier monument créé pour ${alreadyCreated * MILESTONE_STEP}, prochain à ${(alreadyCreated + 1) * MILESTONE_STEP}`,
      },
      { status: 409 },
    );
  }

  const milestoneNumber    = alreadyCreated + 1;
  const milestoneBurnCount = milestoneNumber * MILESTONE_STEP;

  const memberIds = await getMemberIds();
  if (memberIds.length === 0) {
    return NextResponse.json({ error: "Aucun membre ANA disponible" }, { status: 503 });
  }
  const proposerId = memberIds[Math.floor(Math.random() * memberIds.length)];
  let proposer: NormiePersona;
  try { proposer = await buildPersona(proposerId); }
  catch { return NextResponse.json({ error: "Impossible de construire le persona du proposeur" }, { status: 503 }); }

  let sampleTokenIds: number[] = [];
  try {
    const recent = await getBurnedTokens(SAMPLE_SIZE, 0);
    sampleTokenIds = recent.map(t => Number(t.tokenId));
  } catch { /* non-fatal — createMemorialArtwork handles an empty sample fine */ }

  // A real creative act, informed by a handful of real recent burns for
  // texture, but explicitly framed (totalHonoredOverride) around the true
  // milestone count, and permitted (maximalComplexity) to use the full shape
  // budget — this is meant to be the most visually complex composition the
  // pipeline can produce, for testing rendering across multiple physical
  // screens at once.
  const { pixels, cartel } = await createMemorialArtwork({
    proposer, burnedTokenIds: sampleTokenIds, otherMembers: [],
    totalHonoredOverride: milestoneBurnCount,
    maximalComplexity:    true,
  });
  const drawPixelsB64 = Buffer.from(pixels).toString("base64");
  const artworkText   = pixelsToBmpDataUri(pixels, MEMORIAL_CANVAS_W, MEMORIAL_CANVAS_H);

  const title    = `Monument — ${milestoneBurnCount.toLocaleString("en-US")} Normies`;
  const proposal = `${milestoneBurnCount.toLocaleString("en-US")} Normies have now been burned across the collection. ${proposer.name} created this collective monument on behalf of the association to mark the milestone.`;

  const pricing = await getMemorialPricing();

  // Dedicated salon, same pattern as every other memorial path — never AGORA directly.
  const salon = await createSalon({
    name:        title.slice(0, 60),
    description: `Salon dédié au monument "${title}" — vote et échanges.`,
    createdBy:   proposer.tokenId,
  });
  await addMessage({
    salonId:   AGORA_SALON_ID,
    tokenId:   proposer.tokenId,
    name:      proposer.name,
    imageUrl:  proposer.imageUrl ?? "",
    content:   `📜 I'm proposing a monument: "${title}". A dedicated salon has just opened for it. ${proposal}`,
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
    burnedTokenId:  sampleTokenIds[0],
    burnedTokenIds: sampleTokenIds,
    memorialKind:   "milestone",
    memorialMilestoneNumber:        milestoneNumber,
    memorialTotalBurnedAtMilestone: milestoneBurnCount,
    memorialPublicSupply: MILESTONE_PUBLIC_SUPPLY,
    reservedClaimRecipients: {}, // deliberate — see file doc comment
    salonId:        salon.id,
    voteOpenedAt:   Date.now(),
    drawPixels:     drawPixelsB64,
    drawCanvasW:    MEMORIAL_CANVAS_W,
    drawCanvasH:    MEMORIAL_CANVAS_H,
    artworkText,
    cartelText:     cartel,
    editionPrice:   formatEther(BigInt(pricing.batchPriceWei)),
    editionSupply:  MILESTONE_PUBLIC_SUPPLY,
    authorTokenId:     proposer.tokenId,
    authorName:        proposer.name,
    curatorTokenId:    proposer.tokenId,
    curatorName:       proposer.name,
    rapporteurTokenId: proposer.tokenId,
    rapporteurName:    proposer.name,
  }, "VOTE_OPEN");

  return NextResponse.json({
    workId:                  work.id,
    workTitle:                work.title,
    milestoneNumber,
    milestoneStep:           MILESTONE_STEP,
    totalBurnedHonored:      milestoneBurnCount,
    totalBurnedNow:          totalBurned,
    burnBaseline:            baseline,
    effectiveBurnedNow:      effectiveBurned,
    nextMilestoneAvailableAt: (milestoneNumber + 1) * MILESTONE_STEP,
  });
}
