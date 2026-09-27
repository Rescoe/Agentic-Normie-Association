export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { createSalon, getActiveSalonByCreator } from "@/lib/salonStore";
import { readPublicSnapshot } from "@/lib/publicSnapshot";

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

// GET reads ONLY the durable public snapshot -- see @/lib/publicSnapshot's
// header comment. POST below is a write (creating a salon) and stays fully
// dynamic/uncached/Neon-backed, unrelated to the "no public GET touches
// Neon" goal.
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" };

export async function GET() {
  const snapshot = await readPublicSnapshot();
  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({
    salons: snapshot.salons.list,
    nextSynthesisAt: snapshot.salons.nextSynthesisAt,
    nextSynthesisDate: snapshot.salons.nextSynthesisDate,
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
