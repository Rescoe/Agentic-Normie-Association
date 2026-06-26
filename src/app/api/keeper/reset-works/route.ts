export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { resetWorks } from "@/lib/workStore";
import { verifyAdminRequest } from "@/lib/adminAuth";

export async function POST(req: NextRequest) {
  const isAdminCall = (await verifyAdminRequest(req)).ok;
  if (!isAdminCall) {
    return NextResponse.json({ error: "Unauthorized — a valid admin signature is required" }, { status: 401 });
  }
  await resetWorks();
  return NextResponse.json({ ok: true, message: "All works cleared from Neon" });
}
