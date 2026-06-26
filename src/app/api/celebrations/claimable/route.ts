/**
 * GET /api/celebrations/claimable?address=0x...
 * Lists CelebrationRegistry entries the given wallet can sponsor-claim a free
 * edition for — i.e. it's the honored recipient, hasn't claimed yet, the work
 * is linked, and the registry's sponsorship pool can currently cover it.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { CELEBRATION_REGISTRY_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listWorks } from "@/lib/workStore";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 30_000 }),
});

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

interface OnChainCelebration {
  eventType:         number;
  normieTokenId:     bigint;
  eligibleRecipient: string;
  sourceRef:         string;
  workId:            bigint;
  editionsAddr:      string;
  claimed:            boolean;
  registeredAt:      bigint;
}

export interface ClaimableCelebration {
  celebrationId:  number;
  eventType:      number;
  normieTokenId:  number;
  editionsAddr:   string;
  workTitle:      string;
  claimableNow:   boolean;
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) return NextResponse.json({ error: "address query param required" }, { status: 400 });

  const registryAddr = CONTRACT_ADDRESSES.CelebrationRegistry as `0x${string}`;
  if (!registryAddr) return NextResponse.json({ claimable: [] satisfies ClaimableCelebration[] });

  try {
    const count = await client.readContract({
      address: registryAddr, abi: CELEBRATION_REGISTRY_ABI, functionName: "celebrationCount",
    }) as bigint;
    const total = Number(count);
    if (total === 0) return NextResponse.json({ claimable: [] satisfies ClaimableCelebration[] });

    const ids = Array.from({ length: total }, (_, i) => i);
    const all = await Promise.all(ids.map(async id => {
      const c = await client.readContract({
        address: registryAddr, abi: CELEBRATION_REGISTRY_ABI, functionName: "getCelebration", args: [BigInt(id)],
      }) as OnChainCelebration;
      return { id, ...c };
    }));

    const mine = all.filter(c =>
      c.eligibleRecipient.toLowerCase() === address.toLowerCase() &&
      !c.claimed &&
      c.editionsAddr.toLowerCase() !== ZERO_ADDR
    );

    if (mine.length === 0) return NextResponse.json({ claimable: [] satisfies ClaimableCelebration[] });

    const works = await listWorks();
    const claimable: ClaimableCelebration[] = await Promise.all(mine.map(async c => {
      const claimableNow = await client.readContract({
        address: registryAddr, abi: CELEBRATION_REGISTRY_ABI, functionName: "isClaimable", args: [BigInt(c.id)],
      }).catch(() => false) as boolean;
      const work = works.find(w => w.onChainWorkId === Number(c.workId));
      return {
        celebrationId: c.id,
        eventType:     c.eventType,
        normieTokenId: Number(c.normieTokenId),
        editionsAddr:  c.editionsAddr,
        workTitle:     work?.title ?? `Work #${c.workId}`,
        claimableNow,
      };
    }));

    return NextResponse.json({ claimable });
  } catch (e) {
    console.error("[celebrations/claimable] error:", e);
    return NextResponse.json({ error: "Failed to load claimable celebrations" }, { status: 500 });
  }
}
