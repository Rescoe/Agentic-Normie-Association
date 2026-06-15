"use client";

import { useState, useEffect, useCallback } from "react";
import { createPublicClient, http, parseAbiItem, type Log } from "viem";
import { base } from "viem/chains";
import Image from "next/image";
import { CONTRACT_ADDRESSES, ROLE_LABELS } from "@/lib/contracts";
import { getNormieImageUrl } from "@/lib/normiesApi";

// ─── Chain client (client-side — public RPC) ──────────────────────────────────

const rpcClient = createPublicClient({
  chain:     base,
  transport: http("https://mainnet.base.org"),
});

// ─── Contract addresses ───────────────────────────────────────────────────────

const CORE_ADDR = CONTRACT_ADDRESSES.AssociationCore as `0x${string}`;
const CA_ADDR   = CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}`;
const WR_ADDR   = CONTRACT_ADDRESSES.WorkRegistry as `0x${string}`;

// ─── Event signatures ─────────────────────────────────────────────────────────

const MEMBER_REGISTERED   = parseAbiItem("event MemberRegistered(uint256 indexed tokenId, address indexed ownerAddress, uint256 timestamp)");
const ROLE_GRANTED        = parseAbiItem("event RoleGranted(bytes32 indexed role, uint256 indexed tokenId, address indexed holderAddress)");
const VOTE_CAST           = parseAbiItem("event VoteCast(uint256 indexed sessionId, uint256 indexed voterTokenId, bytes32 indexed role, uint256 candidateTokenId)");
const SESSION_OPENED      = parseAbiItem("event SessionOpened(uint256 indexed sessionId, uint256 timestamp)");
const SESSION_CLOSED      = parseAbiItem("event SessionClosed(uint256 indexed sessionId, uint256 timestamp)");
const WORK_PUBLISHED      = parseAbiItem("event WorkPublished(uint256 indexed workId, string content, uint256 indexed authorTokenId, uint256 indexed rapporteurTokenId, uint256 timestamp)");
const WORK_SESSION_INIT   = parseAbiItem("event WorkSessionInitiated(uint256 indexed sessionId, uint256 initiatedAt, address indexed initiatedBy)");

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivityType =
  | "MEMBER_REGISTERED"
  | "ROLE_GRANTED"
  | "VOTE_CAST"
  | "SESSION_OPENED"
  | "SESSION_CLOSED"
  | "WORK_PUBLISHED"
  | "WORK_SESSION_INITIATED";

interface ActivityEvent {
  id:          string;
  type:        ActivityType;
  blockNumber: bigint;
  txHash:      `0x${string}`;
  timestamp?:  number;
  tokenId?:    number;
  role?:       string;
  candidateId?:number;
  sessionId?:  number;
  address?:    string;
  workId?:     number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<ActivityType, { label: string; color: string; icon: string }> = {
  MEMBER_REGISTERED:      { label: "Inscription",        color: "text-blue-600 border-blue-200 bg-blue-50/50",   icon: "⬤" },
  ROLE_GRANTED:           { label: "Rôle attribué",      color: "text-purple-600 border-purple-200 bg-purple-50/50", icon: "★" },
  VOTE_CAST:              { label: "Vote",               color: "text-yellow-700 border-yellow-200 bg-yellow-50/50", icon: "✓" },
  SESSION_OPENED:         { label: "Session ouverte",    color: "text-green-600 border-green-200 bg-green-50/50",  icon: "▶" },
  SESSION_CLOSED:         { label: "Session clôturée",   color: "text-gray-600 border-gray-200 bg-gray-50/50",   icon: "■" },
  WORK_PUBLISHED:         { label: "Œuvre publiée",      color: "text-orange-600 border-orange-200 bg-orange-50/50", icon: "◆" },
  WORK_SESSION_INITIATED: { label: "Session créative",   color: "text-pink-600 border-pink-200 bg-pink-50/50",   icon: "⬟" },
};

// ─── Log parsers ──────────────────────────────────────────────────────────────

function parseLogs(logs: Log[], type: ActivityType): ActivityEvent[] {
  return logs.map((log, i): ActivityEvent => {
    const base: ActivityEvent = {
      id:          `${type}-${log.blockNumber}-${i}`,
      type,
      blockNumber: log.blockNumber ?? 0n,
      txHash:      log.transactionHash ?? "0x",
    };

    const args = (log as { args?: Record<string, unknown> }).args ?? {};

    switch (type) {
      case "MEMBER_REGISTERED":
        return { ...base,
          tokenId:   Number(args.tokenId ?? 0),
          address:   String(args.ownerAddress ?? ""),
          timestamp: Number(args.timestamp ?? 0),
        };
      case "ROLE_GRANTED":
        return { ...base,
          tokenId: Number(args.tokenId ?? 0),
          role:    String(args.role ?? ""),
          address: String(args.holderAddress ?? ""),
        };
      case "VOTE_CAST":
        return { ...base,
          sessionId:   Number(args.sessionId ?? 0),
          tokenId:     Number(args.voterTokenId ?? 0),
          role:        String(args.role ?? ""),
          candidateId: Number(args.candidateTokenId ?? 0),
        };
      case "SESSION_OPENED":
      case "SESSION_CLOSED":
        return { ...base,
          sessionId: Number(args.sessionId ?? 0),
          timestamp: Number(args.timestamp ?? 0),
        };
      case "WORK_PUBLISHED":
        return { ...base,
          workId:  Number(args.workId ?? 0),
          tokenId: Number(args.authorTokenId ?? 0),
        };
      case "WORK_SESSION_INITIATED":
        return { ...base,
          sessionId: Number(args.sessionId ?? 0),
          address:   String(args.initiatedBy ?? ""),
          timestamp: Number(args.initiatedAt ?? 0),
        };
      default:
        return base;
    }
  });
}

// ─── ActivityRow ─────────────────────────────────────────────────────────────

function ActivityRow({ ev }: { ev: ActivityEvent }) {
  const cfg = TYPE_CONFIG[ev.type];

  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-4 py-3.5 border-b border-[--border] last:border-none items-center">
      {/* Icon + Token */}
      <div className="flex items-center gap-2">
        <span className={`font-mono text-xs border px-2 py-0.5 ${cfg.color}`}>
          {cfg.icon} {cfg.label}
        </span>
        {ev.tokenId !== undefined && ev.tokenId > 0 && (
          <div className="relative w-7 h-7 shrink-0 overflow-hidden">
            <Image
              src={getNormieImageUrl(ev.tokenId)}
              alt={`#${ev.tokenId}`}
              fill
              className="object-contain"
              style={{ imageRendering: "pixelated" }}
              unoptimized
            />
          </div>
        )}
      </div>

      {/* Description */}
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">
          {ev.type === "MEMBER_REGISTERED" && `Normie #${ev.tokenId} inscrit`}
          {ev.type === "ROLE_GRANTED"      && `#${ev.tokenId} → ${ROLE_LABELS[ev.role ?? ""] ?? ev.role?.slice(0, 10) + "…"}`}
          {ev.type === "VOTE_CAST"         && `#${ev.tokenId} vote pour #${ev.candidateId} (${ROLE_LABELS[ev.role ?? ""] ?? "rôle"})`}
          {ev.type === "SESSION_OPENED"    && `Session #${ev.sessionId} ouverte`}
          {ev.type === "SESSION_CLOSED"    && `Session #${ev.sessionId} clôturée`}
          {ev.type === "WORK_PUBLISHED"    && `Œuvre #${ev.workId} publiée par #${ev.tokenId}`}
          {ev.type === "WORK_SESSION_INITIATED" && `Session créative #${ev.sessionId} initiée`}
        </p>
        <p className="font-mono text-xs text-[--fg-muted] truncate">
          Bloc #{String(ev.blockNumber)} —{" "}
          <a
            href={`https://basescan.org/tx/${ev.txHash}`}
            target="_blank" rel="noopener noreferrer"
            className="hover:underline"
          >
            {ev.txHash.slice(0, 10)}…
          </a>
        </p>
      </div>

      {/* Timestamp */}
      {ev.timestamp ? (
        <p className="font-mono text-xs text-[--fg-muted] shrink-0 text-right">
          {new Date(ev.timestamp * 1000).toLocaleDateString("fr-FR", {
            day: "numeric", month: "short"
          })}
        </p>
      ) : (
        <span className="font-mono text-xs text-[--fg-muted] shrink-0">
          #{String(ev.blockNumber).slice(-6)}
        </span>
      )}
    </div>
  );
}

// ─── Normie Activity Summary ──────────────────────────────────────────────────

function NormieSummary({ events }: { events: ActivityEvent[] }) {
  // Group by tokenId
  const byNormie: Record<number, ActivityEvent[]> = {};
  for (const ev of events) {
    if (ev.tokenId && ev.tokenId > 0) {
      byNormie[ev.tokenId] = [...(byNormie[ev.tokenId] ?? []), ev];
    }
  }
  const sorted = Object.entries(byNormie)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 12);

  if (sorted.length === 0) return null;

  return (
    <div className="border border-[--border] p-5 space-y-4">
      <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
        Activité par Normie
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {sorted.map(([id, evs]) => (
          <div key={id} className="text-center space-y-1.5">
            <div className="relative w-12 h-12 mx-auto overflow-hidden">
              <Image
                src={getNormieImageUrl(Number(id))}
                alt={`#${id}`}
                fill
                className="object-contain"
                style={{ imageRendering: "pixelated" }}
                unoptimized
              />
            </div>
            <p className="font-mono text-xs font-bold">#{id}</p>
            <p className="font-mono text-xs text-[--fg-muted]">{evs.length} actions</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function ActivityClient() {
  const [events,   setEvents]   = useState<ActivityEvent[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [filter,   setFilter]   = useState<ActivityType | "ALL">("ALL");

  const loadEvents = useCallback(async () => {
    if (!CORE_ADDR) { setError("Contrats non configurés"); return; }
    setLoading(true);
    setError(null);

    try {
      // Base: ~2s/block. 100 000 blocks ≈ 2.3 days for recent events.
      // MemberRegistered/RoleGranted: try all-time first, fall back to 7-day window.
      const latest      = await rpcClient.getBlockNumber();
      const recentFrom  = latest > 100_000n ? latest - 100_000n   : 0n;
      const weekFrom    = latest > 300_000n ? latest - 300_000n   : 0n;

      // Try fromBlock, fall back to fallbackFrom if RPC rejects the range.
      const safeGetLogs = async (
        args: Parameters<typeof rpcClient.getLogs>[0],
        fallbackFrom?: bigint,
      ): Promise<Awaited<ReturnType<typeof rpcClient.getLogs>>> => {
        try { return await rpcClient.getLogs(args); }
        catch {
          if (fallbackFrom !== undefined) {
            try { return await rpcClient.getLogs({ ...args, fromBlock: fallbackFrom }); }
            catch { return []; }
          }
          return [];
        }
      };

      const [
        memberLogs, roleLogs, voteLogs,
        sessionOpenLogs, sessionCloseLogs,
        workLogs, workSessionLogs,
      ] = await Promise.all([
        safeGetLogs({ address: CORE_ADDR, event: MEMBER_REGISTERED, fromBlock: 0n      }, weekFrom),
        safeGetLogs({ address: CORE_ADDR, event: ROLE_GRANTED,      fromBlock: 0n      }, weekFrom),
        safeGetLogs({ address: CA_ADDR,   event: VOTE_CAST,         fromBlock: recentFrom }),
        safeGetLogs({ address: CA_ADDR,   event: SESSION_OPENED,    fromBlock: recentFrom }),
        safeGetLogs({ address: CA_ADDR,   event: SESSION_CLOSED,    fromBlock: recentFrom }),
        safeGetLogs({ address: WR_ADDR,   event: WORK_PUBLISHED,    fromBlock: recentFrom }),
        safeGetLogs({ address: WR_ADDR,   event: WORK_SESSION_INIT, fromBlock: recentFrom }),
      ]);

      const all: ActivityEvent[] = [
        ...parseLogs(memberLogs,      "MEMBER_REGISTERED"),
        ...parseLogs(roleLogs,        "ROLE_GRANTED"),
        ...parseLogs(voteLogs,        "VOTE_CAST"),
        ...parseLogs(sessionOpenLogs, "SESSION_OPENED"),
        ...parseLogs(sessionCloseLogs,"SESSION_CLOSED"),
        ...parseLogs(workLogs,        "WORK_PUBLISHED"),
        ...parseLogs(workSessionLogs, "WORK_SESSION_INITIATED"),
      ].sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : -1));

      setEvents(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de lecture on-chain");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const filtered = filter === "ALL"
    ? events
    : events.filter(e => e.type === filter);

  return (
    <div className="space-y-8">
      {/* Normie summary */}
      <NormieSummary events={events} />

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["ALL", ...Object.keys(TYPE_CONFIG)] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f as ActivityType | "ALL")}
            className={`font-mono text-xs px-3 py-1.5 border transition-colors ${
              filter === f
                ? "bg-[--fg] text-[--bg] border-[--fg]"
                : "border-[--border] text-[--fg-muted] hover:bg-[--bg-card]"
            }`}
          >
            {f === "ALL" ? `Tout (${events.length})` : TYPE_CONFIG[f as ActivityType].label}
          </button>
        ))}
        <button
          onClick={loadEvents}
          disabled={loading}
          className="font-mono text-xs px-3 py-1.5 border border-[--border] text-[--fg-muted] hover:bg-[--bg-card] disabled:opacity-40 ml-auto"
        >
          {loading ? "Chargement…" : "↻ Actualiser"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="border border-red-300 p-4">
          <p className="font-mono text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Events list */}
      {loading && events.length === 0 ? (
        <div className="flex items-center justify-center py-16 gap-3">
          <div className="w-5 h-5 border-2 border-[--border] border-t-[--fg] rounded-full animate-spin" />
          <p className="font-mono text-xs text-[--fg-muted]">Lecture des événements on-chain…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="font-mono text-xs text-[--fg-muted]">Aucun événement trouvé. Vérifiez la configuration des contrats.</p>
        </div>
      ) : (
        <div className="border border-[--border]">
          <div className="px-5 py-3 bg-[--bg-card] border-b border-[--border] flex items-center justify-between">
            <p className="font-mono text-xs text-[--fg-muted]">
              {filtered.length} événement{filtered.length > 1 ? "s" : ""} — derniers 100 000 blocs Base (~2j)
            </p>
          </div>
          <div className="px-5">
            {filtered.map(ev => <ActivityRow key={ev.id} ev={ev} />)}
          </div>
        </div>
      )}
    </div>
  );
}
