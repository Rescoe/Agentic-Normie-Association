/**
 * POST /api/keeper/public-snapshot-refresh
 *
 * Rebuilds the durable public snapshot (see @/lib/publicSnapshot) and
 * replaces the one stored in Vercel Blob. Called by the orchestrator as a
 * SEQUENTIAL follow-up after the 2h/6h/24h task groups settle — not
 * concurrently with them — specifically so it reads Neon/chain state AFTER
 * salon-exchange/work-lifecycle/check-burns/election-cycle have written
 * their changes, not from a stale snapshot-of-the-request-start. Also
 * callable directly (manual/admin trigger, or from a route that just wrote
 * something the public snapshot should reflect immediately rather than
 * waiting for the next orchestrator tick).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { refreshPublicSnapshot } from "@/lib/publicSnapshot";

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret required" }, { status: 401 });
  }

  const result = await refreshPublicSnapshot();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
