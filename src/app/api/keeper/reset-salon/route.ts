export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { resetAgora } from "@/lib/salonStore";
import { verifyAdminRequest } from "@/lib/adminAuth";

export async function POST(req: NextRequest) {
  const isAdminCall = (await verifyAdminRequest(req)).ok;
  const cronSecret  = process.env.CRON_SECRET;
  const isCron      = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

  if (!isAdminCall && !isCron) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret or a valid admin signature required" }, { status: 401 });
  }

  await resetAgora();
  return NextResponse.json({ ok: true, message: "Agora reset — Normies will meet fresh" });
}
