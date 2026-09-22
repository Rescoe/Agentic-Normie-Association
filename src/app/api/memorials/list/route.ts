/**
 * GET /api/memorials/list — public read of every ANAMemorials series, enriched
 * with the matching ANAWork (title/cartel/artwork/state come from Neon, the
 * richer off-chain record; pool/price/claim state comes straight from chain).
 *
 * Includes the contract's own address in the response — ANA_MEMORIALS_ADDRESS
 * is NOT NEXT_PUBLIC_-prefixed (Vercel rejected that name), so it's only
 * readable server-side. Any client component that needs to call the contract
 * (mint/claim buttons) gets the address from here instead of importing
 * CONTRACT_ADDRESSES.ANAMemorials directly, which would be empty in the browser.
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { ANA_MEMORIALS_ABI, CONTRACT_ADDRESSES } from "@/lib/contracts";
import { listWorks } from "@/lib/workStore";

const client = createPublicClient({
  chain:     base,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org", { timeout: 30_000 }),
});

export interface MemorialListItem {
  memorialId:       number;
  workAnaId?:       string; // ANAWork id — links to the dedicated /galerie/celebrations/[id] page
  title:            string;
  cartelText?:      string;
  artworkText?:     string; // BMP data URI, from the matching ANAWork
  workState?:       string;
  priceWei:         string;
  publicSupply:     number;
  publicMinted:     number;
  requesterSupply:  number;
  requesterMinted:  number;
  requesterAddr:    string;
  openEnded:        boolean;
  claimDeadline:    number; // unix seconds, 0 if not openEnded
  burnedTokenIds:   Array<{ tokenId: number; reservedRecipient: string; reservedClaimed: boolean }>;
}

export async function GET() {
  const addr = CONTRACT_ADDRESSES.ANAMemorials as `0x${string}`;
  if (!addr) return NextResponse.json({ contractAddress: "", items: [] satisfies MemorialListItem[] });

  try {
    const count = await client.readContract({
      address: addr, abi: ANA_MEMORIALS_ABI, functionName: "getSeriesCount",
    }) as bigint;
    const total = Number(count);
    if (total === 0) return NextResponse.json({ contractAddress: addr, items: [] satisfies MemorialListItem[] });

    const works = await listWorks();

    const items: MemorialListItem[] = await Promise.all(
      Array.from({ length: total }, (_, memorialId) => memorialId).map(async memorialId => {
        const [series, burnedTokenIdsRaw] = await Promise.all([
          client.readContract({
            address: addr, abi: ANA_MEMORIALS_ABI, functionName: "getSeries", args: [BigInt(memorialId)],
          }),
          client.readContract({
            address: addr, abi: ANA_MEMORIALS_ABI, functionName: "getBurnedTokenIds", args: [BigInt(memorialId)],
          }) as Promise<readonly bigint[]>,
        ]);

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

        const work = works.find(w => w.onChainMemorialId === memorialId);

        return {
          memorialId,
          workAnaId:        work?.id,
          title:            series.title,
          cartelText:       work?.cartelText,
          artworkText:      work?.artworkText,
          workState:        work?.state,
          priceWei:         series.priceWei.toString(),
          publicSupply:     Number(series.publicSupply),
          publicMinted:     Number(series.publicMinted),
          requesterSupply:  Number(series.requesterSupply),
          requesterMinted:  Number(series.requesterMinted),
          requesterAddr:    series.requesterAddr,
          openEnded:        series.openEnded,
          claimDeadline:    Number(series.claimDeadline),
          burnedTokenIds,
        };
      }),
    );

    return NextResponse.json({ contractAddress: addr, items: items.reverse() }); // newest first
  } catch (e) {
    console.error("[memorials/list] error:", e);
    return NextResponse.json({ error: "Failed to load memorials" }, { status: 500 });
  }
}
