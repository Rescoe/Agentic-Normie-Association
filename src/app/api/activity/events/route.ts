/**
 * GET /api/activity/events
 *
 * Incrementally scans ALL on-chain events from every ANA contract and caches the
 * running total in Neon. Scanning/parsing logic lives in @/lib/activityScanner
 * (shared with backfill/route.ts, which patches specific gaps this cursor-based
 * scan can leave behind — see that file's header for why gaps happen at all).
 */

export const dynamic = "force-dynamic"; // never pre-render at build time
export const maxDuration = 60; // Vercel Hobby plan cap — was unset (10s default), far too short for a full chain scan

import { NextResponse } from "next/server";
import { listTxLog, type TxLogRow } from "@/lib/txLog";
import {
  rpc, scanRange, readCache, writeCache, CORE_CONFIGURED,
  MAX_EVENTS_KEPT, type ActivityEvent, type CachedPayload,
} from "@/lib/activityScanner";

// AssociationCore's actual deployment block for the CURRENT (26/09/2026)
// redeploy — verified on-chain via binary search on eth_getCode against
// 0xB70f699348A17BA8a21bE8A544092Cb3eC1bE488 (block 51,811,677, timestamp
// 2026-09-26T08:51:41Z), rounded down for safety margin. Was 47_000_000n,
// anchored to the PREVIOUS AssociationCore deployment (10/06/2026) — after
// the 26/09 contract redeploy, every contract address this scanner reads
// (Core, Assembly, WorkRegistry, ...) is new, so scanning from the old floor
// only wasted ~4.4M blocks finding nothing before ever reaching real events,
// while CACHE_KEY's version bump below drops the stale mixed-history cache
// that floor had already accumulated. This MUST be a fixed constant, not
// computed from `latest` — it used to be `latest - 2_000_000n` ("46 days
// back"), which is a *sliding* window: every day that passes without the
// cursor finishing its catch-up, the floor itself creeps forward and
// permanently strands whatever the cursor hadn't reached yet. A fixed floor
// anchored to the real deployment block doesn't have this problem — it
// never moves. Update this again (and re-verify the address above) the next
// time these contracts are redeployed.
const LAUNCH_FLOOR_BLOCK = 51_800_000n;

// Vercel Hobby hard-caps every function at 60s NO MATTER what maxDuration says. WINDOW bounds
// how many *new* blocks a single request scans — the cache stores a permanent lastScannedBlock
// cursor and each request only advances it by one WINDOW. Kept deliberately small: llamarpc (the
// fast primary) has been in an active outage, so both local and production fall back to
// mainnet.base.org / drpc.org, which are far more rate-limit-prone — see activityScanner.ts's
// RPC_CONCURRENCY comment. Catching up from LAUNCH_FLOOR_BLOCK to "now" (~4.4M blocks) takes
// ~175 cron ticks at this WINDOW. Safe to raise again once a high-limit RPC is confirmed healthy.
const WINDOW = 25_000n;

// Vercel's edge cache serves repeated requests within this window without invoking the
// function at all — no Neon read, no RPC calls. Kept short (well under the 5-min cron
// interval) so it only dedupes bursts of real page-load traffic; the cron's own requests
// are always spaced far enough apart to pass through and keep advancing the cursor.
// NOTE: this also caches responses to manual/debug curl calls against the same URL — append
// a cache-busting query param (e.g. ?_cb=<timestamp>) when polling this by hand, otherwise
// repeated calls just replay the same cached response instead of advancing anything.
const EDGE_CACHE_HEADERS = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" };

// ─── tx_log merge ──────────────────────────────────────────────────────────────
// tx_log is written the moment ANA submits a tx (see lib/txLog.ts) — it's always
// fresher than the chain-scan cache above (which can be up to 10 min stale) and
// costs one indexed SQL query instead of an RPC round-trip. We merge it in on
// every request, regardless of cache hit/miss, so brand-new activity shows up
// immediately. The chain scan remains the source of truth for history predating
// this feature and for anything tx_log might have missed.

const TX_LOG_TYPE_MAP: Record<string, string> = {
  "register":               "MEMBER_REGISTERED",
  "vote":                   "VOTE_CAST",
  "session-init":           "WORK_SESSION_INITIATED",
  "publish":                "WORK_PUBLISHED",
  "deploy-collection":      "COLLECTION_CREATED",
  "initialize-collection":  "COLLECTION_INITIALIZED",
};

function txLogToEvents(rows: TxLogRow[]): ActivityEvent[] {
  return rows
    .filter(r => r.status === "confirmed")
    .map(r => {
      const resultData = (r.result_data ?? {}) as Record<string, unknown>;
      // The on-chain numeric workId only exists for "publish" (from the WorkPublished
      // event, captured in result_data) — work_id otherwise holds our internal ANAWork
      // id (e.g. "work_169..._abcde"), which isn't a display-friendly number.
      const onChainWorkId = r.type === "publish" && typeof resultData.onChainWorkId === "number"
        ? resultData.onChainWorkId : undefined;
      return {
        id:            `txlog-${r.tx_hash}`,
        type:          TX_LOG_TYPE_MAP[r.type] ?? r.type.toUpperCase(),
        blockNumber:   r.block_number != null ? String(r.block_number) : "0",
        txHash:        r.tx_hash,
        timestamp:     r.confirmed_at ? Math.floor(new Date(r.confirmed_at).getTime() / 1000) : undefined,
        address:       r.target_address ?? r.from_address ?? undefined,
        tokenId:       r.related_token_id ?? undefined,
        workId:        onChainWorkId,
        extra:         {
          ...(resultData as Record<string, string | number | boolean>),
          name:           r.label ?? undefined,
          fromAddress:    r.from_address ?? undefined,
          targetAddress:  r.target_address ?? undefined,
          functionName:   r.function_name,
          contractName:   r.contract_name,
        } as Record<string, string | number | boolean>,
      };
    });
}

async function mergeTxLog(events: ActivityEvent[]): Promise<ActivityEvent[]> {
  try {
    const rows = await listTxLog(200);
    if (rows.length === 0) return events;
    const knownHashes = new Set(events.map(e => e.txHash));
    const extra = txLogToEvents(rows).filter(e => !knownHashes.has(e.txHash));
    const merged = [...extra, ...events];
    merged.sort((a, b) => {
      const diff = BigInt(b.blockNumber) - BigInt(a.blockNumber);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });
    return merged;
  } catch (e) {
    console.warn(`[activity/events] tx_log merge failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    return events;
  }
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  if (!CORE_CONFIGURED) {
    return NextResponse.json({ events: [], meta: null, error: "Contracts not configured" });
  }

  try {
    const latest = await rpc.getBlockNumber();
    const cached = await readCache();

    // First-ever run: floor is the fixed launch block (never moves — see comment above
    // LAUNCH_FLOOR_BLOCK). Every run after that: resume exactly where the last one left off.
    const floor = LAUNCH_FLOOR_BLOCK;
    const lastScanned = cached?.lastScannedBlock ? BigInt(cached.lastScannedBlock) : floor - 1n;
    const from = lastScanned + 1n > floor ? lastScanned + 1n : floor;

    if (from > latest) {
      // Already fully caught up and no new blocks since the last request — skip
      // RPC entirely, just merge tx_log on top of what's already accumulated.
      const events = await mergeTxLog(cached?.events ?? []);
      console.log(`[activity/events] up to date at block ${latest} — ${cached?.events.length ?? 0} events (+tx_log → ${events.length})`);
      return NextResponse.json({
        events,
        meta: { fromBlock: String(floor), toBlock: String(latest), cachedAt: Date.now() },
      }, { headers: { "X-Cache": "UP_TO_DATE", ...EDGE_CACHE_HEADERS } });
    }

    // Bounded window — never scans more than WINDOW blocks per request, regardless
    // of how far behind the cursor is. Catching up a multi-million-block backlog just
    // takes a handful of requests instead of one request that can never finish.
    const to = from + WINDOW - 1n > latest ? latest : from + WINDOW - 1n;

    console.log(`[activity/events] fetching blocks ${from}–${to} (${to - from + 1n} blocks, caught up to ${to}/${latest})…`);
    const t0 = Date.now();

    const events = await scanRange(from, to);
    console.log(`[activity/events] fetch done in ${Date.now() - t0}ms`);

    // Re-read the cache fresh right before merging/writing. `cached` above was read at the
    // START of this request, but a full scan takes 15-25s+ — wide enough for a concurrent
    // request (cron every 5 min, plus manual catch-up calls, with no locking on this route)
    // to have already advanced the cursor further and written its own result in the
    // meantime. Merging against the stale start-of-request snapshot would silently overwrite
    // that newer state with less data — this is what wiped the accumulated event history
    // back to empty after a burst of manual catch-up calls overlapped with a cron tick.
    const freshCached = await readCache();
    if (freshCached?.lastScannedBlock && BigInt(freshCached.lastScannedBlock) >= to) {
      // Someone else already reached at least as far as we did — don't regress their
      // lastScannedBlock cursor. But DO merge what we found: their scan of an overlapping
      // range can have its own partial RPC failures ("over rate limit" on a per-chunk
      // basis, silently returning [] for that one contract/event pair — see fetchLogs
      // above), so simply discarding our results here risks permanently losing real
      // events that ONLY this request's scan actually caught. Confirmed this is a real
      // data-loss path, not theoretical: a genuine WorkPublished log (workId 13, full
      // content) was independently verified on-chain at a block well within the already-
      // scanned range, yet never made it into the cache — this exact branch is why.
      const eventIds = new Set(freshCached.events.map(e => e.id));
      const newOnes  = events.filter(e => !eventIds.has(e.id));
      if (newOnes.length > 0) {
        const merged = [...newOnes, ...freshCached.events].slice(0, MAX_EVENTS_KEPT);
        merged.sort((a, b) => {
          const diff = BigInt(b.blockNumber) - BigInt(a.blockNumber);
          return diff > 0n ? 1 : diff < 0n ? -1 : 0;
        });
        await writeCache({ ...freshCached, events: merged });
        console.log(`[activity/events] superseded by cursor progress (cache at ${freshCached.lastScannedBlock} >= our ${to}), but recovered ${newOnes.length} event(s) their scan missed`);
        const withTxLog = await mergeTxLog(merged);
        return NextResponse.json({ ...freshCached, events: withTxLog }, { headers: { "X-Cache": "SUPERSEDED_MERGED", ...EDGE_CACHE_HEADERS } });
      }
      console.log(`[activity/events] superseded by a concurrent request (cache already at ${freshCached.lastScannedBlock} >= our ${to}) — nothing new to add`);
      const merged = await mergeTxLog(freshCached.events);
      return NextResponse.json({ ...freshCached, events: merged }, { headers: { "X-Cache": "SUPERSEDED", ...EDGE_CACHE_HEADERS } });
    }

    // Merge with whatever was already accumulated (this window's new events come first
    // since we always scan forward), cap the blob so it doesn't grow unbounded — older
    // events past MAX_EVENTS_KEPT are still recoverable from tx_log / the chain itself.
    const allEvents = [...events, ...(freshCached?.events ?? [])].slice(0, MAX_EVENTS_KEPT);
    allEvents.sort((a, b) => {
      const diff = BigInt(b.blockNumber) - BigInt(a.blockNumber);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });

    const payload: CachedPayload = {
      events:           allEvents,
      lastScannedBlock: String(to),
      meta:             { fromBlock: String(floor), toBlock: String(to), cachedAt: Date.now() },
    };
    await writeCache(payload);

    const merged = await mergeTxLog(allEvents);
    console.log(`[activity/events] +${events.length} new events (window ${from}-${to}/${latest}) in ${Date.now() - t0}ms — ${allEvents.length} total (+tx_log → ${merged.length})`);

    return NextResponse.json({ ...payload, events: merged }, {
      headers: { "X-Cache": to < latest ? "CATCHING_UP" : "MISS", ...EDGE_CACHE_HEADERS },
    });

  } catch (err) {
    console.error("[activity/events] ERROR:", err);
    return NextResponse.json(
      { events: [], meta: null, error: "Chain read failed", detail: String(err) },
      { status: 500 }
    );
  }
}
