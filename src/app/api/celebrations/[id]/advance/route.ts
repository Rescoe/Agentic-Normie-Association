export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getWork } from "@/lib/workStore";

/**
 * POST /api/celebrations/[id]/advance — nudges the work-lifecycle state
 * machine forward by ONE tick (server-to-server call to
 * /api/keeper/work-lifecycle using CRON_SECRET, exactly what the 2h cron
 * does) and returns this work's resulting state.
 *
 * Exists so a freshly-created memorial (via request-memorial) doesn't have
 * to sit through up to 2h of cron ticks before it reaches CREATING and can
 * actually be drawn — the draw page below polls this a few times instead.
 * Safe to call repeatedly: it's the exact same operation the cron already
 * runs unattended every 2h, just invoked on demand.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  try {
    const url = new URL("/api/keeper/work-lifecycle", req.url).toString();
    const res = await fetch(url, {
      method:  "POST",
      headers: { "x-cron-secret": cronSecret },
      signal:  AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return NextResponse.json({ error: `work-lifecycle ${res.status}: ${err.slice(0, 200)}` }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "tick failed" }, { status: 502 });
  }

  const work = await getWork(params.id);
  if (!work) return NextResponse.json({ error: "Work not found" }, { status: 404 });

  return NextResponse.json({ ok: true, state: work.state });
}
