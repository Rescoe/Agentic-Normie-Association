/**
 * GET /api/members
 *
 * Aggregates ANA member data:
 *   1. tokenIds from AssociationCore (Base)
 *   2. persona from normie.art (name, archetype, traits, quirks…)
 *   3. salon stats from salonStore (messages sent, last active)
 */

export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ASSOCIATION_CORE_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { buildPersona } from "@/lib/normiesPersona";
import { getMemberStats } from "@/lib/salonStore";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

async function getMemberIds(): Promise<number[]> {
  try {
    const raw = await client.readContract({
      address:      CONTRACT_ADDRESSES.AssociationCore as `0x${string}`,
      abi:          ASSOCIATION_CORE_ABI,
      functionName: "getMemberTokenIds",
    });
    return (raw as bigint[]).map(Number);
  } catch { return []; }
}

export async function GET() {
  const memberIds = await getMemberIds();
  if (memberIds.length === 0) {
    return NextResponse.json({ members: [], note: "Chain read failed or no members yet" });
  }

  const personas = await Promise.allSettled(memberIds.map(id => buildPersona(id)));
  const members = personas.map((result, i) => {
    const tokenId = memberIds[i];
    const stats   = getMemberStats(tokenId);
    if (result.status === "rejected") {
      return { tokenId, name: `Normie #${tokenId}`, imageUrl: `https://api.normies.art/normies/image/${tokenId}`, stats };
    }
    const p = result.value;
    return {
      tokenId:            p.tokenId,
      name:               p.name,
      imageUrl:           p.imageUrl,
      archetype:          p.archetype,
      tagline:            p.tagline,
      greeting:           p.greeting,
      personalityTraits:  p.personalityTraits,
      communicationStyle: p.communicationStyle,
      quirks:             p.quirks,
      level:              p.level,
      actionPoints:       p.actionPoints,
      description:        p.description,
      isRegisteredAgent:  p.isRegisteredAgent,
      stats,
    };
  });

  return NextResponse.json({ members, count: members.length });
}
