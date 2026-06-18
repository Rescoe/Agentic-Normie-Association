export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { resetWorks } from "@/lib/workStore";

export async function POST(req: NextRequest) {
  const isAdminCall = req.headers.get("x-admin-call") === "1";
  if (!isAdminCall) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await resetWorks();
  return NextResponse.json({ ok: true, message: "All works cleared from Neon" });
}
