/**
 * POST /api/admin/backfill-tx-log
 *
 * One-off historical import — see lib/etherscanBackfill.ts for why this exists.
 * Body: { since?: "2026-06-01" } — defaults to 2026-06-01T00:00:00Z if omitted.
 *
 * Auth follows the same convention as /api/keeper/work-lifecycle: x-cron-secret
 * (automation) or x-admin-call: 1 (manual trigger from the admin panel).
 */

import { NextRequest, NextResponse } from "next/server";
import { backfillTxLog, blockNumberAtTimestamp } from "@/lib/etherscanBackfill";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby plan cap — safe to call again, inserts are idempotent (ON CONFLICT DO NOTHING)

export async function POST(req: NextRequest) {
  const cronSecret  = process.env.CRON_SECRET;
  const isCron      = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  const isAdminCall = req.headers.get("x-admin-call") === "1";
  if (!isCron && !isAdminCall) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or x-admin-call required" }, { status: 401 });
  }

  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "BASESCAN_API_KEY not configured" }, { status: 500 });
  }

  let body: { since?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const sinceDate = body.since ? new Date(body.since) : new Date("2026-06-01T00:00:00Z");
  const sinceTs    = Math.floor(sinceDate.getTime() / 1000);

  try {
    const sinceBlock = await blockNumberAtTimestamp(sinceTs, apiKey);
    const result      = await backfillTxLog(sinceBlock);
    return NextResponse.json({ since: sinceDate.toISOString(), sinceBlock, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
