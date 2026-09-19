export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { listWorks } from "@/lib/workStore";

/**
 * GET /api/celebrations/list — public read of memorial works (isBurnMemorial),
 * most recent first, for the Célébrations page to show what's in progress
 * (and let it stop offering "◈ Mémorial" for a tokenId that already has one).
 *
 * REJECTED memorials are excluded: a member "no" vote is aesthetic moderation
 * (work-lifecycle's stepVoteTallied regenerates and reopens the vote instead
 * of ever rejecting a memorial that way), so the only way a memorial actually
 * reaches REJECTED is an admin's own forceReject — a deliberate archive, which
 * should disappear from the public gallery rather than show a "REJECTED"
 * badge next to a burn that already got real attention/comms.
 */
export async function GET() {
  const works = (await listWorks())
    .filter(w => w.isBurnMemorial && w.state !== "REJECTED")
    .sort((a, b) => b.proposedAt - a.proposedAt)
    .slice(0, 50)
    .map(w => ({
      id:             w.id,
      title:          w.title,
      state:          w.state,
      burnedTokenId:  w.burnedTokenId,
      proposedBy:     w.proposedBy,
      proposedByName: w.proposedByName,
      artworkText:    w.artworkText,
      cartelText:     w.cartelText,
    }));

  return NextResponse.json({ works });
}
