export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { listWorks } from "@/lib/workStore";

// s-maxage: Vercel's Edge Network serves this straight from cache for the
// window below regardless of visitor count -- 10 or 10,000 concurrent
// readers still hit Neon at most once per window, not once per request.
// stale-while-revalidate covers the refresh itself: still-fresh-enough
// cached data is served while one request repopulates the cache in the
// background, so nobody blocks on a cold Neon read. Was 30s; extended to 30
// minutes (26/09 follow-up cost audit, explicitly approved) -- nobody needs
// live vote results down to the second, and this is the single biggest
// remaining lever on this route's own cost after the ~1.4MB payload size
// itself (see workStore.ts normalization discussion).
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" };

export async function GET() {
  const works = await listWorks();
  return NextResponse.json(works, { headers: CACHE_HEADERS });
}
