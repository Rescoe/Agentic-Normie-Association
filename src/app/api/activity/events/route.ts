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

// ─── RPC client ───────────────────────────────────────────────────────────────

const rpc = createPublicClient({
  chain:     baseChain,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
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
// Strategy:
//   1. Try a SINGLE getLogs call (no chunking) — instant when the RPC allows it
//      and the contract has few events (ANA is brand-new, maybe 50–200 events total)
//   2. On failure, fall back to parallel chunking with a conservative batch size
//      to avoid rate-limiting the public Base RPC.
//
// SCAN_RANGE = 500 000 blocks ≈ 11 days — covers all ANA history (deployed June 2025)
// 500 000 / 2 000 = 250 chunks per type → 250 / BATCH_SIZE = batches

const CHUNK      = 2_000n;  // Base public RPC hard limit per getLogs request
const BATCH_SIZE = 12;      // 14 types × 12 = 168 max concurrent — safe for public RPC
const SCAN_RANGE = 500_000n; // blocks to scan back from latest (~11 days on Base)

async function fetchLogs(
  address: `0x${string}`,
  event:   AbiEvent,
  from:    bigint,
  to:      bigint,
): Promise<Log[]> {
  if (!address) return [];

  // 1. Optimistic single call — works when the RPC is permissive or the result
  //    set is small (which it is for a brand-new association).
  try {
    return await rpc.getLogs({ address, event, fromBlock: from, toBlock: to });
  } catch {
    // "block range too large" or similar — fall through to chunking
  }

  // 2. Parallel chunk fallback
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
    console.log(`[activity/events] cache hit — ${cached.events.length} events`);
    return NextResponse.json(cached, {
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
    await writeCache(payload);

    console.log(`[activity/events] ${events.length} events — cache miss, chain fetched in ${Date.now() - t0}ms`);

    return NextResponse.json(payload, {
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
