/**
 * GET /api/memorials/[memorialId] — single-series on-chain detail, for the
 * dedicated per-work celebration page (/galerie/celebrations/[id]). Same
 * shape as one item of /api/memorials/list, but a single getSeries() call
 * instead of iterating every series on the contract — that route is fine for
 * a gallery grid, wasteful for one page that only ever needs one series.
 *
 * Includes kind/honoredBurnCount/creatorName/creatorProposerTokenId — added
 * to the contract after /api/memorials/list was written and never
 * backfilled there; a dedicated page is exactly where they matter most.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ANA_MEMORIALS_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listWorks } from "@/lib/workStore";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 30_000 }),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { memorialId: string } },
) {
  const addr = CONTRACT_ADDRESSES.ANAMemorials as `0x${string}`;
  if (!addr) return NextResponse.json({ error: "ANA_MEMORIALS_ADDRESS not configured" }, { status: 503 });

  const memorialId = parseInt(params.memorialId, 10);
  if (!Number.isInteger(memorialId) || memorialId < 0) {
    return NextResponse.json({ error: "Invalid memorialId" }, { status: 400 });
  }

  try {
    const [series, burnedTokenIdsRaw] = await Promise.all([
      client.readContract({
        address: addr, abi: ANA_MEMORIALS_ABI, functionName: "getSeries", args: [BigInt(memorialId)],
      }),
      client.readContract({
        address: addr, abi: ANA_MEMORIALS_ABI, functionName: "getBurnedTokenIds", args: [BigInt(memorialId)],
      }) as Promise<readonly bigint[]>,
    ]);

    if (!series.initialized) return NextResponse.json({ error: "Unknown memorial" }, { status: 404 });

    const burnedTokenIds = await Promise.all(burnedTokenIdsRaw.map(async tokenIdBn => {
      const tokenId = Number(tokenIdBn);
      const [recipient, claimed] = await Promise.all([
        client.readContract({
          address: addr, abi: ANA_MEMORIALS_ABI, functionName: "reservedRecipient", args: [BigInt(memorialId), tokenIdBn],
        }) as Promise<string>,
        client.readContract({
          address: addr, abi: ANA_MEMORIALS_ABI, functionName: "reservedClaimed", args: [BigInt(memorialId), tokenIdBn],
        }) as Promise<boolean>,
      ]);
      return { tokenId, reservedRecipient: recipient, reservedClaimed: claimed };
    }));

    const works = await listWorks();
    const work = works.find(w => w.onChainMemorialId === memorialId);

    return NextResponse.json({
      contractAddress: addr,
      memorialId,
      title:                  series.title,
      kind:                   series.kind,
      honoredBurnCount:       Number(series.honoredBurnCount),
      workId:                 Number(series.workId),
      creatorName:            series.creatorName,
      creatorProposerTokenId: Number(series.creatorProposerTokenId),
      creatorAddr:            series.creatorAddr,
      creatorUsesVault:       series.creatorUsesVault,
      priceWei:               series.priceWei.toString(),
      publicSupply:           Number(series.publicSupply),
      publicMinted:           Number(series.publicMinted),
      requesterSupply:        Number(series.requesterSupply),
      requesterMinted:        Number(series.requesterMinted),
      requesterAddr:          series.requesterAddr,
      openEnded:              series.openEnded,
      claimDeadline:          Number(series.claimDeadline),
      mintedInSeries:         Number(series.mintedInSeries),
      burnedTokenIds,
      // Off-chain enrichment (cartel/artwork/state) — same source /api/works/[id]
      // reads, included here too so the page can do one fetch when it already
      // knows the memorialId (e.g. coming from the mint panel) rather than two.
      workAnaId:    work?.id,
      cartelText:   work?.cartelText,
      artworkText:  work?.artworkText,
      workState:    work?.state,
    });
  } catch (e) {
    console.error("[memorials/[memorialId]] error:", e);
    return NextResponse.json({ error: "Failed to load memorial" }, { status: 500 });
  }
}
