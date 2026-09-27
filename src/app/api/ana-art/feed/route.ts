export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { listWorks } from "@/lib/workStore";
import { listDrawings } from "@/lib/drawStore";

const FEED_SECRET = process.env.ANA_ART_FEED_SECRET ?? "";

// NOT a public CDN cache: this route is gated by a secret header
// (x-feed-secret) checked INSIDE the handler, but a Vercel Edge
// `Cache-Control: public` cache key does not vary on that header by
// default -- once one authorized caller populates the cache, an
// unauthorized request within the s-maxage window could be served the same
// cached 200 body straight from the edge, never re-running the handler's own
// auth check. `private, no-store` means every request re-executes the
// handler (and therefore re-checks the secret).
//
// That auth-safety reasoning still holds, but it left the actual Neon reads
// (listWorks/listDrawings) completely uncached -- fine when proof-of-draw
// was a single low-frequency caller, until it turned out to run TWO pollers
// hitting this route roughly every 5 min (found via Vercel logs, Sept 2026
// Neon cost investigation), which alone was enough to keep Neon's compute
// from ever seeing 5 minutes of inactivity. Fix: cache the DATA BUILD (not
// the HTTP response) in Next's shared Data Cache via unstable_cache, keyed
// independently of the secret/limit/request -- auth still runs on every
// request via FEED_SECRET before this is ever called, so an unauthorized
// caller never even reaches the cache.
const getCachedFeedItems = unstable_cache(
  async (): Promise<AnaArtFeedItem[]> => {
    const [works, drawings] = await Promise.all([listWorks(), listDrawings()]);
    return buildFeedItems(works, drawings);
  },
  ["ana-art-feed-v1"],
  { revalidate: 1800, tags: ["ana-art-feed"] },
);

const CACHE_HEADERS = { "Cache-Control": "private, no-store" };

export interface AnaArtFeedItem {
  id:             string;
  kind:           "celebration" | "spontaneous";
  pixels:         string; // base64, raw grayscale bytes, canvasW*canvasH, 0-255
  canvasW:        number;
  canvasH:        number;
  title:          string;
  agentTokenId:   number;
  agentName?:     string;
  publishedAt:    number;
}

function buildFeedItems(
  works: Awaited<ReturnType<typeof listWorks>>,
  drawings: Awaited<ReturnType<typeof listDrawings>>,
): AnaArtFeedItem[] {
  const celebrationItems: AnaArtFeedItem[] = works
    .filter(w => w.artForm === "pixel-drawing" && w.state === "PUBLISHED"
      && w.drawPixels && w.drawCanvasW && w.drawCanvasH)
    .map(w => ({
      id:           w.id,
      kind:         "celebration" as const,
      pixels:       w.drawPixels!,
      canvasW:      w.drawCanvasW!,
      canvasH:      w.drawCanvasH!,
      title:        w.title,
      agentTokenId: w.proposedBy,
      agentName:    w.proposedByName,
      publishedAt:  w.publishedAt ?? w.proposedAt,
    }));

  const spontaneousItems: AnaArtFeedItem[] = drawings
    .filter(d => d.decision === "approved")
    .map(d => ({
      id:           d.id,
      kind:         "spontaneous" as const,
      pixels:       d.pixels,
      canvasW:      d.canvasW,
      canvasH:      d.canvasH,
      title:        `Spontaneous drawing by Normie #${d.submittedBy}`,
      agentTokenId: d.submittedBy,
      publishedAt:  d.decidedAt ?? d.submittedAt,
    }));

  return [...celebrationItems, ...spontaneousItems].sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * GET /api/ana-art/feed — read-only feed of human-drawn pixel pieces ready
 * for physical screens: published burn-celebration ANAWorks (artForm
 * "pixel-drawing") and approved SpontaneousDrawing submissions.
 *
 * proof-of-draw is the caller — it pulls this on its own schedule
 * (opportunistically, from opted-in devices' pull cycle, or a manual check)
 * and tracks which ids it has already ingested. This route is stateless: it
 * always returns everything eligible, most recent first, capped by `limit`.
 *
 * The data build itself is cached (see getCachedFeedItems above) -- `limit`
 * is applied AFTER reading from that cache, never passed into it, so every
 * caller (whatever limit it asks for) shares the same cache entry instead of
 * fragmenting it per limit value.
 */
export async function GET(req: NextRequest) {
  if (!FEED_SECRET || req.headers.get("x-feed-secret") !== FEED_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "50")));
  const items = (await getCachedFeedItems()).slice(0, limit);

  return NextResponse.json({ items }, { headers: CACHE_HEADERS });
}
