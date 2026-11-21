/**
 * GET /api/v1/curation/works?before=<workId>&limit=<1..100>
 *
 * Public, read-only, versioned (`version: 1`) list of ANA's published works for Néo-RESCOE's curation queue
 * (and any other reader). Newest first; `next` is the value to pass as `before` for the following page.
 * No secret, no write, CORS open. Contract: docs/API_CURATION_V1.md.
 *
 * Cost: the response is edge-cached for 30 minutes (same window as /api/works), so any number of readers
 * costs at most one Neon read per window — a bridge must never be what keeps the database awake.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { listWorks, toPublicWork } from "@/lib/workStore";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { buildCurationPage, parseCurationQuery } from "@/lib/curationFeed";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const CACHE = { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" };

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
}

export async function GET(req: NextRequest) {
  const query = parseCurationQuery(req.nextUrl.searchParams);
  if ("error" in query) {
    return NextResponse.json({ error: query.error }, { status: 400, headers: { ...CORS, "Cache-Control": "no-store" } });
  }
  const works = (await listWorks()).map(toPublicWork);
  const page = buildCurationPage(works, query, req.nextUrl.origin, CONTRACT_ADDRESSES.WorkRegistry || null);
  return NextResponse.json(page, { headers: { ...CORS, ...CACHE } });
}
