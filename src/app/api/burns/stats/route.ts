/**
 * GET /api/burns/stats
 *
 * Public read endpoint for the Célébrations gallery — entirely live, no
 * persistence: total burned count and the most recently burned tokens are
 * read straight from api.normies.art on every request. ANA does not keep
 * its own copy of normies.art's burn history.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getHistoryStats, getBurnedTokens, getBurnedTokenImageUrl } from "@/lib/normiesApi";

const TOTAL_SUPPLY = 10_000;

export async function GET() {
  try {
    const [stats, recent] = await Promise.all([
      getHistoryStats(),
      getBurnedTokens(24, 0),
    ]);

    return NextResponse.json({
      totalBurned: stats.totalBurnedTokens,
      totalSupply: TOTAL_SUPPLY,
      recentBurns: recent.map(t => ({
        tokenId:     Number(t.tokenId),
        txHash:      t.txHash,
        blockNumber: t.blockNumber,
        burnedAt:    new Date(Number(t.timestamp) * 1000).toISOString(),
        imageUrl:    getBurnedTokenImageUrl(t.tokenId),
      })),
    });
  } catch (err) {
    console.error("[burns/stats] ERROR:", err);
    return NextResponse.json({ error: "Failed to load burn stats" }, { status: 502 });
  }
}
