export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { listWorks } from "@/lib/workStore";
import { listDrawings } from "@/lib/drawStore";

const FEED_SECRET = process.env.ANA_ART_FEED_SECRET ?? "";

// proof-of-draw already debounces its own caller (maybeCheckAnaFeed) to at
// most one real fetch per ANA_FEED_CHECK_DEBOUNCE_SEC (default 60s) via a
// shared Redis lock on ITS side -- but this route itself had no caching at
// all on ANA's side, meaning a shorter debounce there, a manual
// checkAnaFeedNow() trigger, or any other future caller would hit the full
// workStore/drawStore blobs uncached. Matching cache window as a backstop
// (found while auditing whether proof-of-draw adds to ANA's Neon load,
// 26/09).
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" };

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
