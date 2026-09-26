export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { listWorks } from "@/lib/workStore";
import { listDrawings } from "@/lib/drawStore";

const FEED_SECRET = process.env.ANA_ART_FEED_SECRET ?? "";

// NOT a public CDN cache (Sept 2026 cost audit, P0 finding): this route is
// gated by a secret header (x-feed-secret) checked INSIDE the handler, but a
// Vercel Edge `Cache-Control: public` cache key does not vary on that header
// by default -- once one authorized caller populates the cache, an
// unauthorized request within the s-maxage window could be served the same
// cached 200 body straight from the edge, never re-running the handler's own
// auth check. `private, no-store` means every request re-executes the
// handler (and therefore re-checks the secret) -- this route is a low-
// frequency device-pull endpoint (proof-of-draw already debounces its own
// caller to ~once/60s on its side), not a site-wide hot path, so losing the
// CDN cache here is not a meaningful Neon cost regression.
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

/**
 * GET /api/ana-art/feed — read-only feed of human-drawn pixel pieces ready
 * for physical screens: published burn-celebration ANAWorks (artForm
 * "pixel-drawing") and approved SpontaneousDrawing submissions.
 *
 * proof-of-draw is the caller — it pulls this on its own schedule
 * (opportunistically, from opted-in devices' pull cycle, or a manual check)
 * and tracks which ids it has already ingested. This route is stateless: it
 * always returns everything eligible, most recent first, capped by `limit`.
 */
export async function GET(req: NextRequest) {
  if (!FEED_SECRET || req.headers.get("x-feed-secret") !== FEED_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "50")));

  const [works, drawings] = await Promise.all([listWorks(), listDrawings()]);

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

  const items = [...celebrationItems, ...spontaneousItems]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, limit);

  return NextResponse.json({ items }, { headers: CACHE_HEADERS });
}
