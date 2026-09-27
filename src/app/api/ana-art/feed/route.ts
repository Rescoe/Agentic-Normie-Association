export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { readPublicSnapshot, type AnaArtFeedItem } from "@/lib/publicSnapshot";

const FEED_SECRET = process.env.ANA_ART_FEED_SECRET ?? "";

export type { AnaArtFeedItem };

/**
 * GET /api/ana-art/feed — read-only feed of human-drawn pixel pieces ready
 * for physical screens: published burn-celebration ANAWorks (artForm
 * "pixel-drawing") and approved SpontaneousDrawing submissions.
 *
 * proof-of-draw is the caller — two of its pollers were found (Sept 2026
 * Neon cost investigation, via Vercel logs) hitting this route roughly
 * every 5 minutes combined, which alone was enough to keep Neon's compute
 * from ever seeing 5 minutes of inactivity. This now reads exclusively from
 * the durable public snapshot (@/lib/publicSnapshot) -- no cache miss here
 * ever reaches Neon, regardless of how often proof-of-draw polls. The
 * x-feed-secret check still runs on every request BEFORE the snapshot is
 * ever read, so an unauthorized caller never even reaches it.
 */
export async function GET(req: NextRequest) {
  if (!FEED_SECRET || req.headers.get("x-feed-secret") !== FEED_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await readPublicSnapshot();
  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }

  const limit = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "50")));
  const items: AnaArtFeedItem[] = snapshot.anaArtFeed.slice(0, limit);

  // private, no-store: this is a secret-gated route, not a public CDN
  // resource -- a shared cache keyed without the secret header could leak
  // an authorized response to an unauthorized caller. The underlying data
  // is already cheap to serve (read from the snapshot, no Neon), so losing
  // the CDN cache here costs nothing.
  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
}
