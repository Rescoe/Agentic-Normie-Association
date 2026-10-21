import type { NextRequest } from "next/server";
import { verifyAdminRequest } from "@/lib/adminAuth";

/** True for the orchestrator's cron secret (header or Bearer) or a valid admin signature. */
export async function isCronOrAdmin(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers.get("x-cron-secret") === cronSecret || req.headers.get("authorization") === `Bearer ${cronSecret}`)) {
    return true;
  }
  return (await verifyAdminRequest(req)).ok;
}
