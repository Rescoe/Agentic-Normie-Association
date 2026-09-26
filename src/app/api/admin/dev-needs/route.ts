/**
 * GET  /api/admin/dev-needs — list structured dev/tool requests (see devRequests.ts)
 * POST /api/admin/dev-needs — admin updates status/response. Body: { id, status, humanResponse? }
 *
 * Normies flag a real technical issue with the ANA app by prefixing a salon
 * message with "[DEV-NEEDED]" (see normiesPersona.ts buildSystemPrompt) — this
 * creates or reinforces a structured request (devRequests.ts). Synthesis can
 * also promote a recurring theme straight to PROPOSED. Humans respond and move
 * the status forward from here; the status/response is reinjected into salon
 * memory at the next synthesis so Normies see what was delivered or refused.
 *
 * Auth follows the same convention as other admin routes: x-cron-secret
 * (automation) or a wallet-signed admin proof (manual call from the admin panel).
 */
import { NextRequest, NextResponse } from "next/server";
import { listDevRequests, updateDevRequestStatus, toLegacyView, type DevRequestStatus } from "@/lib/devRequests";
import { verifyAdminRequest } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

const VALID_STATUSES: DevRequestStatus[] = [
  "OBSERVED", "PROPOSED", "DISCUSSING", "SELECTED", "HUMAN_REVIEW",
  "IN_PROGRESS", "DELIVERED", "NORMIE_TESTING", "CLOSED", "REJECTED",
];

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) return true;
  return (await verifyAdminRequest(req)).ok;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }
  const statusParam = req.nextUrl.searchParams.get("status");
  const status = statusParam && VALID_STATUSES.includes(statusParam as DevRequestStatus) ? statusParam as DevRequestStatus : undefined;
  const requests = await listDevRequests(status);
  return NextResponse.json({
    requests,
    // Legacy shape kept for the existing admin panel widget until it's updated for the full workflow.
    needs: requests.map(toLegacyView),
    total: requests.length,
    open: requests.filter(r => !["CLOSED", "REJECTED", "DELIVERED"].includes(r.status)).length,
  });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }
  let body: { id?: string; status?: string; humanResponse?: string; resolved?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Back-compat: the old { resolved: true } shape maps to CLOSED.
  const status = body.status && VALID_STATUSES.includes(body.status as DevRequestStatus)
    ? body.status as DevRequestStatus
    : (body.resolved ? "CLOSED" : undefined);
  if (!status) return NextResponse.json({ error: `status required (one of ${VALID_STATUSES.join(", ")})` }, { status: 400 });

  const result = await updateDevRequestStatus(body.id, status, body.humanResponse);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true });
}
