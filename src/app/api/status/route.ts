export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { readChainStats } from "@/lib/chainReader";
import { getActiveWorks } from "@/lib/workStore";

export async function GET() {
  const [stats, activeWorks] = await Promise.all([
    readChainStats(),
    getActiveWorks().catch(() => []),
  ]);

  const sessionPhase = !stats.deployed
    ? "pré-lancement"
    : stats.sessionState?.resolved
    ? "rôles attribués"
    : stats.sessionState?.active
    ? "AG constitutive"
    : "inscription";

  return NextResponse.json({
    deployed:      stats.deployed,
    memberCount:   stats.memberCount,
    workCount:     stats.workCount,
    activeWorks:   activeWorks.length,
    sessionActive: stats.sessionState?.active ?? false,
    sessionPhase,
    chain:         process.env.NEXT_PUBLIC_CHAIN === "base" ? "Base" : "Base Sepolia",
    updatedAt:     Date.now(),
  });
}
