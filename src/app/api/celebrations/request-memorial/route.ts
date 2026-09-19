export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base, mainnet } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listWorks, createWork } from "@/lib/workStore";
import { buildPersona } from "@/lib/normiesPersona";
import { checkMemorialRequestLimit, recordMemorialRequest } from "@/lib/salonStore";
import {
  createMemorialArtwork, MEMORIAL_CANVAS_W, MEMORIAL_CANVAS_H,
  MEMORIAL_EDITION_PRICE, MEMORIAL_EDITION_SUPPLY,
} from "@/lib/memorialArt";
import { pixelsToBmpDataUri } from "@/lib/pixelImage";

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

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * POST /api/celebrations/request-memorial — lets any visitor nominate a
 * specific burned tokenId for a memorial, instead of waiting for the
 * check-burns cron's aggregate supply-diff detection. Same creation shape as
 * check-burns: generates the memorial's visual instantly (memorialArt.ts, no
 * LLM/human involved), creates the work already in VOTE_OPEN, exempt from
 * the "one active work" gate (see check-burns/route.ts). The vote
 * (stepVoteOpen/stepVoteTallied) is what moderates it, post-creation.
 *
 * Public and lightly rate-limited (10 min/IP) rather than wallet-gated: this
 * only ever creates a work already subject to the same member vote every
 * other ANA work goes through, it doesn't touch funds or on-chain state.
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

  let body: { tokenId?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const tokenId = body.tokenId;
  if (!Number.isInteger(tokenId) || tokenId! < 0) {
    return NextResponse.json({ error: "tokenId (integer) requis" }, { status: 400 });
  }

  const burnCheck = await verifyBurned(tokenId!);
  if (!burnCheck.burned) {
    return NextResponse.json({ error: burnCheck.error ?? "Ce Normie n'est pas brûlé" }, { status: 409 });
  }

  const existing = (await listWorks()).find(
    w => w.burnedTokenId === tokenId && w.state !== "REJECTED",
  );
  if (existing) {
    return NextResponse.json(
      { error: `Un mémorial existe déjà pour ce Normie (${existing.id}, état ${existing.state})`, workId: existing.id },
      { status: 409 },
    );
  }

  const memberIds = await getMemberIds();
  if (memberIds.length === 0) {
    return NextResponse.json({ error: "Aucun membre ANA disponible" }, { status: 503 });
  }

  const proposerId = memberIds[Math.floor(Math.random() * memberIds.length)];
  let proposer;
  try { proposer = await buildPersona(proposerId); }
  catch { return NextResponse.json({ error: "Impossible de construire le persona du proposeur" }, { status: 503 }); }

  // A real creative act by the proposer (own persona/history, informed by
  // the burned Normie's identity) — see memorialArt.ts. The work goes
  // straight to VOTE_OPEN, already fully created; the vote moderates it.
  const { pixels, cartel } = await createMemorialArtwork({
    proposer, burnedTokenIds: [tokenId!], otherMembers: [],
  });
  const drawPixelsB64 = Buffer.from(pixels).toString("base64");
  const artworkText   = pixelsToBmpDataUri(pixels, MEMORIAL_CANVAS_W, MEMORIAL_CANVAS_H);

  const work = await createWork({
    proposedBy:     proposer.tokenId,
    proposedByName: proposer.name,
    proposedAt:     Date.now(),
    title:          `Memory of Normie #${tokenId}`,
    proposal:       `Normie #${tokenId} was burned. In its memory, ${proposer.name} created this memorial piece on behalf of the association.`,
    suggestedForm:  "pixel-drawing",
    artForm:        "pixel-drawing",
    isBurnMemorial: true,
    burnedTokenId:  tokenId,
    salonId:        "salon_agora_ana",
    voteOpenedAt:   Date.now(),
    drawPixels:     drawPixelsB64,
    drawCanvasW:    MEMORIAL_CANVAS_W,
    drawCanvasH:    MEMORIAL_CANVAS_H,
    artworkText,
    cartelText:     cartel,
    editionPrice:   MEMORIAL_EDITION_PRICE,
    editionSupply:  MEMORIAL_EDITION_SUPPLY,
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
    workId:       work.id,
    proposerTokenId: proposer.tokenId,
    proposerName: proposer.name,
  });
}
