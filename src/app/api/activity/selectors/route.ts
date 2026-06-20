/**
 * GET /api/activity/selectors            → full dictionary (for reference/debugging)
 * GET /api/activity/selectors?selector=0x9463c17d → single lookup
 *
 * See lib/functionSelectors.ts for why this exists: our contracts aren't verified on
 * BaseScan, so raw calls show up unlabeled there. This is the canonical place to resolve
 * a selector back to "which ANA function is this" — including ones made directly by
 * Normie wallets, not just the relayer.
 */

import { NextRequest, NextResponse } from "next/server";
import { decodeSelector, listAllSelectors } from "@/lib/functionSelectors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const selector = req.nextUrl.searchParams.get("selector");
  if (selector) {
    const info = decodeSelector(selector);
    if (!info) return NextResponse.json({ error: `Unknown selector ${selector}` }, { status: 404 });
    return NextResponse.json({ selector: selector.toLowerCase(), ...info });
  }
  return NextResponse.json({ selectors: listAllSelectors() });
}
