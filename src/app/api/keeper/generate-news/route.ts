export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/adminAuth";
import { generateNews } from "@/lib/newsGenerator";

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const cronOk = !!cronSecret && (req.headers.get("x-cron-secret") === cronSecret || req.headers.get("authorization") === `Bearer ${cronSecret}`);
  if (!cronOk && !(await verifyAdminRequest(req)).ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await generateNews()) });
}
