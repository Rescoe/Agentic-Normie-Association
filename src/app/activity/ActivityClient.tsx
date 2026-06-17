"use client";

import { useState, useEffect, useCallback } from "react";
import { createPublicClient, http, parseAbiItem, type Log } from "viem";
import { base } from "viem/chains";
import Image from "next/image";
import { CONTRACT_ADDRESSES, CONSTITUENT_ASSEMBLY_ABI, ROLE_LABELS, ROLES } from "@/lib/contracts";
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

function ActivityRow({ ev, getName }: { ev: ActivityEvent; getName: (id: number) => string }) {
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
              alt={getName(ev.tokenId)}
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
          {ev.type === "MEMBER_REGISTERED" && `${getName(ev.tokenId!)} inscrit`}
          {ev.type === "ROLE_GRANTED"      && `${getName(ev.tokenId!)} → ${ROLE_LABELS[ev.role ?? ""] ?? ev.role?.slice(0, 10) + "…"}`}
          {ev.type === "VOTE_CAST"         && `${getName(ev.tokenId!)} vote pour ${getName(ev.candidateId!)} (${ROLE_LABELS[ev.role ?? ""] ?? "rôle"})`}
          {ev.type === "SESSION_OPENED"    && `Session #${ev.sessionId} ouverte`}
          {ev.type === "SESSION_CLOSED"    && `Session #${ev.sessionId} clôturée`}
          {ev.type === "WORK_PUBLISHED"    && `Œuvre #${ev.workId} publiée par ${getName(ev.tokenId!)}`}
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

// ─── Elected Roles (read from getLeader — no log scan needed) ────────────────

const CA_ELECTED = CONTRACT_ADDRESSES.ConstituentAssembly as `0x${string}` | undefined;

const ROLE_ORDER = [
  { hash: ROLES.PRESIDENT,      label: "Président",                  group: "Institutionnel" },
  { hash: ROLES.VICE_PRESIDENT, label: "Vice-Président / Trésorier", group: "Institutionnel" },
  { hash: ROLES.SECRETARY,      label: "Secrétaire",                 group: "Institutionnel" },
  { hash: ROLES.AUTHOR,         label: "Auteur",                     group: "Créatif" },
  { hash: ROLES.CURATOR,        label: "Curateur",                   group: "Créatif" },
  { hash: ROLES.RAPPORTEUR,     label: "Rapporteur",                 group: "Créatif" },
] as const;

function ElectedRolesPanel() {
  const [elected, setElected] = useState<Array<{ tokenId: number; count: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!CA_ELECTED) { setLoading(false); return; }
    Promise.all(
      ROLE_ORDER.map(r =>
        rpcClient.readContract({
          address:      CA_ELECTED!,
          abi:          CONSTITUENT_ASSEMBLY_ABI,
          functionName: "getLeader",
          args:         [r.hash as `0x${string}`],
        }).then(res => {
          const t = res as [bigint, bigint];
          return { tokenId: Number(t[0]), count: Number(t[1]) };
        }).catch(() => ({ tokenId: 0, count: 0 }))
      )
    ).then(results => {
      setElected(results);
      setLoading(false);
    });
  }, []);

  const hasAny = elected.some(e => e.tokenId > 0);
  if (loading) {
    return (
      <div className="border border-[--border] p-5 space-y-3 animate-pulse">
        <div className="h-3 bg-[--border] rounded w-32" />
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {ROLE_ORDER.map(r => (
            <div key={r.hash} className="space-y-1">
              <div className="w-12 h-12 bg-[--border] rounded mx-auto" />
              <div className="h-2 bg-[--border] rounded w-16 mx-auto" />
              <div className="h-2 bg-[--border] rounded w-12 mx-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!hasAny) return null;

  return (
    <div className="border border-[--border] p-5 space-y-4">
      <p className="font-mono text-xs uppercase tracking-widest text-[--fg-muted]">
        Élus actuels — Assemblée Constitutive
      </p>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {ROLE_ORDER.map((r, i) => {
          const e = elected[i];
          if (!e || e.tokenId === 0) {
            return (
              <div key={r.hash} className="text-center space-y-1.5 opacity-40">
                <div className="w-12 h-12 mx-auto border border-dashed border-[--border] flex items-center justify-center">
                  <span className="font-mono text-xs text-[--fg-muted]">—</span>
                </div>
                <p className="font-mono text-xs text-[--fg-muted]">{r.label}</p>
              </div>
            );
          }
          return (
            <div key={r.hash} className="text-center space-y-1.5">
              <div className="relative w-12 h-12 mx-auto overflow-hidden ring-2 ring-[--fg]">
                <Image
                  src={getNormieImageUrl(e.tokenId)}
                  alt={`#${e.tokenId}`}
                  fill
                  className="object-contain"
                  style={{ imageRendering: "pixelated" }}
                  unoptimized
                />
              </div>
              <p className="font-mono text-xs font-bold">#{e.tokenId}</p>
              <p className="font-mono text-[10px] text-[--fg-muted] leading-tight">{r.label}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Normie Activity Summary ──────────────────────────────────────────────────

function NormieSummary({ events, getName }: { events: ActivityEvent[]; getName: (id: number) => string }) {
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
        {sorted.map(([id, evs]) => {
          const name = getName(Number(id));
          return (
            <div key={id} className="text-center space-y-1.5">
              <div className="relative w-12 h-12 mx-auto overflow-hidden">
                <Image
                  src={getNormieImageUrl(Number(id))}
                  alt={name}
                  fill
                  className="object-contain"
                  style={{ imageRendering: "pixelated" }}
                  unoptimized
                />
              </div>
              <p className="font-mono text-xs font-bold truncate" title={name}>{name}</p>
              <p className="font-mono text-xs text-[--fg-muted]">{evs.length} actions</p>
            </div>
          );
        })}
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
  const [nameMap,  setNameMap]  = useState<Map<number, string>>(new Map());

  const getName = useCallback((id: number) => nameMap.get(id) ?? `#${id}`, [nameMap]);

  const loadEvents = useCallback(async () => {
    if (!CORE_ADDR) { setError("Contrats non configurés"); return; }
    setLoading(true);
    setError(null);

    try {
      // Public Base RPC limits eth_getLogs to 2 000 blocks per request.
      // We paginate in 2 000-block chunks and merge results.
      const CHUNK = 2_000n;
      const latest = await rpcClient.getBlockNumber();

      // Recent window: 30 000 blocks ≈ 16h for votes/sessions/works
      // Historical: 300 000 blocks ≈ 6.9 days for members/roles
      const recentFrom = latest > 30_000n  ? latest - 30_000n  : 0n;
      const histFrom   = latest > 300_000n ? latest - 300_000n : 0n;

      const getLogsChunked = async (
        args: Omit<Parameters<typeof rpcClient.getLogs>[0], "fromBlock" | "toBlock">,
        from: bigint,
        to: bigint,
      ): Promise<Awaited<ReturnType<typeof rpcClient.getLogs>>> => {
        const results: Awaited<ReturnType<typeof rpcClient.getLogs>> = [];
        let cursor = from;
        while (cursor <= to) {
          const end = cursor + CHUNK - 1n > to ? to : cursor + CHUNK - 1n;
          try {
            const chunk = await rpcClient.getLogs({ ...args, fromBlock: cursor, toBlock: end });
            results.push(...chunk);
          } catch { /* skip failed chunk, continue */ }
          cursor = end + 1n;
        }
        return results;
      };

      const [
        memberLogs, roleLogs, voteLogs,
        sessionOpenLogs, sessionCloseLogs,
        workLogs, workSessionLogs,
      ] = await Promise.all([
        getLogsChunked({ address: CORE_ADDR, event: MEMBER_REGISTERED }, histFrom,   latest),
        getLogsChunked({ address: CORE_ADDR, event: ROLE_GRANTED      }, histFrom,   latest),
        getLogsChunked({ address: CA_ADDR,   event: VOTE_CAST         }, recentFrom, latest),
        getLogsChunked({ address: CA_ADDR,   event: SESSION_OPENED    }, recentFrom, latest),
        getLogsChunked({ address: CA_ADDR,   event: SESSION_CLOSED    }, recentFrom, latest),
        getLogsChunked({ address: WR_ADDR,   event: WORK_PUBLISHED    }, recentFrom, latest),
        getLogsChunked({ address: WR_ADDR,   event: WORK_SESSION_INIT }, recentFrom, latest),
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

  // Batch-resolve persona names for all tokenIds seen in events
  useEffect(() => {
    const ids = [...new Set(events.flatMap(ev => [ev.tokenId, ev.candidateId].filter((id): id is number => !!id && id > 0)))]
      .filter(id => !nameMap.has(id));
    if (!ids.length) return;
    fetch(`/api/normies/persona?tokenIds=${ids.join(",")}`)
      .then(r => r.json())
      .then(d => {
        const resolved: [number, string][] = (d.personas ?? [])
          .filter((p: { name: string }) => p.name && !p.name.startsWith("Normie #"))
          .map((p: { tokenId: number; name: string }) => [p.tokenId, p.name] as [number, string]);
        if (resolved.length) setNameMap(prev => new Map([...prev, ...resolved]));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const filtered = filter === "ALL"
    ? events
    : events.filter(e => e.type === filter);

  return (
    <div className="space-y-8">
      {/* Elected roles — reads from getLeader() directly, no log scan */}
      {CA_ELECTED && <ElectedRolesPanel />}

      {/* Normie summary */}
      <NormieSummary events={events} getName={getName} />

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
              {filtered.length} événement{filtered.length > 1 ? "s" : ""} — derniers ~7j Base
            </p>
          </div>
          <div className="px-5">
            {filtered.map(ev => <ActivityRow key={ev.id} ev={ev} getName={getName} />)}
          </div>
        </div>
      )}
    </div>
  );
}
