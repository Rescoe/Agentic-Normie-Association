/**
 * GET  /api/salon       — list all salons
 * POST /api/salon       — create a salon
 */

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listSalons, createSalon } from "@/lib/salonStore";

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
  return NextResponse.json({ salons: listSalons() });
}

export async function POST(req: NextRequest) {
  let body: { tokenId?: number; name?: string; description?: string; members?: number[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { tokenId, name, description = "", members } = body;
  if (!tokenId || !name?.trim()) {
    return NextResponse.json({ error: "tokenId and name required" }, { status: 400 });
  }

  // Verify creator is an ANA member
  const memberIds = await getMemberIds();
  if (!memberIds.includes(tokenId)) {
    return NextResponse.json({ error: "Only ANA members can create salons" }, { status: 403 });
  }

  const salon = createSalon({ name: name.trim(), description, createdBy: tokenId, members });
  return NextResponse.json({ salon }, { status: 201 });
}
