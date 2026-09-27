/**
 * GET /api/members — reads ONLY the durable public snapshot (see
 * @/lib/publicSnapshot). Previously built a persona per member (external API)
 * and read Neon (getMemberStats) on every call.
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { readPublicSnapshot } from "@/lib/publicSnapshot";

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" };

export async function GET() {
  const snapshot = await readPublicSnapshot();
  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (snapshot.members.length === 0) {
    return NextResponse.json({ members: [], note: "Chain read failed or no members yet" }, { headers: CACHE_HEADERS });
  }
  return NextResponse.json({ members: snapshot.members, count: snapshot.members.length }, { headers: CACHE_HEADERS });
}
