/**
 * GET /api/v1/curation/works/{id}
 *
 * One published ANA work in the same shape as the list (`id` = its WorkRegistry id). 404 when the id is not a
 * published, on-chain, non-memorial work. Public, read-only, CORS open, edge-cached. Contract: docs/API_CURATION_V1.md.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { listWorks, toPublicWork } from "@/lib/workStore";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";
import { CURATION_VERSION, isCurationEligible, toCurationWork } from "@/lib/curationFeed";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const CACHE = { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" };

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!/^\d{1,9}$/.test(params.id)) {
    return NextResponse.json({ error: "id must be a work id (digits only)" }, { status: 400, headers: { ...CORS, "Cache-Control": "no-store" } });
  }
  const id = Number(params.id);
  const work = (await listWorks()).map(toPublicWork).find(w => w.onChainWorkId === id && isCurationEligible(w));
  if (!work) {
    return NextResponse.json({ error: "No published work with this id" }, { status: 404, headers: { ...CORS, "Cache-Control": "public, s-maxage=60" } });
  }
  return NextResponse.json(
    { version: CURATION_VERSION, source: "ana", work: toCurationWork(work, req.nextUrl.origin, CONTRACT_ADDRESSES.WorkRegistry || null) },
    { headers: { ...CORS, ...CACHE } },
  );
}
