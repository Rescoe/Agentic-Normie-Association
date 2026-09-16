/**
 * POST /api/activity/backfill
 *
 * One-off maintenance tool: re-scans a specific narrow block range for every
 * tracked event type and merges any found events into the activity cache —
 * WITHOUT moving lastScannedBlock. For recovering events a transient RPC glitch
 * dropped from a range the main cursor (see events/route.ts) already passed and
 * will never revisit.
 *
 * Known cause: mainnet.base.org can return an empty eth_getLogs result (no error
 * at all) for a range that has real matching logs, then the correct result on an
 * identical retry moments later — see project_ana_activity_feed_bugs memory.
 * Retrying on error doesn't catch this since there's no error to catch.
 *
 * Body: { fromBlock: string, toBlock: string }
 * Range capped at 5 000 blocks — this is a targeted patch tool, not a bulk
 * rescan mechanism (that's what the cursor in events/route.ts is for).
 * Protected by x-cron-secret, same as the other keeper/admin routes.
 */
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { scanRange, readCache, writeCache, MAX_EVENTS_KEPT, type CachedPayload } from "@/lib/activityScanner";

const MAX_RANGE = 5_000n;

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const isAuthorized = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized — x-cron-secret required" }, { status: 401 });
  }

  let body: { fromBlock?: string; toBlock?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.fromBlock || !body.toBlock) {
    return NextResponse.json({ error: "fromBlock and toBlock are required" }, { status: 400 });
  }

  let from: bigint, to: bigint;
  try {
    from = BigInt(body.fromBlock);
    to   = BigInt(body.toBlock);
  } catch {
    return NextResponse.json({ error: "fromBlock/toBlock must be valid integers" }, { status: 400 });
  }

  if (to < from) {
    return NextResponse.json({ error: "toBlock must be >= fromBlock" }, { status: 400 });
  }
  if (to - from + 1n > MAX_RANGE) {
    return NextResponse.json({ error: `Range too large — max ${MAX_RANGE} blocks per call` }, { status: 400 });
  }

  try {
    const found = await scanRange(from, to);

    const cached = await readCache();
    const existingIds = new Set((cached?.events ?? []).map(e => e.id));
    const newOnes = found.filter(e => !existingIds.has(e.id));

    if (newOnes.length === 0) {
      return NextResponse.json({
        scanned: { fromBlock: String(from), toBlock: String(to) },
        found: found.length,
        added: 0,
        message: "Nothing new — either already in the cache or genuinely no events in this range.",
      });
    }

    const merged = [...newOnes, ...(cached?.events ?? [])].slice(0, MAX_EVENTS_KEPT);
    merged.sort((a, b) => {
      const diff = BigInt(b.blockNumber) - BigInt(a.blockNumber);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });

    // lastScannedBlock deliberately left untouched — this range may sit well behind
    // the cursor, and rewriting it backward would break the main route's forward-only
    // assumption.
    const payload: CachedPayload = {
      events:           merged,
      lastScannedBlock: cached?.lastScannedBlock ?? String(to),
      meta:             cached?.meta ?? { fromBlock: String(from), toBlock: String(to), cachedAt: Date.now() },
    };
    await writeCache(payload);

    return NextResponse.json({
      scanned: { fromBlock: String(from), toBlock: String(to) },
      found: found.length,
      added: newOnes.length,
      addedEvents: newOnes,
    });
  } catch (err) {
    console.error("[activity/backfill] ERROR:", err);
    return NextResponse.json(
      { error: "Backfill scan failed", detail: String(err) },
      { status: 500 }
    );
  }
}
