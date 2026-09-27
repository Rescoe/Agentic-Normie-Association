export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { readPublicSnapshot } from "@/lib/publicSnapshot";

// Reads ONLY the durable public snapshot -- see @/lib/publicSnapshot's
// header comment. Previously read Neon (listWorks()) on every call.
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" };

export async function GET() {
  const snapshot = await readPublicSnapshot();
  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(snapshot.works, { headers: CACHE_HEADERS });
}
