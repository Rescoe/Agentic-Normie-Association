export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { resetAgora, resetAllSalons } from "@/lib/salonStore";
import { verifyAdminRequest } from "@/lib/adminAuth";

export async function POST(req: NextRequest) {
  const isAdminCall = (await verifyAdminRequest(req)).ok;
  const cronSecret  = process.env.CRON_SECRET;
  const isCron      = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

  if (!isAdminCall && !isCron) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }

  // scope: "agora" (default, existing behavior) keeps every other salon
  // intact and only clears Agora — "all" drops every salon, admin-only
  // (never via cron, deliberately — this is a real reset action, not
  // something that should ever fire on a schedule).
  const body  = await req.json().catch(() => ({} as Record<string, unknown>));
  const scope = (body as { scope?: string }).scope === "all" ? "all" : "agora";

  if (scope === "all") {
    if (!isAdminCall) {
      return NextResponse.json({ error: "scope=all requires a valid admin signature — never available to cron" }, { status: 403 });
    }
    await resetAllSalons();
    return NextResponse.json({ ok: true, message: "All salons reset — Agora cleared, every other salon dropped" });
  }

  await resetAgora();
  return NextResponse.json({ ok: true, message: "Agora reset — Normies will meet fresh" });
}
