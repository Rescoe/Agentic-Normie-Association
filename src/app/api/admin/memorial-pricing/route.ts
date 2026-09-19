export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/adminAuth";
import { getMemorialPricing, setMemorialPricing, type MemorialPricingConfig } from "@/lib/memorialPricing";

/**
 * GET/PUT /api/admin/memorial-pricing — the 3 paid-tier + batch prices for
 * burn memorials (src/lib/memorialPricing.ts). Kept in Neon rather than
 * hardcoded or on-chain specifically so this can be tuned without a contract
 * redeploy, per the porteur's own request.
 */
export async function GET() {
  return NextResponse.json(await getMemorialPricing());
}

export async function PUT(req: NextRequest) {
  const auth = await verifyAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ error: "Admin signature required" }, { status: 401 });

  let body: MemorialPricingConfig;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  for (const key of ["tier1", "tier2", "tier3", "batchPriceWei"] as const) {
    if (!(key in body)) return NextResponse.json({ error: `Missing field: ${key}` }, { status: 400 });
  }

  await setMemorialPricing(body);
  return NextResponse.json({ ok: true });
}
