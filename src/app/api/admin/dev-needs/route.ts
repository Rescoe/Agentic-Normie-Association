/**
 * GET  /api/admin/dev-needs — list human-intervention needs flagged by Normies
 * POST /api/admin/dev-needs — mark one resolved/unresolved. Body: { id, resolved? }
 *
 * Normies flag a real technical issue with the ANA app by prefixing a salon
 * message with "[DEV-NEEDED]" (see normiesPersona.ts buildSystemPrompt). Without
 * this board those observations were lost in the salon message flow.
 *
 * Auth follows the same convention as other admin routes: x-cron-secret
 * (automation) or a wallet-signed admin proof (manual call from the admin panel).
 */
import { NextRequest, NextResponse } from "next/server";
import { listDevNeeds, resolveDevNeed } from "@/lib/salonStore";
import { verifyAdminRequest } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) return true;
  return (await verifyAdminRequest(req)).ok;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }
  const needs = await listDevNeeds();
  return NextResponse.json({ needs, total: needs.length, unresolved: needs.filter(n => !n.resolved).length });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }
  let body: { id?: string; resolved?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await resolveDevNeed(body.id, body.resolved ?? true);
  return NextResponse.json({ ok: true });
}
