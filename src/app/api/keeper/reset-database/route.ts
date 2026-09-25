/**
 * POST /api/keeper/reset-database
 *
 * Wipes the ENTIRE Neon kv_store — every store, not just one: works, salons
 * (including archived/closed ones, not just the active Agora), spontaneous
 * drawings, the activity cache, memorial pricing config, the memorial batch
 * queue, and the election-cycle keeper state. Irreversible.
 *
 * Deliberately a raw DELETE FROM kv_store rather than calling each store's
 * own reset function — a per-store approach silently misses any store that
 * didn't get its own reset wired up (which is exactly how memorial-pricing,
 * memorial-batch-queue, and the activity cache were never covered by
 * reset-works/reset-salon). This can't drift out of sync as new stores are
 * added later.
 */
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { kvDeleteAll } from "@/lib/db";
import { verifyAdminRequest } from "@/lib/adminAuth";
import { invalidateCache as invalidateWorkCache } from "@/lib/workStore";
import { invalidateCache as invalidateSalonCache } from "@/lib/salonStore";
import { invalidateCache as invalidateDrawCache } from "@/lib/drawStore";

export async function POST(req: NextRequest) {
  const isAdminCall = (await verifyAdminRequest(req)).ok;
  if (!isAdminCall) {
    return NextResponse.json({ error: "Unauthorized — a valid admin signature is required" }, { status: 401 });
  }
  const deletedCount = await kvDeleteAll();

  // So this warm Lambda instance doesn't keep serving pre-wipe data from
  // memory for up to the next cache TTL — the wipe should be visible
  // immediately, not after a 15-30s delay.
  invalidateWorkCache();
  invalidateSalonCache();
  invalidateDrawCache();

  return NextResponse.json({ ok: true, message: `Entire database wiped — ${deletedCount} key(s) removed` });
}
