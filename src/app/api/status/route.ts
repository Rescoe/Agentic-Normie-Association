export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { readChainStats } from "@/lib/chainReader";
import { getActiveWorks } from "@/lib/workStore";

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
  });
}
