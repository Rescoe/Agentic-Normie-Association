/**
 * GET /api/health
 *
 * Ultra-lightweight liveness probe. Does:
 *   1. A SELECT 1 on Neon to keep the branch from being archived (Neon
 *      archives branches after 28 days of inactivity on the free tier).
 *   2. Returns the Neon hostname so it's easy to confirm which branch
 *      is actually wired up.
 *
 * Called by the weekly `neon-keepalive` GitHub Actions workflow. Also
 * useful as a general health check — returns 200 when Neon is reachable,
 * 503 otherwise.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sql, USE_NEON, getNeonHost } from "@/lib/db";

export async function GET() {
  const neonHost = getNeonHost();

  if (!USE_NEON) {
    return NextResponse.json(
      { ok: true, neon: false, message: "No Neon connection configured — local mode" },
      { status: 200 },
    );
  }

  try {
    await sql()`SELECT 1 AS ping`;
    return NextResponse.json(
      { ok: true, neon: true, host: neonHost },
      { status: 200 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, neon: false, host: neonHost, error: msg },
      { status: 503 },
    );
  }
}
