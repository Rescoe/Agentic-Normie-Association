export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { readChainStats } from "@/lib/chainReader";
import { getActiveWorks } from "@/lib/workStore";

// Cached at the edge (Sept 2026 cost audit) -- backs LiveEventsBanner, which
// is mounted site-wide via Navbar, so this was the single most-hit route.
// Was 30s; extended to 30 minutes (26/09 follow-up audit, explicitly
// approved) -- the banner already only polls every 30 min client-side, so a
// 30s edge cache was only ever protecting against concurrent-visitor bursts,
// not the polling itself. Matching the two windows removes the redundancy.
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" };

export async function GET() {
  const [stats, activeWorks] = await Promise.all([
    readChainStats(),
    getActiveWorks().catch(() => []),
  ]);

  const session = stats.sessionState;
  const sessionPhase = !stats.deployed
    ? "pre-launch"
    : session?.resolved
    ? "roles assigned"
    : session?.active
    ? "constituent assembly"
    : "registration";

  return NextResponse.json({
    deployed:      stats.deployed,
    memberCount:   stats.memberCount,
    workCount:     stats.workCount,
    sessionActive: session?.active ?? false,
    sessionDeadline: session?.deadline ?? 0,
    sessionPhase,
    activeWorks:   activeWorks.map(w => ({
      id:    w.id,
      title: w.title,
      state: w.state,
      isFoundingWork: w.isFoundingWork ?? false,
    })),
    chain:     "Base",
    updatedAt: Date.now(),
  }, { headers: CACHE_HEADERS });
}
