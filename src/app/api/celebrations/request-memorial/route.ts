export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listWorks, createWork } from "@/lib/workStore";
import { buildPersona } from "@/lib/normiesPersona";
import { checkMemorialRequestLimit, recordMemorialRequest } from "@/lib/salonStore";

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

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * POST /api/celebrations/request-memorial — lets any visitor nominate a
 * specific (real or test) burned tokenId for a memorial, instead of waiting
 * for the check-burns cron's aggregate supply-diff detection. Same creation
 * shape as check-burns (random member proposer/drawer, artForm
 * "pixel-drawing", isBurnMemorial) but tied to one explicit tokenId
 * (burnedTokenId) and exempt from the same "one active work" gate — see
 * check-burns/route.ts for why that gate excludes memorials.
 *
 * Public and lightly rate-limited (10 min/IP) rather than wallet-gated: this
 * only ever *proposes* a memorial, it doesn't touch funds or on-chain state,
 * and the real gate is downstream (peer review before publication).
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

  const work = await createWork({
    proposedBy:     proposer.tokenId,
    proposedByName: proposer.name,
    proposedAt:     Date.now(),
    title:          `Memory of Normie #${tokenId}`,
    proposal:       `Normie #${tokenId} was burned. In its memory, ANA proposes a memorial work — ${proposer.name} will draw a small pixel piece on finitude, burning, and the permanence of what remains on-chain.`,
    suggestedForm:  "pixel-drawing",
    isBurnMemorial: true,
    burnedTokenId:  tokenId,
    salonId:        "salon_agora_ana",
  });

  await recordMemorialRequest(ip);

  return NextResponse.json({
    ok: true,
    workId:       work.id,
    proposerTokenId: proposer.tokenId,
    proposerName: proposer.name,
  });
}
