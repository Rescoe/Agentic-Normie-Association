export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listSalons, createSalon, getActiveSalonByCreator } from "@/lib/salonStore";
import { getSalonWorkOutcomes } from "@/lib/workStore";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
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

// GET is cached at the edge so read traffic no longer scales 1:1 with Neon
// reads (Sept 2026 cost audit) -- POST below stays fully dynamic/uncached,
// it's a write. Was 30s; the compact-list rewrite (salonStore.ts, 26/09
// pérennisation pass) means this no longer reads full message history per
// salon, but the audit's own P0 finding was that even the OLD 30s window
// could still burn ~120 Go/mois/region under sustained traffic — 30 minutes
// matches /api/works and /api/status (see the 26/09 follow-up cost audit).
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" };

// Synthesis is now per-salon (threshold-based, checked every 30-min orchestrator
// tick) with a daily catch-all at 00:00 UTC for any backlog — see synthesis.ts.
// There's no longer one single "next synthesis" timestamp shared by every
// salon, so this reports the guaranteed daily catch-all only: worst case,
// everything gets synthesized by then, even if a busy salon's own threshold
// fires sooner. Kept for the existing UI footnote (SalonClient.tsx), which
// already treats this field as optional.
function nextMidnightUtc(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return next.getTime();
}

export async function GET() {
  const [salons, outcomes] = await Promise.all([listSalons(), getSalonWorkOutcomes()]);
  const enriched = salons.map(s => ({ ...s, workOutcome: outcomes[s.id] ?? null }));
  const nextSynthesisAt = nextMidnightUtc();
  return NextResponse.json({
    salons: enriched,
    nextSynthesisAt,
    nextSynthesisDate: new Date(nextSynthesisAt).toISOString(),
  }, { headers: CACHE_HEADERS });
}

export async function POST(req: NextRequest) {
  let body: { tokenId?: number; name?: string; description?: string; members?: number[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { tokenId, name, description = "", members } = body;
  if (!tokenId || !name?.trim()) {
    return NextResponse.json({ error: "tokenId and name required" }, { status: 400 });
  }

  const memberIds = await getMemberIds();
  if (memberIds.length > 0 && !memberIds.includes(tokenId)) {
    return NextResponse.json({
      error: `Normie #${tokenId} n'est pas inscrit dans l'ANA.`,
    }, { status: 403 });
  }

  const existing = await getActiveSalonByCreator(tokenId);
  if (existing) {
    return NextResponse.json({
      error: `You already have an active salon: "${existing.name}". Close it before creating a new one.`,
      existingSalonId: existing.id,
    }, { status: 409 });
  }

  const salon = await createSalon({ name: name.trim(), description, createdBy: tokenId, members });
  return NextResponse.json({ salon }, { status: 201 });
}
