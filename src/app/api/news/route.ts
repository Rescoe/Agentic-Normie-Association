/**
 * GET /api/news?limit=50 — dedicated public newsroom feed.
 *
 * /api/home-snapshot's 30-minute cache is deliberately tuned for the
 * homepage widget (see its own comment) — far too stale for a newsroom
 * meant to back real-time social communication. This route gets its own,
 * shorter, still-bounded cache instead of adding a second Neon read path
 * for every visitor.
 *
 * ANANewsItem rows are already the public-safe shape written by
 * newsGenerator.ts (title/body/socialText/media/links — never
 * validationNote, an operational error, an RPC diagnostic, or any other
 * admin-only field), so this returns them as-is rather than needing its own
 * allow-list DTO the way /api/works does.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { listNews } from "@/lib/newsStore";
import { clampNewsLimit } from "@/lib/newsMedia";

// 2 minutes fresh, serve-stale-while-revalidating for up to 5 — short enough
// for a newsroom driving social posts, still bounded so a burst of visitors
// never multiplies Neon reads.
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" };

export async function GET(req: NextRequest) {
  const limit = clampNewsLimit(req.nextUrl.searchParams.get("limit"));
  const items = await listNews(limit);
  return NextResponse.json({ items }, { headers: CACHE_HEADERS });
}
