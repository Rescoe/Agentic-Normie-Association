/**
 * GET /api/admin/works — full ANAWork records (including validationNote,
 * operational* diagnostics, internal counters) for the admin dashboard.
 *
 * The public GET /api/works (src/app/api/works/route.ts) intentionally
 * strips every diagnostic field via toPublicWork()'s allow-list — a raw RPC
 * provider key ended up in validationNote and was served there verbatim
 * (29/09/2026 incident). The admin panel still needs those diagnostics to
 * show "intervention requise" detail (error code, attempt count, what to
 * reconcile/resume) — this route is the authenticated place for that. Every
 * text diagnostic field is already redacted at write time
 * (workStore.updateWork()/advanceState()), so this is "detailed" without
 * being "raw".
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { listWorks } from "@/lib/workStore";
import { verifyAdminRequest } from "@/lib/adminAuth";

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) return true;
  return (await verifyAdminRequest(req)).ok;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }
  const works = await listWorks();
  return NextResponse.json(works, { headers: { "Cache-Control": "no-store" } });
}
