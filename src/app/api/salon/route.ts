export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listSalons, createSalon, getActiveSalonByCreator, getSynthesisInfo } from "@/lib/salonStore";
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

export async function GET() {
  const [salons, synthInfo, outcomes] = await Promise.all([listSalons(), getSynthesisInfo(), getSalonWorkOutcomes()]);
  const enriched = salons.map(s => ({ ...s, workOutcome: outcomes[s.id] ?? null }));
  return NextResponse.json({
    salons: enriched,
    nextSynthesisAt:   synthInfo.nextSynthesisAt,
    nextSynthesisDate: new Date(synthInfo.nextSynthesisAt).toISOString(),
  });
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
