/**
 * POST /api/keeper/synthesize
 *
 * Manual/orchestrator trigger for salon synthesis (see synthesis.ts). The
 * daily midnight orchestrator tick calls runDailySynthesis() with the day's
 * collected external signals; the 30-min ticks call runThresholdSynthesis()
 * for any salon that individually crossed the message threshold. This route
 * exposes both for manual testing/admin use — never for an anonymous caller
 * to trigger a costly LLM synthesis pass, hence the same cron-secret/admin
 * auth every other keeper route uses.
 *
 * Body: { salonId?: string, force?: boolean, mode?: "threshold" | "daily" }
 *   - salonId + force: synthesize exactly that salon regardless of threshold.
 *   - mode "threshold" (default): every salon currently past the message threshold.
 *   - mode "daily": every salon with any backlog, plus external signal collection.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { synthesizeSalon, runThresholdSynthesis, runDailySynthesis } from "@/lib/synthesis";
import { collectDailySignals } from "@/lib/externalSignals";
import { verifyAdminRequest } from "@/lib/adminAuth";

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers.get("x-cron-secret") === cronSecret || req.headers.get("authorization") === `Bearer ${cronSecret}`)) return true;
  return (await verifyAdminRequest(req)).ok;
}

export async function POST(req: NextRequest) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }

  let body: { salonId?: string; force?: boolean; mode?: "threshold" | "daily" } = {};
  try { body = await req.json(); } catch { /* ok */ }

  if (body.salonId) {
    const result = await synthesizeSalon(body.salonId, { force: body.force ?? true });
    return NextResponse.json(result);
  }

  if (body.mode === "daily") {
    const { kept } = await collectDailySignals().catch(e => { console.error("[synthesize] signal collection failed:", e); return { kept: [] }; });
    const results = await runDailySynthesis(kept);
    return NextResponse.json({ mode: "daily", signalsCollected: kept.length, results });
  }

  const results = await runThresholdSynthesis();
  return NextResponse.json({ mode: "threshold", results });
}
