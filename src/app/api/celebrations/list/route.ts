export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { listWorks } from "@/lib/workStore";

/**
 * GET /api/celebrations/list — public read of memorial works (isBurnMemorial),
 * most recent first, for the Célébrations page to show what's in progress
 * (and let it stop offering "◈ Mémorial" for a tokenId that already has one).
 */
export async function GET() {
  const works = (await listWorks())
    .filter(w => w.isBurnMemorial)
    .sort((a, b) => b.proposedAt - a.proposedAt)
    .slice(0, 50)
    .map(w => ({
      id:                w.id,
      title:             w.title,
      state:             w.state,
      burnedTokenId:     w.burnedTokenId,
      proposedBy:        w.proposedBy,
      proposedByName:    w.proposedByName,
      peerReviewerTokenId: w.peerReviewerTokenId,
      peerReviewDecision:  w.peerReviewDecision,
    }));

  return NextResponse.json({ works });
}
