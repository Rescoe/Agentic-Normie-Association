/**
 * GET /api/home-snapshot — thin projection of the durable public snapshot
 * (see @/lib/publicSnapshot) for the homepage's "happening now" widget:
 * works + the Agora's last 5 messages + recent burns. No Neon/RPC/external
 * calls of its own -- everything here was already read once when the
 * orchestrator last refreshed the master snapshot.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readPublicSnapshot, type PublicSnapshot } from "@/lib/publicSnapshot";

const AGORA_SALON_ID = "salon_agora_ana";

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" };

export async function GET() {
  const snapshot = await readPublicSnapshot();
  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const agora = snapshot.salons.detail[AGORA_SALON_ID] as PublicSnapshot["salons"]["detail"][string] | undefined;
  const agoraMessages = [...(agora?.messages ?? [])].slice(-5).reverse();

  return NextResponse.json({
    works: snapshot.works,
    agoraMessages,
    recentBurns: snapshot.recentBurns,
  }, { headers: CACHE_HEADERS });
}
