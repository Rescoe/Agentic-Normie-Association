/**
 * activityScanner.ts — shared chain-scanning + cache logic for the activity feed.
 *
 * Used by:
 *   src/app/api/activity/events/route.ts    — the main incremental cursor scan
 *   src/app/api/activity/backfill/route.ts  — one-off narrow-range recovery for
 *                                              events a transient RPC glitch dropped
 *                                              from a range the cursor already passed
 *
 * Contracts covered:
 *   AssociationCore       → MemberRegistered, RoleGranted
 *   ConstituentAssembly   → SessionOpened/Closed, VoteCast, RoleResolved, RolesResolved
 *   WorkRegistry           → WorkPublished, WorkSessionInitiated, WorkArchived
 *   GovernanceCalendar    → EventScheduled, EventTriggered
 *   FactoryRegistry       → FactoryRegistered
 *   CollectionFactory     → CollectionCreated (legacy factory — kept in case of old history)
 *   ANACollectionFactory  → CollectionDeployed (the factory actually used by workPublisher.ts)
 *   ANAEditions (dynamic) → CollectionInitialized, EditionMinted — one contract per work,
 *                           addresses discovered via ANACollectionFactory.getAllCollections()
 */

import {
  createPublicClient, http, fallback, parseAbiItem,
  keccak256, stringToBytes,
  type Log, type AbiEvent,
} from "viem";
import { base as baseChain } from "viem/chains";
import { CONTRACT_ADDRESSES, ROLE_LABELS, ANA_COLLECTION_FACTORY_ABI } from "@/lib/contracts";

// ─── RPC client ───────────────────────────────────────────────────────────────

const RPC_URL = process.env.BASE_RPC_URL ?? "https://base.llamarpc.com";
export const rpc = createPublicClient({
  chain:     baseChain,
  transport: fallback([
    http(RPC_URL, { retryCount: 0 }),
    http("https://base.drpc.org", { retryCount: 0 }),
    http("https://mainnet.base.org", { retryCount: 0 }),
  ], { rank: true }),
});

// ─── Contract addresses ───────────────────────────────────────────────────────

const ADDR = {
  CORE:  CONTRACT_ADDRESSES.AssociationCore     as `0x${string}` | undefined,
  CA:    CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}` | undefined,
  WR:    CONTRACT_ADDRESSES.WorkRegistry        as `0x${string}` | undefined,
  GC:    CONTRACT_ADDRESSES.GovernanceCalendar  as `0x${string}` | undefined,
  FR:    CONTRACT_ADDRESSES.FactoryRegistry     as `0x${string}` | undefined,
  CF:    CONTRACT_ADDRESSES.CollectionFactory   as `0x${string}` | undefined,
  ANACF: CONTRACT_ADDRESSES.ANACollectionFactory as `0x${string}` | undefined,
};

export const CORE_CONFIGURED = !!ADDR.CORE;

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
  COLLECTION_DEPLOYED:  parseAbiItem("event CollectionDeployed(uint256 indexed normieTokenId, address indexed collectionAddr, string name, address minter)") as AbiEvent,
  COLLECTION_INITIALIZED: parseAbiItem("event CollectionInitialized(string artworkTitle, uint256 workId)") as AbiEvent,
  EDITION_MINTED:          parseAbiItem("event EditionMinted(uint256 indexed tokenId, address indexed buyer, uint256 priceWei)") as AbiEvent,
};

const GC_LABELS: Record<string, string> = {
  [keccak256(stringToBytes("BURN_CREATION"))]:    "Création par burn",
  [keccak256(stringToBytes("ELECTION"))]:          "Élection",
  [keccak256(stringToBytes("GENERAL_ASSEMBLY"))]:  "Assemblée générale",
  [keccak256(stringToBytes("INSCRIPTION_OPEN"))]:  "Ouverture inscriptions",
  [keccak256(stringToBytes("INSCRIPTION_CLOSE"))]: "Clôture inscriptions",
  [keccak256(stringToBytes("WORK_SESSION"))]:      "Session créative",
};

// ─── Global RPC concurrency limiter ───────────────────────────────────────────
// mainnet.base.org rate-limits well below what a full scan can generate: 17 event
// types × BATCH_SIZE parallel chunks each can mean 100+ simultaneous eth_getLogs
// calls. Measured directly: a 40-request burst got ~37% rejected with "over rate
// limit", silently indistinguishable from "no events" unless caught. Every getLogs
// call goes through this limiter so total in-flight requests stay bounded regardless
// of how many event types (or callers — this module is shared) run concurrently.
const CHUNK            = 2_000n;
const BATCH_SIZE       = 20;
const RPC_CONCURRENCY  = 8;
let activeRpcRequests  = 0;
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
        // Rate-limit is transient, not "no events" — worth retrying with backoff. Note this
        // does NOT catch every failure mode: mainnet.base.org has been observed returning a
        // plain empty result (no error at all) for a range with real matching logs, then the
        // correct result on an identical retry moments later. Not defended against here —
        // see project_ana_activity_feed_bugs memory. The backfill endpoint exists precisely
        // to patch specific known gaps this can leave behind.
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

/** Scans every tracked event type across every ANA contract for one block range. */
export async function scanRange(from: bigint, to: bigint): Promise<ActivityEvent[]> {
  let collectionAddrs: `0x${string}`[] = [];
  if (ADDR.ANACF) {
    try {
      collectionAddrs = await rpc.readContract({
        address: ADDR.ANACF, abi: ANA_COLLECTION_FACTORY_ABI, functionName: "getAllCollections",
      }) as `0x${string}`[];
    } catch (e) {
      console.warn(`[activityScanner] getAllCollections failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

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

  collectionDeployedLogs.forEach((log, i) => {
    const a = args(log);
    events.push({ ...makeEv(log, "COLLECTION_CREATED", i),
      tokenId: Number(a.normieTokenId ?? 0),
      address: String(a.collectionAddr ?? ""),
      extra:   { name: String(a.name ?? "") },
    });
  });

  collectionInitLogs.forEach((log, i) => {
    const a = args(log);
    events.push({ ...makeEv(log, "COLLECTION_INITIALIZED", i),
      address: String(log.address ?? ""),
      workId:  Number(a.workId ?? 0),
      extra:   { name: String(a.artworkTitle ?? ""), collectionAddress: String(log.address ?? "") },
    });
  });

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

  return events;
}

// ─── Cache helpers (Neon KV) ──────────────────────────────────────────────────
// This is a permanent incremental ledger, not a TTL cache. Each entry records the
// highest block already scanned (lastScannedBlock); the main route only scans
// forward from there. There is nothing to "expire": once an event is found, it
// stays, and the cursor only ever moves forward — see events/route.ts's GET for
// why, and backfill/route.ts for the one exception (recovering a dropped event
// from a range the cursor already passed, without moving the cursor at all).

// Bumped v8 -> v9 on the 26/09/2026 contract redeploy: v8's cache held
// lastScannedBlock + events scanned against the PREVIOUS contract addresses
// (old AssociationCore/WorkRegistry/etc.) — mixing those into new-contract
// history would be actively wrong, not just stale. A version bump abandons
// that old row cleanly (no DELETE needed — v9 simply doesn't exist yet, so
// the very next request starts a fresh scan from LAUNCH_FLOOR_BLOCK in
// events/route.ts, which was updated to the new contracts' real deployment
// block in the same change). The old v8 row is harmless dead data in
// kv_store from here on.
export const CACHE_KEY       = "activity:events:v9";
export const MAX_EVENTS_KEPT = 1000; // keep the blob bounded — older events are still in tx_log/on-chain

export interface CachedPayload {
  events:           ActivityEvent[];
  lastScannedBlock: string;
  meta:             { fromBlock: string; toBlock: string; cachedAt: number };
}

export async function readCache(): Promise<CachedPayload | null> {
  try {
    const { kvGet, USE_NEON } = await import("@/lib/db");
    if (!USE_NEON) return null;
    const raw = await kvGet(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedPayload;
  } catch { return null; }
}

export async function writeCache(payload: CachedPayload): Promise<void> {
  try {
    const { kvSet, USE_NEON } = await import("@/lib/db");
    if (!USE_NEON) return;
    await kvSet(CACHE_KEY, JSON.stringify(payload));
  } catch { /* silent — cache write failure is not fatal */ }
}
