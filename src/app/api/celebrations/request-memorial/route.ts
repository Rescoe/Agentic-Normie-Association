export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, formatEther, isAddress, decodeEventLog } from "viem";
import { base, mainnet } from "viem/chains";
import { ANA_MEMORIALS_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listWorks, createWork } from "@/lib/workStore";
import { buildPersona } from "@/lib/normiesPersona";
import { checkMemorialRequestLimit, recordMemorialRequest, createSalon, addMessage, AGORA_SALON_ID } from "@/lib/salonStore";
import { createMemorialArtwork, MEMORIAL_CANVAS_W, MEMORIAL_CANVAS_H } from "@/lib/memorialArt";
import { pixelsToBmpDataUri } from "@/lib/pixelImage";
import { findLastOwnerOfBurnedToken } from "@/server/relayer/celebrationPublisher";
import { resolveTier, type MemorialTierId } from "@/lib/memorialPricing";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 15_000 }),
});

// Same mainnet client + burn semantics as check-burns/route.ts: Normies are
// real ERC721 burns (owner mapping cleared), not transfers to a dead address
// — so ownerOf() reverting is exactly what "burned" means for this contract.
const mainnetClient = createPublicClient({
  chain:     mainnet,
  transport: http(process.env.ETH_MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com", { timeout: 15_000 }),
});

const ERC721_OWNER_ABI = [
  {
    inputs:  [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name:    "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type:    "function",
  },
] as const;

// Bounds on the requester-chosen parameters — generous enough for any real
// use, tight enough to stop someone requesting an absurd (griefing) supply or
// an unbounded open claim window.
const MIN_TIER2_PUBLIC_SUPPLY     = 10;    // below this, "fixed edition" loses its distinct meaning from tier 1
const MAX_TIER2_PUBLIC_SUPPLY     = 500;
const MIN_TIER3_DURATION_SECONDS  = 3600;          // 1 hour
const MAX_TIER3_DURATION_SECONDS  = 90 * 86_400;   // 90 days

/**
 * Verifies tokenId is actually burned on-chain before letting anyone spend a
 * member's drawing effort on it. Fails closed: if we can't reach the chain
 * or the contract isn't configured, this rejects rather than silently
 * trusting the caller's claim.
 */
async function verifyBurned(tokenId: number): Promise<{ burned: boolean; error?: string }> {
  const addr = process.env.NORMIES_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!addr) return { burned: false, error: "NORMIES_CONTRACT_ADDRESS non configuré — vérification impossible" };

  try {
    await mainnetClient.readContract({
      address: addr, abi: ERC721_OWNER_ABI, functionName: "ownerOf", args: [BigInt(tokenId)],
    });
    // Call succeeded → the token still has an owner → it is NOT burned.
    return { burned: false, error: `Normie #${tokenId} n'est pas brûlé (il a encore un propriétaire).` };
  } catch (e) {
    // ownerOf() reverts for a burned (or never-minted) tokenId — this is the
    // standard ERC721 signal check-burns' own detection relies on too.
    // A tokenId that was simply never minted reverts identically; treating
    // that as "burned" here is an acceptable edge case (it still can't
    // resolve to a real prior owner/persona either way), not a security gap.
    if (e instanceof Error && /timeout|network|fetch/i.test(e.message)) {
      return { burned: false, error: "Impossible de vérifier le statut on-chain — réessaie." };
    }
    return { burned: true };
  }
}

type RequestPaidArgs = {
  payer: `0x${string}`;
  creatorProposerTokenId: bigint;
  creatorAddr: `0x${string}`;
  amount: bigint;
};

/**
 * Verifies the requester actually paid for this tier BEFORE the memorial is
 * created — by decoding the RequestPaid event emitted by
 * ANAMemorials.payForRequest(creatorProposerTokenId), rather than just
 * checking a plain transfer's to/from/value. payForRequest() splits the
 * payment 50/50 with the resolved creator immediately on-chain (unlike the
 * old tip(), which sent everything to the vault with no way to know a
 * creator) — so the event's own args are the only reliable proof of both
 * "this was really a payment for a request" AND "which proposer it was
 * priced for," which request-memorial then reuses unchanged rather than
 * picking a different one after the fact.
 */
async function verifyRequestPayment(
  txHash: string, expectedPayer: string, expectedProposerTokenId: number, minValueWei: bigint,
): Promise<{ ok: boolean; error?: string }> {
  const memorialsAddr = CONTRACT_ADDRESSES.ANAMemorials;
  if (!memorialsAddr) return { ok: false, error: "ANA_MEMORIALS_ADDRESS non configuré" };

  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    if (receipt.status !== "success") return { ok: false, error: "La transaction de paiement a échoué on-chain" };
    if (!receipt.to || receipt.to.toLowerCase() !== memorialsAddr.toLowerCase()) {
      return { ok: false, error: "Le paiement n'a pas été envoyé au contrat ANAMemorials" };
    }

    let matched: RequestPaidArgs | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== memorialsAddr.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: ANA_MEMORIALS_ABI, data: log.data, topics: log.topics, eventName: "RequestPaid",
        });
        matched = decoded.args as unknown as RequestPaidArgs;
        break;
      } catch { /* not a RequestPaid log — keep scanning the receipt's other logs */ }
    }
    if (!matched) {
      return { ok: false, error: "Aucun événement RequestPaid trouvé — appelle ANAMemorials.payForRequest() avant de demander le mémorial" };
    }
    if (matched.payer.toLowerCase() !== expectedPayer.toLowerCase()) {
      return { ok: false, error: "Le paiement ne vient pas de requesterWallet" };
    }
    if (Number(matched.creatorProposerTokenId) !== expectedProposerTokenId) {
      return { ok: false, error: "Le paiement ne correspond pas au proposeur attendu" };
    }
    if (matched.amount < minValueWei) {
      return { ok: false, error: `Paiement insuffisant (${formatEther(matched.amount)} ETH < ${formatEther(minValueWei)} ETH)` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Impossible de vérifier la transaction de paiement: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * POST /api/celebrations/request-memorial — lets a visitor pay to nominate a
 * specific burned tokenId for a memorial, instead of waiting for the batch
 * cron. Same creative shape as the batch path: generates the memorial's
 * visual instantly (memorialArt.ts, LLM-driven), creates the work already in
 * VOTE_OPEN. The vote (stepVoteOpen/stepVoteTallied) moderates it after the
 * fact, same as every memorial.
 *
 * Payment happens HERE, before creation — the requester calls ANAMemorials'
 * payForRequest(proposerTokenId) themselves (their own wallet, their own
 * gas) for the chosen tier's price, and this route verifies that transaction
 * (via the RequestPaid event) before doing anything. The proposer is picked
 * by verify-burned's pre-check BEFORE payment (payForRequest needs it up
 * front to split 50/50 with the right creator immediately) and reused here
 * unchanged — this route never re-picks one. That payment covers the
 * requester's own reserved edition — mintRequester() is free for them later
 * (see ANAMemorials.sol), since they already paid.
 *
 * The burned Normie's own last owner ALWAYS gets a separate, free, reserved
 * claim regardless of who requests or pays — resolved here the same way the
 * batch path resolves it, independent of `requesterWallet`.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rateCheck = await checkMemorialRequestLimit(ip);
  if (!rateCheck.allowed) {
    const minutes = Math.ceil((rateCheck.retryAfterMs ?? 0) / 60_000);
    return NextResponse.json(
      { error: `Trop de demandes — réessaie dans ~${minutes} min` },
      { status: 429 },
    );
  }

  let body: {
    tokenId?: number; tier?: number; requesterWallet?: string; proposerTokenId?: number;
    publicSupply?: number; claimDurationSeconds?: number; paymentTxHash?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const tokenId = body.tokenId;
  if (!Number.isInteger(tokenId) || tokenId! < 0) {
    return NextResponse.json({ error: "tokenId (integer) requis" }, { status: 400 });
  }

  const tier = body.tier;
  if (tier !== 1 && tier !== 2 && tier !== 3) {
    return NextResponse.json({ error: "tier (1, 2 ou 3) requis" }, { status: 400 });
  }

  const requesterWallet = body.requesterWallet;
  if (!requesterWallet || !isAddress(requesterWallet)) {
    return NextResponse.json({ error: "requesterWallet (adresse valide) requis" }, { status: 400 });
  }

  const proposerTokenId = body.proposerTokenId;
  if (!Number.isInteger(proposerTokenId) || proposerTokenId! < 0) {
    return NextResponse.json({ error: "proposerTokenId (integer) requis — utilise celui renvoyé par verify-burned" }, { status: 400 });
  }

  if (!body.paymentTxHash || !/^0x[0-9a-fA-F]{64}$/.test(body.paymentTxHash)) {
    return NextResponse.json({ error: "paymentTxHash requis — appelle ANAMemorials.payForRequest() avant de demander le mémorial" }, { status: 400 });
  }

  const alreadyUsed = (await listWorks()).some(w => w.memorialPaymentTxHash === body.paymentTxHash);
  if (alreadyUsed) {
    return NextResponse.json({ error: "Cette transaction de paiement a déjà été utilisée pour un autre mémorial" }, { status: 409 });
  }

  const tierConfig = await resolveTier(tier as MemorialTierId);

  const paymentCheck = await verifyRequestPayment(body.paymentTxHash, requesterWallet, proposerTokenId!, BigInt(tierConfig.priceWei));
  if (!paymentCheck.ok) {
    return NextResponse.json({ error: paymentCheck.error ?? "Paiement invalide" }, { status: 402 });
  }

  const burnCheck = await verifyBurned(tokenId!);
  if (!burnCheck.burned) {
    return NextResponse.json({ error: burnCheck.error ?? "Ce Normie n'est pas brûlé" }, { status: 409 });
  }

  const existing = (await listWorks()).find(
    w => (w.burnedTokenId === tokenId || w.burnedTokenIds?.includes(tokenId!)) && w.state !== "REJECTED",
  );
  if (existing) {
    return NextResponse.json(
      { error: `Un mémorial existe déjà pour ce Normie (${existing.id}, état ${existing.state})`, workId: existing.id },
      { status: 409 },
    );
  }

  // proposerTokenId was picked by verify-burned's pre-check, BEFORE the user
  // paid — payForRequest() already split the payment 50/50 with this exact
  // proposer on-chain (verified above), so it is reused unchanged here, not
  // re-picked at random.
  let proposer;
  try { proposer = await buildPersona(proposerTokenId!); }
  catch { return NextResponse.json({ error: "Impossible de construire le persona du proposeur" }, { status: 503 }); }

  // A real creative act by the proposer (own persona/history, informed by
  // the burned Normie's identity) — see memorialArt.ts. The work goes
  // straight to VOTE_OPEN, already fully created; the vote moderates it.
  const { pixels, cartel } = await createMemorialArtwork({
    proposer, burnedTokenIds: [tokenId!], otherMembers: [],
  });
  const drawPixelsB64 = Buffer.from(pixels).toString("base64");
  const artworkText   = pixelsToBmpDataUri(pixels, MEMORIAL_CANVAS_W, MEMORIAL_CANVAS_H);

  const lastOwner = await findLastOwnerOfBurnedToken(tokenId!);
  const requesterIsLastOwner = !!lastOwner && lastOwner.toLowerCase() === requesterWallet.toLowerCase();
  const reservedClaimRecipients: Record<number, string> = {};
  // Only register a separate free claim when the requester is NOT the burned
  // Normie's last owner. When they're the same wallet, their own paid
  // (requester-pool) edition already covers their entitlement — registering
  // a free claim on top of it would mint them a second, near-identical
  // edition for the same event, which is what the porteur explicitly asked
  // to avoid: "si le demandeur est l'ancien propriétaire, l'édition sera
  // unique." When it's someone else, the last owner keeps their own
  // separate, free, guaranteed claim as always.
  if (lastOwner && !requesterIsLastOwner) reservedClaimRecipients[tokenId!] = lastOwner;

  // Requester-chosen quantity (tier 2) / duration (tier 3), clamped to sane
  // bounds — defaults to the tier's config value if not provided or invalid.
  // Tier 2 has a floor of 10: a "fixed edition" option with fewer than that
  // stops meaning anything distinct from tier 1.
  const publicSupply = tier === 2
    ? Math.max(MIN_TIER2_PUBLIC_SUPPLY, Math.min(MAX_TIER2_PUBLIC_SUPPLY, Math.floor(body.publicSupply ?? tierConfig.publicSupply)))
    : tierConfig.publicSupply;
  const claimDurationSeconds = tier === 3
    ? Math.max(MIN_TIER3_DURATION_SECONDS, Math.min(MAX_TIER3_DURATION_SECONDS, Math.floor(body.claimDurationSeconds ?? tierConfig.claimDurationSeconds ?? MIN_TIER3_DURATION_SECONDS)))
    : tierConfig.claimDurationSeconds;

  const title = `Memory of Normie #${tokenId}`;
  const proposal = `Normie #${tokenId} was burned. In its memory, ${proposer.name} created this memorial piece on behalf of the association.`;

  // Dedicated salon per memorial — was hardcoded to AGORA, which mixed every
  // vote message into the main salon's unrelated conversation.
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
    content:   `📜 I'm proposing a new work for ANA: "${title}". A dedicated salon has just opened for it. ${proposal}`,
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
    burnedTokenId:  tokenId,
    burnedTokenIds: [tokenId!],
    memorialKind:   "requested",
    memorialTier:   tier as MemorialTierId,
    memorialPublicSupply:         publicSupply,
    memorialRequesterSupply:      tierConfig.requesterSupply,
    memorialRequesterAddr:        requesterWallet,
    memorialOpenEnded:            tierConfig.openEnded,
    memorialClaimDurationSeconds: claimDurationSeconds,
    memorialPaymentTxHash:        body.paymentTxHash,
    reservedClaimRecipients,
    salonId:        salon.id,
    voteOpenedAt:   Date.now(),
    drawPixels:     drawPixelsB64,
    drawCanvasW:    MEMORIAL_CANVAS_W,
    drawCanvasH:    MEMORIAL_CANVAS_H,
    artworkText,
    cartelText:     cartel,
    // editionPrice is an ETH-decimal string throughout ANAWork (legacy field) —
    // convert once here so stepPublishing's memorial branch can parse it back
    // to wei the same way the batch path does.
    editionPrice:   formatEther(BigInt(tierConfig.priceWei)),
    editionSupply:  publicSupply + tierConfig.requesterSupply,
    authorTokenId:     proposer.tokenId,
    authorName:        proposer.name,
    curatorTokenId:    proposer.tokenId,
    curatorName:       proposer.name,
    rapporteurTokenId: proposer.tokenId,
    rapporteurName:    proposer.name,
  }, "VOTE_OPEN");

  await recordMemorialRequest(ip);

  return NextResponse.json({
    ok: true,
    workId:          work.id,
    proposerTokenId: proposer.tokenId,
    proposerName:    proposer.name,
    tier,
    // requesterIsLastOwner=true  → exactly 1 edition will ever exist for this
    //                              event (the requester's own paid edition —
    //                              no separate reservedClaim was registered).
    // requesterIsLastOwner=false → 2: the requester's paid edition, plus the
    //                              last owner's separate free claim.
    requesterIsLastOwner,
    reservedFreeClaimForLastOwner: lastOwner != null && !requesterIsLastOwner,
  });
}
