export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { resetAgora } from "@/lib/salonStore";

export async function POST(req: NextRequest) {
  const isAdminCall = req.headers.get("x-admin-call") === "1";
  const cronSecret  = process.env.CRON_SECRET;
  const isCron      = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

  if (!isAdminCall && !isCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await resetAgora();
  return NextResponse.json({ ok: true, message: "Agora reset — Normies will meet fresh" });
}
