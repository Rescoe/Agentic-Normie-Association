export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { listWorks } from "@/lib/workStore";

// s-maxage: Vercel's Edge Network serves this straight from cache for 30s
// regardless of visitor count -- 10 or 10,000 concurrent readers still hit
// Neon at most once every 30s, not once per request. stale-while-revalidate
// covers the refresh itself: still-fresh-enough cached data is served while
// one request repopulates the cache in the background, so nobody blocks on
// a cold Neon read. (Sept 2026 cost audit -- this route had no HTTP caching
// at all, so it scaled 1:1 with traffic.)
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" };

export async function GET() {
  const works = await listWorks();
  return NextResponse.json(works, { headers: CACHE_HEADERS });
}
