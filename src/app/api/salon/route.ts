export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listSalons, createSalon, getActiveSalonByCreator, getSynthesisInfo } from "@/lib/salonStore";

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
  const [salons, synthInfo] = await Promise.all([listSalons(), getSynthesisInfo()]);
  return NextResponse.json({
    salons,
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
      error: `Tu as déjà un salon actif : "${existing.name}". Ferme-le avant d'en créer un nouveau.`,
      existingSalonId: existing.id,
    }, { status: 409 });
  }

  const salon = await createSalon({ name: name.trim(), description, createdBy: tokenId, members });
  return NextResponse.json({ salon }, { status: 201 });
}
