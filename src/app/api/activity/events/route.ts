/**
 * GET /api/activity/events
 *
 * Fetches ALL on-chain events from every ANA contract, server-side.
 * Cached 5 minutes (ISR) — the browser makes one HTTP fetch instead of 1000+ RPC calls.
 *
 * Contracts covered:
 *   AssociationCore      → MemberRegistered, RoleGranted
 *   ConstituentAssembly  → SessionOpened, SessionClosed, VoteCast, RoleResolved, RolesResolved
 *   WorkRegistry         → WorkPublished, WorkSessionInitiated, WorkArchived
 *   GovernanceCalendar   → EventScheduled, EventTriggered
 *   FactoryRegistry      → FactoryRegistered
 *   CollectionFactory    → CollectionCreated
 */

export const revalidate = 300; // 5-minute ISR cache

import { NextResponse }                            from "next/server";
import { createPublicClient, http, parseAbiItem, keccak256, stringToBytes, type Log, type AbiEvent } from "viem";
import { base as baseChain }                       from "viem/chains";
import { CONTRACT_ADDRESSES, ROLE_LABELS }         from "@/lib/contracts";

// ─── Client ───────────────────────────────────────────────────────────────────

const client = createPublicClient({
  chain:     baseChain,
  transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

// ─── Addresses ────────────────────────────────────────────────────────────────

const CORE     = CONTRACT_ADDRESSES.AssociationCore     as `0x${string}` | undefined;
const CA       = CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}` | undefined;
const WR       = CONTRACT_ADDRESSES.WorkRegistry        as `0x${string}` | undefined;
const GC       = CONTRACT_ADDRESSES.GovernanceCalendar  as `0x${string}` | undefined;
const FR       = CONTRACT_ADDRESSES.FactoryRegistry     as `0x${string}` | undefined;
const CF       = CONTRACT_ADDRESSES.CollectionFactory   as `0x${string}` | undefined;

// ─── Event signatures ─────────────────────────────────────────────────────────

// AssociationCore
const EV_MEMBER_REGISTERED = parseAbiItem("event MemberRegistered(uint256 indexed tokenId, address indexed ownerAddress, uint256 timestamp)");
const EV_ROLE_GRANTED      = parseAbiItem("event RoleGranted(bytes32 indexed role, uint256 indexed tokenId, address indexed holderAddress)");

// ConstituentAssembly
const EV_SESSION_OPENED    = parseAbiItem("event SessionOpened(uint256 indexed sessionId, uint256 timestamp)");
const EV_SESSION_CLOSED    = parseAbiItem("event SessionClosed(uint256 indexed sessionId, uint256 timestamp)");
const EV_VOTE_CAST         = parseAbiItem("event VoteCast(uint256 indexed sessionId, uint256 indexed voterTokenId, bytes32 indexed role, uint256 candidateTokenId)");
const EV_ROLE_RESOLVED     = parseAbiItem("event RoleResolved(uint256 indexed sessionId, bytes32 indexed role, uint256 winnerTokenId, uint256 voteCount)");
const EV_ROLES_RESOLVED    = parseAbiItem("event RolesResolved(uint256 indexed sessionId)");

// WorkRegistry
const EV_WORK_PUBLISHED    = parseAbiItem("event WorkPublished(uint256 indexed workId, string content, uint256 indexed authorTokenId, uint256 indexed rapporteurTokenId, uint256 timestamp)");
const EV_WORK_SESSION_INIT = parseAbiItem("event WorkSessionInitiated(uint256 indexed sessionId, uint256 initiatedAt, address indexed initiatedBy)");
const EV_WORK_ARCHIVED     = parseAbiItem("event WorkArchived(uint256 indexed workId, uint256 archivedAt)");

// GovernanceCalendar
const EV_GC_SCHEDULED      = parseAbiItem("event EventScheduled(uint256 indexed eventId, bytes32 indexed eventType, uint256 scheduledAt, bool recurring, uint256 periodSeconds)");
const EV_GC_TRIGGERED      = parseAbiItem("event EventTriggered(uint256 indexed eventId, bytes32 indexed eventType, address indexed triggeredBy, uint256 timestamp)");

// FactoryRegistry
const EV_FACTORY_REGISTERED = parseAbiItem("event FactoryRegistered(bytes32 indexed factoryType, address indexed factory)");

// CollectionFactory
const EV_COLLECTION_CREATED = parseAbiItem("event CollectionCreated(uint256 indexed normieTokenId, address indexed collection, string name, string symbol, address minter, uint256 timestamp)");

// ─── GovernanceCalendar event type labels ─────────────────────────────────────

const GC_EVENT_LABELS: Record<string, string> = {
  [keccak256(stringToBytes("BURN_CREATION"))]:    "Création par burn",
  [keccak256(stringToBytes("ELECTION"))]:          "Élection",
  [keccak256(stringToBytes("GENERAL_ASSEMBLY"))]:  "Assemblée générale",
  [keccak256(stringToBytes("INSCRIPTION_OPEN"))]:  "Ouverture inscriptions",
  [keccak256(stringToBytes("INSCRIPTION_CLOSE"))]: "Clôture inscriptions",
  [keccak256(stringToBytes("WORK_SESSION"))]:      "Session créative",
};

// ─── Log fetcher with chunked pagination ─────────────────────────────────────

const CHUNK = 5_000n; // Base mainnet public RPC handles ~5k blocks/request

async function getLogs(
  address: `0x${string}`,
  event:   AbiEvent,
  from:    bigint,
  to:      bigint,
): Promise<Log[]> {
  const results: Log[] = [];
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + CHUNK - 1n > to ? to : cursor + CHUNK - 1n;
    try {
      const chunk = await client.getLogs({ address, event, fromBlock: cursor, toBlock: end });
      results.push(...chunk);
    } catch {
      // If chunk is too large, retry with 2k blocks
      try {
        const SMALL = 2_000n;
        let c2 = cursor;
        while (c2 <= end) {
          const e2 = c2 + SMALL - 1n > end ? end : c2 + SMALL - 1n;
          try {
            const tiny = await client.getLogs({ address, event, fromBlock: c2, toBlock: e2 });
            results.push(...tiny);
          } catch { /* skip failed small chunk */ }
          c2 = e2 + 1n;
        }
      } catch { /* skip entire chunk */ }
    }
    cursor = end + 1n;
  }
  return results;
}

// ─── Serialized event type ────────────────────────────────────────────────────

export interface ActivityEvent {
  id:          string;
  type:        string;
  blockNumber: string;   // string to survive JSON (bigint not serializable)
  txHash:      string;
  timestamp?:  number;
  tokenId?:    number;
  candidateId?: number;
  sessionId?:  number;
  workId?:     number;
  role?:       string;
  roleLabel?:  string;
  address?:    string;
  extra?:      Record<string, string | number | boolean>;
}

function makeEvent(log: Log, type: string, i: number): ActivityEvent {
  return {
    id:          `${type}-${log.blockNumber}-${i}`,
    type,
    blockNumber: String(log.blockNumber ?? 0n),
    txHash:      log.transactionHash ?? "0x",
  };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  // Safety: require at least AssociationCore to be configured
  if (!CORE) {
    return NextResponse.json({ events: [], error: "Contracts not configured" });
  }

  try {
    const latest = await client.getBlockNumber();
    // Cover ~1M blocks (≈23 days on Base at 2s/block) — all ANA history
    const from   = latest > 1_000_000n ? latest - 1_000_000n : 0n;

    // Fetch all event types in parallel
    const [
      memberLogs, roleLogs,
      sessionOpenLogs, sessionCloseLogs, voteLogs, roleResolvedLogs, rolesResolvedLogs,
      workLogs, workSessionLogs, workArchivedLogs,
      gcScheduledLogs, gcTriggeredLogs,
      factoryLogs,
      collectionLogs,
    ] = await Promise.all([
      CORE ? getLogs(CORE, EV_MEMBER_REGISTERED, from, latest)  : Promise.resolve([]),
      CORE ? getLogs(CORE, EV_ROLE_GRANTED,      from, latest)  : Promise.resolve([]),
      CA   ? getLogs(CA,   EV_SESSION_OPENED,    from, latest)  : Promise.resolve([]),
      CA   ? getLogs(CA,   EV_SESSION_CLOSED,    from, latest)  : Promise.resolve([]),
      CA   ? getLogs(CA,   EV_VOTE_CAST,         from, latest)  : Promise.resolve([]),
      CA   ? getLogs(CA,   EV_ROLE_RESOLVED,     from, latest)  : Promise.resolve([]),
      CA   ? getLogs(CA,   EV_ROLES_RESOLVED,    from, latest)  : Promise.resolve([]),
      WR   ? getLogs(WR,   EV_WORK_PUBLISHED,    from, latest)  : Promise.resolve([]),
      WR   ? getLogs(WR,   EV_WORK_SESSION_INIT, from, latest)  : Promise.resolve([]),
      WR   ? getLogs(WR,   EV_WORK_ARCHIVED,     from, latest)  : Promise.resolve([]),
      GC   ? getLogs(GC,   EV_GC_SCHEDULED,      from, latest)  : Promise.resolve([]),
      GC   ? getLogs(GC,   EV_GC_TRIGGERED,      from, latest)  : Promise.resolve([]),
      FR   ? getLogs(FR,   EV_FACTORY_REGISTERED,from, latest)  : Promise.resolve([]),
      CF   ? getLogs(CF,   EV_COLLECTION_CREATED, from, latest) : Promise.resolve([]),
    ]);

    const events: ActivityEvent[] = [];

    // AssociationCore — MemberRegistered
    memberLogs.forEach((log, i) => {
      const a = (log as { args?: Record<string, unknown> }).args ?? {};
      events.push({ ...makeEvent(log, "MEMBER_REGISTERED", i),
        tokenId:   Number(a.tokenId ?? 0),
        address:   String(a.ownerAddress ?? ""),
        timestamp: Number(a.timestamp ?? 0),
      });
    });

    // AssociationCore — RoleGranted
    roleLogs.forEach((log, i) => {
      const a = (log as { args?: Record<string, unknown> }).args ?? {};
      const roleHash = String(a.role ?? "");
      events.push({ ...makeEvent(log, "ROLE_GRANTED", i),
        role:      roleHash,
        roleLabel: ROLE_LABELS[roleHash],
        tokenId:   Number(a.tokenId ?? 0),
        address:   String(a.holderAddress ?? ""),
      });
    });

    // ConstituentAssembly — SessionOpened
    sessionOpenLogs.forEach((log, i) => {
      const a = (log as { args?: Record<string, unknown> }).args ?? {};
      events.push({ ...makeEvent(log, "SESSION_OPENED", i),
        sessionId: Number(a.sessionId ?? 0),
        timestamp: Number(a.timestamp ?? 0),
      });
    });

    // ConstituentAssembly — SessionClosed
    sessionCloseLogs.forEach((log, i) => {
      const a = (log as { args?: Record<string, unknown> }).args ?? {};
      events.push({ ...makeEvent(log, "SESSION_CLOSED", i),
        sessionId: Number(a.sessionId ?? 0),
        timestamp: Number(a.timestamp ?? 0),
      });
    });

    // ConstituentAssembly — VoteCast
    voteLogs.forEach((log, i) => {
      const a = (log as { args?: Record<string, unknown> }).args ?? {};
      const roleHash = String(a.role ?? "");
      events.push({ ...makeEvent(log, "VOTE_CAST", i),
        sessionId:   Number(a.sessionId ?? 0),
        tokenId:     Number(a.voterTokenId ?? 0),
        candidateId: Number(a.candidateTokenId ?? 0),
        role:        roleHash,
        roleLabel:   ROLE_LABELS[roleHash],
      });
    });

    // ConstituentAssembly — RoleResolved
    roleResolvedLogs.forEach((log, i) => {
      const a = (log as { args?: Record<string, unknown> }).args ?? {};
      const roleHash = String(a.role ?? "");
      events.push({ ...makeEvent(log, "ROLE_RESOLVED", i),
        sessionId: Number(a.sessionId ?? 0),
        tokenId:   Number(a.winnerTokenId ?? 0),
        role:      roleHash,
        roleLabel: ROLE_LABELS[roleHash],
        extra:     { voteCount: Number(a.voteCount ?? 0) },
      });
    });

    // ConstituentAssembly — RolesResolved
    rolesResolvedLogs.forEach((log, i) => {
      const a = (log as { args?: Record<string, unknown> }).args ?? {};
      events.push({ ...makeEvent(log, "ROLES_RESOLVED", i),
        sessionId: Number(a.sessionId ?? 0),
      });
    });

    // WorkRegistry — WorkPublished
    workLogs.forEach((log, i) => {
      const a = (log as { args?: Record<string, unknown> }).args ?? {};
      events.push({ ...makeEvent(log, "WORK_PUBLISHED", i),
        workId:    Number(a.workId ?? 0),
        tokenId:   Number(a.authorTokenId ?? 0),
        timestamp: Number(a.timestamp ?? 0),
        extra:     { rapporteurTokenId: Number(a.rapporteurTokenId ?? 0) },
      });
    });

    // WorkRegistry — WorkSessionInitiated
    workSessionLogs.forEach((log, i) => {
      const a = (log as { args?: Record<string, unknown> }).args ?? {};
      events.push({ ...makeEvent(log, "WORK_SESSION_INITIATED", i),
        sessionId: Number(a.sessionId ?? 0),
        address:   String(a.initiatedBy ?? ""),
        timestamp: Number(a.initiatedAt ?? 0),
      });
    });

    // WorkRegistry — WorkArchived
    workArchivedLogs.forEach((log, i) => {
      const a = (log as { args?: Record<string, unknown> }).args ?? {};
      events.push({ ...makeEvent(log, "WORK_ARCHIVED", i),
        workId:    Number(a.workId ?? 0),
        timestamp: Number(a.archivedAt ?? 0),
      });
    });

    // GovernanceCalendar — EventScheduled
    gcScheduledLogs.forEach((log, i) => {
      const a = (log as { args?: Record<string, unknown> }).args ?? {};
      const evType = String(a.eventType ?? "");
      events.push({ ...makeEvent(log, "GC_SCHEDULED", i),
        extra: {
          eventId:       Number(a.eventId ?? 0),
          eventType:     evType,
          eventTypeLabel: GC_EVENT_LABELS[evType] ?? evType.slice(0, 10),
          scheduledAt:   Number(a.scheduledAt ?? 0),
          recurring:     Boolean(a.recurring),
        },
      });
    });

    // GovernanceCalendar — EventTriggered
    gcTriggeredLogs.forEach((log, i) => {
      const a = (log as { args?: Record<string, unknown> }).args ?? {};
      const evType = String(a.eventType ?? "");
      events.push({ ...makeEvent(log, "GC_TRIGGERED", i),
        address:   String(a.triggeredBy ?? ""),
        timestamp: Number(a.timestamp ?? 0),
        extra: {
          eventId:        Number(a.eventId ?? 0),
          eventType:      evType,
          eventTypeLabel: GC_EVENT_LABELS[evType] ?? evType.slice(0, 10),
        },
      });
    });

    // FactoryRegistry — FactoryRegistered
    factoryLogs.forEach((log, i) => {
      const a = (log as { args?: Record<string, unknown> }).args ?? {};
      events.push({ ...makeEvent(log, "FACTORY_REGISTERED", i),
        address: String(a.factory ?? ""),
        extra:   { factoryType: String(a.factoryType ?? "") },
      });
    });

    // CollectionFactory — CollectionCreated
    collectionLogs.forEach((log, i) => {
      const a = (log as { args?: Record<string, unknown> }).args ?? {};
      events.push({ ...makeEvent(log, "COLLECTION_CREATED", i),
        tokenId:   Number(a.normieTokenId ?? 0),
        address:   String(a.collection ?? ""),
        timestamp: Number(a.timestamp ?? 0),
        extra: {
          name:   String(a.name ?? ""),
          symbol: String(a.symbol ?? ""),
        },
      });
    });

    // Sort by block descending
    events.sort((a, b) => {
      const diff = BigInt(b.blockNumber) - BigInt(a.blockNumber);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });

    return NextResponse.json({
      events,
      meta: {
        total:       events.length,
        fromBlock:   String(from),
        toBlock:     String(latest),
        cachedUntil: Date.now() + 300_000,
      },
    });

  } catch (err) {
    console.error("[activity/events]", err);
    return NextResponse.json(
      { events: [], error: "Chain read failed", detail: String(err) },
      { status: 500 }
    );
  }
}
