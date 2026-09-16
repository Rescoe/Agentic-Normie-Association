/**
 * GET /api/activity/events
 *
 * Fetches ALL on-chain events from every ANA contract.
 *
 * Performance strategy:
 *   1. Neon KV cache (5-minute TTL) — instant on cache hit
 *   2. On cache miss: fetch from RPC using PARALLEL chunks (not sequential)
 *      → 14 event types × parallel batches ≈ 5–15s instead of 5 min
 *
 * Contracts covered:
 *   AssociationCore       → MemberRegistered, RoleGranted
 *   ConstituentAssembly   → SessionOpened/Closed, VoteCast, RoleResolved, RolesResolved
 *   WorkRegistry          → WorkPublished, WorkSessionInitiated, WorkArchived
 *   GovernanceCalendar    → EventScheduled, EventTriggered
 *   FactoryRegistry       → FactoryRegistered
 *   CollectionFactory     → CollectionCreated (legacy factory — kept in case of old history)
 *   ANACollectionFactory  → CollectionDeployed (the factory actually used by workPublisher.ts)
 *   ANAEditions (dynamic) → CollectionInitialized, EditionMinted — one contract per work,
 *                           addresses discovered via ANACollectionFactory.getAllCollections()
 */

export const dynamic = "force-dynamic"; // never pre-render at build time
export const maxDuration = 60; // Vercel Hobby plan cap — was unset (10s default), far too short for a full chain scan

import { NextResponse }     from "next/server";
import {
  createPublicClient, http, fallback, parseAbiItem,
  keccak256, stringToBytes,
  type Log, type AbiEvent,
} from "viem";
import { base as baseChain } from "viem/chains";
import { CONTRACT_ADDRESSES, ROLE_LABELS, ANA_COLLECTION_FACTORY_ABI } from "@/lib/contracts";
import { listTxLog, type TxLogRow } from "@/lib/txLog";

// ─── RPC client ───────────────────────────────────────────────────────────────

// LlamaRPC supports up to 10 000 blocks per eth_getLogs (vs 2 000 for mainnet.base.org).
// Override with BASE_RPC_URL env var to use Alchemy/QuickNode/etc.
// fallback() retries against the next URL when one is down — llamarpc had a full
// outage (HTTP 521) that silently zeroed out every event in production, because
// fetchLogs() swallows per-chunk errors to keep one bad provider from killing the
// whole scan. Without a fallback transport, "swallow the error" became "swallow
// the entire chain's history" the moment the primary RPC went down.
const RPC_URL = process.env.BASE_RPC_URL ?? "https://base.llamarpc.com";
const rpc = createPublicClient({
  chain:     baseChain,
  // retryCount: 0 on each leg — viem's fallback() already retries by moving to the
  // next transport. Leaving the default retryCount (3) on every leg meant a single
  // chunk request against a *dead* primary (llamarpc's HTTP 521 outage) retried 3x
  // with backoff before fallback() even tried the next URL — multiplied across
  // ~1000 chunks × 17 event types, that's what took the whole route from a few
  // seconds to a full timeout with zero response in production.
  transport: fallback([
    http(RPC_URL, { retryCount: 0 }),
    // base.publicnode.com and mainnet.base.org both reject getLogs on block ranges
    // older than their free-tier window ("Archive requests require a personal
    // token" / outright rate-limit) — verified by hand against this exact
    // 2M-block range. drpc.org is the one public Base RPC that actually serves
    // full archive history for free, so it's the real fallback; the others are
    // kept after it only in case drpc.org itself has an outage.
    http("https://base.drpc.org", { retryCount: 0 }),
    http("https://mainnet.base.org", { retryCount: 0 }),
  ], { rank: true }), // periodically re-ranks transports by health/latency so a
                      // recovered llamarpc gets used again without a redeploy
});

// ─── Contract addresses ───────────────────────────────────────────────────────

const ADDR = {
  CORE:  CONTRACT_ADDRESSES.AssociationCore     as `0x${string}` | undefined,
  CA:    CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}` | undefined,
  WR:    CONTRACT_ADDRESSES.WorkRegistry        as `0x${string}` | undefined,
  GC:    CONTRACT_ADDRESSES.GovernanceCalendar  as `0x${string}` | undefined,
  FR:    CONTRACT_ADDRESSES.FactoryRegistry     as `0x${string}` | undefined,
  CF:    CONTRACT_ADDRESSES.CollectionFactory   as `0x${string}` | undefined,
  // ANACollectionFactory is the contract workPublisher.ts actually calls
  // (CollectionFactory above is an older/legacy factory contract). They emit
  // different events (CollectionDeployed vs CollectionCreated) — both are
  // scanned since either could hold real history depending on deployment era.
  ANACF: CONTRACT_ADDRESSES.ANACollectionFactory as `0x${string}` | undefined,
};

// ─── Event signatures ─────────────────────────────────────────────────────────

const EV = {
  MEMBER_REGISTERED:    parseAbiItem("event MemberRegistered(uint256 indexed tokenId, address indexed ownerAddress, uint256 timestamp)")   as AbiEvent,
  ROLE_GRANTED:         parseAbiItem("event RoleGranted(bytes32 indexed role, uint256 indexed tokenId, address indexed holderAddress)")     as AbiEvent,
  SESSION_OPENED:       parseAbiItem("event SessionOpened(uint256 indexed sessionId, uint256 timestamp)")                                   as AbiEvent,
  SESSION_CLOSED:       parseAbiItem("event SessionClosed(uint256 indexed sessionId, uint256 timestamp)")                                   as AbiEvent,
  VOTE_CAST:            parseAbiItem("event VoteCast(uint256 indexed sessionId, uint256 indexed voterTokenId, bytes32 indexed role, uint256 candidateTokenId)") as AbiEvent,
  ROLE_RESOLVED:        parseAbiItem("event RoleResolved(uint256 indexed sessionId, bytes32 indexed role, uint256 winnerTokenId, uint256 voteCount)") as AbiEvent,
  ROLES_RESOLVED:       parseAbiItem("event RolesResolved(uint256 indexed sessionId)")                                                      as AbiEvent,
  WORK_PUBLISHED:       parseAbiItem("event WorkPublished(uint256 indexed workId, string content, uint256 indexed authorTokenId, uint256 indexed rapporteurTokenId, uint256 timestamp)") as AbiEvent,
  WORK_SESSION_INIT:    parseAbiItem("event WorkSessionInitiated(uint256 indexed sessionId, uint256 initiatedAt, address indexed initiatedBy)") as AbiEvent,
  WORK_ARCHIVED:        parseAbiItem("event WorkArchived(uint256 indexed workId, uint256 archivedAt)")                                      as AbiEvent,
  GC_SCHEDULED:         parseAbiItem("event EventScheduled(uint256 indexed eventId, bytes32 indexed eventType, uint256 scheduledAt, bool recurring, uint256 periodSeconds)") as AbiEvent,
  GC_TRIGGERED:         parseAbiItem("event EventTriggered(uint256 indexed eventId, bytes32 indexed eventType, address indexed triggeredBy, uint256 timestamp)") as AbiEvent,
  FACTORY_REGISTERED:   parseAbiItem("event FactoryRegistered(bytes32 indexed factoryType, address indexed factory)")                      as AbiEvent,
  COLLECTION_CREATED:   parseAbiItem("event CollectionCreated(uint256 indexed normieTokenId, address indexed collection, string name, string symbol, address minter, uint256 timestamp)") as AbiEvent,
  // ANACollectionFactory.createCollection() — the contract actually used in production —
  // emits this, NOT CollectionCreated above (see contracts/factory/ANACollectionFactory.sol:43).
  COLLECTION_DEPLOYED:  parseAbiItem("event CollectionDeployed(uint256 indexed normieTokenId, address indexed collectionAddr, string name, address minter)") as AbiEvent,
  // Per-ANAEditions-instance events — these contracts are deployed dynamically (one per
  // work), so there's no single fixed address to scan; see getAllCollections() fetch below.
  COLLECTION_INITIALIZED: parseAbiItem("event CollectionInitialized(string artworkTitle, uint256 workId)") as AbiEvent,
  EDITION_MINTED:          parseAbiItem("event EditionMinted(uint256 indexed tokenId, address indexed buyer, uint256 priceWei)") as AbiEvent,
};

// ─── GovernanceCalendar event type labels ─────────────────────────────────────

const GC_LABELS: Record<string, string> = {
  [keccak256(stringToBytes("BURN_CREATION"))]:    "Création par burn",
  [keccak256(stringToBytes("ELECTION"))]:          "Élection",
  [keccak256(stringToBytes("GENERAL_ASSEMBLY"))]:  "Assemblée générale",
  [keccak256(stringToBytes("INSCRIPTION_OPEN"))]:  "Ouverture inscriptions",
  [keccak256(stringToBytes("INSCRIPTION_CLOSE"))]: "Clôture inscriptions",
  [keccak256(stringToBytes("WORK_SESSION"))]:      "Session créative",
};

// ─── Parallel log fetcher ─────────────────────────────────────────────────────
// CHUNK is capped at 2 000 — the limit of the *narrowest* provider in the fallback
// chain (mainnet.base.org). LlamaRPC alone tolerates up to 10 000, but a chunk
// size that only works on the primary defeats the point of having a fallback:
// if llamarpc is down and we fail over to mainnet.base.org mid-scan, a 5 000-block
// request would just fail there too.
//
// Math with CHUNK=2 000 and SCAN_RANGE=2 000 000:
//   2 000 000 / 2 000 = 1000 chunks per type
//   1000 / BATCH_SIZE(20) = 50 sequential batches per type
//   All event types run in parallel → dominated by slowest ≈ 15–25s
//   Within Vercel Hobby 60s limit.

const CHUNK      = 2_000n;
const BATCH_SIZE = 20;
// AssociationCore's actual deployment block (2026-06-10T21:10:41Z, per Simple-Deploy-Solidity's
// deployed.json), rounded down for safety margin. This MUST be a fixed constant, not computed
// from `latest` — it used to be `latest - 2_000_000n` ("46 days back"), which is a *sliding*
// window: every day that passes without the cursor finishing its catch-up, the floor itself
// creeps forward and permanently strands whatever the cursor hadn't reached yet. That's why
// registrations from ~90 days ago (e.g. bitpixi.base.eth, roubzi.eth — block ~47.19M) never
// showed up even though the cron was running: by the time anyone looked, "46 days back" from
// the then-current block had already slid past those blocks, and `from = max(lastScanned+1,
// floor)` never lets the scan go back below the (now later) floor to pick them up. A fixed
// floor anchored to the real deployment block doesn't have this problem — it never moves.
const LAUNCH_FLOOR_BLOCK = 47_000_000n;
// Vercel Hobby hard-caps every function at 60s NO MATTER what maxDuration says — there is no
// "give it more time" fix. Re-scanning the full history on every cache miss was the original
// bug: with degraded public RPCs, millions of blocks × 17 event types simply cannot finish in
// 60s, so the route timed out with zero response instead of degrading gracefully.
// WINDOW bounds how many *new* blocks a single request is allowed to scan — the cache stores a
// permanent lastScannedBlock cursor (see CachedPayload) and each request only advances it by
// one WINDOW. Kept deliberately small (measured empirically, see RPC_CONCURRENCY comment below):
// llamarpc — the fast primary — is in an active outage (HTTP 525) as of 2026-09-16, so both local
// and production are actually falling back to mainnet.base.org / drpc.org, which are far more
// rate-limit-prone. A larger WINDOW here just means more silently-dropped chunks, not faster
// catch-up. Catching up from LAUNCH_FLOOR_BLOCK to "now" (~4.4M blocks) takes ~175 cron ticks at
// this WINDOW — slower, but each tick actually finds what it scans instead of racing a rate
// limit. Cron cadence bumped to every 5 min (see activity-catchup.yml) to compensate. Safe to
// raise WINDOW again once llamarpc (or another high-limit RPC) is confirmed healthy.
const WINDOW = 25_000n;

// ─── Global RPC concurrency limiter ───────────────────────────────────────────
// mainnet.base.org rate-limits well below what this route used to generate: up to 17
// event types × BATCH_SIZE parallel chunks each meant 100+ simultaneous eth_getLogs
// calls. Measured directly against mainnet.base.org: a 40-request burst got ~37%
// rejected with "over rate limit". Those rejections were swallowed by the bare
// `.catch(() => [])` below, so a rate-limited chunk looked identical to "no events in
// this range" — this, not just the sliding-floor bug above, is why registrations that
// definitely happened (verified independently via a direct eth_getLogs call) never
// showed up in the feed. Every getLogs call now goes through this limiter so total
// in-flight requests stay bounded regardless of how many event types run concurrently.
// Vercel's edge cache serves repeated requests within this window without invoking the
// function at all — no Neon read, no RPC calls. Kept short (well under the 5-min cron
// interval) so it only dedupes bursts of real page-load traffic; the cron's own requests
// are always spaced far enough apart to pass through and keep advancing the cursor.
// This is the main lever against Neon transfer growing with visitor count rather than
// with actual chain activity — see project memory on Neon quota for the full reasoning.
const EDGE_CACHE_HEADERS = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" };

const RPC_CONCURRENCY = 8;
let activeRpcRequests = 0;
const rpcWaitQueue: Array<() => void> = [];

async function withRpcLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (activeRpcRequests >= RPC_CONCURRENCY) {
    await new Promise<void>(resolve => rpcWaitQueue.push(resolve));
  }
  activeRpcRequests++;
  try {
    return await fn();
  } finally {
    activeRpcRequests--;
    rpcWaitQueue.shift()?.();
  }
}

async function fetchLogs(
  address: `0x${string}` | `0x${string}`[],
  event:   AbiEvent,
  from:    bigint,
  to:      bigint,
): Promise<Log[]> {
  if (!address || (Array.isArray(address) && address.length === 0)) return [];

  // Parallel chunk fetching — no optimistic single call (it hangs on range errors
  // for 10-30s on public RPCs, wasting our Vercel budget)
  const chunks: Array<{ from: bigint; to: bigint }> = [];
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + CHUNK - 1n > to ? to : cursor + CHUNK - 1n;
    chunks.push({ from: cursor, to: end });
    cursor = end + 1n;
  }

  const allLogs: Log[] = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async c => {
        const call = () => withRpcLimit(() => rpc.getLogs({ address, event, fromBlock: c.from, toBlock: c.to }));
        // Rate-limit is transient, not "no events" — worth retrying with backoff before
        // giving up. Any other error (malformed range, etc.) fails fast, since retrying
        // it would just waste the request budget. Up to 3 attempts total: a single retry
        // wasn't enough when the RPC is under sustained load for the whole request, not
        // just a momentary burst.
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await call();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!/rate limit/i.test(msg) || attempt === 2) return [] as Log[];
            await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
          }
        }
        return [] as Log[];
      })
    );
    allLogs.push(...results.flat());
  }

  return allLogs;
}

// ─── Public event type ────────────────────────────────────────────────────────

export interface ActivityEvent {
  id:           string;
  type:         string;
  blockNumber:  string;
  txHash:       string;
  timestamp?:   number;
  tokenId?:     number;
  candidateId?: number;
  sessionId?:   number;
  workId?:      number;
  role?:        string;
  roleLabel?:   string;
  address?:     string;
  extra?:       Record<string, string | number | boolean>;
}

function makeEv(log: Log, type: string, i: number): ActivityEvent {
  return {
    id:          `${type}-${String(log.blockNumber)}-${i}`,
    type,
    blockNumber: String(log.blockNumber ?? 0n),
    txHash:      log.transactionHash ?? "0x",
  };
}

function args(log: Log): Record<string, unknown> {
  return (log as { args?: Record<string, unknown> }).args ?? {};
}

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

// ─── Cache helpers (Neon KV) ──────────────────────────────────────────────────
// This is no longer a TTL cache — it's a permanent incremental ledger. Each entry
// records the highest block already scanned (lastScannedBlock); the next request
// only scans forward from there, bounded by WINDOW. There is nothing to "expire":
// once an event is found, it stays, and the cursor only ever moves forward.

// bumped v7 → v8: even with the fresh-read guard, a concurrent cron tick still landed
// inside the narrow window between v7's fresh-read and its write, dropping the recovered
// registrations again. Cron is paused (see activity-catchup.yml) for this re-scan so
// there's only one writer — see project_ana_activity_feed_bugs memory for the full trail.
const CACHE_KEY         = "activity:events:v8";
const MAX_EVENTS_KEPT = 1000; // keep the blob bounded — older events are still in tx_log/on-chain

interface CachedPayload {
  events:           ActivityEvent[];
  lastScannedBlock: string;
  meta:             { fromBlock: string; toBlock: string; cachedAt: number };
}

async function readCache(): Promise<CachedPayload | null> {
  try {
    const { kvGet, USE_NEON } = await import("@/lib/db");
    if (!USE_NEON) return null;
    const raw = await kvGet(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedPayload;
  } catch { return null; }
}

async function writeCache(payload: CachedPayload): Promise<void> {
  try {
    const { kvSet, USE_NEON } = await import("@/lib/db");
    if (!USE_NEON) return;
    await kvSet(CACHE_KEY, JSON.stringify(payload));
  } catch { /* silent — cache write failure is not fatal */ }
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  if (!ADDR.CORE) {
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
    // of how far behind the cursor is. Catching up a 2M-block backlog just takes a
    // handful of requests instead of one request that can never finish.
    const to = from + WINDOW - 1n > latest ? latest : from + WINDOW - 1n;

    console.log(`[activity/events] fetching blocks ${from}–${to} (${to - from + 1n} blocks, caught up to ${to}/${latest})…`);
    const t0 = Date.now();

    // ANAEditions collections are deployed dynamically (one per work) — there's no
    // fixed address to scan, so we list them via the factory first, then pass the
    // whole array to getLogs() in one shot for CollectionInitialized/EditionMinted.
    let collectionAddrs: `0x${string}`[] = [];
    if (ADDR.ANACF) {
      try {
        collectionAddrs = await rpc.readContract({
          address: ADDR.ANACF, abi: ANA_COLLECTION_FACTORY_ABI, functionName: "getAllCollections",
        }) as `0x${string}`[];
      } catch (e) {
        console.warn(`[activity/events] getAllCollections failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Fetch ALL event types in parallel
    const [
      memberLogs, roleLogs,
      sessOpenLogs, sessCloseLogs, voteLogs, roleResLogs, rolesResLogs,
      workPubLogs, workSessLogs, workArcLogs,
      gcSchedLogs, gcTrigLogs,
      factoryLogs, collectionLogs, collectionDeployedLogs,
      collectionInitLogs, editionMintedLogs,
    ] = await Promise.all([
      ADDR.CORE ? fetchLogs(ADDR.CORE, EV.MEMBER_REGISTERED,  from, to) : [],
      ADDR.CORE ? fetchLogs(ADDR.CORE, EV.ROLE_GRANTED,       from, to) : [],
      ADDR.CA   ? fetchLogs(ADDR.CA,   EV.SESSION_OPENED,     from, to) : [],
      ADDR.CA   ? fetchLogs(ADDR.CA,   EV.SESSION_CLOSED,     from, to) : [],
      ADDR.CA   ? fetchLogs(ADDR.CA,   EV.VOTE_CAST,          from, to) : [],
      ADDR.CA   ? fetchLogs(ADDR.CA,   EV.ROLE_RESOLVED,      from, to) : [],
      ADDR.CA   ? fetchLogs(ADDR.CA,   EV.ROLES_RESOLVED,     from, to) : [],
      ADDR.WR   ? fetchLogs(ADDR.WR,   EV.WORK_PUBLISHED,     from, to) : [],
      ADDR.WR   ? fetchLogs(ADDR.WR,   EV.WORK_SESSION_INIT,  from, to) : [],
      ADDR.WR   ? fetchLogs(ADDR.WR,   EV.WORK_ARCHIVED,      from, to) : [],
      ADDR.GC   ? fetchLogs(ADDR.GC,   EV.GC_SCHEDULED,       from, to) : [],
      ADDR.GC   ? fetchLogs(ADDR.GC,   EV.GC_TRIGGERED,       from, to) : [],
      ADDR.FR   ? fetchLogs(ADDR.FR,   EV.FACTORY_REGISTERED, from, to) : [],
      ADDR.CF    ? fetchLogs(ADDR.CF,    EV.COLLECTION_CREATED,    from, to) : [],
      ADDR.ANACF ? fetchLogs(ADDR.ANACF, EV.COLLECTION_DEPLOYED,   from, to) : [],
      collectionAddrs.length ? fetchLogs(collectionAddrs, EV.COLLECTION_INITIALIZED, from, to) : [],
      collectionAddrs.length ? fetchLogs(collectionAddrs, EV.EDITION_MINTED,         from, to) : [],
    ]);

    console.log(`[activity/events] fetch done in ${Date.now() - t0}ms`);

    // ── 3. Parse logs into ActivityEvent ──────────────────────────────────
    const events: ActivityEvent[] = [];

    memberLogs.forEach((log, i) => {
      const a = args(log);
      events.push({ ...makeEv(log, "MEMBER_REGISTERED", i),
        tokenId:   Number(a.tokenId  ?? 0),
        address:   String(a.ownerAddress ?? ""),
        timestamp: Number(a.timestamp ?? 0),
      });
    });

    roleLogs.forEach((log, i) => {
      const a = args(log);
      const rh = String(a.role ?? "");
      events.push({ ...makeEv(log, "ROLE_GRANTED", i),
        role:      rh,
        roleLabel: ROLE_LABELS[rh],
        tokenId:   Number(a.tokenId  ?? 0),
        address:   String(a.holderAddress ?? ""),
      });
    });

    sessOpenLogs.forEach((log, i) => {
      const a = args(log);
      events.push({ ...makeEv(log, "SESSION_OPENED", i),
        sessionId: Number(a.sessionId ?? 0),
        timestamp: Number(a.timestamp ?? 0),
      });
    });

    sessCloseLogs.forEach((log, i) => {
      const a = args(log);
      events.push({ ...makeEv(log, "SESSION_CLOSED", i),
        sessionId: Number(a.sessionId ?? 0),
        timestamp: Number(a.timestamp ?? 0),
      });
    });

    voteLogs.forEach((log, i) => {
      const a = args(log);
      const rh = String(a.role ?? "");
      events.push({ ...makeEv(log, "VOTE_CAST", i),
        sessionId:   Number(a.sessionId     ?? 0),
        tokenId:     Number(a.voterTokenId  ?? 0),
        candidateId: Number(a.candidateTokenId ?? 0),
        role:        rh,
        roleLabel:   ROLE_LABELS[rh],
      });
    });

    roleResLogs.forEach((log, i) => {
      const a = args(log);
      const rh = String(a.role ?? "");
      events.push({ ...makeEv(log, "ROLE_RESOLVED", i),
        sessionId: Number(a.sessionId     ?? 0),
        tokenId:   Number(a.winnerTokenId ?? 0),
        role:      rh,
        roleLabel: ROLE_LABELS[rh],
        extra:     { voteCount: Number(a.voteCount ?? 0) },
      });
    });

    rolesResLogs.forEach((log, i) => {
      const a = args(log);
      events.push({ ...makeEv(log, "ROLES_RESOLVED", i),
        sessionId: Number(a.sessionId ?? 0),
      });
    });

    workPubLogs.forEach((log, i) => {
      const a = args(log);
      events.push({ ...makeEv(log, "WORK_PUBLISHED", i),
        workId:    Number(a.workId        ?? 0),
        tokenId:   Number(a.authorTokenId ?? 0),
        timestamp: Number(a.timestamp     ?? 0),
        extra:     { rapporteurTokenId: Number(a.rapporteurTokenId ?? 0) },
      });
    });

    workSessLogs.forEach((log, i) => {
      const a = args(log);
      events.push({ ...makeEv(log, "WORK_SESSION_INITIATED", i),
        sessionId: Number(a.sessionId   ?? 0),
        address:   String(a.initiatedBy ?? ""),
        timestamp: Number(a.initiatedAt ?? 0),
      });
    });

    workArcLogs.forEach((log, i) => {
      const a = args(log);
      events.push({ ...makeEv(log, "WORK_ARCHIVED", i),
        workId:    Number(a.workId     ?? 0),
        timestamp: Number(a.archivedAt ?? 0),
      });
    });

    gcSchedLogs.forEach((log, i) => {
      const a = args(log);
      const et = String(a.eventType ?? "");
      events.push({ ...makeEv(log, "GC_SCHEDULED", i),
        extra: {
          eventId:        Number(a.eventId    ?? 0),
          eventType:      et,
          eventTypeLabel: GC_LABELS[et] ?? "Événement",
          scheduledAt:    Number(a.scheduledAt ?? 0),
          recurring:      Boolean(a.recurring),
        },
      });
    });

    gcTrigLogs.forEach((log, i) => {
      const a = args(log);
      const et = String(a.eventType ?? "");
      events.push({ ...makeEv(log, "GC_TRIGGERED", i),
        address:   String(a.triggeredBy ?? ""),
        timestamp: Number(a.timestamp   ?? 0),
        extra: {
          eventId:        Number(a.eventId ?? 0),
          eventType:      et,
          eventTypeLabel: GC_LABELS[et] ?? "Événement",
        },
      });
    });

    factoryLogs.forEach((log, i) => {
      const a = args(log);
      events.push({ ...makeEv(log, "FACTORY_REGISTERED", i),
        address: String(a.factory     ?? ""),
        extra:   { factoryType: String(a.factoryType ?? "") },
      });
    });

    collectionLogs.forEach((log, i) => {
      const a = args(log);
      events.push({ ...makeEv(log, "COLLECTION_CREATED", i),
        tokenId:   Number(a.normieTokenId ?? 0),
        address:   String(a.collection   ?? ""),
        timestamp: Number(a.timestamp    ?? 0),
        extra: {
          name:   String(a.name   ?? ""),
          symbol: String(a.symbol ?? ""),
        },
      });
    });

    // ANACollectionFactory.createCollection() — the actual production path.
    collectionDeployedLogs.forEach((log, i) => {
      const a = args(log);
      events.push({ ...makeEv(log, "COLLECTION_CREATED", i),
        tokenId: Number(a.normieTokenId ?? 0),
        address: String(a.collectionAddr ?? ""),
        extra:   { name: String(a.name ?? "") },
      });
    });

    // Per-collection ANAEditions.initialize() — links artwork content to the collection.
    collectionInitLogs.forEach((log, i) => {
      const a = args(log);
      events.push({ ...makeEv(log, "COLLECTION_INITIALIZED", i),
        address: String(log.address ?? ""),
        workId:  Number(a.workId ?? 0),
        extra:   { name: String(a.artworkTitle ?? ""), collectionAddress: String(log.address ?? "") },
      });
    });

    // buyAndMint() on any deployed ANAEditions collection.
    editionMintedLogs.forEach((log, i) => {
      const a = args(log);
      events.push({ ...makeEv(log, "EDITION_MINTED", i),
        address: String(a.buyer ?? ""),
        extra: {
          collectionAddress: String(log.address ?? ""),
          tokenId:            Number(a.tokenId  ?? 0),
          priceWei:           String(a.priceWei  ?? "0"),
        },
      });
    });

    // Re-read the cache fresh right before merging/writing. `cached` above was read at the
    // START of this request, but a full scan takes 15-25s+ — wide enough for a concurrent
    // request (cron every 5 min, plus manual catch-up calls, with no locking on this route)
    // to have already advanced the cursor further and written its own result in the
    // meantime. Merging against the stale start-of-request snapshot would silently overwrite
    // that newer state with less data — this is what wiped the accumulated event history
    // back to empty after a burst of manual catch-up calls overlapped with a cron tick.
    const freshCached = await readCache();
    if (freshCached?.lastScannedBlock && BigInt(freshCached.lastScannedBlock) >= to) {
      // Someone else already reached at least as far as we did — writing our result (built
      // from a stale merge base) would regress their progress. Their data supersedes ours.
      console.log(`[activity/events] superseded by a concurrent request (cache already at ${freshCached.lastScannedBlock} >= our ${to}) — skipping write`);
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

    // ── 4. Cache and return ────────────────────────────────────────────────
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
