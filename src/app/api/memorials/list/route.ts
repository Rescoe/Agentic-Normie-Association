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

// Cached at the edge (Sept 2026 cost audit) -- Footer.tsx fetches this on
// every single page, site-wide, so uncached this was the single most-hit
// route on the whole site, plus one on-chain read per memorial series. Was
// 60s; bumped to 30 minutes (26/09 follow-up cost audit) to match
// /api/works, /api/status and /api/salon -- a memorial list changes on the
// order of days/weeks, not seconds.
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" };

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
  if (!addr) return NextResponse.json({ contractAddress: "", items: [] satisfies MemorialListItem[] }, { headers: CACHE_HEADERS });

  try {
    const [count, milestoneStepRaw] = await Promise.all([
      client.readContract({ address: addr, abi: ANA_MEMORIALS_ABI, functionName: "getSeriesCount" }) as Promise<bigint>,
      // Read straight from the contract, not hard-coded anywhere client-side —
      // this exact number went stale in the admin UI once already (displayed
      // "1000" after the contract was redeployed with MILESTONE_STEP=100).
      client.readContract({ address: addr, abi: ANA_MEMORIALS_ABI, functionName: "MILESTONE_STEP" }) as Promise<bigint>,
    ]);
    const total = Number(count);
    const milestoneStep = Number(milestoneStepRaw);
    if (total === 0) return NextResponse.json({ contractAddress: addr, milestoneStep, items: [] satisfies MemorialListItem[] }, { headers: CACHE_HEADERS });

    const works = await listWorks();

    // Was Promise.all() over every memorial -- one bad RPC call (a timeout, a
    // rate-limited public node, a single reverting read) failed the ENTIRE
    // response with a 500. Confirmed live (26/09): this route was 500ing in
    // production, uncached (the catch block below never set Cache-Control),
    // so every visitor on every page (Footer.tsx fetches this site-wide) kept
    // retrying the full RPC fan-out and kept re-hitting the same failure.
    // allSettled + per-memorial try/catch means one failure degrades that one
    // memorial to null (filtered out) instead of taking down the whole list.
    const settled = await Promise.allSettled(
      Array.from({ length: total }, (_, memorialId) => memorialId).map(async memorialId => {
        const [series, burnedTokenIdsRaw] = await Promise.all([
          client.readContract({
            address: addr, abi: ANA_MEMORIALS_ABI, functionName: "getSeries", args: [BigInt(memorialId)],
          }),
          client.readContract({
            address: addr, abi: ANA_MEMORIALS_ABI, functionName: "getBurnedTokenIds", args: [BigInt(memorialId)],
          }) as Promise<readonly bigint[]>,
        ]);

        const burnedTokenIdsSettled = await Promise.allSettled(burnedTokenIdsRaw.map(async tokenIdBn => {
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
        const burnedTokenIds = burnedTokenIdsSettled
          .filter((r): r is PromiseFulfilledResult<{ tokenId: number; reservedRecipient: string; reservedClaimed: boolean }> => r.status === "fulfilled")
          .map(r => r.value);

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

    const failures = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length > 0) {
      console.error(`[memorials/list] ${failures.length}/${total} memorial(s) failed to load:`, failures.map(f => f.reason));
    }
    const items = settled
      .filter(r => r.status === "fulfilled")
      .map(r => (r as PromiseFulfilledResult<MemorialListItem>).value);

    return NextResponse.json({ contractAddress: addr, milestoneStep, items: items.reverse() }, { headers: CACHE_HEADERS }); // newest first
  } catch (e) {
    console.error("[memorials/list] error:", e);
    // Short cache even on total failure -- without it, an outage (RPC down,
    // etc.) means every visitor on every page keeps retrying the full RPC
    // fan-out for as long as the outage lasts, exactly what was observed live.
    return NextResponse.json(
      { error: "Failed to load memorials", items: [] satisfies MemorialListItem[] },
      { status: 500, headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } },
    );
  }
}
