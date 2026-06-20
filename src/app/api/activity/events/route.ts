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
 *   AssociationCore      → MemberRegistered, RoleGranted
 *   ConstituentAssembly  → SessionOpened/Closed, VoteCast, RoleResolved, RolesResolved
 *   WorkRegistry         → WorkPublished, WorkSessionInitiated, WorkArchived
 *   GovernanceCalendar   → EventScheduled, EventTriggered
 *   FactoryRegistry      → FactoryRegistered
 *   CollectionFactory    → CollectionCreated
 */

export const dynamic = "force-dynamic"; // never pre-render at build time

import { NextResponse }     from "next/server";
import {
  createPublicClient, http, parseAbiItem,
  keccak256, stringToBytes,
  type Log, type AbiEvent,
} from "viem";
import { base as baseChain } from "viem/chains";
import { CONTRACT_ADDRESSES, ROLE_LABELS } from "@/lib/contracts";
import { listTxLog, type TxLogRow } from "@/lib/txLog";

// ─── RPC client ───────────────────────────────────────────────────────────────

// LlamaRPC supports up to 10 000 blocks per eth_getLogs (vs 2 000 for mainnet.base.org).
// Override with BASE_RPC_URL env var to use Alchemy/QuickNode/etc.
const RPC_URL = process.env.BASE_RPC_URL ?? "https://base.llamarpc.com";
const rpc = createPublicClient({
  chain:     baseChain,
  transport: http(RPC_URL),
});

// ─── Contract addresses ───────────────────────────────────────────────────────

const ADDR = {
  CORE: CONTRACT_ADDRESSES.AssociationCore     as `0x${string}` | undefined,
  CA:   CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}` | undefined,
  WR:   CONTRACT_ADDRESSES.WorkRegistry        as `0x${string}` | undefined,
  GC:   CONTRACT_ADDRESSES.GovernanceCalendar  as `0x${string}` | undefined,
  FR:   CONTRACT_ADDRESSES.FactoryRegistry     as `0x${string}` | undefined,
  CF:   CONTRACT_ADDRESSES.CollectionFactory   as `0x${string}` | undefined,
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
// Uses LlamaRPC (base.llamarpc.com) which supports up to 10 000 blocks per
// getLogs request — 5× larger than mainnet.base.org (2 000 limit).
//
// Math with CHUNK=5 000 and SCAN_RANGE=2 000 000:
//   2 000 000 / 5 000 = 400 chunks per type
//   400 / BATCH_SIZE(20) = 20 sequential batches per type
//   All 14 event types run in parallel → dominated by slowest ≈ 5–10s
//   Well within Vercel Hobby 60s limit.

const CHUNK      = 5_000n;    // LlamaRPC supports up to 10 000 — 5 000 is safe
const BATCH_SIZE = 20;        // 14 types × 20 = 280 max concurrent — OK for llamarpc
const SCAN_RANGE = 2_000_000n; // ~46 days on Base — covers all ANA deployment history

async function fetchLogs(
  address: `0x${string}`,
  event:   AbiEvent,
  from:    bigint,
  to:      bigint,
): Promise<Log[]> {
  if (!address) return [];

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
      batch.map(c =>
        rpc.getLogs({ address, event, fromBlock: c.from, toBlock: c.to })
           .catch((): Log[] => [])
      )
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

const CACHE_KEY    = "activity:events:v3";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CachedPayload {
  events:      ActivityEvent[];
  meta:        { fromBlock: string; toBlock: string; cachedAt: number; cachedUntil: number };
}

async function readCache(): Promise<CachedPayload | null> {
  try {
    const { kvGet, USE_NEON } = await import("@/lib/db");
    if (!USE_NEON) return null;
    const raw = await kvGet(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (Date.now() > parsed.meta.cachedUntil) return null; // expired
    return parsed;
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
  // ── 1. Try cache first ────────────────────────────────────────────────────
  const cached = await readCache();
  if (cached) {
    const events = await mergeTxLog(cached.events);
    console.log(`[activity/events] cache hit — ${cached.events.length} events (+tx_log → ${events.length})`);
    return NextResponse.json({ ...cached, events }, {
      headers: { "X-Cache": "HIT" },
    });
  }

  // ── 2. Fetch from chain ───────────────────────────────────────────────────
  if (!ADDR.CORE) {
    return NextResponse.json({ events: [], meta: null, error: "Contracts not configured" });
  }

  try {
    const latest = await rpc.getBlockNumber();

    // Cover SCAN_RANGE blocks (~11 days on Base at 2s/block).
    // ANA contracts were deployed in June 2025 — 500K blocks is more than enough.
    // Keeping this tight avoids rate-limiting the public Base RPC.
    const from = latest > SCAN_RANGE ? latest - SCAN_RANGE : 0n;

    console.log(`[activity/events] fetching blocks ${from}–${latest} (${latest - from} blocks)…`);
    const t0 = Date.now();

    // Fetch ALL event types in parallel
    const [
      memberLogs, roleLogs,
      sessOpenLogs, sessCloseLogs, voteLogs, roleResLogs, rolesResLogs,
      workPubLogs, workSessLogs, workArcLogs,
      gcSchedLogs, gcTrigLogs,
      factoryLogs, collectionLogs,
    ] = await Promise.all([
      ADDR.CORE ? fetchLogs(ADDR.CORE, EV.MEMBER_REGISTERED,  from, latest) : [],
      ADDR.CORE ? fetchLogs(ADDR.CORE, EV.ROLE_GRANTED,       from, latest) : [],
      ADDR.CA   ? fetchLogs(ADDR.CA,   EV.SESSION_OPENED,     from, latest) : [],
      ADDR.CA   ? fetchLogs(ADDR.CA,   EV.SESSION_CLOSED,     from, latest) : [],
      ADDR.CA   ? fetchLogs(ADDR.CA,   EV.VOTE_CAST,          from, latest) : [],
      ADDR.CA   ? fetchLogs(ADDR.CA,   EV.ROLE_RESOLVED,      from, latest) : [],
      ADDR.CA   ? fetchLogs(ADDR.CA,   EV.ROLES_RESOLVED,     from, latest) : [],
      ADDR.WR   ? fetchLogs(ADDR.WR,   EV.WORK_PUBLISHED,     from, latest) : [],
      ADDR.WR   ? fetchLogs(ADDR.WR,   EV.WORK_SESSION_INIT,  from, latest) : [],
      ADDR.WR   ? fetchLogs(ADDR.WR,   EV.WORK_ARCHIVED,      from, latest) : [],
      ADDR.GC   ? fetchLogs(ADDR.GC,   EV.GC_SCHEDULED,       from, latest) : [],
      ADDR.GC   ? fetchLogs(ADDR.GC,   EV.GC_TRIGGERED,       from, latest) : [],
      ADDR.FR   ? fetchLogs(ADDR.FR,   EV.FACTORY_REGISTERED, from, latest) : [],
      ADDR.CF   ? fetchLogs(ADDR.CF,   EV.COLLECTION_CREATED, from, latest) : [],
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

    // Sort: most recent first
    events.sort((a, b) => {
      const diff = BigInt(b.blockNumber) - BigInt(a.blockNumber);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });

    // ── 4. Cache and return ────────────────────────────────────────────────
    const now  = Date.now();
    const meta = {
      fromBlock:   String(from),
      toBlock:     String(latest),
      cachedAt:    now,
      cachedUntil: now + CACHE_TTL_MS,
    };

    const payload: CachedPayload = { events, meta };
    await writeCache(payload); // cache stores pure chain data — tx_log is merged in fresh on every request

    const merged = await mergeTxLog(events);
    console.log(`[activity/events] ${events.length} events — cache miss, chain fetched in ${Date.now() - t0}ms (+tx_log → ${merged.length})`);

    return NextResponse.json({ ...payload, events: merged }, {
      headers: { "X-Cache": "MISS" },
    });

  } catch (err) {
    console.error("[activity/events] ERROR:", err);
    return NextResponse.json(
      { events: [], meta: null, error: "Chain read failed", detail: String(err) },
      { status: 500 }
    );
  }
}
